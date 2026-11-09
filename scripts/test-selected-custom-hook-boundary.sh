#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq 'const customPostHooksTask = customHookManifest.length > 0 ? {' "$PROVISION"
grep -Fq 'customPostHooksTask?.id ?? catalogPostValidationTask.id' "$PROVISION"
grep -Fq '...(customPostHooksTask ? [customPostHooksTask] : [])' "$PROVISION"
grep -Fq '...(customPostHooksTask ? {' "$PROVISION"
grep -Fq "task.id === 'desired.custom-post-hooks'" "$ROOT/scripts/test-bootstrap-install-acceptance.sh"

printf '%s\n' 'selected-custom-hook-boundary: 5 passed, 0 failed'
