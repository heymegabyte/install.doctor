#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-zfs-prep.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
printf 'preserve\n' > "$TMP/pool-state"
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env sh
printf 'Linux\n'
SH
cat > "$TMP/bin/zpool" <<'SH'
#!/usr/bin/env sh
[ "$1" = list ] && printf 'rpool\n'
SH
chmod 0700 "$TMP/bin/"*

if PATH="$TMP/bin:/usr/bin:/bin" SUDO_PASSWORD=secret ENABLE_ZFS_PREP=1 bash "$HOOK"; then
  printf '%s\n' 'selected ZFS lifecycle incorrectly reported configured' >&2
  exit 1
else
  test "$?" -eq 20
fi
test "$(cat "$TMP/pool-state")" = preserve

! rg -q 'get-secret|SUDO_PASSWORD|sudo|apt-get|zfs[[:space:]]+(create|set|destroy)|zpool[[:space:]]+(scrub|clear|replace|detach)|systemctl|/sys/module|/etc/' "$HOOK"
! rg -q '^# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1$' "$HOOK"
printf '%s\n' 'zfs-prep-fail-closed: 4 passed, 0 failed'
