#!/usr/bin/env bash
# A12 gate — architectural decisions are recorded with alternatives + consequences. Every ADR under
# docs/aid/decisions/ must be well-formed (Status + Context + Decision + a Counterargument/Rationale +
# Consequences), and the big one-way-door decisions must each HAVE an ADR. This closes the A12 gap where
# the Better Auth sign-in choice (#102 — the Phase-3 keystone) shipped with no decision record.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEC="$ROOT/docs/aid/decisions"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "ADR hygiene (A12)"

[ -d "$DEC" ] || { fail "decisions dir missing ($DEC)"; say "adr: $P passed, $F failed"; exit 1; }

n="$(ls "$DEC"/[0-9]*.md 2>/dev/null | wc -l | tr -d ' ')"
[ "$n" -ge 4 ] && pass "decisions/ has $n ADRs (>=4)" || fail "expected >=4 ADRs, found $n"

# Every ADR is well-formed — records the DECISION, its alternatives (Counterargument/Rationale), and
# the migration CONSEQUENCES (A12: "with alternatives and migration consequences").
bad=0
for f in "$DEC"/[0-9]*.md; do
  base="$(basename "$f")"
  grep -qE '\*\*Status:\*\*' "$f" || { fail "$base: no **Status:** line"; bad=1; }
  grep -qE '^## Context' "$f" || { fail "$base: no ## Context"; bad=1; }
  grep -qE '^## Decision' "$f" || { fail "$base: no ## Decision"; bad=1; }
  grep -qE '^## (Counterargument|Rationale|Alternatives|Why )' "$f" || { fail "$base: no alternatives section (Counterargument/Rationale/Alternatives/Why …)"; bad=1; }
  grep -qE '^## Consequences' "$f" || { fail "$base: no ## Consequences (migration consequences)"; bad=1; }
done
[ "$bad" = 0 ] && pass "every ADR well-formed (Status + Context + Decision + alternatives + Consequences; A12)" || true

# The one-way-door decisions each have an ADR (the ones this project actually made).
grep -rqiE 'better.?auth' "$DEC"/[0-9]*.md && pass "the Better Auth sign-in decision is recorded (ADR; #102 keystone)" || fail "no ADR records the Better Auth / sign-in decision (A12 gap)"
grep -rqiE 'hishtory|atuin' "$DEC"/[0-9]*.md && pass "the shell-history (hiSHtory) decision is recorded" || fail "no ADR for the shell-history decision"
grep -rqiE 'device token|hashed.?opaque' "$DEC"/[0-9]*.md && pass "the device-token decision is recorded" || fail "no ADR for the device-token decision"
# fire #116 — the catalog-enrichment-from-declared-fields PATTERN (#110-115: how the App Store/plan surface
# software.yml's declared `_`-fields, and WHY only explicit-declared + measure-first, no AI-generation) is a
# substantial repeated architectural decision → must be recorded so the pattern + its measured rejections endure.
grep -rqiE 'catalog.enrichment' "$DEC"/[0-9]*.md && pass "the catalog-enrichment-from-declared-fields decision is recorded (ADR; #110-115 pattern)" || fail "no ADR records the catalog-enrichment pattern (A12 gap)"

say "adr: $P passed, $F failed"
[ "$F" -eq 0 ]
