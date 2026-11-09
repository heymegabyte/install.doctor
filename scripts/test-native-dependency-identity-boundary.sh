#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/native-dependency-identity.XXXXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/bin" "$TMP/state"

curl_path="$TMP/bin/curl"
rsync_path="$TMP/bin/rsync"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$curl_path"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$rsync_path"
chmod 0755 "$curl_path" "$rsync_path"

# Exercise the production functions against an isolated fixed-path fixture.
sed -e "s#/usr/bin/curl#$curl_path#g" -e "s#/usr/bin/rsync#$rsync_path#g" \
  "$ROOT/scripts/provision.sh" > "$TMP/provision.sh"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

curl_sha="$(sha256_file "$curl_path")"
rsync_sha="$(sha256_file "$rsync_path")"
export XDG_STATE_HOME="$TMP/state"
export INSTALL_DOCTOR_CURL_PATH="$curl_path" INSTALL_DOCTOR_CURL_SHA256="$curl_sha"
export INSTALL_DOCTOR_RSYNC_PATH="$rsync_path" INSTALL_DOCTOR_RSYNC_SHA256="$rsync_sha"
export INSTALL_DOCTOR_NATIVE_MANAGER_SHA256="$(printf 'a%.0s' {1..64})"

# shellcheck source=/dev/null
source "$TMP/provision.sh"
# Native package managers create root-owned binaries. Keep the fixture
# unprivileged while faithfully presenting that ownership boundary.
stat() {
  local path="${!#}"
  case "$path" in
    "$curl_path"|"$rsync_path"|"$TMP/bin")
      case "${1:-}" in
        -f|-c) printf '0 755\n' ;;
        *) return 1 ;;
      esac
      ;;
    *) command stat "$@" ;;
  esac
}
test "$(idTrustedBootstrapDependency curl)" = "$curl_path"
test "$(idTrustedBootstrapDependency rsync)" = "$rsync_path"

printf '\n# changed\n' >> "$curl_path"
if idTrustedBootstrapDependency curl >/dev/null 2>&1; then
  printf 'changed curl retained stale plan authority\n' >&2
  exit 1
fi

INSTALL_DOCTOR_CURL_SHA256=absent
export INSTALL_DOCTOR_CURL_SHA256
idRecordBootstrapDependencyReceipt curl
test "$(idTrustedBootstrapDependency curl)" = "$curl_path"

receipt="$XDG_STATE_HOME/install.doctor/engine/effects/bootstrap-curl-created.receipt"
ln "$receipt" "$TMP/receipt-hardlink"
if idTrustedBootstrapDependency curl >/dev/null 2>&1; then
  printf 'hard-linked creation receipt retained authority\n' >&2
  exit 1
fi
rm -f "$TMP/receipt-hardlink"

printf '\n# substituted\n' >> "$curl_path"
if idTrustedBootstrapDependency curl >/dev/null 2>&1; then
  printf 'substituted created curl retained receipt authority\n' >&2
  exit 1
fi

printf 'native-dependency-identity-boundary: 7 passed, 0 failed\n'
