import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  RollbackLiveOwnerError,
  LiveOwnerError,
  createRollbackPlan,
  createRollbackRunStore,
  createJournalStore,
  configurationCompensationArtifactDigest,
} from '../dist/index.js';

const digest = character => character.repeat(64);
const at = '2026-11-06T05:00:00.000Z';
const fixtureBytes = Buffer.from('prior\n');
const fixtureSnapshot = {
  schemaVersion: 1, targetPath: '/etc/install-doctor/base.conf', existed: true,
  mode: 0o640, uid: 501, gid: 20, digest: createHash('sha256').update(fixtureBytes).digest('hex'),
};
const artifact = {
  schemaVersion: 1,
  record: {
    schemaVersion: 1, taskId: 'config.base', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(fixtureSnapshot, fixtureBytes), restores: ['bytes', 'mode', 'ownership'],
  },
  snapshot: fixtureSnapshot,
  bytesBase64: fixtureBytes.toString('base64'),
  dependencies: [],
};

function installPlan(planDigest) {
  const task = {
    schemaVersion: 1, id: 'config.install', inputDigest: digest('c'), dependencies: [], predicate: 'host-supported',
    requiredCapabilities: [], operations: { check: 'check', apply: 'apply', verify: 'verify' }, timeoutMs: 1_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
    failurePolicy: 'continue-independent',
  };
  return {
    schemaVersion: 1, planId: 'plan-install', digest: planDigest, releaseId: 'release-one', desiredRevision: 'desired-one',
    hostFactsDigest: digest('e'), createdAt: at, tasks: [task], selectedTaskIds: [task.id],
  };
}

async function fixture(overrides = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-rollback-store-'));
  await chmod(stateRoot, 0o700);
  let tick = 0;
  const store = createRollbackRunStore({
    stateRoot,
    bootId: 'boot-one',
    processStart: 'process-one',
    now: () => `2026-11-06T05:00:${String(tick++).padStart(2, '0')}.000Z`,
    isProcessAlive: async () => true,
    ...overrides,
  });
  const plan = await createRollbackPlan({
    sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [artifact],
  }, () => at);
  return { stateRoot, store, plan };
}

function canonicalBytes(value) {
  const canonical = input => Array.isArray(input) ? input.map(canonical)
    : input !== null && typeof input === 'object'
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]))
      : input;
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`);
}

test('persists exact approved rollback plan and immutable append-only noncompletion evidence', async () => {
  const { stateRoot, store, plan } = await fixture();
  const result = await store.recordBlockedRun('rollback-one', plan, plan.digest);
  assert.equal(result.receipt.completed, false);
  assert.equal(result.receipt.status, 'approved-not-executed');
  assert.deepEqual(result.events.map(event => event.sequence), [0, 1, 2]);
  const inspection = await store.inspect('rollback-one', plan.digest);
  assert.equal(inspection.authority, 'committed');
  assert.equal(inspection.receipt.completed, false);
  assert.deepEqual(inspection.events.map(event => event.kind), result.events.map(event => event.kind));
  const runRoot = join(stateRoot, 'rollback-runs', plan.digest, 'rollback-one');
  assert.equal((await lstat(runRoot)).mode & 0o777, 0o700);
  assert.equal((await readdir(join(runRoot, 'events'))).length, 3);
  assert.deepEqual(JSON.parse(await readFile(join(runRoot, 'plan.json'), 'utf8')), plan);
});

test('wrong approval fails before creating rollback evidence', async () => {
  const { stateRoot, store, plan } = await fixture();
  await assert.rejects(store.recordBlockedRun('rollback-one', plan, digest('0')), /exact rollback plan digest/);
  await assert.rejects(lstat(join(stateRoot, 'rollback-runs')), error => error.code === 'ENOENT');
});

test('exclusive ownership rejects a concurrent rollback recorder', async () => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const { stateRoot, store, plan } = await fixture({
    fault: async point => {
      if (point === 'after-plan-sync') { entered(); await gate; }
    },
  });
  const active = store.recordBlockedRun('rollback-one', plan, plan.digest);
  await reached;
  const competitor = createRollbackRunStore({
    stateRoot, bootId: 'boot-one', processStart: 'process-two', isProcessAlive: async () => true,
  });
  await assert.rejects(competitor.recordBlockedRun('rollback-two', plan, plan.digest), RollbackLiveOwnerError);
  const installStore = createJournalStore({
    stateRoot, hostId: 'host-one', bootId: 'boot-one', processStart: 'install-process', isProcessAlive: async () => true,
  });
  await assert.rejects(installStore.claim('install-run', installPlan(plan.digest)), LiveOwnerError);
  unblock();
  await active;
});

test('active install ownership excludes rollback recording through the shared host lease', async () => {
  const { stateRoot, store, plan } = await fixture();
  const installStore = createJournalStore({
    stateRoot, hostId: 'host-one', bootId: 'boot-one', processStart: 'install-process', isProcessAlive: async () => true,
  });
  const claim = await installStore.claim('install-run', installPlan(plan.digest));
  await assert.rejects(store.recordBlockedRun('rollback-one', plan, plan.digest), RollbackLiveOwnerError);
  await installStore.release(claim.owner);
});

test('read-only verification detects tampering and absent inspection creates nothing', async () => {
  const { stateRoot, store, plan } = await fixture();
  const absentRoot = join(stateRoot, 'absent');
  const reader = createRollbackRunStore({ stateRoot: absentRoot, bootId: 'boot-one', processStart: 'reader' });
  assert.equal((await reader.inspect('rollback-one', plan.digest)).authority, 'absent');
  await assert.rejects(lstat(absentRoot), error => error.code === 'ENOENT');

  await store.recordBlockedRun('rollback-one', plan, plan.digest);
  const eventRoot = join(stateRoot, 'rollback-runs', plan.digest, 'rollback-one', 'events');
  const [eventName] = await readdir(eventRoot);
  await writeFile(join(eventRoot, eventName), '{}\n', { mode: 0o600 });
  const inspection = await store.inspect('rollback-one', plan.digest);
  assert.equal(inspection.authority, 'corrupt');
  assert.match(inspection.problems[0], /digest|event/i);
});

test('failure before final commit remains released and explicitly uncommitted', async () => {
  const { stateRoot, plan } = await fixture();
  const store = createRollbackRunStore({
    stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => { if (point === 'after-receipt-sync') throw new Error('injected precommit failure'); },
  });
  await assert.rejects(store.recordBlockedRun('rollback-one', plan, plan.digest), /injected precommit failure/);
  assert.equal((await store.inspect('rollback-one', plan.digest)).authority, 'uncommitted');
  await assert.rejects(lstat(join(stateRoot, 'owner.json')), error => error.code === 'ENOENT');
});

test('atomic publication leaves only complete final artifacts after interruption', async () => {
  const { stateRoot, plan } = await fixture();
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => { if (point === 'after-plan-sync') throw new Error('stop after publication'); } });
  await assert.rejects(store.recordBlockedRun('rollback-atomic', plan, plan.digest), /stop after publication/);
  const runRoot = join(stateRoot, 'rollback-runs', plan.digest, 'rollback-atomic');
  assert.deepEqual(JSON.parse(await readFile(join(runRoot, 'plan.json'), 'utf8')), plan);
  assert.equal((await readdir(runRoot)).some(name => name.includes('.tmp.')), false);
  assert.equal((await readdir(stateRoot)).some(name => name.startsWith('owner.json.tmp.')), false);
});

test('resume repairs the approval boundary after a crash with only the start event durable', async () => {
  const { stateRoot, plan } = await fixture(); let interrupted = false;
  const store = createRollbackRunStore({
    stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => {
      if (point === 'after-event-sync' && !interrupted) { interrupted = true; throw new Error('crash after start'); }
    },
  });
  await assert.rejects(store.executeUserFileRollback('rollback-one-event', plan, plan.digest, async () => [artifact]), /crash after start/);
  const result = await store.executeUserFileRollback('rollback-one-event', plan, plan.digest, async () => [artifact]);
  assert.deepEqual(result.events.slice(0, 2).map(event => event.kind), ['rollback-run-started', 'rollback-plan-approved']);
  assert.equal(result.events.filter(event => event.kind === 'rollback-plan-approved').length, 1);
});

test('inspection rejects a digest-consistent commit with an invalid event lifecycle', async () => {
  const { stateRoot, store, plan } = await fixture();
  await store.recordBlockedRun('rollback-lifecycle', plan, plan.digest);
  const runRoot = join(stateRoot, 'rollback-runs', plan.digest, 'rollback-lifecycle');
  const commitRoot = join(runRoot, 'commits');
  const [commitName] = await readdir(commitRoot);
  const commitPath = join(commitRoot, commitName);
  const commit = JSON.parse(await readFile(commitPath, 'utf8'));
  const event = JSON.parse(await readFile(commit.events[1].path, 'utf8'));
  event.kind = 'rollback-run-started';
  const eventBytes = canonicalBytes(event);
  const eventDigest = createHash('sha256').update(eventBytes).digest('hex');
  const replacementEventPath = join(runRoot, 'events', `00000001-${eventDigest}.json`);
  await writeFile(replacementEventPath, eventBytes, { mode: 0o600 });
  await rm(commit.events[1].path);
  commit.events[1] = { path: replacementEventPath, sha256: eventDigest };
  commit.evidencePaths[2] = replacementEventPath;
  const commitBytes = canonicalBytes(commit);
  const commitDigest = createHash('sha256').update(commitBytes).digest('hex');
  await writeFile(join(commitRoot, `${commitDigest}.json`), commitBytes, { mode: 0o600 });
  await rm(commitPath);

  const inspection = await store.inspect('rollback-lifecycle', plan.digest);
  assert.equal(inspection.authority, 'corrupt');
  assert.match(inspection.problems[0], /approval|lifecycle/i);
});

test('ownership loss after receipt publication prevents final commit authority', async () => {
  const { stateRoot, plan } = await fixture(); let stolen = false;
  const store = createRollbackRunStore({
    stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => {
      if (point !== 'after-receipt-sync' || stolen) return;
      stolen = true;
      const ownerPath = join(stateRoot, 'owner.json');
      const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
      await writeFile(ownerPath, `${JSON.stringify({ ...owner, token: randomUUID() }, null, 2)}\n`, { mode: 0o600 });
    },
  });
  await assert.rejects(store.recordBlockedRun('rollback-fenced-final', plan, plan.digest), RollbackLiveOwnerError);
  await rm(join(stateRoot, 'owner.json'));
  const inspection = await store.inspect('rollback-fenced-final', plan.digest);
  assert.equal(inspection.authority, 'uncommitted');
});

test('postcommit lease cleanup failure cannot contradict durable rollback success', async () => {
  const { stateRoot, plan } = await fixture();
  const store = createRollbackRunStore({
    stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => { if (point === 'before-release') throw new Error('injected cleanup failure'); },
  });
  const result = await store.recordBlockedRun('rollback-postcommit-cleanup', plan, plan.digest);
  assert.equal(result.receipt.status, 'approved-not-executed');
  const inspection = await store.inspect('rollback-postcommit-cleanup', plan.digest);
  assert.equal(inspection.authority, 'committed');
});

test('inspection prefers verified commit authority, ignores reserved crash temps, and rejects unknown evidence', async () => {
  const { stateRoot, store, plan } = await fixture();
  await store.recordBlockedRun('rollback-committed-owner', plan, plan.digest);
  await assert.rejects(store.recordBlockedRun('rollback-committed-owner', plan, plan.digest), /terminal commit evidence/);
  await writeFile(join(stateRoot, 'owner.json'), `${JSON.stringify({
    schemaVersion: 1, runId: 'rollback-committed-owner', planDigest: plan.digest, hostId: 'rollback-store', pid: process.pid,
    bootId: 'boot-one', processStart: 'process-one', token: randomUUID(), claimedAt: at, heartbeatAt: at,
    leaseUntil: '2099-11-06T05:00:00.000Z',
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal((await store.inspect('rollback-committed-owner', plan.digest)).authority, 'committed');

  const receiptRoot = join(stateRoot, 'rollback-runs', plan.digest, 'rollback-committed-owner', 'receipts');
  await writeFile(join(receiptRoot, `partial.json.tmp.${process.pid}.${randomUUID()}`), 'partial', { mode: 0o600 });
  assert.equal((await store.inspect('rollback-committed-owner', plan.digest)).authority, 'committed');
  await writeFile(join(receiptRoot, 'abandoned.tmp'), 'partial', { mode: 0o600 });
  const corrupted = await store.inspect('rollback-committed-owner', plan.digest);
  assert.equal(corrupted.authority, 'corrupt');
  assert.match(corrupted.problems[0], /temporary|unknown artifacts/i);
});

test('already-restored reconciliation records a fenced task start before its outcome', async () => {
  const { stateRoot } = await fixture();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-already-restored-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); const bytes = Buffer.from('old\n'); await writeFile(target, bytes, { mode: 0o600 });
  const info = await lstat(target);
  const snapshot = { schemaVersion: 1, targetPath: target, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid,
    digest: createHash('sha256').update(bytes).digest('hex') };
  const compensation = { schemaVersion: 1, record: { schemaVersion: 1, taskId: 'config.base', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes), restores: ['bytes', 'mode', 'ownership'] }, snapshot,
    bytesBase64: bytes.toString('base64'), dependencies: [] };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [compensation] }, () => at);
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one' });
  const result = await store.executeUserFileRollback('rollback-already-restored', plan, plan.digest, async () => [compensation]);
  assert.deepEqual(result.events.map(event => event.kind), [
    'rollback-run-started', 'rollback-plan-approved', 'rollback-task-started', 'rollback-task-restored', 'rollback-run-finished',
  ]);
  assert.equal((await store.inspect('rollback-already-restored', plan.digest)).authority, 'committed');
});

test('recent malformed owner fails closed while expired malformed evidence is quarantined', async () => {
  const { stateRoot, store, plan } = await fixture();
  const ownerPath = join(stateRoot, 'owner.json');
  await writeFile(ownerPath, '{}\n', { mode: 0o600 }); await utimes(ownerPath, new Date(at), new Date(at));
  await assert.rejects(store.recordBlockedRun('rollback-malformed', plan, plan.digest), RollbackLiveOwnerError);
  await utimes(ownerPath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'));
  await store.recordBlockedRun('rollback-malformed', plan, plan.digest);
  assert.equal((await readdir(stateRoot)).some(name => name.startsWith('owner.json.malformed.')), true);
  await assert.rejects(lstat(ownerPath), error => error.code === 'ENOENT');
});

test('executes user-file rollback only after shared ownership and resumes across mutation and precommit boundaries', async () => {
  const { stateRoot } = await fixture(); let interrupted = false; let receiptInterrupted = false;
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => {
      if (point === 'before-outcome-sync' && !interrupted) { interrupted = true; throw new Error('crash after mutation'); }
      if (point === 'after-receipt-sync' && !receiptInterrupted) { receiptInterrupted = true; throw new Error('crash before final commit'); }
    } });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-run-execute-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 });
  const info = await lstat(target); const bytes = Buffer.from('old\n');
  const snapshot = { schemaVersion: 1, targetPath: target, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid,
    digest: createHash('sha256').update(bytes).digest('hex') };
  const compensation = { schemaVersion: 1, record: { schemaVersion: 1, taskId: 'config.base', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes), restores: ['bytes', 'mode', 'ownership'] }, snapshot,
    bytesBase64: bytes.toString('base64'), dependencies: [] };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [compensation] }, () => at);
  const load = async () => {
    await lstat(join(stateRoot, 'owner.json'));
    return [compensation];
  };
  await assert.rejects(store.executeUserFileRollback('rollback-execute', plan, plan.digest, load), /crash after mutation/);
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  assert.equal((await store.inspect('rollback-execute', plan.digest)).authority, 'uncommitted');
  await assert.rejects(store.executeUserFileRollback('rollback-execute', plan, plan.digest, load), /crash before final commit/);
  assert.equal((await store.inspect('rollback-execute', plan.digest)).authority, 'uncommitted');
  const result = await store.executeUserFileRollback('rollback-execute', plan, plan.digest, load);
  assert.equal(result.receipt.status, 'succeeded'); assert.equal(result.receipt.completed, true);
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  const inspection = await store.inspect('rollback-execute', plan.digest);
  assert.equal(inspection.authority, 'committed'); assert.equal(inspection.receipt.status, 'succeeded');
  assert.equal(inspection.events.at(-1).kind, 'rollback-run-finished');
  assert.equal(inspection.events.filter(event => event.kind === 'rollback-task-started').length, 1);
  assert.equal(inspection.events.filter(event => event.kind === 'rollback-task-restored').length, 1);
  assert.equal(inspection.events.filter(event => event.kind === 'rollback-run-finished').length, 1);
});

test('task-start checkpoint is durable before mutation and interruption remains uncommitted', async () => {
  const { stateRoot } = await fixture(); let eventSyncs = 0;
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => { if (point === 'after-event-sync' && ++eventSyncs === 3) throw new Error('crash after task start'); } });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-precheckpoint-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 }); const info = await lstat(target); const bytes = Buffer.from('old\n');
  const snapshot = { schemaVersion: 1, targetPath: target, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, digest: createHash('sha256').update(bytes).digest('hex') };
  const compensation = { schemaVersion: 1, record: { schemaVersion: 1, taskId: 'config.base', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes), restores: ['bytes', 'mode', 'ownership'] }, snapshot, bytesBase64: bytes.toString('base64'), dependencies: [] };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [compensation] }, () => at);
  await assert.rejects(store.executeUserFileRollback('rollback-crash', plan, plan.digest, async () => [compensation]), /crash after task start/);
  assert.equal(await readFile(target, 'utf8'), 'new\n');
  assert.equal((await store.inspect('rollback-crash', plan.digest)).authority, 'uncommitted');
});

test('lease fencing is revalidated immediately before rollback mutation', async () => {
  const { stateRoot } = await fixture();
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one' });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-fence-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 });
  const info = await lstat(target); const bytes = Buffer.from('old\n');
  const snapshot = { schemaVersion: 1, targetPath: target, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, digest: createHash('sha256').update(bytes).digest('hex') };
  const compensation = { schemaVersion: 1, record: { schemaVersion: 1, taskId: 'config.base', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes), restores: ['bytes', 'mode', 'ownership'] }, snapshot, bytesBase64: bytes.toString('base64'), dependencies: [] };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [compensation] }, () => at);
  await assert.rejects(store.executeUserFileRollback('rollback-fenced', plan, plan.digest, async () => {
    await writeFile(join(stateRoot, 'owner.json'), '{}\n', { mode: 0o600 });
    return [compensation];
  }), /rollback artifact|JSON|parse|schema/i);
  assert.equal(await readFile(target, 'utf8'), 'new\n');
});

test('long rollback renews the shared lease and cleans the renewal timer', async () => {
  const { stateRoot, plan } = await fixture(); let clock = Date.parse(at); let firstHeartbeat;
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one', leaseMs: 1_000,
    now: () => new Date(clock += 100).toISOString(), isProcessAlive: async () => true });
  const pending = store.executeUserFileRollback('rollback-renew', plan, plan.digest, async () => {
    firstHeartbeat = JSON.parse(await readFile(join(stateRoot, 'owner.json'), 'utf8')).heartbeatAt;
    await new Promise(resolve => setTimeout(resolve, 450));
    const renewed = JSON.parse(await readFile(join(stateRoot, 'owner.json'), 'utf8')).heartbeatAt;
    assert.notEqual(renewed, firstHeartbeat);
    throw new Error('stop after renewal proof');
  });
  await assert.rejects(pending, /stop after renewal proof/);
  await assert.rejects(lstat(join(stateRoot, 'owner.json')), error => error.code === 'ENOENT');
});

test('service-state evidence is durably bound and retry does not repeat a completed adapter restore', async () => {
  const { stateRoot } = await fixture(); let interrupted = false; let serviceState = { enabled: false, running: true }; let restores = 0;
  const adapter = { manager: 'systemd', capture: async () => ({ ...serviceState }), restore: async (_id, state) => { restores += 1; serviceState = { ...state }; } };
  const store = createRollbackRunStore({ stateRoot, bootId: 'boot-one', processStart: 'process-one', serviceAdapters: { systemd: adapter },
    fault: async point => { if (point === 'before-outcome-sync' && !interrupted) { interrupted = true; throw new Error('service outcome interruption'); } } });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rollback-service-retry-'))); await chmod(root, 0o700);
  const target = join(root, 'config'); await writeFile(target, 'new\n', { mode: 0o600 }); const info = await lstat(target); const bytes = Buffer.from('old\n');
  const snapshot = { schemaVersion: 1, targetPath: target, existed: true, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, digest: createHash('sha256').update(bytes).digest('hex') };
  const serviceSnapshot = { schemaVersion: 1, serviceId: 'fixture.service', manager: 'systemd', enabled: true, running: false };
  const compensation = { schemaVersion: 1, record: { schemaVersion: 1, taskId: 'config.service', kind: 'configuration', state: 'available', createdAt: at,
    artifactDigest: configurationCompensationArtifactDigest(snapshot, bytes, serviceSnapshot), restores: ['bytes', 'mode', 'ownership', 'service-state'] },
    snapshot, bytesBase64: bytes.toString('base64'), dependencies: [], serviceSnapshot };
  const plan = await createRollbackPlan({ sourceRunId: 'source-run', sourcePlanDigest: digest('f'), compensations: [compensation] }, () => at);
  await assert.rejects(store.executeUserFileRollback('rollback-service', plan, plan.digest, async () => [compensation]), /service outcome interruption/);
  assert.deepEqual(serviceState, { enabled: true, running: false }); assert.equal(restores, 1);
  await store.executeUserFileRollback('rollback-service', plan, plan.digest, async () => [compensation]);
  assert.equal(restores, 1);
  const inspection = await store.inspect('rollback-service', plan.digest);
  assert.equal(inspection.events.filter(event => event.kind === 'rollback-task-restored').length, 1);
  assert.deepEqual(inspection.plan.tasks[0].service, { serviceId: 'fixture.service', manager: 'systemd' });
});
