#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq "throw new Error('selected services are unsupported until an installer-engine-owned, manager-specific privileged operation is available')" "$PROVISION"
! grep -Fq "id: 'desired.services'" "$PROVISION"
! grep -Fq "'desired-services-check'" "$PROVISION"
! grep -Fq "'desired-services-apply'" "$PROVISION"
! grep -Fq "'desired-services-verify'" "$PROVISION"
grep -Fq 'dependencies: [customPostHooksTask?.id ?? catalogPostValidationTask.id, ...caskLauncherTasks.map' "$PROVISION"

printf '%s\n' 'selected-services-fail-closed: 6 passed, 0 failed'
