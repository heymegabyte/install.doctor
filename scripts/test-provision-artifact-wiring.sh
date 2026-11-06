#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

for command in "command: 'load-plan'" "command: 'artifact-derive'"; do
  if grep -q "$command" "$PROVISION"; then pass "provisioner wires $command"; else fail "provisioner does not wire $command"; fi
done

if ! grep -q 'ARTIFACT_PREPARE_INVOCATION' "$PROVISION" \
  && grep -q "network: 'required'" "$PROVISION"; then
  pass 'artifact fetch is delegated to the approved in-task engine operation'
else
  fail 'production flow retains a pre-run artifact preparation path'
fi

if grep -q 'const directoryRequirements = new Map' "$PROVISION" \
  && grep -q "kind: 'managed-directory'" "$PROVISION"; then
  pass 'fresh-host artifact roots are deduplicated managed-directory tasks'
else
  fail 'fresh-host artifact roots are not represented in the approved graph'
fi

if grep -q 'const artifactOperations' "$PROVISION" && grep -q "compensation: 'configuration'" "$PROVISION"; then
  pass 'derived immutable artifacts become compensatable engine tasks'
else
  fail 'artifact operations are not part of the approved engine plan'
fi

if grep -q 'dependencies: \[desiredPackagesTask.id, ...directoryTaskIds\]' "$PROVISION" \
  && grep -q 'const directoryTasks = ' "$PROVISION"; then
  pass 'artifact tasks depend on every required directory task'
else
  fail 'artifact tasks can execute before required directories'
fi

if grep -q 'artifact.directoryRequirements' "$PROVISION" \
  && ! grep -q 'requirement.exists' "$PROVISION"; then
  pass 'directory task identity is stable across fresh and converged runs'
else
  fail 'directory tasks drift when roots begin to exist'
fi

printf 'provision-artifact-wiring: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
