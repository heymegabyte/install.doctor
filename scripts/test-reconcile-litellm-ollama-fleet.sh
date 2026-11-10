#!/usr/bin/env bash
# Regression gate for the Ollama GPU fleet reconciler (scripts/reconcile-litellm-ollama-fleet.sh),
# part of the rotate-eligible-gpu-ollama-fleet change. Guards its contract:
#   - only aliases with an existing ollama_chat/qwen2.5:7b-instruct template gain a deployment,
#   - each added entry carries the authenticated api_base + rpm + OLLAMA_GATEWAY_TOKEN,
#   - enrollment is idempotent (an already-enrolled origin returns 0 and writes nothing),
#   - a catalog with no eligible template adds nothing.
# Hermetic (mktemp fixtures, no network, no host mutation). This is the discoverable .sh form of the
# retired scripts/test-reconcile-litellm-ollama-fleet.py, so scripts/test-all.sh now actually runs it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECONCILE="$ROOT/scripts/reconcile-litellm-ollama-fleet.sh"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "reconcile-litellm-ollama-fleet — Ollama GPU fleet rotation guard"

# The reconciler delegates its YAML round-trip to python3 + pyyaml; a box without both cannot run it
# (or its contract), so skip honestly rather than false-fail (same convention as test-command-not-found.sh).
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import yaml' 2>/dev/null; then
  skip "reconciler needs python3 + pyyaml"
  say "reconcile-litellm-ollama-fleet: $P passed, $F failed"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/config.yaml"

fact() { printf '%s\n' "$FACTS" | awk -v k="$1" '$1 == k { print $2; exit }'; }

# Read back structural facts from the resulting YAML (COUNT + the last entry's fields).
facts_of() {
  python3 - "$1" <<'PY'
import sys
import yaml

with open(sys.argv[1]) as fh:
    data = yaml.safe_load(fh) or {}
models = data.get("model_list", [])
print("COUNT", len(models))
if models:
    last = models[-1]
    print("LAST_NAME", last.get("model_name"))
    lp = last.get("litellm_params", {})
    print("LAST_API_BASE", lp.get("api_base"))
    print("LAST_API_KEY", lp.get("api_key"))
    print("LAST_RPM", lp.get("rpm"))
    print("LAST_MODEL", lp.get("model"))
    print("LAST_IN_COST", lp.get("input_cost_per_token"))
    print("LAST_TIMEOUT", lp.get("timeout"))
    print("LAST_STREAM_TIMEOUT", lp.get("stream_timeout"))
    print("LAST_MAX_PAR", lp.get("max_parallel_requests"))
    print("LAST_NUM_CTX", lp.get("num_ctx"))
    mi = last.get("model_info", {}) or {}
    print("LAST_INFO_ID", mi.get("id", ""))
    print("LAST_TAGS", ",".join(mi.get("tags") or []))
PY
}

# --- 1. adds only the templated alias; skips non-template models ---
cat > "$CFG" <<'YAML'
model_list:
  - model_name: local-llm
    litellm_params:
      model: ollama_chat/qwen2.5:7b-instruct
      api_base: http://existing:11434
  - model_name: remote-only
    litellm_params:
      model: deepseek/deepseek-chat
YAML
out="$(bash "$RECONCILE" "$CFG" --api-base https://ollama.example.test --rpm 40)"
FACTS="$(facts_of "$CFG")"
[ "$out" = "1" ] && pass "adds exactly one deployment for the templated alias" || fail "expected 1 added, got '$out'"
[ "$(fact COUNT)" = "3" ] && pass "appends one entry (2 -> 3), never duplicates the non-template model" || fail "expected 3 entries, got '$(fact COUNT)'"
[ "$(fact LAST_NAME)" = "local-llm" ] && pass "added entry is the templated alias (local-llm)" || fail "added entry is '$(fact LAST_NAME)'"
[ "$(fact LAST_API_BASE)" = "https://ollama.example.test" ] && pass "added entry points at the authenticated origin" || fail "added api_base is '$(fact LAST_API_BASE)'"
[ "$(fact LAST_API_KEY)" = "os.environ/OLLAMA_GATEWAY_TOKEN" ] && pass "added entry uses the OLLAMA_GATEWAY_TOKEN env ref (no inline secret)" || fail "added api_key is '$(fact LAST_API_KEY)'"
[ "$(fact LAST_RPM)" = "40" ] && pass "added entry carries the requested rpm (40)" || fail "added rpm is '$(fact LAST_RPM)'"
[ "$(fact LAST_IN_COST)" = "0.0" ] && pass "added entry pins input_cost_per_token to 0.0" || fail "added input_cost_per_token is '$(fact LAST_IN_COST)'"
[ "$(fact LAST_TIMEOUT)" = "180" ] && pass "added entry defaults timeout to 180s" || fail "added timeout is '$(fact LAST_TIMEOUT)'"
[ "$(fact LAST_STREAM_TIMEOUT)" = "45" ] && pass "added entry defaults stream_timeout to 45s" || fail "added stream_timeout is '$(fact LAST_STREAM_TIMEOUT)'"
[ "$(fact LAST_TAGS)" = "local,ollama,gpu" ] && pass "added entry tags deployment as local,ollama,gpu" || fail "added tags are '$(fact LAST_TAGS)'"
[ "$(fact LAST_MAX_PAR)" = "8" ] && pass "added entry caps max_parallel_requests to 8 on Linux GPU" || fail "added max_parallel_requests is '$(fact LAST_MAX_PAR)'"
[ "$(fact LAST_NUM_CTX)" = "32768" ] && pass "added entry sets num_ctx to 32768 on qwen2.5 models" || fail "added num_ctx is '$(fact LAST_NUM_CTX)'"

# --- 2. idempotent for an already-enrolled origin ---
cat > "$CFG" <<'YAML'
model_list:
  - model_name: local-llm
    litellm_params:
      model: ollama_chat/qwen2.5:7b-instruct
      api_base: https://ollama.example.test
YAML
before="$(cat "$CFG")"
out="$(bash "$RECONCILE" "$CFG" --api-base https://ollama.example.test --rpm 60)"
[ "$out" = "0" ] && pass "already-enrolled origin returns 0 (no re-add)" || fail "expected 0 for enrolled origin, got '$out'"
[ "$(cat "$CFG")" = "$before" ] && pass "idempotent: enrolled origin leaves the config byte-for-byte unchanged" || fail "enrolled origin rewrote the config"

# --- 3. adds nothing when no eligible template exists ---
cat > "$CFG" <<'YAML'
model_list:
  - model_name: remote-only
    litellm_params:
      model: deepseek/deepseek-chat
YAML
out="$(bash "$RECONCILE" "$CFG" --api-base https://ollama.example.test --rpm 60)"
FACTS="$(facts_of "$CFG")"
[ "$out" = "0" ] && pass "no eligible qwen template -> 0 added" || fail "expected 0 when no template, got '$out'"
[ "$(fact COUNT)" = "1" ] && pass "no eligible template leaves the list at 1 entry (nothing invented)" || fail "expected 1 entry, got '$(fact COUNT)'"

# --- 4. supports explicit --template-model and derives unique model_info.id ---
cat > "$CFG" <<'YAML'
model_list:
  - model_name: ollama-coder
    litellm_params:
      model: ollama_chat/qwen2.5-coder:14b
      api_base: https://ollama-legion.example.test
    model_info:
      id: ollama-coder-legion-rtx4080
      description: Legion RTX 4080 node
YAML
out="$(bash "$RECONCILE" "$CFG" --api-base https://ollama-omen.example.test --rpm 60 --template-model ollama_chat/qwen2.5-coder:14b)"
FACTS="$(facts_of "$CFG")"
[ "$out" = "1" ] && pass "supports explicit --template-model (qwen2.5-coder:14b)" || fail "expected 1 added for explicit template-model, got '$out'"
[ "$(fact LAST_MODEL)" = "ollama_chat/qwen2.5-coder:14b" ] && pass "added deployment preserves requested template model" || fail "added model is '$(fact LAST_MODEL)'"
[ "$(fact LAST_INFO_ID)" = "ollama-coder-ollama-omen-example-test" ] && pass "derives unique model_info.id per enrolled origin" || fail "unexpected LAST_INFO_ID '$(fact LAST_INFO_ID)'"

say "reconcile-litellm-ollama-fleet: $P passed, $F failed"
[ "$F" -eq 0 ]
