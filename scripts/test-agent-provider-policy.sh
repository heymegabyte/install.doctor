#!/usr/bin/env bash
# Locks the boundary between internal agent throughput routing and aid product inference.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0

ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }
assert_file_has() {
  file="$1"
  pattern="$2"
  label="$3"
  if grep -Eqi "$pattern" "$ROOT/$file"; then ok "$label"; else bad "$label"; fi
}

for entry in AGENTS.md CLAUDE.md CODEX.md GEMINI.md .agents/rules/antigravity.md; do
  assert_file_has "$entry" 'agent-provider-policy' "$entry points to the canonical provider policy"
  assert_file_has "$entry" 'OpenCode' "$entry identifies OpenCode as the internal throughput harness"
  assert_file_has "$entry" 'LiteLLM' "$entry identifies the internal LiteLLM rail"
  assert_file_has "$entry" '(Ollama|local model)' "$entry preserves local-model routing"
  assert_file_has "$entry" '(swarm|fan-out)' "$entry requires parallelism assessment"
done

assert_file_has AGENTS.md 'product runtime' 'AGENTS.md scopes the no-LiteLLM exception to product runtime'
assert_file_has AGENTS.md 'ProjectSites routing' 'AGENTS.md preserves Desktop Tools ProjectSites routing'
assert_file_has AGENTS.md 'preferred and no LiteLLM' 'AGENTS.md preserves Desktop Tools no-LiteLLM runtime boundary'
assert_file_has CODEX.md 'ProjectSites/no-LiteLLM' 'CODEX.md preserves the product runtime boundary'
assert_file_has GEMINI.md 'ProjectSites.*without LiteLLM' 'GEMINI.md preserves the product runtime boundary'
assert_file_has CLAUDE.md 'ProjectSites routing without LiteLLM' 'CLAUDE.md preserves the product runtime boundary'

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
