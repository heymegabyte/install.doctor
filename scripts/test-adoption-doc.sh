#!/usr/bin/env bash
# X07 gate — the adoption/migration guide exists, names the REAL adoption mechanics that ship today
# (chezmoi already owns dotfiles · aid-pair enrols without duplicating · _bin-aware detection avoids
# reinstalls · shells/profiles preserved · desired state is ADDITIVE via the one revisioned write path
# · aid apply is opt-in), and is HONEST that there is no legacy auto-conversion engine (A07 ◐) and no
# per-host repo import yet (I ⬜). No "automatically migrates your old config" fabrication. No network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/adoption.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "adoption doc (X07)"

if [ -s "$DOC" ]; then
  lc="$(wc -l <"$DOC" | tr -d ' ')"
  [ "$lc" -ge 40 ] && pass "adoption.md exists + substantial (${lc} lines)" || fail "doc too thin (${lc} lines, want >=40)"
else
  fail "adoption.md missing ($DOC)"
  say "adoption: $P passed, $F failed"
  exit 1
fi

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# The real adoption mechanics.
chk "chezmoi" "chezmoi already owns dotfiles (no re-import)"
chk "aid-pair" "enrol the existing host (no duplicate identity)"
chkre "already (present|installed)|detect|_bin|bin-aware|not reinstall" "adopt already-installed apps/CLIs (detected present, not reinstalled)"
chkre "preserv" "preserves shells/profiles/pkg-managers (B12)"
chkre "additive|one (revisioned )?write path|does not clobber|non-destructive" "desired state is additive / non-clobbering"
chkre "opt-in|aid apply|--yes|dry-run" "nothing installs without explicit apply (opt-in)"
chkre "resume|re-run|idempotent|duplicat" "resume without duplicating hosts/steps (B10)"

# HONESTY about what adoption does NOT do yet.
chkre "no (automatic|legacy).*conversion|not (auto|automatically) (convert|migrat)|manual" "honest: no legacy auto-conversion engine (A07 ◐)"
chkre "repo import|I ⬜|per-host repo|not yet" "honest: per-host repo import not built (I ⬜)"

# NO-FABRICATION: never claim it auto-migrates an existing config.
grep -qiE "automatically migrates your|auto-imports your (existing )?config|one-click migrat" "$DOC" && fail "fabricated 'automatically migrates your config' claim" || pass "no fabricated auto-migration claim (A07 honest)"

say "adoption: $P passed, $F failed"
[ "$F" -eq 0 ]
