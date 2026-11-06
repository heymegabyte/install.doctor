#!/usr/bin/env bash
set -euo pipefail
# @file Rclone S3 Mounts
# @brief Reconciles the user's protected, Infisical-backed Cloudflare R2 remote
# @description
#     Install Doctor leverages Rclone and CloudFlare R2 to provide S3-compliant bucket mounts that allow you to retain stateful files and configurations.
#     In general, these buckets are used for backing up files like your browser profiles, Docker backup files, and other files that cannot be stored as
#     as code in your Install Doctor fork.
#
#     This hook owns only its delimited block in the user's rclone.conf. Secrets are resolved through get-secret (Infisical on enrolled targets),
#     held in mode-0600 temporary files, and never printed. Account creation, system configuration, mount directories, and service lifecycle are
#     intentionally outside this user-scoped hook; they require separate typed desired-state operations and must not be inferred from a prior receipt.
#
#     The managed remote is reconciled without replacing unrelated remotes or comments. A malformed, duplicate, or symlinked configuration
#     fails closed. Service and mount reconciliation must be implemented by their service owner before it can be enabled again.
#
#     ## Links
#
#     * [Rclone mount script](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_local/bin/executable_rclone-mount)
#     * [Rclone default configurations](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_config/rclone)
#     * [Rclone documentation](https://rclone.org/docs/)

set -Eeo pipefail

START='# INSTALL DOCTOR MANAGED S3 START'
END='# INSTALL DOCTOR MANAGED S3 END'
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/rclone/rclone.conf"
CHEZMOI_DATA="${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml"
TMP_BLOCK=''
TMP_CONFIG=''
cleanup() { [ -z "$TMP_BLOCK" ] || rm -f -- "$TMP_BLOCK"; [ -z "$TMP_CONFIG" ] || rm -f -- "$TMP_CONFIG"; }
trap cleanup EXIT HUP INT TERM

mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null; }
owner_uid() { stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1" 2>/dev/null; }

prerequisites() {
  command -v rclone >/dev/null 2>&1 || return 20
  command -v yq >/dev/null 2>&1 || return 20
  command -v get-secret >/dev/null 2>&1 || return 20
  [ -f "$CHEZMOI_DATA" ] && [ ! -L "$CHEZMOI_DATA" ] || return 20
  R2_ENDPOINT="$(yq '.data.user.cloudflare.r2' "$CHEZMOI_DATA")"
  [ -n "$R2_ENDPOINT" ] && [ "$R2_ENDPOINT" != null ] || return 20
  case "$R2_ENDPOINT" in *[!A-Za-z0-9.-]*) return 2 ;; esac
  case "$USER" in ''|*[!A-Za-z0-9._-]*) return 2 ;; esac
  get-secret --exists CLOUDFLARE_R2_ID_USER CLOUDFLARE_R2_SECRET_USER || return 20
}

build_block() {
  local ACCESS SECRET
  umask 077
  TMP_BLOCK="$(mktemp "${TMPDIR:-/tmp}/install-doctor-rclone-block.XXXXXX")" || return 1
  ACCESS="$(get-secret CLOUDFLARE_R2_ID_USER)" || return 1
  SECRET="$(get-secret CLOUDFLARE_R2_SECRET_USER)" || return 1
  [ -n "$ACCESS" ] && [ -n "$SECRET" ] || return 1
  case "$ACCESS$SECRET" in *$'\n'*|*$'\r'*) return 2 ;; esac
  printf '%s\n' "$START" "[$USER-s3]" "access_key_id = $ACCESS" 'acl = private' \
    "endpoint = ${R2_ENDPOINT}.r2.cloudflarestorage.com" 'provider = Cloudflare' 'region = auto' \
    "secret_access_key = $SECRET" 'type = s3' "$END" > "$TMP_BLOCK"
  unset ACCESS SECRET
  chmod 600 "$TMP_BLOCK"
}

managed_block_count() { grep -cF "$START" "$CONFIG_FILE" 2>/dev/null || true; }

config_matches() {
  [ -f "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] || return 1
  [ "$(managed_block_count)" -eq 1 ] || return 1
  [ "$(grep -cF "$END" "$CONFIG_FILE" 2>/dev/null || true)" -eq 1 ] || return 1
  awk -v start="$START" -v end="$END" '$0 == start {inside=1} inside {print} $0 == end {exit}' "$CONFIG_FILE" | cmp -s - "$TMP_BLOCK"
}

state_check() {
  prerequisites || return $?
  build_block || return 2
  config_matches || return 10
  [ "$(mode "$CONFIG_FILE")" = 600 ] || return 10
  [ "$(owner_uid "$CONFIG_FILE")" = "$(id -u)" ] || return 10
  return 0
}

apply_config() {
  local DIRECTORY
  prerequisites || return $?
  build_block || return 2
  DIRECTORY="$(dirname "$CONFIG_FILE")"
  [ ! -L "$DIRECTORY" ] || return 2
  mkdir -p "$DIRECTORY"
  if [ -e "$CONFIG_FILE" ] && { [ ! -f "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; }; then return 2; fi
  [ "$(managed_block_count)" -le 1 ] || return 2
  TMP_CONFIG="$(mktemp "$DIRECTORY/.rclone.conf.install-doctor.XXXXXX")" || return 1
  if [ -f "$CONFIG_FILE" ]; then
    awk -v start="$START" -v end="$END" '
      $0 == start { if (inside) exit 42; inside=1; next }
      $0 == end { if (!inside) exit 43; inside=0; next }
      !inside { print }
      END { if (inside) exit 44 }
    ' "$CONFIG_FILE" > "$TMP_CONFIG" || return 2
  fi
  cat "$TMP_BLOCK" >> "$TMP_CONFIG"
  chmod 600 "$TMP_CONFIG"
  if [ -f "$CONFIG_FILE" ] && cmp -s "$TMP_CONFIG" "$CONFIG_FILE" \
    && [ "$(mode "$CONFIG_FILE")" = 600 ] && [ "$(owner_uid "$CONFIG_FILE")" = "$(id -u)" ]; then return 0; fi
  mv -f "$TMP_CONFIG" "$CONFIG_FILE"; TMP_CONFIG=''
}

case "${1:---apply}" in
  --check) state_check ;;
  --apply) apply_config ;;
  --verify) state_check; STATUS=$?; [ "$STATUS" -eq 0 ] && exit 0; [ "$STATUS" -eq 20 ] && exit 20; exit 2 ;;
  *) printf 'usage: %s [--check|--apply|--verify]\n' "$0" >&2; exit 2 ;;
esac
