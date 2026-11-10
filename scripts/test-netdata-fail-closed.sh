#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-netdata.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/evidence"
printf 'preserve\n' > "$TMP/evidence/host-state"
cat > "$TMP/bin/netdata" <<'SH'
#!/usr/bin/env sh
exit 0
SH
chmod 0700 "$TMP/bin/netdata"

if PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" bash "$HOOK"; then
  printf '%s\n' 'installed Netdata incorrectly reported configured' >&2
  exit 1
else
  test "$?" -eq 20
fi
test "$(cat "$TMP/evidence/host-state")" = preserve

! rg -q 'get-secret|netdata-claim|sudo|systemctl|chown|/sys/kernel|cp[[:space:]]+-' "$HOOK"
! rg -q '^# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1$' "$HOOK"
printf '%s\n' 'netdata-fail-closed: 4 passed, 0 failed'
