#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-vim.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --check; then
  printf '%s\n' 'check incorrectly accepted missing state' >&2
  exit 1
else
  test "$?" -eq 10
fi

HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply
HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --verify

data_inode="$(stat -f '%i' "$TMP/data/nvim" 2>/dev/null || stat -c '%i' "$TMP/data/nvim")"
state_inode="$(stat -f '%i' "$TMP/state/nvim" 2>/dev/null || stat -c '%i' "$TMP/state/nvim")"
HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply
test "$data_inode" = "$(stat -f '%i' "$TMP/data/nvim" 2>/dev/null || stat -c '%i' "$TMP/data/nvim")"
test "$state_inode" = "$(stat -f '%i' "$TMP/state/nvim" 2>/dev/null || stat -c '%i' "$TMP/state/nvim")"

rm -rf "$TMP/data/nvim"
ln -s "$TMP/outside" "$TMP/data/nvim"
if HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply; then
  printf '%s\n' 'apply incorrectly accepted a symlinked managed path' >&2
  exit 1
fi
test ! -e "$TMP/outside"

printf '%s\n' 'vim-typed-hook: 7 passed, 0 failed'
