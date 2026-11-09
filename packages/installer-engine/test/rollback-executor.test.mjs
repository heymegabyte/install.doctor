import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configurationCompensationArtifactDigest, createRollbackPlan, executeApprovedUserFileRollback } from '../dist/index.js';

const d = value => createHash('sha256').update(value).digest('hex');

async function fixture(taskId, targetPath, dependencies = []) {
  const bytes = Buffer.from(`${taskId}-old\n`);
  const info = await stat(targetPath);
  const snapshot = { schemaVersion: 1, targetPath, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, digest: d(bytes) };
  return { schemaVersion: 1, record: { schemaVersion: 1, taskId, kind: 'configuration', state: 'available', createdAt: '2026-11-06T05:00:00.000Z', artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes), restores: ['bytes', 'mode', 'ownership'] }, snapshot, bytesBase64: bytes.toString('base64'), dependencies };
}

test('restores user-owned files in reverse dependency order and verifies postconditions', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-')));
  await chmod(root, 0o700);
  const basePath = join(root, 'base.conf'); const childPath = join(root, 'child.conf');
  await writeFile(basePath, 'new\n', { mode: 0o600 }); await writeFile(childPath, 'new\n', { mode: 0o600 });
  const artifacts = [await fixture('config.base', basePath), await fixture('config.child', childPath, ['config.base'])];
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: artifacts });
  const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, artifacts);
  assert.equal(result.status, 'succeeded'); assert.equal(result.completed, true);
  assert.deepEqual(result.outcomes.map(item => item.taskId), ['config.child', 'config.base']);
  assert.equal(await readFile(basePath, 'utf8'), 'config.base-old\n');
  assert.equal(await readFile(childPath, 'utf8'), 'config.child-old\n');
});

test('rejects stale approval/evidence and unsafe non-user target before mutation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-deny-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n');
  const artifacts = [await fixture('config.base', target)];
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: artifacts });
  await assert.rejects(executeApprovedUserFileRollback({ plan, approvedPlanDigest: '0'.repeat(64) }, artifacts), /exact rollback plan digest/);
  await assert.rejects(executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, [{ ...artifacts[0], record: { ...artifacts[0].record, artifactDigest: '1'.repeat(64) } }]), /integrity mismatch/);
  assert.equal(await readFile(target, 'utf8'), 'new\n');
});

test('rejects an internally unbound compensation artifact before mutation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-digest-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 });
  const valid = await fixture('config.base', target);
  const unbound = { ...valid, record: { ...valid.record, artifactDigest: '1'.repeat(64) } };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: [valid] });
  await assert.rejects(executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, [unbound]), /integrity mismatch/);
  assert.equal(await readFile(target, 'utf8'), 'new\n');
});

test('restores captured service state through injected adapters in reverse dependency order', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-service-'))); await chmod(root, 0o700);
  const basePath = join(root, 'base.conf'); const childPath = join(root, 'child.conf');
  await writeFile(basePath, 'new\n', { mode: 0o600 }); await writeFile(childPath, 'new\n', { mode: 0o600 });
  const withService = async (taskId, path, dependencies) => {
    const item = await fixture(taskId, path, dependencies); const serviceSnapshot = { schemaVersion: 1, serviceId: `${taskId}.service`, manager: 'systemd', enabled: true, running: false };
    const bytes = Buffer.from(item.bytesBase64, 'base64');
    return { ...item, serviceSnapshot, record: { ...item.record, artifactDigest: configurationCompensationArtifactDigest(item.snapshot, bytes, serviceSnapshot), restores: [...item.record.restores, 'service-state'] } };
  };
  const artifacts = [await withService('config.base', basePath, []), await withService('config.child', childPath, ['config.base'])];
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: artifacts }); const restored = [];
  const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, artifacts, {
    beforeTask: async () => 'execute', afterTask: async () => {}, beforeMutation: async () => {},
    captureService: async () => ({ enabled: false, running: true }),
    restoreService: async snapshot => { restored.push([snapshot.serviceId, snapshot.enabled, snapshot.running]); },
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(restored, [['config.child.service', true, false], ['config.base.service', true, false]]);
  await assert.rejects(executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, artifacts), /unsupported service manager/);
});

test('service-only compensation restores systemd state without touching a synthetic file target', async () => {
  const serviceSnapshot = { schemaVersion: 1, serviceId: 'alloy.service', manager: 'systemd', enabled: false, running: false };
  const snapshot = { schemaVersion: 1, kind: 'service', targetPath: 'systemd:alloy.service',
    existed: false, mode: null, uid: null, gid: null, digest: null };
  const artifact = { schemaVersion: 1, snapshot, bytesBase64: null, dependencies: [], serviceSnapshot, appliedDigest: null,
    record: { schemaVersion: 1, taskId: 'service.native.alloy', kind: 'configuration', state: 'available',
      createdAt: '2026-11-06T05:00:00.000Z', artifactDigest: configurationCompensationArtifactDigest(snapshot, null, serviceSnapshot),
      restores: ['service-state'] } };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: [artifact] });
  const restored = [];
  const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, [artifact], {
    beforeTask: async () => 'execute', beforeMutation: async () => {}, afterTask: async () => {},
    captureService: async () => ({ enabled: true, running: true }),
    restoreService: async value => { restored.push(value); },
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(restored, [serviceSnapshot]);
});

test('a new retry recognizes an exactly restored configuration without mutating it again', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-retry-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 });
  const artifact = await fixture('config.base', target);
  const restoredBytes = Buffer.from(artifact.bytesBase64, 'base64');
  await writeFile(target, restoredBytes, { mode: artifact.snapshot.mode });
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: [artifact] });
  const recorded = []; let authorizationCalls = 0; let mutationCalls = 0;
  const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, [artifact], {
    beforeTask: async () => { authorizationCalls += 1; return 'execute'; },
    beforeMutation: async () => { mutationCalls += 1; },
    afterTask: async outcome => { recorded.push(outcome); },
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.outcomes, [{ taskId: 'config.base', status: 'restored', detail: 'already-restored' }]);
  assert.deepEqual(recorded, result.outcomes);
  assert.equal(authorizationCalls, 0);
  assert.equal(mutationCalls, 0);
  assert.equal(await readFile(target, 'utf8'), 'config.base-old\n');
});

test('already-restored reconciliation includes captured service state', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-executor-service-retry-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 });
  const base = await fixture('config.service', target); const bytes = Buffer.from(base.bytesBase64, 'base64');
  await writeFile(target, bytes, { mode: base.snapshot.mode });
  const serviceSnapshot = { schemaVersion: 1, serviceId: 'fixture.service', manager: 'systemd', enabled: true, running: false };
  const artifact = { ...base, serviceSnapshot, record: { ...base.record,
    artifactDigest: configurationCompensationArtifactDigest(base.snapshot, bytes, serviceSnapshot),
    restores: [...base.record.restores, 'service-state'] } };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: 'f'.repeat(64), compensations: [artifact] });
  let restores = 0; let starts = 0;
  const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest: plan.digest }, [artifact], {
    beforeTask: async () => { starts += 1; return 'execute'; }, afterTask: async () => {},
    captureService: async () => ({ enabled: true, running: false }),
    restoreService: async () => { restores += 1; },
  });
  assert.equal(result.outcomes[0].detail, 'already-restored');
  assert.equal(starts, 0); assert.equal(restores, 0);
});
