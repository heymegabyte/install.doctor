#!/usr/bin/env bash
# D01-cov catalog COVERAGE (fire #143) — advances D01 (software.yml as the AUTHORITATIVE + COMPLETE catalog)
# with a drift-detection completeness gate. (NOT D04, which is provider-selection sharing.) Every post-installx hook
# (home/dot_local/bin/post-installx/executable_post-<tool>.sh) must map to EITHER a browseable catalog entry
# (catalog.json name/bin) OR an EXPLICIT, documented exemption (packages/control-plane/catalog-coverage-exemptions.json),
# so a configured-but-unbrowseable tool can't silently slip through (drift-detection). The exemption file
# documents WHY each exempt tool is not browseable (custom-install with no package-manager provider → gen-catalog
# skips it; or internal non-user-facing tooling). The gate also rejects STALE exemptions (no matching hook),
# REDUNDANT exemptions (the tool IS in the catalog), and exemptions with no reason. A LOCAL test (no network).
set -uo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
CAT="$dir/../packages/control-plane/src/catalog.json"
EXM="$dir/../packages/control-plane/catalog-coverage-exemptions.json"
HOOKS="$dir/../home/dot_local/bin/post-installx"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "catalog coverage (D01-completeness) @ $HOOKS"

# enumerate hook tool names (strip executable_post- + .sh/.tmpl; skip the _TEMPLATE scaffold)
hooks=$(ls -1 "$HOOKS" 2>/dev/null | grep -E '^executable_post-' | sed -E 's/^executable_post-//; s/\.sh(\.tmpl)?$//' | sort -u)
nhooks=$(printf '%s\n' "$hooks" | grep -c .)
[ "$nhooks" -gt 0 ] && pass "enumerated $nhooks post-installx hooks" || fail "no post-installx hooks found at $HOOKS"

incat() { jq -e --arg h "$1" 'any(.[]; .name==$h or .bin==$h)' "$CAT" >/dev/null 2>&1; }
isexempt() { [ -f "$EXM" ] && jq -e --arg h "$1" 'has($h)' "$EXM" >/dev/null 2>&1; }
exreason() { jq -r --arg h "$1" '.[$h]//""' "$EXM" 2>/dev/null; }

# (1) every hook is COVERED: in the browseable catalog OR explicitly exempt.
uncovered=""
for h in $hooks; do
  if incat "$h"; then :; elif isexempt "$h"; then :; else uncovered="$uncovered $h"; fi
done
[ -z "$uncovered" ] && pass "every post-installx hook maps to a catalog entry or a documented exemption (no silent orphan; D01-completeness)" || fail "uncovered hooks (no catalog entry + no exemption):$uncovered"

if [ -f "$EXM" ]; then
  # (2) no STALE exemption — every exemption key must correspond to a real hook (so the list can't rot).
  stale=""
  for k in $(jq -r 'keys[]' "$EXM" 2>/dev/null); do printf '%s\n' "$hooks" | grep -qx "$k" || stale="$stale $k"; done
  [ -z "$stale" ] && pass "no stale exemptions (every exemption has a live hook)" || fail "stale exemptions (no matching hook — remove them):$stale"
  # (3) no REDUNDANT exemption — an exempt tool must NOT already be in the catalog (else just let it be browseable).
  redundant=""
  for k in $(jq -r 'keys[]' "$EXM" 2>/dev/null); do incat "$k" && redundant="$redundant $k"; done
  [ -z "$redundant" ] && pass "no redundant exemptions (no exempt tool is already browseable)" || fail "redundant exemptions (tool IS in catalog — drop the exemption):$redundant"
  # (4) every exemption documents a non-empty reason (honesty — WHY it is not browseable).
  noreason=""
  for k in $(jq -r 'keys[]' "$EXM" 2>/dev/null); do [ -n "$(exreason "$k")" ] || noreason="$noreason $k"; done
  [ -z "$noreason" ] && pass "every exemption documents a reason" || fail "exemptions missing a reason:$noreason"
else
  fail "exemptions file missing ($EXM) — create it to document intentionally-unbrowseable hooks"
fi

say "catalog-coverage: $P passed, $F failed"
[ "$F" -eq 0 ]
