#!/usr/bin/env bash
# Removal-wave ledger guard (repository-wide-convergence tasks 27/29): the two removal waves must stay
# implemented — retired QA fixtures and dead assets must NOT be restored, and the ledger JSON must stay
# internally consistent. This was previously an orphaned Python test (test-removal-implementation-ledger.py)
# that `scripts/test-all.sh` never discovered (its glob only matches `test-*.sh`), so the removal waves were
# silently un-gated — a restored asset or re-added QA fixture would pass the suite unnoticed. Ported to Bash
# so the one-command suite runs it and the tree honors the "prefer Bash over Python for tests" directive.
#
# Division of labor: the "role-specific wave-1 tools remain lazy" assertion (software.yml `_preload: true`
# must not re-adopt the 52 role-specific tools) is already enforced by scripts/test-preload-policy.sh; this
# guard asserts the LEDGER-consistency and file-removal halves only, so the two don't drift apart.
# Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="$ROOT/.agent/removal-implementation-ledger.json"
QA_ROOT="$ROOT/home/dot_local/share/ansible/environments/qa"

say()  { command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "removal-wave implementation ledger"

if [ ! -f "$LEDGER" ]; then fail "ledger missing ($LEDGER)"; say "removal-implementation-ledger: $P passed, $F failed"; exit 1; fi
if ! command -v jq >/dev/null 2>&1; then fail "jq required to validate the ledger JSON"; say "removal-implementation-ledger: $P passed, $F failed"; exit 1; fi

# jq -e returns 0 only when the final expression is truthy.
jq -e 'type == "object" and (.implemented | type) == "number" and (.minimumImplemented | type) == "number"' "$LEDGER" >/dev/null 2>&1 \
  && pass "ledger is a valid JSON object with numeric implemented/minimumImplemented" \
  || fail "ledger JSON is malformed or missing numeric counts"

jq -e '.implemented >= .minimumImplemented and .minimumImplemented >= 100' "$LEDGER" >/dev/null 2>&1 \
  && pass "implemented >= minimumImplemented >= 100 (was $(jq -r .implemented "$LEDGER"))" \
  || fail "implemented ($(jq -r .implemented "$LEDGER")) < minimumImplemented ($(jq -r .minimumImplemented "$LEDGER")) or < 100"

DELIVERY="$(jq -c '[.deliveryWaves[].count]' "$LEDGER" 2>/dev/null || true)"
[ "$DELIVERY" = "[52,50]" ] \
  && pass "delivery waves are [52,50]" \
  || fail "delivery-wave counts are $DELIVERY, expected [52,50]"

jq -e '([.deliveryWaves[].count] | add) == .implemented' "$LEDGER" >/dev/null 2>&1 \
  && pass "delivery-wave counts sum to implemented" \
  || fail "delivery-wave counts do not sum to implemented"

jq -e '([.waves[].count] | add) == .implemented' "$LEDGER" >/dev/null 2>&1 \
  && pass "wave counts sum to implemented" \
  || fail "wave counts do not sum to implemented"

QA_COUNT="$(jq -r '.waves[] | select(.id == "security-qa-fixture-removal") | .count' "$LEDGER" 2>/dev/null || true)"
[ "$QA_COUNT" = "38" ] \
  && pass "security-qa-fixture-removal records 38 removed files" \
  || fail "security-qa-fixture-removal count is '$QA_COUNT', expected 38"

if [ -d "$QA_ROOT" ] && [ -n "$(find "$QA_ROOT" -type f 2>/dev/null)" ]; then
  fail "retired QA fixture files were restored ($(find "$QA_ROOT" -type f | wc -l | tr -d ' ') file(s))"
else
  pass "no retired QA fixture files were restored"
fi

ASSETS_COUNT="$(jq -r '.waves[] | select(.id == "dead-generated-and-duplicate-assets") | .count' "$LEDGER" 2>/dev/null || true)"
ASSETS_LEN="$(jq -r '.waves[] | select(.id == "dead-generated-and-duplicate-assets") | .paths | length' "$LEDGER" 2>/dev/null || true)"
[ "$ASSETS_COUNT" = "12" ] && [ "$ASSETS_LEN" = "12" ] \
  && pass "dead-generated-and-duplicate-assets records 12 paths" \
  || fail "dead-assets count=$ASSETS_COUNT paths.len=$ASSETS_LEN, expected 12/12"

restored=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ -e "$ROOT/$p" ]; then fail "removed asset was restored: $p"; restored=$((restored + 1)); fi
done < <(jq -r '.waves[] | select(.id == "dead-generated-and-duplicate-assets") | .paths[]' "$LEDGER" 2>/dev/null)
[ "$restored" -eq 0 ] && pass "none of the 12 removed dead assets were restored"

say "removal-implementation-ledger: $P passed, $F failed"
[ "$F" -eq 0 ]
