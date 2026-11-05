#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/fleet-storage-assess.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if "$script" --host 'bad;host' --output "$tmp/bad" >/dev/null 2>&1; then
  echo 'FAIL: accepted shell metacharacters in host' >&2
  exit 1
fi

mkdir "$tmp/bin"
cat >"$tmp/bin/ssh" <<'MOCK'
#!/bin/sh
printf 'synthetic read-only output\n'
MOCK
chmod +x "$tmp/bin/ssh"
PATH="$tmp/bin:$PATH" "$script" --host fixture.example --output "$tmp/evidence" >/dev/null

test -s "$tmp/evidence/status.tsv"
test "$(stat -f '%Lp' "$tmp/evidence/status.tsv" 2>/dev/null || stat -c '%a' "$tmp/evidence/status.tsv")" = 600
grep -q $'identity\tok' "$tmp/evidence/status.tsv"
grep -q 'observed evidence, not desired state' "$tmp/evidence/README.txt"

if PATH="$tmp/bin:$PATH" "$script" --host fixture.example --output "$tmp/evidence" >/dev/null 2>&1; then
  echo 'FAIL: overwrote prior evidence' >&2
  exit 1
fi

for forbidden in 'zpool clear' 'zpool import' 'zpool detach' 'zpool replace' 'zpool scrub' 'zfs destroy' 'zfs receive'; do
  if grep -v '^#' "$script" | grep -Fq "$forbidden"; then
    echo "FAIL: mutating command present: $forbidden" >&2
    exit 1
  fi
done

echo 'fleet-storage-assess: PASS'
