#!/usr/bin/env bash
# Served-entrypoint drift guard (new-arc "the deployed entrypoints must actually serve" + no-dead-claim, #204).
# install.doctor serves standalone bootstrap scripts at short URLs via site/firebase.json `redirects`
# (e.g. /start → scripts/provision.sh). docs/scripts/overview/utility.md DOCUMENTS each script→URL mapping as
# a public contract. A documented URL with NO redirect 404s — a dead claim (found #204: /brew + /ssh were
# documented but had no redirect → both 404 while /start was 200). This guard locks the doc ↔ serving-config
# in sync: every `scripts/<x>.sh → https://install.doctor/<ep>` row in utility.md MUST have a matching
# `"source": "/<ep>"` redirect in firebase.json whose destination serves that script. Pure file assertions.
# NOTE: this verifies the serving CONFIG; the live deploy is Firebase-gated (site-deploy needs the
# FIREBASE_SERVICE_ACCOUNT secret, CLAUDE.md §9) — a correct redirect goes live on the next site deploy.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UTIL="$ROOT/docs/scripts/overview/utility.md"
FB="$ROOT/site/firebase.json"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "served-entrypoint drift (utility.md ↔ firebase.json redirects)"

[ -f "$UTIL" ] && pass "utility.md present" || fail "utility.md missing ($UTIL)"
[ -f "$FB" ] && pass "site/firebase.json present" || fail "firebase.json missing ($FB)"
if command -v python3 >/dev/null 2>&1 && [ -f "$FB" ]; then
  python3 -c "import json,sys; json.load(open('$FB'))" 2>/dev/null && pass "firebase.json is valid JSON" || fail "firebase.json is INVALID JSON"
fi

# Every utility.md row mapping `scripts/<x>.sh` → `https://install.doctor/<ep>` is a served-URL contract.
# Here-string (not a pipe) so the pass/fail counters survive (no subshell).
pairs="$(grep -E '`scripts/[a-z.-]+`' "$UTIL" 2>/dev/null | grep 'install.doctor/' \
  | sed -E 's#.*`(scripts/[a-z.-]+)`.*install\.doctor/([a-z]+).*#\2 \1#' | grep -E '^[a-z]+ scripts/')"
if [ -z "$pairs" ]; then
  fail "no documented script→URL entrypoint rows found in utility.md (extraction broke?)"
else
  while read -r ep script; do
    [ -z "$ep" ] && continue
    sfile="$(basename "$script")"
    if grep -qE "\"source\": \"/$ep\"" "$FB" && grep -qE "$sfile\"" "$FB"; then
      pass "/$ep is served — firebase.json redirects it to $script (documented in utility.md)"
    else
      fail "/$ep is DOCUMENTED (→ $script) but has NO matching firebase.json redirect → it 404s (dead claim)"
    fi
  done <<< "$pairs"
fi

say "served-entrypoints: $P passed, $F failed"
[ "$F" -eq 0 ]
