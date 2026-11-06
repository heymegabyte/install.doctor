#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/offline-bundle-request.yml"
MODULE="$ROOT/packages/control-plane/scripts/offline-bundle-request.mjs"
TEST="$ROOT/packages/control-plane/test/offline-bundle-request.test.mjs"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
test -f "$WORKFLOW" && test -f "$MODULE" && test -f "$TEST" || fail 'request producer foundation is incomplete'
grep -Fq 'permissions: {}' "$WORKFLOW" || fail 'workflow permissions are not deny-by-default'
grep -Fq 'test "$GITHUB_SHA" = "$PRODUCER_WORKFLOW_SHA"' "$WORKFLOW" || fail 'immutable producer revision is not bound'
grep -Fq "test \"\$(jq -r .path <<<\"\$run\")\" = '.github/workflows/offline-bundle-request.yml'" "$WORKFLOW" || fail 'workflow path is not independently bound'
grep -Fq 'ref: ${{ github.workflow_sha }}' "$WORKFLOW" || fail 'reviewed producer source is not checked out immutably'
grep -Fq 'exit 78' "$WORKFLOW" || fail 'missing explicit same-host fail-closed boundary'
grep -Fq 'Same-host handoff unavailable' "$WORKFLOW" || fail 'operator blocker is not actionable'
! grep -Fq 'name: offline-bundle-authority-input' "$WORKFLOW" || fail 'ephemeral workflow must not upload authority input'
! grep -Eq 'Infisical|INSTALL_DOCTOR_.*KEY|secrets\.' "$WORKFLOW" || fail 'blocked producer must not resolve authority credentials'
grep -Fq 'install.doctor.offline-request-authority' "$MODULE" || fail 'request signer namespace is not separated'
grep -Fq 'producerWorkflowSha' "$MODULE" || fail 'per-request attestation omits immutable producer SHA'
grep -Fq 'producerRunId' "$MODULE" || fail 'per-request attestation omits producer run'
node --test "$TEST"
printf 'offline-bundle-request-workflow: PASS\n'
