#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-groups"
CATALOG="$ROOT/packages/control-plane/src/catalog.json"

grep -Fq 'const systemIdentityPackages = loadPlan.items' "$PROVISION"
grep -Fq 'item.systemIdentityReconciliation === true' "$PROVISION"
grep -Fq '&& legacySelectedPackages.includes(item.name)' "$PROVISION"
grep -Fq 'const softwareGroupsTask = systemIdentityPackages.length > 0 ? {' "$PROVISION"
grep -Fq '...(softwareGroupsTask ? [softwareGroupsTask] : [])' "$PROVISION"
grep -Fq '...(softwareGroupsTask ? {' "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_SYSTEM_IDENTITY_PACKAGES: systemIdentityPackages.join' "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_SOFTWARE_GROUPS_PATH: softwareGroupsPath' "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_SOFTWARE_GROUPS_SHA256: softwareGroupsDigest' "$PROVISION"
grep -Fq "provisioning/home/dot_config/system/usr/local/bin/executable_process-software-groups" \
  "$ROOT/packages/desktop-tools-runtime/scripts/build.mjs"
grep -Fq 'INSTALL_DOCTOR_SYSTEM_IDENTITY_PACKAGES' "$PROCESSOR"
grep -Fq 'missing-engine-system-identity-selection' "$PROCESSOR"
jq -e 'any(.[]; .name == "rclone" and .systemIdentityReconciliation == true)' "$CATALOG" >/dev/null
jq -e '[.[] | select(.name == "ripgrep") | has("systemIdentityReconciliation")] | all(. == false)' "$CATALOG" >/dev/null
grep -Fq "task.id === 'desired.software-groups'" "$ROOT/scripts/test-bootstrap-install-acceptance.sh"

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
cat > "$TMP/process-software-groups" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = --check ] || : > "$PROCESSOR_APPLY_MARKER"
exit 0
SH
chmod 0700 "$TMP/process-software-groups"
DIGEST="$(shasum -a 256 "$TMP/process-software-groups" | awk '{print $1}')"
HOME="$TMP/home" PROCESSOR_APPLY_MARKER="$TMP/applied" INSTALL_DOCTOR_SOFTWARE_GROUPS_PATH="$TMP/process-software-groups" \
  INSTALL_DOCTOR_SOFTWARE_GROUPS_SHA256="$DIGEST" /bin/bash -c 'source "$1"; idRunVerifiedSoftwareGroupsProcessor apply' _ "$PROVISION"
test -f "$TMP/applied"
printf '# substituted\n' >> "$TMP/process-software-groups"
if HOME="$TMP/home" PROCESSOR_APPLY_MARKER="$TMP/substituted-applied" INSTALL_DOCTOR_SOFTWARE_GROUPS_PATH="$TMP/process-software-groups" \
  INSTALL_DOCTOR_SOFTWARE_GROUPS_SHA256="$DIGEST" /bin/bash -c 'source "$1"; idRunVerifiedSoftwareGroupsProcessor apply' _ "$PROVISION"; then
  printf '%s\n' 'substituted software-groups processor was accepted' >&2
  exit 1
fi
test ! -e "$TMP/substituted-applied"

printf '%s\n' 'selected-system-identity-boundary: 18 passed, 0 failed'
