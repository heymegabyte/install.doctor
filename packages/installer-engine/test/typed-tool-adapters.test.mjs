import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopToolsToolAdapters, DESKTOP_TOOLS_TYPED_TOOL_NAMES } from '../dist/typed-tool-adapters.js';

const digest = character => character.repeat(64);

function harness(overrides = {}) {
  const invocations = [];
  const consents = [];
  let id = 0;
  const adapters = createDesktopToolsToolAdapters({
    operation: Object.freeze({ facts: { signed: true }, desiredState: { revision: 'r1' }, plan: { selectedTaskIds: [] }, operations: {} }),
    runId: 'run-one', releaseId: 'release-one', stateRoot: '/private/desktop-tools',
    createId: () => `id-${++id}`,
    now: () => '2026-11-08T12:00:00.000Z',
    invokeEngine: async invocation => {
      invocations.push(invocation);
      if (invocation.command === 'plan') return { schemaVersion: 1, digest: digest('a') };
      if (invocation.command === 'rollback-config-plan') return { schemaVersion: 1, digest: digest('b') };
      return { ok: true, command: invocation.command };
    },
    requestConsent: async request => {
      consents.push(request);
      return { approved: true, actorId: 'owner-one', approvedAt: '2026-11-08T11:59:00.000Z' };
    },
    ...overrides,
  });
  return { adapters, invocations, consents };
}

test('exports exactly the ten bounded Desktop Tools capabilities', () => {
  const { adapters } = harness();
  assert.deepEqual(Object.keys(adapters), [...DESKTOP_TOOLS_TYPED_TOOL_NAMES]);
  assert.equal(Object.isFrozen(adapters), true);
});

test('read-only adapters reject unknown fields and inject the trusted operation closure', async () => {
  const { adapters, invocations } = harness();
  await assert.rejects(adapters.desktop_tools_discover({ schemaVersion: 1, shell: 'rm -rf /' }), /unrecognized_keys/i);
  await adapters.desktop_tools_discover({ schemaVersion: 1 });
  assert.deepEqual(invocations[0], {
    schemaVersion: 1, runId: 'run-one', releaseId: 'release-one', command: 'discover',
    facts: { signed: true }, desiredState: { revision: 'r1' }, plan: { selectedTaskIds: [] }, operations: {},
  });
});

test('apply requires brokered consent for an adapter-produced plan and cannot replay approval', async () => {
  const { adapters, invocations, consents } = harness();
  await assert.rejects(adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: digest('c') }), /plan produced/);
  const plan = await adapters.desktop_tools_plan({ schemaVersion: 1 });
  const approval = await adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: plan.digest });
  assert.deepEqual(consents[0], { operation: 'apply', planDigest: digest('a'), runId: 'run-one' });
  await assert.rejects(adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: approval.approvalId, argv: ['/bin/sh'] }), /unrecognized_keys/i);
  await adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: approval.approvalId });
  const run = invocations.at(-1);
  assert.equal(run.command, 'run');
  assert.equal(run.approvedPlanDigest, digest('a'));
  assert.equal(run.stateRoot, '/private/desktop-tools');
  assert.equal(run.renderer, 'headless');
  await assert.rejects(adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: approval.approvalId }), /unused adapter-issued/);
});

test('verify, status, and resume remain bound to the session plan and journal root', async () => {
  const { adapters, invocations } = harness();
  const plan = await adapters.desktop_tools_plan({ schemaVersion: 1 });
  const approval = await adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: plan.digest });
  await assert.rejects(adapters.desktop_tools_resume({ schemaVersion: 1, approvalId: approval.approvalId }), /execution has started/);
  await adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: approval.approvalId });
  await adapters.desktop_tools_verify({ schemaVersion: 1, runId: 'run-one', planDigest: plan.digest });
  await adapters.desktop_tools_status({ schemaVersion: 1, runId: 'run-one', planDigest: plan.digest });
  await adapters.desktop_tools_resume({ schemaVersion: 1, approvalId: approval.approvalId });
  assert.deepEqual(invocations.slice(-3).map(value => value.command), ['evidence-verify', 'status', 'resume']);
  assert.equal(invocations.at(-3).stateRoot, '/private/desktop-tools');
  assert.equal(invocations.at(-2).approvedPlanDigest, plan.digest);
  assert.equal(invocations.at(-2).plan.digest, plan.digest);
  assert.equal(invocations.at(-1).stateRoot, '/private/desktop-tools');
  await assert.rejects(adapters.desktop_tools_status({ schemaVersion: 1, runId: 'other', planDigest: plan.digest }), /outside this adapter session/);
});

test('rollback is plan-first, separately consented, exact, and engine-owned', async () => {
  const { adapters, invocations, consents } = harness();
  const sourcePlanDigest = digest('d');
  const plan = await adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'plan', sourceRunId: 'source-one', sourcePlanDigest });
  const approval = await adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'approve', sourceRunId: 'source-one',
    sourcePlanDigest, rollbackPlanDigest: plan.digest });
  assert.deepEqual(consents[0], { operation: 'rollback-config', planDigest: digest('b'), runId: 'rollback-id-1', sourceRunId: 'source-one' });
  await assert.rejects(adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'resume', approvalId: approval.approvalId }),
    /correct execution state/);
  await adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'execute', approvalId: approval.approvalId });
  const execution = invocations.at(-1);
  assert.equal(execution.command, 'rollback-config-execute');
  assert.equal(execution.sourcePlanDigest, sourcePlanDigest);
  assert.equal(execution.approvedPlanDigest, digest('b'));
  assert.equal(execution.rollbackRunId, approval.rollbackRunId);
  await assert.rejects(adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'execute', approvalId: approval.approvalId }),
    /correct execution state/);
});

test('deprovision is an ownership-aware non-executable preview with no engine mutation', async () => {
  const { adapters, invocations } = harness();
  const appliedDigest = digest('e');
  const preview = await adapters.desktop_tools_deprovision_preview({
    schemaVersion: 1, sourceRunId: 'source-one', sourcePlanDigest: digest('f'),
    resources: [{ schemaVersion: 1, resourceId: 'managed-config', effect: 'configuration', target: '/etc/example.conf',
      ownership: 'installer-owned', userData: 'absent', observedDigest: appliedDigest,
      ownershipEvidence: { schemaVersion: 1, owner: 'install.doctor', sourceRunId: 'source-one',
        artifactDigest: digest('1'), appliedDigest } }],
  });
  assert.equal(preview.executable, false);
  assert.deepEqual(preview.eligibleResourceIds, ['managed-config']);
  assert.equal(invocations.length, 0);
});
