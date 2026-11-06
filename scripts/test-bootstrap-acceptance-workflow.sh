#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/bootstrap-install-acceptance.yml"

fail() { printf 'bootstrap-acceptance-workflow: FAIL: %s\n' "$*" >&2; exit 1; }

[ -f "$WORKFLOW" ] || fail 'workflow is missing'
if grep -Eq '^[[:space:]]+(paths|paths-ignore):' "$WORKFLOW"; then
  fail 'signed lifecycle gate must not filter paths because releases bind the entire source commit'
fi
grep -Eq '^[[:space:]]+branches: \[master\]$' "$WORKFLOW" \
  || fail 'canonical push gate must target exactly master'
! grep -Eq 'branches:.*main' "$WORKFLOW" \
  || fail 'retired main branch must not remain in the signed lifecycle gate'
grep -Eq '^  workflow_dispatch:' "$WORKFLOW" \
  || fail 'manual signed lifecycle dispatch must remain available'

for required in \
  'scripts/test-bootstrap-release-workflow.sh' \
  'scripts/test-bootstrap-install-acceptance.sh' \
  'scripts/test-bootstrap-upgrade-acceptance.sh' \
  'packages/installer-engine/test/offline-sandbox.test.mjs'; do
  grep -Fq "$required" "$WORKFLOW" || fail "workflow does not execute $required"
done

printf 'bootstrap-acceptance-workflow: PASS\n'
