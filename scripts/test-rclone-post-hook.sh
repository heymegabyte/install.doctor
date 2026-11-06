#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-rclone.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/rclone-post-hook.XXXXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/bin" "$TMP/home/.config/chezmoi" "$TMP/home/.config/rclone"
printf '%s\n' 'fixture' > "$TMP/home/.config/chezmoi/chezmoi.yaml"

cat > "$TMP/bin/rclone" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$TMP/bin/yq" <<'SH'
#!/usr/bin/env bash
printf '%s\n' account-id
SH
cat > "$TMP/bin/get-secret" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = --exists ]; then exit 0; fi
case "${1:-}" in
  CLOUDFLARE_R2_ID_USER) printf '%s\n' access-fixture ;;
  CLOUDFLARE_R2_SECRET_USER) printf '%s\n' secret-fixture ;;
  *) exit 1 ;;
esac
SH
chmod 700 "$TMP/bin/"*
export PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/home/.config" USER=fixture
CONFIG="$XDG_CONFIG_HOME/rclone/rclone.conf"
printf '%s\n' '[preserved]' 'value = yes' > "$CONFIG"
chmod 600 "$CONFIG"

set +e
bash "$HOOK" --check
status=$?
set -e
[ "$status" -eq 10 ]
bash "$HOOK" --apply
bash "$HOOK" --verify
grep -Fq '[preserved]' "$CONFIG"
grep -Fq 'access_key_id = access-fixture' "$CONFIG"
grep -Fq 'secret_access_key = secret-fixture' "$CONFIG"
[ "$(stat -c '%a' "$CONFIG" 2>/dev/null || stat -f '%Lp' "$CONFIG")" = 600 ]
[ "$(stat -c '%u' "$CONFIG" 2>/dev/null || stat -f '%u' "$CONFIG")" = "$(id -u)" ]
before="$(cksum "$CONFIG")"
bash "$HOOK" --check
bash "$HOOK" --apply
bash "$HOOK" --verify
[ "$(cksum "$CONFIG")" = "$before" ]

printf '\n%s\n' '# INSTALL DOCTOR MANAGED S3 START' >> "$CONFIG"
set +e
bash "$HOOK" --apply >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 2 ]

rm -f "$TMP/bin/get-secret"
set +e
bash "$HOOK" --check >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 20 ]

printf '%s\n' 'rclone-post-hook: 12 passed, 0 failed'
