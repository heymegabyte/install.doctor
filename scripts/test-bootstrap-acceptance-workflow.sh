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
  'packages/control-plane/test/disposable-product-composition.test.mjs' \
  'scripts/test-bootstrap-release-workflow.sh' \
  'scripts/test-bootstrap-install-acceptance.sh' \
  'scripts/test-bootstrap-upgrade-acceptance.sh' \
  'packages/installer-engine/test/typed-tool-adapters.test.mjs' \
  'packages/installer-engine/test/mcp-server.test.mjs' \
  'packages/installer-engine/test/provisioning-prompt.test.mjs' \
  'packages/installer-engine/test/session-events.test.mjs' \
  'packages/installer-engine/test/adoption-plan.test.mjs' \
  'packages/installer-engine/test/deprovision-plan.test.mjs' \
  'packages/installer-engine/test/deprovision-lifecycle-canary.test.mjs' \
  'packages/installer-engine/test/offline-sandbox.test.mjs' \
  'packages/installer-engine/test/offline-bundle.test.mjs' \
  'packages/installer-engine/test/offline-execution.test.mjs'; do
  grep -Fq "$required" "$WORKFLOW" || fail "workflow does not execute $required"
done

node - "$WORKFLOW" <<'NODE' || fail 'disposable composition job has production authority or external-write capability'
const fs = require('node:fs');
const workflow = fs.readFileSync(process.argv[2], 'utf8');
const match = workflow.match(/^  disposable-product-composition:\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\n)/m);
if (!match) process.exit(1);
const job = match[0];
for (const forbidden of ['environment:', 'id-token:', 'secrets.', 'INFISICAL', 'wrangler deploy', 'rclone', 'aws s3', 'firebase']) {
  if (job.includes(forbidden)) process.exit(2);
}
if (!job.includes('Disposable Desktop Tools product composition') || !job.includes('persist-credentials: false')) process.exit(3);
if (!job.includes('DESKTOP_TOOLS_COMPOSITION_RECEIPT:') || !job.includes('name: disposable-composition-${{ github.run_id }}')
  || !job.includes('retention-days: 14')) process.exit(4);
NODE

grep -Fq 'INSTALL_DOCTOR_REQUIRE_REAL_OFFLINE_SANDBOX: "1"' "$WORKFLOW" \
  || fail 'offline lifecycle job must require real Linux namespace isolation'
grep -Fq '.artifacts.linux_x64.upstreamUrl' "$WORKFLOW" \
  && grep -Fq 'sha256sum --check --strict' "$WORKFLOW" \
  && grep -Fq 'OPENCODE_PINNED_BINARY=' "$WORKFLOW" \
  || fail 'typed-tool acceptance must acquire, verify, and expose the exact pinned OpenCode runtime'
grep -Fq "skip: process.env.OPENCODE_PINNED_BINARY ? false" "$ROOT/packages/installer-engine/test/mcp-server.test.mjs" \
  || fail 'real OpenCode MCP acceptance must run when the pinned runtime is present'
grep -Fq 'production provisioner dispatches and reruns a real signed bundle through the network-denied CLI' \
  "$ROOT/packages/installer-engine/test/offline-execution.test.mjs" \
  || fail 'offline lifecycle suite must drive the production provisioner dispatcher and unchanged rerun'

UPGRADE_ACCEPTANCE="$ROOT/scripts/test-bootstrap-upgrade-acceptance.sh"
grep -Fq 'COPY --chown=0:0 --chmod=0555 container-tools/curl /usr/bin/curl' "$UPGRADE_ACCEPTANCE" \
  && grep -Fq 'COPY --chown=0:0 --chmod=0555 container-tools/rsync /usr/bin/rsync' "$UPGRADE_ACCEPTANCE" \
  && grep -Fq 'for TOOL in gum zx chezmoi process-software-groups process-software-post-scripts; do' "$UPGRADE_ACCEPTANCE" \
  || fail 'upgrade lifecycle must use fixed root-owned curl and rsync identities'

printf 'bootstrap-acceptance-workflow: PASS\n'
