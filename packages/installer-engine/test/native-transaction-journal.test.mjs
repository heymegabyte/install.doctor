import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createJournalStore } from '../dist/index.js';

const digest = character => character.repeat(64);
const task = {
  schemaVersion: 1, id: 'native.root', inputDigest: digest('b'), dependencies: [], predicate: 'host-supported',
  requiredCapabilities: [], operations: { check: 'check', apply: 'apply', verify: 'verify' }, timeoutMs: 1_000,
  retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
  privilege: 'admin', network: 'none', consent: 'none', lockDomains: ['dpkg'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'continue-independent',
};
const plan = {
  schemaVersion: 1, planId: 'plan-one', digest: digest('a'), releaseId: 'release-one', desiredRevision: 'desired-one',
  hostFactsDigest: digest('c'), createdAt: '2026-11-06T00:00:00.000Z', tasks: [task], selectedTaskIds: [task.id],
};

const record = (overrides = {}) => ({
  schemaVersion: 1,
  kind: 'install-doctor-native-dpkg-transaction-record',
  transactionId: digest('d'),
  runId: 'run-one',
  hostId: 'host-one',
  planDigest: plan.digest,
  rootPackageKey: 'native.root',
  authorityDigest: digest('e'),
  phase: 'prepared',
  packages: [{ packageKey: 'curl', packageName: 'curl', version: '8.10.1-1', architecture: 'arm64', phase: 'pending' }],
  serviceSnapshots: [],
  policyRecord: null,
  activePackageKey: null,
  failure: null,
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
  ...overrides,
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-native-journal-'));
  await chmod(root, 0o700);
  const store = createJournalStore({
    stateRoot: root, hostId: 'host-one', bootId: 'boot-one', processStart: 'start-one', pid: 42,
    now: () => '2026-11-06T00:00:00.000Z', isProcessAlive: async () => true,
  });
  const claim = await store.claim('run-one', plan);
  return { root, store, claim };
}

test('native transaction persistence is write-ahead, owner fenced, and resumes from exact durable bytes', async () => {
  const { store, claim } = await fixture();
  const persistence = store.bindNativeDpkgTransactionPersistence(claim.owner);
  assert.equal(await persistence.load(digest('d')), undefined);
  await assert.rejects(persistence.save(record({ phase: 'unpacking' })), /prepared/i);
  await persistence.save(record());
  assert.deepEqual(await persistence.load(digest('d')), record());

  const updated = record({ phase: 'services-captured', updatedAt: '2026-11-06T00:00:01.000Z' });
  await persistence.save(updated);
  assert.deepEqual(await persistence.load(digest('d')), updated);
  await assert.rejects(persistence.save(record({ rootPackageKey: 'other.task', updatedAt: '2026-11-06T00:00:02.000Z' })), /identity|binding/i);

  await store.release(claim.owner);
  await assert.rejects(persistence.load(digest('d')), /lease|owner/i);
  const resumed = await store.claim('run-one', plan, 'resume');
  const rebound = store.bindNativeDpkgTransactionPersistence(resumed.owner);
  assert.deepEqual(await rebound.load(digest('d')), updated);
});

test('one run cannot create two native transactions for the same root task', async () => {
  const { store, claim } = await fixture();
  const persistence = store.bindNativeDpkgTransactionPersistence(claim.owner);
  await persistence.save(record());
  await assert.rejects(
    persistence.save(record({ transactionId: digest('f'), updatedAt: '2026-11-06T00:00:01.000Z' })),
    /root package|task/i,
  );
});

test('native current heads and immutable records reject content, mode, and unexpected-name tampering', async () => {
  const { root, store, claim } = await fixture();
  const persistence = store.bindNativeDpkgTransactionPersistence(claim.owner);
  await persistence.save(record());
  const run = join(root, 'runs', plan.digest, 'run-one');
  const headPath = join(run, 'native-transactions', 'current', `${digest('d')}.json`);
  const head = JSON.parse(await readFile(headPath, 'utf8'));
  const objectPath = join(run, 'native-transactions', 'objects', 'sha256', `${head.recordDigest}.json`);
  await writeFile(objectPath, '{}\n', { mode: 0o600 });
  await assert.rejects(persistence.load(digest('d')), /digest|schema|record/i);

  const second = await fixture();
  const secondPersistence = second.store.bindNativeDpkgTransactionPersistence(second.claim.owner);
  await secondPersistence.save(record());
  const secondRun = join(second.root, 'runs', plan.digest, 'run-one');
  const secondHead = JSON.parse(await readFile(join(secondRun, 'native-transactions', 'current', `${digest('d')}.json`), 'utf8'));
  const secondObject = join(secondRun, 'native-transactions', 'objects', 'sha256', `${secondHead.recordDigest}.json`);
  await chmod(secondObject, 0o666);
  await assert.rejects(secondPersistence.load(digest('d')), /permissions|links/i);
  await chmod(secondObject, 0o600);

  await writeFile(join(secondRun, 'native-transactions', 'current', 'surprise.json'), '{}\n', { mode: 0o600 });
  await assert.rejects(secondPersistence.save(record({ phase: 'services-captured', updatedAt: '2026-11-06T00:00:01.000Z' })), /unexpected native transaction/i);
});

test('terminal commit binds the native transaction index and detects post-commit tampering', async () => {
  const { root, store, claim } = await fixture();
  const persistence = store.bindNativeDpkgTransactionPersistence(claim.owner);
  await persistence.save(record());
  await persistence.save(record({ phase: 'completed', updatedAt: '2026-11-06T00:00:01.000Z' }));
  await store.checkpoint(claim.owner, {
    taskId: task.id, inputDigest: task.inputDigest, status: 'verified', attempts: 1, updatedAt: '2026-11-06T00:00:01.000Z',
  });
  const receipt = {
    schemaVersion: 1, runId: 'run-one', planDigest: plan.digest, status: 'success',
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:00:02.000Z',
    taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 },
    evidencePaths: ['placeholder'], nextAction: null,
  };
  const events = [
    { schemaVersion: 1, sequence: 0, at: '2026-11-06T00:00:00.000Z', runId: 'run-one', kind: 'run-status', status: 'started' },
    { schemaVersion: 1, sequence: 1, at: '2026-11-06T00:00:01.000Z', runId: 'run-one', kind: 'task-status', taskId: task.id, status: 'verified', attempt: 1 },
    { schemaVersion: 1, sequence: 2, at: '2026-11-06T00:00:01.100Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'started' },
    { schemaVersion: 1, sequence: 3, at: '2026-11-06T00:00:01.200Z', runId: 'run-one', kind: 'phase-status', phase: 'record', status: 'succeeded' },
    { schemaVersion: 1, sequence: 4, at: '2026-11-06T00:00:02.000Z', runId: 'run-one', kind: 'run-status', status: 'success' },
  ];
  const evidence = await store.finalize(claim.owner, plan, receipt, events);
  const indexPath = evidence.find(path => path.includes('native-transaction-indexes'));
  assert.ok(indexPath);
  assert.equal((await store.inspectCompletion('run-one', plan.digest)).authority, 'committed');

  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const nativeObjectPath = index.transactions[0].record.path;
  await writeFile(nativeObjectPath, '{}\n', { mode: 0o600 });
  const inspection = await store.inspectCompletion('run-one', plan.digest);
  assert.equal(inspection.authority, 'corrupt');
  assert.match(inspection.problems.join(' '), /native transaction.*digest|digest.*native transaction/i);
});
