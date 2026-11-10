#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-hishtory.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/.hishtory"

cat > "$TMP/bin/hishtory" <<'SH'
#!/usr/bin/env bash
: > "$HISHTORY_EXECUTED"
exit 99
SH
cat > "$TMP/bin/get-secret" <<'SH'
#!/usr/bin/env bash
: > "$SECRET_READ"
printf '%s\n' 'fixture-secret-that-must-not-be-read'
SH
chmod 0700 "$TMP/bin/hishtory" "$TMP/bin/get-secret"

if HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" HISHTORY_EXECUTED="$TMP/executed" SECRET_READ="$TMP/secret-read" \
  bash "$HOOK"; then
  printf '%s\n' 'uninitialized hook incorrectly reported success' >&2
  exit 1
else
  test "$?" -eq 20
fi
test ! -e "$TMP/executed"
test ! -e "$TMP/secret-read"

: > "$TMP/home/.hishtory/.hishtory.db"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" HISHTORY_EXECUTED="$TMP/executed" SECRET_READ="$TMP/secret-read" \
  bash "$HOOK"
test ! -e "$TMP/executed"
test ! -e "$TMP/secret-read"

! rg -q '\$\(get-secret|HISHTORY_SECRET|^[[:space:]]*hishtory init' "$HOOK"
printf '%s\n' 'hishtory-secret-boundary: 7 passed, 0 failed'
