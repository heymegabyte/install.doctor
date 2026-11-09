import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LiveOwnerError, configurationCompensationArtifactDigest, createJournalStore } from '../dist/index.js';

const digest = character => character.repeat(64);
const task = {
  schemaVersion: 1, id: 'task.one', inputDigest: digest('b'), dependencies: [], predicate: 'host-supported',
  requiredCapabilities: [], operations: { check: 'check', apply: 'apply', verify: 'verify' }, timeoutMs: 1_000,
  retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
  privilege: 'user', network: 'none', consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
  failurePolicy: 'continue-independent',
};
const plan = {
  schemaVersion: 1, planId: 'plan-one', digest: digest('a'), releaseId: 'release-one', desiredRevision: 'desired-one',
  hostFactsDigest: digest('c'), createdAt: '2026-11-06T00:00:00.000Z', tasks: [task], selectedTaskIds: [task.id],
};

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-journal-'));
  await chmod(root, 0o700);
  const clock = { value: Date.parse('2026-11-06T00:00:00.000Z') };
  const store = createJournalStore({
    stateRoot: root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-one', pid: 42,
    now: () => new Date(clock.value).toISOString(), isProcessAlive: async () => true, ...overrides,
  });
  return { root, store, clock };
}

async function onlyJournalObject(root) {
  const directory = join(root, 'runs', plan.digest, 'run-one', 'objects', 'sha256');
  const names = await readdir(directory);
  return join(directory, names.sort().at(-1));
}

const successfulReceipt = (finishedAt = '2026-11-06T00:00:01.000Z') => ({
  schemaVersion: 1, runId: 'run-one', planDigest: plan.digest, status: 'success',
  startedAt: '2026-11-06T00:00:00.000Z', finishedAt,
  taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 },
  evidencePaths: ['placeholder'], nextAction: null,
});

const successfulEvents = (finishedAt = '2026-11-06T00:00:01.000Z') => [
  { schemaVersion: 1, sequence: 0, at: '2026-11-06T00:00:00.000Z', runId: 'run-one', kind: 'run-status', status: 'started' },
  { schemaVersion: 1, sequence: 1, at: '2026-11-06T00:00:00.100Z', runId: 'run-one', kind: 'task-status', taskId: task.id, status: 'verified', attempt: 1 },
  { schemaVersion: 1, sequence: 2, at: '2026-11-06T00:00:00.200Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'started' },
  { schemaVersion: 1, sequence: 3, at: '2026-11-06T00:00:00.300Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'succeeded' },
  { schemaVersion: 1, sequence: 4, at: finishedAt, runId: 'run-one', kind: 'run-status', status: 'success' },
];

test('journal claim persists protected plan and journal and excludes a live second owner', async () => {
  const { root, store } = await fixture();
  const claim = await store.claim('run-one', plan);
  const directory = join(root, 'runs', plan.digest, 'run-one');
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(await onlyJournalObject(root))).mode & 0o777, 0o600);
  await assert.rejects(store.claim('run-one', plan), LiveOwnerError);
  assert.equal(claim.resumed, false);
});

test('run discovery is read-only and distinguishes active from resumable evidence', async () => {
  const { root, store } = await fixture();
  const absentRoot = join(root, 'absent');
  const absentStore = createJournalStore({
    stateRoot: absentRoot, hostId: 'host-one', bootId: 'boot-one', processStart: 'reader',
  });
  assert.deepEqual(await absentStore.listRuns(), []);
  await assert.rejects(lstat(absentRoot), error => error.code === 'ENOENT');

  const claim = await store.claim('run-one', plan);
  const active = await store.listRuns();
  assert.equal(active.length, 1);
  assert.equal(active[0].authority, 'active');
  assert.equal(active[0].resumeCandidate, false);
  await store.release(claim.owner);
  const resumable = await store.listRuns();
  assert.equal(resumable[0].authority, 'uncommitted');
  assert.equal(resumable[0].resumeCandidate, true);
  await assert.rejects(lstat(join(root, 'owner.json')), error => error.code === 'ENOENT');
});

test('run discovery fails closed on a tampered durable chain', async () => {
  const { root, store } = await fixture();
  const claim = await store.claim('run-one', plan);
  await store.release(claim.owner);
  await writeFile(await onlyJournalObject(root), '{}\n', { mode: 0o600 });
  await assert.rejects(store.listRuns(), /hash|journal/i);
});

test('journal checkpoints are fenced by the current owner token and sorted deterministically', async () => {
  const { store } = await fixture();
  const claim = await store.claim('run-one', plan);
  const updated = await store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  assert.equal(updated.entries[0].status, 'verified');
  await store.release(claim.owner);
  await assert.rejects(store.checkpoint(claim.owner, updated.entries[0]), LiveOwnerError);
  const resumed = await store.claim('run-one', plan, 'resume');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.journal.entries[0].status, 'verified');
});

test('fresh run refuses released uncommitted evidence and only explicit resume may adopt it', async () => {
  const { root, store } = await fixture();
  const first = await store.claim('run-one', plan);
  await store.release(first.owner);
  const run = join(root, 'runs', plan.digest, 'run-one');
  const headsBefore = await readdir(join(run, 'heads'));
  await assert.rejects(store.claim('run-one', plan), /fresh run requires absent journal evidence/);
  await assert.rejects(lstat(join(root, 'owner.json')), error => error.code === 'ENOENT');
  assert.deepEqual(await readdir(join(run, 'heads')), headsBefore);
  const resumed = await store.claim('run-one', plan, 'resume');
  assert.equal(resumed.resumed, true);
});

test('concurrent fresh claims have one typed winner without orphan generations', async () => {
  const { root, clock } = await fixture();
  const options = {
    stateRoot: root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-one',
    now: () => new Date(clock.value).toISOString(), isProcessAlive: async () => true,
  };
  const [left, right] = await Promise.allSettled([
    createJournalStore({ ...options, pid: 41 }).claim('run-one', plan),
    createJournalStore({ ...options, pid: 42 }).claim('run-one', plan),
  ]);
  const results = [left, right];
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason instanceof LiveOwnerError, true,
    `losing claim must report LiveOwnerError, received ${rejected.reason?.constructor?.name}: ${rejected.reason?.message}`);
  const run = join(root, 'runs', plan.digest, 'run-one');
  assert.equal((await readdir(join(run, 'heads'))).length, 1);
});

test('configuration compensation is persisted before activation, integrity checked, and owner fenced', async () => {
  const { store } = await fixture();
  const claim = await store.claim('run-one', plan);
  const bytes = Buffer.from('prior configuration\n');
  const snapshot = {
    schemaVersion: 1, targetPath: '/etc/install-doctor/fixture.conf', existed: true,
    mode: 0o640, uid: process.platform === 'win32' ? null : 501, gid: process.platform === 'win32' ? null : 20,
    digest: digest('0'),
  };
  const { createHash } = await import('node:crypto');
  snapshot.digest = createHash('sha256').update(bytes).digest('hex');
  const artifactDigest = configurationCompensationArtifactDigest(snapshot, bytes);
  const available = {
    schemaVersion: 1, taskId: task.id, kind: 'configuration', state: 'available',
    createdAt: '2026-11-06T00:00:01.000Z', artifactDigest, restores: ['bytes', 'mode', 'ownership'],
  };
  await store.persistCompensation(claim.owner, { record: available, snapshot, bytes, dependencies: [] });
  const persisted = await store.readCompensations('run-one', plan.digest);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].record.state, 'available');
  assert.equal(Buffer.from(persisted[0].bytesBase64, 'base64').toString('utf8'), bytes.toString('utf8'));
  await store.updateCompensation(claim.owner, { ...available, state: 'applied' });
  assert.equal((await store.readCompensations('run-one', plan.digest))[0].record.state, 'applied');
  await store.release(claim.owner);
  await assert.rejects(store.updateCompensation(claim.owner, { ...available, state: 'failed' }), LiveOwnerError);
});

test('concurrent task checkpoints serialize without losing an entry', async () => {
  const { store } = await fixture();
  const claim = await store.claim('run-one', plan);
  const entries = ['task.a', 'task.b', 'task.c'].map((taskId, index) => ({
    taskId, inputDigest: digest(String(index + 1)), status: 'verified', attempts: 1,
    updatedAt: `2026-11-06T00:00:0${index + 1}.000Z`,
  }));
  await Promise.all(entries.map(entry => store.checkpoint(claim.owner, entry)));
  const persisted = await store.read('run-one', plan.digest);
  assert.deepEqual(persisted.entries.map(entry => entry.taskId), ['task.a', 'task.b', 'task.c']);
  assert.equal(persisted.revision, 4);
});

test('old heartbeat alone cannot steal a demonstrably live owner', async () => {
  const fixtureState = await fixture({ leaseMs: 1_000, isProcessAlive: async () => true });
  await fixtureState.store.claim('run-one', plan);
  fixtureState.clock.value += 60_000;
  await assert.rejects(fixtureState.store.claim('run-one', plan), LiveOwnerError);
});

test('expired dead owner can be reclaimed but its old token remains fenced', async () => {
  let alive = true;
  const state = await fixture({ leaseMs: 1_000, isProcessAlive: async () => alive });
  const first = await state.store.claim('run-one', plan);
  alive = false;
  state.clock.value += 2_000;
  const second = await state.store.claim('run-one', plan, 'resume');
  assert.notEqual(second.owner.token, first.owner.token);
  await assert.rejects(state.store.release(first.owner), LiveOwnerError);
  const rootEntries = await readdir(state.root);
  assert.ok(rootEntries.some(name => name === `owner.json.stale.${first.owner.token}`), 'stale owner evidence must be preserved');
});

test('PID reuse does not preserve a lease when the process-start identity changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-pid-reuse-'));
  await chmod(root, 0o700);
  let clock = Date.parse('2026-11-06T00:00:00.000Z');
  const original = createJournalStore({
    stateRoot: root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-old', pid: 4242,
    leaseMs: 1_000, now: () => new Date(clock).toISOString(), isProcessAlive: async () => true,
  });
  const first = await original.claim('run-one', plan);
  clock += 2_000;
  const replacement = createJournalStore({
    stateRoot: root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-new', pid: 4242,
    leaseMs: 1_000, now: () => new Date(clock).toISOString(),
    isProcessAlive: async (_pid, expectedStart) => expectedStart === 'start-new',
  });
  const second = await replacement.claim('run-one', plan, 'resume');
  assert.notEqual(second.owner.token, first.owner.token);
  assert.equal(second.owner.pid, first.owner.pid, 'fixture must exercise PID reuse');
  assert.notEqual(second.owner.processStart, first.owner.processStart);
  await assert.rejects(original.release(first.owner), LiveOwnerError);
});

test('immutable generations are content addressed, contiguous, and hash chained', async () => {
  const { root, store } = await fixture();
  const claim = await store.claim('run-one', plan);
  await store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  const run = join(root, 'runs', plan.digest, 'run-one');
  const heads = (await readdir(join(run, 'heads'))).sort();
  assert.equal(heads.length, 2);
  assert.ok(heads[0].startsWith('0000000000000001-'));
  assert.ok(heads[1].startsWith('0000000000000002-'));
  const first = JSON.parse(await readFile(join(run, 'heads', heads[0]), 'utf8'));
  const second = JSON.parse(await readFile(join(run, 'heads', heads[1]), 'utf8'));
  assert.equal(first.previousDigest, null);
  assert.equal(second.previousDigest, first.journalDigest);
  const objectBytes = await readFile(join(run, 'objects', 'sha256', `${second.journalDigest}.json`));
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(objectBytes).digest('hex'), second.journalDigest);

  await rm(join(run, 'heads', heads[0]));
  await assert.rejects(store.read('run-one', plan.digest), /not contiguous/);
});

test('immutable publication leaves only single-linked final names and ignores crash temp artifacts', async () => {
  const { root, store } = await fixture();
  const claim = await store.claim('run-one', plan);
  const run = join(root, 'runs', plan.digest, 'run-one');
  const temporaryName = '.publish.4242.01234567-89ab-4cde-8fab-0123456789ab.tmp';
  for (const directory of ['objects/sha256', 'heads', 'commits', 'compensations']) {
    await writeFile(join(run, directory, temporaryName), '{partial', { mode: 0o600 });
  }

  const objectNames = await readdir(join(run, 'objects', 'sha256'));
  const finalObjectName = objectNames.find(name => name.endsWith('.json'));
  assert.ok(finalObjectName);
  assert.equal((await lstat(join(run, 'objects', 'sha256', finalObjectName))).nlink, 1);
  const finalObjectPath = join(run, 'objects', 'sha256', finalObjectName);
  const linkedCrashTemp = join(run, 'objects', 'sha256', '.publish.4242.11234567-89ab-4cde-8fab-0123456789ab.tmp');
  await link(finalObjectPath, linkedCrashTemp);
  assert.equal((await lstat(finalObjectPath)).nlink, 2);
  const headNames = await readdir(join(run, 'heads'));
  const finalHeadName = headNames.find(name => name.endsWith('.json'));
  assert.ok(finalHeadName);
  assert.equal((await lstat(join(run, 'heads', finalHeadName))).nlink, 1);

  assert.equal((await store.read('run-one', plan.digest)).revision, 1);
  assert.deepEqual(await store.readCompensations('run-one', plan.digest), []);
  await store.release(claim.owner);
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'uncommitted');
  assert.equal((await store.listRuns())[0].authority, 'uncommitted');
});

test('failed initial publication releases only its own lease and leaves no authoritative generation', async () => {
  let fail = true;
  const state = await fixture({
    fault: async point => {
      if (fail && point === 'after-object-sync') { fail = false; throw new Error('injected publication crash'); }
    },
  });
  await assert.rejects(state.store.claim('run-one', plan), /injected publication crash/);
  await assert.rejects(lstat(join(state.root, 'owner.json')), error => error.code === 'ENOENT');
  assert.equal(await state.store.read('run-one', plan.digest), undefined, 'orphan object cannot become an authoritative journal');
  const recovered = await state.store.claim('run-one', plan);
  assert.equal(recovered.journal.revision, 1);
});

test('checkpoint crash before head publication preserves the prior authoritative generation', async () => {
  let armed = false;
  const state = await fixture({
    fault: async point => {
      if (armed && point === 'after-object-sync') { armed = false; throw new Error('injected checkpoint crash'); }
    },
  });
  const claim = await state.store.claim('run-one', plan);
  armed = true;
  const entry = { taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z' };
  await assert.rejects(state.store.checkpoint(claim.owner, entry), /injected checkpoint crash/);
  const beforeRetry = await state.store.read('run-one', plan.digest);
  assert.equal(beforeRetry.revision, 1);
  assert.deepEqual(beforeRetry.entries, []);
  const recovered = await state.store.checkpoint(claim.owner, entry);
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.entries[0].status, 'verified');
});

test('corrupt and insecure journal artifacts fail closed instead of becoming fresh state', async () => {
  const { root, store } = await fixture();
  const claim = await store.claim('run-one', plan);
  await store.release(claim.owner);
  const journal = await onlyJournalObject(root);
  await writeFile(journal, '{', { mode: 0o600 });
  await assert.rejects(store.claim('run-one', plan));
  await writeFile(journal, `${JSON.stringify(claim.journal)}\n`, { mode: 0o666 });
  await chmod(journal, 0o666);
  await assert.rejects(store.claim('run-one', plan));
});

test('resume rejects tampered persisted plans and content-addressed journal objects before ownership', async () => {
  const first = await fixture();
  const claim = await first.store.claim('run-one', plan);
  await first.store.release(claim.owner);
  const directory = join(first.root, 'runs', plan.digest, 'run-one');
  await writeFile(join(directory, 'plan.json'), `${JSON.stringify({ ...plan, desiredRevision: 'tampered' })}\n`, { mode: 0o600 });
  await assert.rejects(first.store.claim('run-one', plan), /persisted plan does not match/);

  const second = await fixture();
  const secondClaim = await second.store.claim('run-one', plan);
  await second.store.release(secondClaim.owner);
  const objectPath = await onlyJournalObject(second.root);
  const object = JSON.parse(await readFile(objectPath, 'utf8'));
  object.journal.entries = [{ taskId: task.id, inputDigest: digest('f'), status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z' }];
  await writeFile(objectPath, `${JSON.stringify(object)}\n`, { mode: 0o600 });
  await assert.rejects(second.store.claim('run-one', plan), /content hash mismatch/);
});

test('finalization writes independently verifiable committed evidence', async () => {
  const { store } = await fixture();
  const claim = await store.claim('run-one', plan);
  await store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  const paths = await store.finalize(claim.owner, plan, {
    schemaVersion: 1, runId: 'run-one', planDigest: plan.digest, status: 'success',
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:00:01.000Z',
    taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 },
    evidencePaths: ['placeholder'], nextAction: null,
  }, [
    { schemaVersion: 1, sequence: 0, at: '2026-11-06T00:00:00.000Z', runId: 'run-one', kind: 'run-status', status: 'started' },
    { schemaVersion: 1, sequence: 1, at: '2026-11-06T00:00:00.100Z', runId: 'run-one', kind: 'task-status', taskId: task.id, status: 'verified', attempt: 1 },
    { schemaVersion: 1, sequence: 2, at: '2026-11-06T00:00:00.200Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'started' },
    { schemaVersion: 1, sequence: 3, at: '2026-11-06T00:00:00.300Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'succeeded' },
    { schemaVersion: 1, sequence: 4, at: '2026-11-06T00:00:01.000Z', runId: 'run-one', kind: 'run-status', status: 'success' },
  ]);
  for (const path of paths) await lstat(path);
  const receiptPath = paths.find(path => path.endsWith('.receipt.json'));
  assert.ok(receiptPath);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(receipt.evidencePaths, paths);
  const eventPath = paths.find(path => path.endsWith('.ndjson'));
  assert.ok(eventPath);
  assert.match(await readFile(eventPath, 'utf8'), /"status":"started"/);
  const commitPath = paths.find(path => path.endsWith('.commit.json'));
  assert.ok(commitPath);
  const commit = JSON.parse(await readFile(commitPath, 'utf8'));
  assert.deepEqual(commit.evidencePaths, paths);
  const { createHash } = await import('node:crypto');
  for (const artifact of [commit.planArtifact, commit.journalObject, commit.journalHead, commit.events, commit.receipt]) {
    assert.equal(createHash('sha256').update(await readFile(artifact.path)).digest('hex'), artifact.sha256);
  }
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'committed');
  const persistedEvents = (await readFile(eventPath, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  await assert.rejects(store.finalize(claim.owner, plan, receipt, persistedEvents), /terminal commit evidence/);
  await store.release(claim.owner);
  const inspection = await store.inspectCompletion('run-one', plan.digest);
  assert.equal(inspection.authority, 'committed');
  assert.equal(inspection.receipt.status, 'success');
  assert.equal(inspection.commitPath, commitPath);
  await assert.rejects(store.claim('run-one', plan), /already has terminal commit evidence/);
  await assert.rejects(store.claim('run-one', plan, 'resume'), /terminal commit evidence|committed run evidence/);

  await writeFile(receiptPath, `${JSON.stringify({ ...receipt, status: 'failed' })}\n`, { mode: 0o600 });
  const tampered = await store.inspectCompletion('run-one', plan.digest);
  assert.equal(tampered.authority, 'corrupt');
  assert.match(tampered.problems[0], /receipt digest/);
});

test('receipt without a final commit marker remains orphan precommit evidence', async () => {
  const state = await fixture({
    fault: async point => { if (point === 'after-receipt-sync') throw new Error('injected precommit crash'); },
  });
  const claim = await state.store.claim('run-one', plan);
  await state.store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  await assert.rejects(state.store.finalize(claim.owner, plan, {
    schemaVersion: 1, runId: 'run-one', planDigest: plan.digest, status: 'success',
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:00:01.000Z',
    taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 },
    evidencePaths: ['placeholder'], nextAction: null,
  }, [
    { schemaVersion: 1, sequence: 0, at: '2026-11-06T00:00:00.000Z', runId: 'run-one', kind: 'run-status', status: 'started' },
    { schemaVersion: 1, sequence: 1, at: '2026-11-06T00:00:00.100Z', runId: 'run-one', kind: 'task-status', taskId: task.id, status: 'verified', attempt: 1 },
    { schemaVersion: 1, sequence: 2, at: '2026-11-06T00:00:00.200Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'started' },
    { schemaVersion: 1, sequence: 3, at: '2026-11-06T00:00:00.300Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'succeeded' },
    { schemaVersion: 1, sequence: 4, at: '2026-11-06T00:00:01.000Z', runId: 'run-one', kind: 'run-status', status: 'success' },
  ]), /injected precommit crash/);
  const run = join(state.root, 'runs', plan.digest, 'run-one');
  assert.equal((await readdir(join(run, 'receipts'))).length, 1, 'fault must occur after durable receipt publication');
  assert.deepEqual(await readdir(join(run, 'commits')), [], 'orphan precommit artifacts must not create authoritative completion evidence');
  await state.store.release(claim.owner);
  const inspection = await state.store.inspectCompletion('run-one', plan.digest);
  assert.equal(inspection.authority, 'uncommitted', 'orphan receipt must not become authoritative completion');
});

test('filesystem-global terminal authority elects one result across independent stores', async () => {
  const state = await fixture();
  const competing = createJournalStore({
    stateRoot: state.root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-one', pid: 42,
    now: () => new Date(state.clock.value).toISOString(), isProcessAlive: async () => true,
  });
  const claim = await state.store.claim('run-one', plan);
  await state.store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  const settled = await Promise.allSettled([
    state.store.finalize(claim.owner, plan, successfulReceipt('2026-11-06T00:00:01.000Z'), successfulEvents('2026-11-06T00:00:01.000Z')),
    competing.finalize(claim.owner, plan, successfulReceipt('2026-11-06T00:00:02.000Z'), successfulEvents('2026-11-06T00:00:02.000Z')),
  ]);
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(result => result.status === 'rejected').length, 1);
  const run = join(state.root, 'runs', plan.digest, 'run-one');
  assert.equal((await readdir(run)).filter(name => name === 'terminal-authority.json').length, 1);
  assert.equal((await state.store.inspectCompletion('run-one', plan.digest)).authority, 'committed');
});

test('orphan candidate commit after a crash is non-authoritative and explicit resume may recover', async () => {
  let crash = true;
  const state = await fixture({
    fault: async point => { if (crash && point === 'after-commit-sync') throw new Error('injected candidate crash'); },
  });
  const claim = await state.store.claim('run-one', plan);
  await state.store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  await assert.rejects(
    state.store.finalize(claim.owner, plan, successfulReceipt(), successfulEvents()),
    /injected candidate crash/,
  );
  await state.store.release(claim.owner);
  assert.equal((await state.store.inspectCompletion('run-one', plan.digest)).authority, 'uncommitted');
  crash = false;
  const resumed = await state.store.claim('run-one', plan, 'resume');
  await state.store.finalize(resumed.owner, plan, successfulReceipt(), successfulEvents());
  assert.equal((await state.store.inspectCompletion('run-one', plan.digest)).authority, 'committed');
});

test('completion inspection distinguishes absent and active runs without writing evidence', async () => {
  const { root, store } = await fixture();
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'absent');
  const claim = await store.claim('run-one', plan);
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'active');
  const before = await readdir(join(root, 'runs', plan.digest, 'run-one', 'commits'));
  await store.inspectCompletion('run-one', plan.digest);
  assert.deepEqual(await readdir(join(root, 'runs', plan.digest, 'run-one', 'commits')), before);
  await store.release(claim.owner);
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'uncommitted');
});

test('completion inspection ignores an expired dead owner for released durable evidence', async () => {
  const state = await fixture({ leaseMs: 1_000, isProcessAlive: async () => false });
  await state.store.claim('run-one', plan);
  state.clock.value += 2_000;
  const inspection = await state.store.inspectCompletion('run-one', plan.digest);
  assert.equal(inspection.authority, 'uncommitted');
  const listed = await state.store.listRuns();
  assert.equal(listed[0].authority, 'uncommitted');
  assert.equal(listed[0].resumeCandidate, true);
});

test('finalization rejects terminal evidence that disagrees with the receipt, plan, or durable journal', async () => {
  const receipt = {
    schemaVersion: 1, runId: 'run-one', planDigest: plan.digest, status: 'success',
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:00:01.000Z',
    taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 },
    evidencePaths: ['placeholder'], nextAction: null,
  };
  const validEvents = () => [
    { schemaVersion: 1, sequence: 0, at: '2026-11-06T00:00:00.000Z', runId: 'run-one', kind: 'run-status', status: 'started' },
    { schemaVersion: 1, sequence: 1, at: '2026-11-06T00:00:00.100Z', runId: 'run-one', kind: 'task-status', taskId: task.id, status: 'verified', attempt: 1 },
    { schemaVersion: 1, sequence: 2, at: '2026-11-06T00:00:00.200Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'started' },
    { schemaVersion: 1, sequence: 3, at: '2026-11-06T00:00:00.300Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'succeeded' },
    { schemaVersion: 1, sequence: 4, at: '2026-11-06T00:00:01.000Z', runId: 'run-one', kind: 'run-status', status: 'success' },
  ];
  const cases = [
    ['missing terminal status', events => events.slice(0, -1), receipt, /exactly one terminal run status/],
    ['receipt mismatch', events => events.map((event, index) => index === 4 ? { ...event, status: 'failed' } : event), receipt, /does not agree with the receipt/],
    ['record phase missing', events => events.filter(event => !(event.kind === 'phase-status' && event.phase === 'record')).map((event, sequence) => ({ ...event, sequence })), receipt, /record phase/],
    ['task outcome missing', events => events.filter(event => event.kind !== 'task-status').map((event, sequence) => ({ ...event, sequence })), receipt, /no terminal outcome/],
    ['unselected task', events => events.map(event => event.kind === 'task-status' ? { ...event, taskId: 'task.other' } : event), receipt, /unselected task/],
    [
      'task counts mismatch',
      events => events.map((event, index) => index === 4 ? { ...event, status: 'failed' } : event),
      { ...receipt, taskCounts: { ...receipt.taskCounts, verified: 0, failed: 1 }, status: 'failed', nextAction: 'Inspect the failed task.' },
      /task counts/,
    ],
  ];

  for (const [name, mutate, candidateReceipt, expected] of cases) {
    const { store } = await fixture();
    const claim = await store.claim('run-one', plan);
    await store.checkpoint(claim.owner, {
      taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
    });
    await assert.rejects(store.finalize(claim.owner, plan, candidateReceipt, mutate(validEvents())), expected, name);
  }

  const state = await fixture();
  const claim = await state.store.claim('run-one', plan);
  await state.store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'failed', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  await assert.rejects(state.store.finalize(claim.owner, plan, receipt, validEvents()), /durable journal/);
});
