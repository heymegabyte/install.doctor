#!/usr/bin/env bash
# X11 gate — the resume ledger NEXT-STEPS.md must stay COMPACT (the loop reads it every fire) while
# preserving all DURABLE state. Asserts a size budget AND that the authoritative pointers survive:
# the TOP-next block, the CONVERGENCE NOTE's gated blockers (O/K#7/N02), the Blockers section, the
# matrix pointer, and freshness (a recent fire). Prevents re-bloat (the fire-by-fire log must be
# collapsed, not accreted). Pure file assertions, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/NEXT-STEPS.md"
BUDGET="${NEXT_STEPS_BYTE_BUDGET:-16000}" # ratchet: may only go DOWN (20000→16000 at #202 after the compaction)

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
# Freshness — references a recent fire.
chkre "#7[0-9]|#8[0-9]" "freshness: references a recent fire (>=70)"

say "next-steps: $P passed, $F failed"
[ "$F" -eq 0 ]
