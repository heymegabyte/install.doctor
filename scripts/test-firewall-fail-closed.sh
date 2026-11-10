#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-firewall.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'preserve\n' > "$TMP/host-state"

if HOME="$TMP/home" SUDO_PASSWORD=secret INFISICAL_TOKEN=secret INSTALL_DOCTOR_FIREWALL=1 bash "$HOOK"; then
  printf '%s\n' 'selected firewall incorrectly reported configured' >&2
  exit 1
else
  test "$?" -eq 20
fi
test "$(cat "$TMP/host-state")" = preserve
INSTALL_DOCTOR_FIREWALL=0 bash "$HOOK"

! rg -q 'get-secret|infisical|SUDO_PASSWORD|sudo|apt-get|ufw|systemctl|socketfilterfw|/etc/' "$HOOK"
! rg -q '^# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1$' "$HOOK"
printf '%s\n' 'firewall-fail-closed: 5 passed, 0 failed'
