#!/usr/bin/env bash
# X11 gate — the resume ledger NEXT-STEPS.md must stay COMPACT (the loop reads it every fire) while
# preserving all DURABLE state. Asserts a size budget AND that the authoritative pointers survive:
# the TOP-next block, the CONVERGENCE NOTE's gated blockers (O/K#7/N02), the Blockers section, the
# matrix pointer, and freshness (a recent fire). Prevents re-bloat (the fire-by-fire log must be
# collapsed, not accreted). Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/NEXT-STEPS.md"
BUDGET="${NEXT_STEPS_BYTE_BUDGET:-14800}" # ratchet: may only go DOWN (20000→16000 #202 · 16000→15500 #297 host-gated→BACKLOG · 15500→15000 #302 per-fire-enum→git log · 15000→14800 #310 collapsed the per-gate drained-list into a RANGE summary)

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "NEXT-STEPS compaction (X11)"

if [ ! -s "$DOC" ]; then
  fail "NEXT-STEPS.md missing ($DOC)"
  say "next-steps: $P passed, $F failed"
  exit 1
fi

bytes="$(wc -c <"$DOC" | tr -d ' ')"
[ "$bytes" -lt "$BUDGET" ] && pass "compact: ${bytes} bytes < ${BUDGET} budget" || fail "BLOATED: ${bytes} bytes >= ${BUDGET} budget — collapse the fire-by-fire log"

chk() { grep -qiF "$1" "$DOC" && pass "durable-state kept: '$1' ($2)" || fail "durable-state LOST: '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# Durable resume state MUST survive the compaction.
chk "TOP next" "the authoritative next-slice pointer"
chkre "CONVERGENCE NOTE|GATED" "the convergence / gated-work note"
chk "## Blockers" "the external-blockers section"
chk "REQUIREMENTS.md" "the matrix pointer"
# The gated external-dep blockers (the thing a human must act on).
chkre "Better Auth" "blocker O (Better Auth)"
chkre "#7|AI Gateway" "blocker K/#7 (provider call)"
chkre "Figma|N02" "blocker N02 (Figma redesign)"
# Freshness — extract the CONVERGENCE NOTE's "refreshed #N" (bumped EVERY fire) + assert it's recent (>=70),
# tracking the CURRENT era. The prior check matched a fixed "#7x/#8x" string, which (a) FALSE-PASSED a stale
# ledger as long as any old #7x reference lingered (the only one left was an incidental "#72" while the ledger
# is at #310+), and (b) would FALSE-FAIL the moment a de-bloat removed that reference. Mirrors X14's freshness.
ns_fire="$(grep -oE 'CONVERGENCE NOTE \(refreshed #[0-9]+' "$DOC" | head -1 | grep -oE '[0-9]+')"
if [ -n "$ns_fire" ] && [ "$ns_fire" -ge 70 ]; then
  pass "freshness: CONVERGENCE NOTE names a recent fire (#$ns_fire >= 70) — tracks the current era, not a fixed #7x window"
else
  fail "freshness: CONVERGENCE NOTE 'refreshed #N' missing or < 70 (#${ns_fire:-none}) — the resume ledger looks stale"
fi

say "next-steps: $P passed, $F failed"
[ "$F" -eq 0 ]
