import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  RollbackPlanSchema,
  RollbackEventSchema,
  RollbackRunReceiptSchema,
  createRollbackPlan,
  configurationCompensationArtifactDigest,
  prepareRollbackRun,
} from '../dist/index.js';

test('rollback task evidence accepts the full versioned launchd observation', () => {
  const event = RollbackEventSchema.parse({
    schemaVersion: 1, sequence: 2, at, rollbackRunId: 'rollback-one', planDigest: digest('a'),
    kind: 'rollback-task-started', taskId: 'config.launchd',
    target: {
      existed: true, digest: digest('b'), mode: 0o600, uid: 501, gid: 20, type: 'regular', links: 1,
      service: {
        domain: { kind: 'gui', uid: 501 },
        definition: { canonicalPath: '/Users/fixture/Library/LaunchAgents/com.install-doctor.fixture.plist', sha256: digest('c'), uid: 501, gid: 20, mode: 0o600 },
        enablementOverride: 'enabled', loaded: true, activity: 'not-running',
      },
    },
  });
  assert.equal(event.kind, 'rollback-task-started');
});

const digest = character => character.repeat(64);
const at = '2026-11-06T05:00:00.000Z';

function artifact(taskId, dependencies = [], targetPath = `/etc/install-doctor/${taskId}.conf`) {
  const bytes = Buffer.from('prior\n');
  const snapshot = {
    schemaVersion: 1, targetPath, existed: true, mode: 0o640, uid: 501, gid: 20,
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
  return {
    schemaVersion: 1,
    record: {
      schemaVersion: 1, taskId, kind: 'configuration', state: 'available', createdAt: at,
      artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes),
      restores: ['bytes', 'mode', 'ownership'],
    },
    snapshot,
    bytesBase64: bytes.toString('base64'),
    dependencies,
  };
}

test('rollback planning is deterministic and orders dependents before dependencies', async () => {
  const artifacts = [
    artifact('config.base'),
    artifact('config.service', ['config.base']),
    artifact('config.proxy', ['config.service']),
  ];
  const first = await createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: artifacts,
  }, () => at);
  const second = await createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [...artifacts].reverse(),
  }, () => '2026-11-06T06:00:00.000Z');
  assert.equal(first.digest, second.digest);
  assert.equal(first.planId, second.planId);
  assert.deepEqual(first.taskOrder, ['config.proxy', 'config.service', 'config.base']);
  assert.deepEqual(first.tasks.map(task => task.taskId), ['config.base', 'config.proxy', 'config.service']);
  const reordered = artifacts.map(item => ({
    ...item,
    dependencies: [...item.dependencies, ...item.dependencies].reverse(),
    record: { ...item.record, restores: [...item.record.restores].reverse() },
  }));
  const normalized = await createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: reordered,
  }, () => at);
  assert.equal(first.digest, normalized.digest);
  assert.deepEqual(first.tasks, normalized.tasks);
  RollbackPlanSchema.parse(first);
});

test('rollback planning rejects duplicate, cyclic, unavailable, and nonconfiguration evidence', async () => {
  const base = artifact('config.base');
  await assert.rejects(createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [base, base],
  }), /duplicate/);
  await assert.rejects(createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'),
    compensations: [artifact('config.a', ['config.b']), artifact('config.b', ['config.a'])],
  }), /cycle/);
  await assert.rejects(createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'),
    compensations: [{ ...base, record: { ...base.record, state: 'applied' } }],
  }), /available/);
  await assert.rejects(createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'),
    compensations: [{ ...base, record: { ...base.record, kind: 'package' } }],
  }));
  await assert.rejects(createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'),
    compensations: [{ ...base, record: { ...base.record, artifactDigest: digest('9') } }],
  }), /integrity mismatch/);
});

test('strict schemas reject unknown fields and a changed artifact changes approval identity', async () => {
  const input = { sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [artifact('config.base')] };
  const plan = await createRollbackPlan(input, () => at);
  assert.equal(RollbackPlanSchema.safeParse({ ...plan, unexpected: true }).success, false);
  const changed = await createRollbackPlan({
    ...input,
    compensations: [artifact('config.base', [], '/etc/install-doctor/config.base.changed.conf')],
  }, () => at);
  assert.notEqual(plan.digest, changed.digest);
  assert.notEqual(plan.planId, changed.planId);
});

test('lifecycle requires exact approval and remains explicitly nonexecuting', async () => {
  const plan = await createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [artifact('config.base')],
  }, () => at);
  await assert.rejects(prepareRollbackRun({ rollbackRunId: 'rollback-one', plan, approvedPlanDigest: null }), /exact rollback plan digest/);
  await assert.rejects(prepareRollbackRun({ rollbackRunId: 'rollback-one', plan, approvedPlanDigest: digest('0') }), /exact rollback plan digest/);
  await assert.rejects(prepareRollbackRun({
    rollbackRunId: 'rollback-one',
    plan: { ...plan, tasks: [{ ...plan.tasks[0], targetPath: '/etc/forged.conf' }] },
    approvedPlanDigest: plan.digest,
  }), /integrity check/);
  const run = await prepareRollbackRun({
    rollbackRunId: 'rollback-one', plan, approvedPlanDigest: plan.digest,
  }, (() => {
    let tick = 0;
    return () => `2026-11-06T05:00:0${tick++}.000Z`;
  })());
  assert.deepEqual(run.events.map(event => event.sequence), [0, 1, 2]);
  assert.deepEqual(run.events.map(event => event.kind), ['rollback-run-started', 'rollback-plan-approved', 'rollback-run-blocked']);
  assert.equal(run.receipt.status, 'approved-not-executed');
  assert.equal(run.receipt.completed, false);
  assert.match(run.receipt.nextAction, /executor/i);
  assert.equal(Object.isFrozen(run.events), true);
  RollbackRunReceiptSchema.parse(run.receipt);
});
