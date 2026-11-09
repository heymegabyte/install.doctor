import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivilegedBrokerTransactionPersistence } from '../dist/privileged-broker-transaction-store.js';

const digest = character => character.repeat(64);
const record = (overrides = {}) => ({
  schemaVersion: 1, kind: 'install-doctor-native-dpkg-transaction-record', transactionId: digest('d'),
  runId: 'run-one', hostId: 'host-one', planDigest: digest('a'), rootPackageKey: 'tree', authorityDigest: digest('e'),
  phase: 'prepared', packages: [{ packageKey: 'tree', packageName: 'tree', version: '2.1.0-1', architecture: 'amd64', phase: 'pending' }],
  serviceSnapshots: [], policyRecord: null, activePackageKey: null, failure: null,
  createdAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-11-08T12:00:00.000Z', ...overrides,
});

test('root transaction fence appends a durable hash chain and resumes exact state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'broker-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const persistence = await createPrivilegedBrokerTransactionPersistence({ root, ownerUid: process.getuid(),
    runId: 'run-one', hostId: 'host-one', planDigest: digest('a') });
  assert.equal(await persistence.load(digest('d')), undefined);
  await persistence.save(record());
  await persistence.save(record());
  assert.equal((await readdir(join(root, digest('d')))).length, 1, 'unchanged save must be a no-op');
  const completed = record({ phase: 'completed', packages: [{ ...record().packages[0], phase: 'configured' }],
    updatedAt: '2026-11-08T12:00:01.000Z' });
  await persistence.save(completed);
  assert.deepEqual(await persistence.load(digest('d')), completed);
  assert.equal((await readdir(join(root, digest('d')))).length, 2);
  assert.match(await persistence.evidenceDigest(), /^[a-f0-9]{64}$/);
});

test('root transaction fence rejects authority drift and generation tampering', async t => {
  const root = await mkdtemp(join(tmpdir(), 'broker-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const persistence = await createPrivilegedBrokerTransactionPersistence({ root, ownerUid: process.getuid(),
    runId: 'run-one', hostId: 'host-one', planDigest: digest('a') });
  await assert.rejects(persistence.save(record({ runId: 'other' })), /differs from root authority/);
  await persistence.save(record());
  const directory = join(root, digest('d'));
  const [name] = await readdir(directory);
  await writeFile(join(directory, name), '{}\n');
  await assert.rejects(persistence.load(digest('d')), /unsafe|schema|chain/);
});
