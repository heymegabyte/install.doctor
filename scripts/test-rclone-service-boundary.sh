#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG="$ROOT/software.yml"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-rclone.sh"
PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-services"
PROVISION="$ROOT/scripts/provision.sh"
LINUX_PRIVATE="$ROOT/home/dot_config/system/etc/systemd/system/s3-private.service.tmpl"
LINUX_PUBLIC="$ROOT/home/dot_config/system/etc/systemd/system/s3-public.service.tmpl"
MAC_PRIVATE="$ROOT/home/Library/LaunchDaemons/rclone.private.plist.tmpl"
MAC_PUBLIC="$ROOT/home/Library/LaunchDaemons/rclone.public.plist.tmpl"

[ "$(yq -r '.softwarePackages.rclone._serviceEnabled' "$CATALOG")" = false ]
reason="$(yq -r '.softwarePackages.rclone._serviceBlockedReason' "$CATALOG")"
printf '%s' "$reason" | grep -Fq 'Fail closed:'
printf '%s' "$reason" | grep -Fq 'check/apply/verify'
[ "$(yq -r '.softwarePackages | with_entries(select(.value._default != false and .value._serviceEnabled == true)) | keys[]' "$CATALOG" | grep -c '^rclone$' || true)" -eq 0 ]

for definition in "$LINUX_PRIVATE" "$LINUX_PUBLIC" "$MAC_PRIVATE" "$MAC_PUBLIC"; do
  [ -f "$definition" ]
done
grep -Fq 'RClone S3 (Private)' "$LINUX_PRIVATE"
grep -Fq 'RClone S3 (Public)' "$LINUX_PUBLIC"
grep -Fq '<string>rclone.private</string>' "$MAC_PRIVATE"
grep -Fq '<string>rclone.public</string>' "$MAC_PUBLIC"

# The user hook must never regain hidden privileged account, mount, or service
# authority. Those effects belong to a future platform-specific typed owner.
if rg -q 'sudo|systemctl|launchctl|load-service|add-usergroup|/var/(cache|log)/rclone|/mnt/(Private|Public)|/Volumes/(Private|Public)' "$HOOK"; then
  printf '%s\n' 'rclone user hook contains a forbidden privileged/service effect' >&2
  exit 1
fi
grep -Fq '.value._serviceEnabled == true' "$PROCESSOR"
grep -Fq 'unknown-or-inapplicable-service' "$PROCESSOR"
grep -Fq "selectedServices.some(service => service !== 'alloy')" "$PROVISION"
grep -Fq 'selected services are unsupported without exact manager-specific installer-engine authority' "$PROVISION"
! grep -Fq "id: 'desired.services'" "$PROVISION"
! grep -Fq "'desired-services-apply'" "$PROVISION"

printf '%s\n' 'rclone-service-boundary: 19 passed, 0 failed'
