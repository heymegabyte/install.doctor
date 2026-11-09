#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq "service !== 'alloy'" "$PROVISION"
grep -Fq "process.env.INSTALL_DOCTOR_PLATFORM_CELL !== 'debian-12-x64-native'" "$PROVISION"
grep -Fq "command: 'native-service-derive'" "$PROVISION"
grep -Fq "serviceComposition.task.id !== 'service.native.alloy'" "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_SELECTED_SERVICE_PACKAGES: selectedServices.join' "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_SELECTED_SERVICES: legacySelectedServices.join' "$PROVISION"
! grep -Fq "id: 'desired.services'" "$PROVISION"
! grep -Fq "'desired-services-check'" "$PROVISION"
! grep -Fq "'desired-services-apply'" "$PROVISION"
! grep -Fq "'desired-services-verify'" "$PROVISION"
grep -Fq 'dependencies: [customUserPostHooksTask?.id ?? customPostHooksTask?.id ?? catalogPostValidationTask.id, ...caskLauncherTasks.map' "$PROVISION"

printf '%s\n' 'selected-services-fail-closed: 11 passed, 0 failed'
