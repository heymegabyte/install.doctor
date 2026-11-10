#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMMAND="$ROOT/home/dot_local/bin/executable_squash-symlink"
work=$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-squash-symlink.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

printf 'preserved\n' > "$work/source"
chmod 640 "$work/source"
ln -s source "$work/link"
bash "$COMMAND" "$work/link"

test ! -L "$work/link"
test "$(cat "$work/link")" = preserved
test "$(stat -f '%Lp' "$work/link" 2>/dev/null || stat -c '%a' "$work/link")" = 640

ln -s missing "$work/broken"
if bash "$COMMAND" "$work/broken" >/dev/null 2>&1; then
  printf 'squash-symlink: broken target unexpectedly succeeded\n' >&2
  exit 1
fi
test -L "$work/broken"

printf 'squash-symlink: copy and failure-preservation checks passed\n'
