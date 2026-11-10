#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-nginx.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/prefix/etc" "$TMP/root/etc/nginx"

cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env sh
printf 'Darwin\n'
SH
cat > "$TMP/bin/nginx" <<'SH'
#!/usr/bin/env sh
exit 0
SH
cat > "$TMP/bin/brew" <<'SH'
#!/usr/bin/env sh
[ "$1" = --prefix ] || exit 2
printf '%s\n' "$TEST_BREW_PREFIX"
SH
chmod 0700 "$TMP/bin/"*

# The production target is fixed at /etc/nginx. Source a rewritten fixture so
# the lifecycle can be exercised without touching the host's /etc.
sed "s@/etc/nginx@$TMP/root/etc/nginx@g" "$HOOK" > "$TMP/hook"
chmod 0700 "$TMP/hook"

if PATH="$TMP/bin:/usr/bin:/bin" TEST_BREW_PREFIX="$TMP/prefix" bash "$TMP/hook" --check; then
  printf '%s\n' 'check incorrectly accepted an absent link' >&2
  exit 1
else
  test "$?" -eq 10
fi
PATH="$TMP/bin:/usr/bin:/bin" TEST_BREW_PREFIX="$TMP/prefix" bash "$TMP/hook" --apply
PATH="$TMP/bin:/usr/bin:/bin" TEST_BREW_PREFIX="$TMP/prefix" bash "$TMP/hook" --verify
test "$(readlink "$TMP/prefix/etc/nginx")" = "$TMP/root/etc/nginx"

rm "$TMP/prefix/etc/nginx"
mkdir "$TMP/prefix/etc/nginx"
printf 'preserve\n' > "$TMP/prefix/etc/nginx/existing.conf"
if PATH="$TMP/bin:/usr/bin:/bin" TEST_BREW_PREFIX="$TMP/prefix" bash "$TMP/hook" --apply; then
  printf '%s\n' 'apply incorrectly replaced existing configuration' >&2
  exit 1
else
  test "$?" -eq 20
fi
test "$(cat "$TMP/prefix/etc/nginx/existing.conf")" = preserve

! rg -q 'rm[[:space:]]+-[A-Za-z]*r|rm[[:space:]]+-rf' "$HOOK"
printf '%s\n' 'nginx-typed-hook: 7 passed, 0 failed'
