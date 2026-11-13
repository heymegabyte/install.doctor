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

inode_of() {
  stat -c '%i' "$1" 2>/dev/null || stat -f '%i' "$1"
}

data_inode="$(inode_of "$TMP/data/nvim")"
state_inode="$(inode_of "$TMP/state/nvim")"
HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply
test "$data_inode" = "$(inode_of "$TMP/data/nvim")"
test "$state_inode" = "$(inode_of "$TMP/state/nvim")"

rm -rf "$TMP/data/nvim"
ln -s "$TMP/outside" "$TMP/data/nvim"
if HOME="$TMP/home" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply; then
  printf '%s\n' 'apply incorrectly accepted a symlinked managed path' >&2
  exit 1
fi
test ! -e "$TMP/outside"

# Restore valid nvim data dir and verify vim state/undo + legacy syncolor recursion file remediation
rm -f "$TMP/data/nvim"
HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/config" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply
test -d "$TMP/state/vim/undo"
test ! -L "$TMP/state/vim/undo"

mkdir -p "$TMP/config/vim/colors/lists" "$TMP/home/.vim/colors/lists"
printf '%s\n' '" legacy Betelgeuse rogue default.vim' > "$TMP/config/vim/colors/lists/default.vim"
printf '%s\n' '" legacy Betelgeuse rogue default.vim' > "$TMP/home/.vim/colors/lists/default.vim"

if HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/config" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --check; then
  printf '%s\n' 'check incorrectly accepted legacy colors/lists/default.vim' >&2
  exit 1
else
  test "$?" -eq 10
fi

HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/config" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --apply
HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/config" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" bash "$HOOK" --verify
test ! -e "$TMP/config/vim/colors/lists/default.vim"
test ! -e "$TMP/home/.vim/colors/lists/default.vim"

printf '%s\n' 'vim-typed-hook: 12 passed, 0 failed'
