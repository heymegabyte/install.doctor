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
grep -Fq 'INSTALL_DOCTOR_SYSTEM_IDENTITY_PACKAGES' "$PROCESSOR"
grep -Fq 'missing-engine-system-identity-selection' "$PROCESSOR"
jq -e 'any(.[]; .name == "rclone" and .systemIdentityReconciliation == true)' "$CATALOG" >/dev/null
jq -e '[.[] | select(.name == "ripgrep") | has("systemIdentityReconciliation")] | all(. == false)' "$CATALOG" >/dev/null
grep -Fq "task.id === 'desired.software-groups'" "$ROOT/scripts/test-bootstrap-install-acceptance.sh"

printf '%s\n' 'selected-system-identity-boundary: 12 passed, 0 failed'
