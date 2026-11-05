#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$ROOT/home/dot_local/bin/executable_syncoid-ssh-wrapper"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat >"$TMP/bin/zfs" <<'SH'
#!/bin/sh
printf '%s\n' "$@"
SH
chmod +x "$TMP/bin/zfs"

PATH="$TMP/bin:$PATH" SSH_ORIGINAL_COMMAND='zfs list -H -o name rpool/data' "$WRAPPER" >"$TMP/allowed"
grep -Fxq 'list' "$TMP/allowed"
grep -Fxq 'rpool/data' "$TMP/allowed"

reject() {
  if PATH="$TMP/bin:$PATH" SSH_ORIGINAL_COMMAND="$1" "$WRAPPER" >/dev/null 2>&1; then
    printf 'accepted unsafe command: %s\n' "$1" >&2
    exit 1
  fi
}

reject 'zfs list; id'
reject 'zfs list && id'
reject 'zfs list $(id)'
reject 'zfs list > /tmp/leak'
reject 'zfs destroy rpool/data'
reject 'zfs send rpool/data@snap --output=/tmp/leak'
reject '/bin/sh -c id'
reject 'zpool status; id'

echo 'syncoid-ssh-wrapper: PASS'
