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

# Freshness — the HEADLINE "Refreshed: fire #N" must name a recent fire (>= 70). The loop reads this doc
# FIRST, so a stale headline mis-orients every fire. Anchor on the Refreshed LINE: the prior regex matched
# any #7x/#8x in the BODY, so (a) it couldn't detect a stale headline and (b) it was capped at #70-89 — a
# headline at #90+ only "passed" via incidental body mentions. Also assert the headline fire# AGREES with
# NEXT-STEPS' CONVERGENCE-NOTE "refreshed #N" (both bumped every fire; a divergence = one ledger went stale).
cs_fire="$(grep 'Refreshed' "$DOC" | head -1 | grep -oE 'fire #[0-9]+' | head -1 | grep -oE '[0-9]+')"
if [ -n "$cs_fire" ] && [ "$cs_fire" -ge 70 ]; then
  pass "freshness: CURRENT-STATE headline names a recent fire (#$cs_fire >= 70)"
else
  fail "freshness: CURRENT-STATE headline fire# '$cs_fire' missing or < 70 (stale/early-audit)"
fi
ns_fire="$(grep -oE 'CONVERGENCE NOTE \(refreshed #[0-9]+' "$ROOT/docs/aid/NEXT-STEPS.md" | head -1 | grep -oE '[0-9]+')"
if [ -n "$cs_fire" ] && [ "$cs_fire" = "$ns_fire" ]; then
  pass "freshness: headline fire# agrees across CURRENT-STATE + NEXT-STEPS (#$cs_fire)"
else
  fail "freshness DRIFT: CURRENT-STATE fire#=$cs_fire NEXT-STEPS fire#=$ns_fire (bump both together)"
fi

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

# A14 (ledgers-from-evidence) — the headline "N assertions / 45 suites GREEN" count MUST agree across
# all 3 ledgers (CURRENT-STATE + NEXT-STEPS + REQUIREMENTS). When a fire bumps the count it must bump all
# three together; a stale one is a lying ledger the next fire inherits (the drift manually reconciled in
# #169 + #173 — now a deterministic guard, the assertion-count sibling of the catalog-count guard #159).
# Matches both "asserts" (NEXT-STEPS) and "assertions" (CURRENT-STATE/REQUIREMENTS); the "/ 45 suites
# GREEN" anchor excludes the "N→M" per-fire transition records. Internal consistency across ledgers.
_lc() { grep -oE '[0-9]+ assert(ion)?s? / 45 suites GREEN' "$1" 2> /dev/null | head -1 | grep -oE '^[0-9]+'; }
cs_n="$(_lc "$DOC")"
ns_n="$(_lc "$ROOT/docs/aid/NEXT-STEPS.md")"
rq_n="$(_lc "$ROOT/docs/aid/REQUIREMENTS.md")"
if [ -n "$cs_n" ] && [ "$cs_n" = "$ns_n" ] && [ "$cs_n" = "$rq_n" ]; then
  pass "assertion-count headline agrees across all 3 ledgers ($cs_n)"
else
  fail "assertion-count DRIFT across ledgers: CURRENT-STATE=$cs_n NEXT-STEPS=$ns_n REQUIREMENTS=$rq_n (bump all 3 together)"
fi

# X12 (rank improvements by value/reliability/effort/recurring-cost) — a durable RANKED backlog must exist
# at docs/aid/BACKLOG.md naming the human-gated unblocks (O04 · K/#7 · I/J · N02) WITH a value+effort
# ranking, so the converged loop hands the operator a clear "unblock this FIRST" decision aid (the master
# prompt names a BACKLOG as loop-state; it was absent until #177). Honest: a gated item is never "done".
BL="$ROOT/docs/aid/BACKLOG.md"
if [ -s "$BL" ] \
  && grep -qiE "O04|better auth" "$BL" && grep -qiE "K/#?7|orchestrator|provider call" "$BL" \
  && grep -qiE "I/J|per-host repo|restic" "$BL" && grep -qiE "N02|figma" "$BL" \
  && grep -qiE "value" "$BL" && grep -qiE "effort" "$BL"; then
  pass "X12 ranked BACKLOG.md exists + ranks the gated unblocks (O04/K#7/I/J/N02) by value+effort"
else
  fail "X12 BACKLOG.md missing/incomplete ($BL) — must rank O04/K#7/I/J/N02 with value+effort"
fi

# Arc-narrative byte ratchet (#212) — the "Refreshed: fire #N" line (3) was accreting one per-fire clause
# EVERY fire (#198→#211 grew it to ~3.5 KB), bloating the doc that is read FIRST each fire. Collapse the
# per-fire history into `git log` + the sections below; a DOWN-ONLY ratchet (like X11's NEXT-STEPS budget)
# stops the re-accretion. Lower it as the summary tightens; never raise it.
LINE3_RATCHET="${LINE3_RATCHET:-1200}"
l3="$(awk 'NR==3{print length($0)}' "$DOC")"
if [ -n "$l3" ] && [ "$l3" -le "$LINE3_RATCHET" ]; then
  pass "arc-narrative line 3 is ${l3}B <= ratchet ${LINE3_RATCHET} (no per-fire clause accretion)"
else
  fail "arc-narrative line 3 is ${l3}B > ratchet ${LINE3_RATCHET} — collapse the per-fire clause chain into git log + the sections below (lower the ratchet, never raise it)"
fi

# MASTER-PROMPT currency (#217) — NEXT-STEPS calls docs/aid/MASTER-PROMPT.md the "full spec (SSOT; the cron
# references it)". It had DRIFTED to the retired v2 banner ("the loop now runs the Install Doctor v2 master
# prompt (cron 4002f61a)") while the live cron 5eaf1b85 has run the bootstrap-QUALITY prompt since #198.
# Assert the SSOT reflects the CURRENT arc: the bootstrap pivot + the live cron + the
# app.install.doctor→desktop.tools retirement, so a session reading the "full spec" isn't misled into v2.
MP="$ROOT/docs/aid/MASTER-PROMPT.md"
if [ -f "$MP" ] && grep -qiF 'bootstrap' "$MP" && grep -qF '5eaf1b85' "$MP" && grep -qiF 'desktop.tools' "$MP"; then
  pass "MASTER-PROMPT.md SSOT reflects the current bootstrap-quality arc (cron 5eaf1b85 + desktop.tools retirement)"
else
  fail "MASTER-PROMPT.md SSOT is STALE — must name the bootstrap pivot + the live cron 5eaf1b85 + the app.install.doctor→desktop.tools retirement (it currently describes the retired v2)"
fi

# REQUIREMENTS.md header cron-currency (#218 — same stale-cron drift class as #217's MASTER-PROMPT fix).
# Its resume header must cite the CURRENT loop cron (5eaf1b85), not present the superseded v2 cron
# (4002f61a) as the active /loop driver, so the matrix doc isn't read as a still-running-v2 spec.
RQ="$ROOT/docs/aid/REQUIREMENTS.md"
if [ -f "$RQ" ] && grep -qF '5eaf1b85' "$RQ" && ! grep -qF '4002f61a' "$RQ"; then
  pass "REQUIREMENTS.md cites the current loop cron 5eaf1b85 + carries ZERO stale v2 4002f61a reference"
else
  fail "REQUIREMENTS.md still references the superseded v2 cron 4002f61a (its matrix is driven by the current loop 5eaf1b85) — drop 4002f61a"
fi

# The master prompt instructs every session to "Read .claude/run-the-loop/ + docs/aid/ loop state FIRST",
# but the real loop state lives in docs/aid/ — .claude/run-the-loop/ was ABSENT, so a session literally
# following that instruction found nothing (#219). Assert a pointer exists there redirecting to the
# docs/aid/ loop-state docs, so the prompt's instructed entry-point resolves instead of dead-ending.
RTL="$ROOT/.claude/run-the-loop/README.md"
if [ -f "$RTL" ] && grep -qF 'CURRENT-STATE.md' "$RTL" && grep -qF 'NEXT-STEPS.md' "$RTL"; then
  pass ".claude/run-the-loop/ pointer exists + redirects to the docs/aid/ loop state (the prompt's instructed read-path resolves)"
else
  fail ".claude/run-the-loop/ has no README pointer to the docs/aid/ loop state — the prompt says to read it FIRST but it is empty"
fi

say "CURRENT-STATE: $P passed, $F failed"
[ "$F" -eq 0 ]
