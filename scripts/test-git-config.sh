#!/usr/bin/env bash
# Git-config modernization gate (fire #364 — from the #362 home/dot_config 20-idea audit). The template
# home/dot_config/git/private_config.tmpl renders the user's global git config. It already ships a strong modern
# baseline (delta pager + Betelgeuse theme, diff.colorMoved, interactive.diffFilter, rerere, fetch.prune,
# push.autoSetupRemote, transfer.fsckobjects); this gate REGRESSION-LOCKS those AND requires the 2026 gaps the
# audit found: merge.conflictstyle=zdiff3 (git 2.35+ — strictly cleaner conflict markers than diff3),
# rebase.autostash, and difftastic wired as a NAMED difftool (`git dft`) so delta stays the daily pager while
# difftastic is the on-demand structural diff (the recommended delta+difft pairing). The settings asserted here
# are literal (not {{ }}-templated), so grep is valid; chezmoi validates the full render separately. No network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GC="${GIT_CONFIG_TMPL:-$ROOT/home/dot_config/git/private_config.tmpl}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qE "$2" "$1" 2> /dev/null; }

say "git-config modernization (private_config.tmpl)"

if [ ! -f "$GC" ]; then
  fail "git config template MISSING ($GC)"
  say "git-config: $P passed, $F failed"
  exit 1
fi
pass "git config template present"

# --- Modern baseline (regression-lock the already-present good settings) ---
has "$GC" 'pager = delta' && pass "core.pager = delta (syntax-highlighted pager)" || fail "core.pager = delta LOST"
has "$GC" 'diffFilter = delta --color-only' && pass "interactive.diffFilter = delta (colored add -p)" || fail "interactive.diffFilter LOST"
has "$GC" 'colorMoved = default' && pass "diff.colorMoved = default (moved-line detection)" || fail "diff.colorMoved LOST"
if has "$GC" '^\[rerere\]' && has "$GC" 'enabled = true'; then pass "rerere enabled (reuse recorded conflict resolutions)"; else fail "rerere LOST"; fi
has "$GC" 'prune = true' && pass "fetch.prune = true (prune deleted remote branches)" || fail "fetch.prune LOST"
has "$GC" 'autoSetupRemote = true' && pass "push.autoSetupRemote = true (no --set-upstream dance)" || fail "push.autoSetupRemote LOST"
has "$GC" 'fsckobjects = true' && pass "transfer.fsckobjects = true (supply-chain object integrity)" || fail "transfer.fsckobjects LOST"

# --- 2026 additions (#364 — RED before this fire) ---
has "$GC" 'conflictstyle = zdiff3' && pass "merge.conflictstyle = zdiff3 (git 2.35+ — cleaner conflict markers than diff3)" || fail "merge.conflictstyle must be zdiff3 (was diff3) — 2026 best practice"
has "$GC" 'autostash = true' && pass "rebase.autostash = true (auto-stash/pop around rebase)" || fail "rebase.autostash = true MISSING"
has "$GC" 'difftool "difftastic"' && pass "difftastic wired as a named difftool — 'git dft' structural diff; delta stays the daily pager" || fail "difftastic difftool NOT wired (delta+difft pairing)"

say "git-config: $P passed, $F failed"
[ "$F" -eq 0 ]
