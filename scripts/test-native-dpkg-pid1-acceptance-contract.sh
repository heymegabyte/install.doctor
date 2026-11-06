#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIVER="$ROOT/scripts/run-native-dpkg-pid1-acceptance.sh"
FIXTURE="$ROOT/packages/installer-engine/test/fixtures/native-dpkg-pid1/acceptance.mjs"
DOCKERFILE="$ROOT/packages/installer-engine/test/fixtures/native-dpkg-pid1/Dockerfile"
WORKFLOW="$ROOT/.github/workflows/native-dpkg-pid1-acceptance.yml"
PASSED=0
FAILED=0

pass() { printf 'PASS %s\n' "$*"; PASSED=$((PASSED + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; FAILED=$((FAILED + 1)); }
check() { local label="$1"; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }
hasNoDeployCommands() { ! grep -Eq 'wrangler deploy|git push|release activate' "$1"; }

check 'driver exists' test -f "$DRIVER"
check 'fixture exists' test -f "$FIXTURE"
check 'Dockerfile exists' test -f "$DOCKERFILE"
check 'workflow exists' test -f "$WORKFLOW"
check 'pinned Debian-family base image' grep -Eq '^FROM node:24-bookworm@sha256:[a-f0-9]{64}$' "$DOCKERFILE"
check 'container has real PID1 systemd' grep -Fq -- '/sbin/init' "$DRIVER"
check 'runtime execution has no network' grep -Fq -- '--network none' "$DRIVER"
check 'container is always removed' grep -Fq 'docker rm --force' "$DRIVER"
check 'PID1 is asserted' grep -Fq "readFile('/proc/1/comm'" "$FIXTURE"
check 'network isolation is asserted' grep -Fq 'assertNativeDpkgNetworkDenied' "$FIXTURE"
check 'NET_ADMIN is removed from the acceptance process' grep -Fq -- '--bounding-set=-net_admin' "$DRIVER"
check 'real package is control-inspected' grep -Fq 'inspectNativeDebianPackage' "$FIXTURE"
check 'real native runtime is used' grep -Fq 'createNativeDpkgTransactionRuntime' "$FIXTURE"
check 'interruption is boundary-controlled' grep -Fq 'controller.abort' "$FIXTURE"
check 'resume is asserted' grep -Fq "resumeConfigureOnly" "$FIXTURE"
check 'second apply is asserted unchanged' grep -Fq "unchangedSecondApply" "$FIXTURE"
check 'policy restoration is asserted' grep -Fq "policyRestoredExactly" "$FIXTURE"
check 'service restoration is asserted' grep -Fq "serviceRestoredExactly" "$FIXTURE"
check 'trigger state is asserted' grep -Fq "noPendingTriggers" "$FIXTURE"
check 'machine-readable evidence is emitted' grep -Fq "schemaVersion: 1" "$FIXTURE"
check 'workflow is bounded' grep -q '^    timeout-minutes: 20$' "$WORKFLOW"
check 'workflow is non-deploying' hasNoDeployCommands "$WORKFLOW"
check 'driver syntax' bash -n "$DRIVER"

printf 'native-dpkg-pid1-acceptance-contract: %d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
