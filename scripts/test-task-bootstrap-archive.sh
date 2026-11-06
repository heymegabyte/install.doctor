#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/task-bootstrap.sh
. "$ROOT/scripts/lib/task-bootstrap.sh"

FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/task-bootstrap-test.XXXXXXXX")"
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT HUP INT TERM

pass_count=0
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { pass_count=$((pass_count + 1)); printf 'PASS: %s\n' "$*"; }
expect_rejected() {
  local archive="$1" label="$2" workspace="$FIXTURE_ROOT/check-$pass_count"
  mkdir -p "$workspace"
  if task_bootstrap_preflight_archive "$archive" "$workspace" >/dev/null 2>&1; then
    fail "$label was accepted"
  fi
  pass "$label is rejected"
}

make_transformed_archive() {
  local archive="$1" from="$2" to="$3" source="$4"
  if tar --version 2>/dev/null | grep -qi bsdtar; then
    tar -P -czf "$archive" -s ",${from},${to}," "$source"
  else
    tar -P -czf "$archive" --transform="s,${from},${to}," "$source"
  fi
}

mkdir -p "$FIXTURE_ROOT/valid"
printf '#!/bin/sh\nexit 0\n' > "$FIXTURE_ROOT/valid/task"
chmod 0755 "$FIXTURE_ROOT/valid/task"
tar -czf "$FIXTURE_ROOT/valid.tar.gz" -C "$FIXTURE_ROOT/valid" task
mkdir "$FIXTURE_ROOT/valid-check"
task_bootstrap_preflight_archive "$FIXTURE_ROOT/valid.tar.gz" "$FIXTURE_ROOT/valid-check"
pass 'one regular task member is accepted'

[ "$(task_bootstrap_platform macos)" = darwin ] || fail 'macOS mapping changed'
[ "$(task_bootstrap_platform alpine)" = linux ] || fail 'Linux mapping changed'
[ "$(task_bootstrap_arch x86_64)" = amd64 ] || fail 'x86_64 mapping changed'
[ "$(task_bootstrap_arch arm64)" = arm64 ] || fail 'arm64 mapping changed'
if task_bootstrap_platform plan9 >/dev/null 2>&1 || task_bootstrap_arch mips64 >/dev/null 2>&1; then
  fail 'unknown platform or architecture fell back to a release asset'
fi
pass 'unknown platform and architecture fail closed'

for asset in \
  task_darwin_amd64.tar.gz task_darwin_arm64.tar.gz \
  task_linux_386.tar.gz task_linux_amd64.tar.gz task_linux_arm.tar.gz task_linux_arm64.tar.gz; do
  checksum="$(task_bootstrap_sha256 "$asset")"
  binary_checksum="$(task_bootstrap_binary_sha256 "$asset")"
  case "$checksum" in
    *[!0-9a-f]*|'') fail "invalid pinned checksum for $asset" ;;
  esac
  case "$binary_checksum" in
    *[!0-9a-f]*|'') fail "invalid pinned binary checksum for $asset" ;;
  esac
  [ "${#checksum}" -eq 64 ] || fail "wrong checksum length for $asset"
  [ "${#binary_checksum}" -eq 64 ] || fail "wrong binary checksum length for $asset"
done
if task_bootstrap_sha256 task_linux_mips64.tar.gz >/dev/null 2>&1 \
  || task_bootstrap_binary_sha256 task_linux_mips64.tar.gz >/dev/null 2>&1; then
  fail 'unknown Task asset received a checksum'
fi
pass 'the complete supported asset matrix has exact SHA-256 pins'

mkdir -p "$FIXTURE_ROOT/version"
printf '#!/bin/sh\nprintf "3.54.0\\n"\n' > "$FIXTURE_ROOT/version/task"
chmod 0755 "$FIXTURE_ROOT/version/task"
fixture_checksum="$(task_bootstrap_hash_file "$FIXTURE_ROOT/version/task")"
task_bootstrap_is_expected_binary "$FIXTURE_ROOT/version/task" "$fixture_checksum" || fail 'pinned version was rejected'
printf '#!/bin/sh\nprintf "3.55.0\\n"\n' > "$FIXTURE_ROOT/version/task"
if task_bootstrap_is_expected_binary "$FIXTURE_ROOT/version/task" "$fixture_checksum"; then
  fail 'non-pinned Task version was accepted'
fi
pass 'only the pinned executable version is accepted'

mkdir -p "$FIXTURE_ROOT/renamed"
cp "$FIXTURE_ROOT/valid/task" "$FIXTURE_ROOT/renamed/payload"
(
  cd "$FIXTURE_ROOT/renamed"
  make_transformed_archive "$FIXTURE_ROOT/traversal.tar.gz" '^payload$' '../task' payload
  make_transformed_archive "$FIXTURE_ROOT/absolute.tar.gz" '^payload$' '/task' payload
)
expect_rejected "$FIXTURE_ROOT/traversal.tar.gz" 'parent traversal member'
expect_rejected "$FIXTURE_ROOT/absolute.tar.gz" 'absolute member'

mkdir -p "$FIXTURE_ROOT/link"
ln -s /bin/sh "$FIXTURE_ROOT/link/task"
tar -czf "$FIXTURE_ROOT/link.tar.gz" -C "$FIXTURE_ROOT/link" task
expect_rejected "$FIXTURE_ROOT/link.tar.gz" 'symbolic link member'

mkdir -p "$FIXTURE_ROOT/special"
mkfifo "$FIXTURE_ROOT/special/task"
tar -czf "$FIXTURE_ROOT/special.tar.gz" -C "$FIXTURE_ROOT/special" task
expect_rejected "$FIXTURE_ROOT/special.tar.gz" 'special-file member'

tar -czf "$FIXTURE_ROOT/duplicate.tar.gz" -C "$FIXTURE_ROOT/valid" task task
expect_rejected "$FIXTURE_ROOT/duplicate.tar.gz" 'duplicate member'

mkdir -p "$FIXTURE_ROOT/collision/one" "$FIXTURE_ROOT/collision/two"
cp "$FIXTURE_ROOT/valid/task" "$FIXTURE_ROOT/collision/one/task"
cp "$FIXTURE_ROOT/valid/task" "$FIXTURE_ROOT/collision/two/task"
(
  cd "$FIXTURE_ROOT/collision"
  if tar --version 2>/dev/null | grep -qi bsdtar; then
    tar -czf "$FIXTURE_ROOT/collision.tar.gz" \
      -s ',^one/task$,collision,' -s ',^two/task$,collision/child,' one/task two/task
  else
    tar -czf "$FIXTURE_ROOT/collision.tar.gz" \
      --transform='s,^one/task$,collision,' --transform='s,^two/task$,collision/child,' one/task two/task
  fi
)
expect_rejected "$FIXTURE_ROOT/collision.tar.gz" 'file/directory type collision'

printf 'Task bootstrap archive tests passed: %s assertions.\n' "$pass_count"
