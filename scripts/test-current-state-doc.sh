#!/usr/bin/env bash
# X14 gate — CURRENT-STATE.md must reflect the HONEST CONVERGED state (the loop reads it FIRST each
# fire, so a stale one mis-orients every future fire). Asserts: freshness (mentions a recent fire),
# names the live dashboard read surfaces + the honest-docs set + the test-all suite, names the GATED
# external-dep blockers, and carries NO stale control-plane count. Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/CURRENT-STATE.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "CURRENT-STATE doc (X14)"

if [ -s "$DOC" ]; then
  pass "CURRENT-STATE.md exists"
else
  fail "CURRENT-STATE.md missing ($DOC)"
  say "CURRENT-STATE: $P passed, $F failed"
  exit 1
fi

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# Freshness — must reference a recent fire (>= 70), not be stuck at the early audit.
chkre "#7[0-9]|#8[0-9]|fire #7[0-9]" "freshness: references a recent fire (>=70)"

# Live dashboard read surfaces (shipped — must NOT still be listed only as Absent).
chk "Machines" "live read surface: Machines"
chk "App Store" "live read surface: App Store"
chk "Environment" "live read surface: Environment"
chk "Recommendations" "live read surface: Recommendations"

# The honest-docs set + the one-command suite.
chkre "getting-started|api-reference|operations|provenance|adoption|platform-support" "names the honest-docs set"
chkre "test-all|315 assertion|19 suites" "names the one-command test aggregator"

# The GATED external-dep blockers (honest 'remaining needs external action').
chkre "Better Auth|O.series" "names the Better-Auth blocker (O)"
chkre "#7|AI Gateway|provider call" "names the provider-call blocker (K/#7)"
chkre "Figma|N02" "names the Figma redesign gate (N02)"

# NO stale control-plane assertion count (67/67 was the fire-#31 figure).
grep -qF "67/67" "$DOC" && fail "stale control-plane count '67/67' still present" || pass "no stale '67/67' control-plane count"
# Machines must not still be asserted as Absent.
grep -qiE "Absent.*Machines|Machines.*(still )?Absent|the 5 nav sections \(Machines" "$DOC" && fail "Machines still listed as Absent (stale)" || pass "Machines not listed as Absent (reflects shipped reality)"

# A14 (ledgers-from-evidence) — the headline "N assertions / 33 suites GREEN" count MUST agree across
# all 3 ledgers (CURRENT-STATE + NEXT-STEPS + REQUIREMENTS). When a fire bumps the count it must bump all
# three together; a stale one is a lying ledger the next fire inherits (the drift manually reconciled in
# #169 + #173 — now a deterministic guard, the assertion-count sibling of the catalog-count guard #159).
# Matches both "asserts" (NEXT-STEPS) and "assertions" (CURRENT-STATE/REQUIREMENTS); the "/ 33 suites
# GREEN" anchor excludes the "N→M" per-fire transition records. Internal consistency across ledgers.
_lc() { grep -oE '[0-9]+ assert(ion)?s? / 33 suites GREEN' "$1" 2> /dev/null | head -1 | grep -oE '^[0-9]+'; }
cs_n="$(_lc "$DOC")"
ns_n="$(_lc "$ROOT/docs/aid/NEXT-STEPS.md")"
rq_n="$(_lc "$ROOT/docs/aid/REQUIREMENTS.md")"
if [ -n "$cs_n" ] && [ "$cs_n" = "$ns_n" ] && [ "$cs_n" = "$rq_n" ]; then
  pass "assertion-count headline agrees across all 3 ledgers ($cs_n)"
else
  fail "assertion-count DRIFT across ledgers: CURRENT-STATE=$cs_n NEXT-STEPS=$ns_n REQUIREMENTS=$rq_n (bump all 3 together)"
fi

say "CURRENT-STATE: $P passed, $F failed"
[ "$F" -eq 0 ]
