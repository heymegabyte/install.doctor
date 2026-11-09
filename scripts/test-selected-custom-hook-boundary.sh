#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq 'const customPostHooksTask = adminCustomHookManifest.length > 0 ? {' "$PROVISION"
grep -Fq "const customUserPostHooksTask = userCustomHookManifest.length > 0 ? {" "$PROVISION"
grep -Fq "id: 'desired.custom-user-post-hooks'" "$PROVISION"
grep -Fq "privilege: 'user', network: 'required'" "$PROVISION"
grep -Fq "consent: 'network', lockDomains: ['custom-post-hooks']" "$PROVISION"
grep -Fq 'customUserPostHooksTask?.id ?? customPostHooksTask?.id ?? catalogPostValidationTask.id' "$PROVISION"
grep -Fq '...(customPostHooksTask ? [customPostHooksTask] : [])' "$PROVISION"
grep -Fq '...(customUserPostHooksTask ? [customUserPostHooksTask] : [])' "$PROVISION"
grep -Fq '...(customPostHooksTask ? {' "$PROVISION"
grep -Fq '...(customUserPostHooksTask ? {' "$PROVISION"
grep -Fq "task.id === 'desired.custom-post-hooks'" "$ROOT/scripts/test-bootstrap-install-acceptance.sh"

printf '%s\n' 'selected-custom-hook-boundary: 11 passed, 0 failed'
