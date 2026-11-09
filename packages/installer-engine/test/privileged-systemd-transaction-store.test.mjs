import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivilegedSystemdTransactionPersistence } from '../dist/index.js';

const d = character => character.repeat(64);
const record = (overrides = {}) => ({
  schemaVersion: 1, kind: 'desktop-tools-native-systemd-transaction-record', transactionId: d('d'),
  runId: 'run-one', hostId: 'host-one', planDigest: d('a'), authorityDigest: d('e'), unit: 'alloy.service',
  desiredState: { enabled: true, running: true }, previousState: { enabled: false, running: false },
  phase: 'prepared', failure: null, createdAt: '2026-11-09T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z', ...overrides,
});

test('root systemd fence appends a durable hash chain and no-ops unchanged saves', async t => {
  const root = await mkdtemp(join(tmpdir(), 'systemd-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const store = await createPrivilegedSystemdTransactionPersistence({ root, ownerUid: process.getuid(), runId: 'run-one', hostId: 'host-one', planDigest: d('a') });
  await store.save(record());
  await store.save(record());
  assert.equal((await readdir(join(root, d('d')))).length, 1);
  const completed = record({ phase: 'completed', updatedAt: '2026-11-09T12:00:01.000Z' });
  await store.save(completed);
  assert.deepEqual(await store.load(d('d')), completed);
  assert.match(await store.evidenceDigest(), /^[a-f0-9]{64}$/);
});

test('root systemd fence rejects authority drift and generation tampering', async t => {
  const root = await mkdtemp(join(tmpdir(), 'systemd-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createPrivilegedSystemdTransactionPersistence({ root, ownerUid: process.getuid(), runId: 'run-one', hostId: 'host-one', planDigest: d('a') });
  await assert.rejects(store.save(record({ hostId: 'other' })), /differs from root authority/);
  await store.save(record());
  const [name] = await readdir(join(root, d('d')));
  await writeFile(join(root, d('d'), name), '{}\n');
  await assert.rejects(store.load(d('d')), /unsafe|schema|chain/);
});
