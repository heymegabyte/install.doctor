import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  NativePolicyRcdError,
  PolicyRcdTransactionRecordSchema,
  createNativePolicyRcdTransaction,
} from '../dist/index.js';

const HELPER = '#!/bin/sh\nexit 101\n';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'policy-rcd-')));
  await chmod(root, 0o700);
  await mkdir(join(root, 'usr'), { mode: 0o755 });
  await mkdir(join(root, 'usr', 'sbin'), { mode: 0o755 });
  const records = [];
  const persistence = {
    prepare: async record => { records.push(structuredClone(record)); },
    update: async record => { records.push(structuredClone(record)); },
  };
  const transaction = await createNativePolicyRcdTransaction({
    persistence,
    testRoot: root,
    testOwner: process.geteuid(),
    testGroup: process.getegid(),
  });
  return { root, target: join(root, 'usr', 'sbin', 'policy-rc.d'), records, persistence, transaction };
}

test('strict record schema rejects unknown state and fields', () => {
  assert.throws(() => PolicyRcdTransactionRecordSchema.parse({ schemaVersion: 1, phase: 'mystery' }));
  assert.throws(() => PolicyRcdTransactionRecordSchema.parse({
    schemaVersion: 1,
    phase: 'prepared',
    target: '/usr/sbin/policy-rc.d',
    snapshot: { schemaVersion: 1, existed: false, bytesBase64: null, uid: null, gid: null, mode: null },
    helperDigest: '0'.repeat(64),
    preparedAt: '2026-01-01T00:00:00.000Z',
    extra: true,
  }));
});

test('absence is checkpointed before installing an exact private 0755 helper', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  let preparedObservedAbsent = false;
  const transaction = await createNativePolicyRcdTransaction({
    persistence: {
      prepare: async record => {
        preparedObservedAbsent = await lstat(state.target).then(() => false, error => error.code === 'ENOENT');
        state.records.push(structuredClone(record));
      },
      update: state.persistence.update,
    },
    testRoot: state.root,
    testOwner: process.geteuid(),
    testGroup: process.getegid(),
  });
  const prepared = await transaction.prepare();
  assert.equal(prepared.phase, 'prepared');
  assert.equal(prepared.snapshot.existed, false);
  assert.equal(preparedObservedAbsent, true);
  const active = await transaction.activate(prepared);
  assert.equal(active.phase, 'active');
  assert.equal(await readFile(state.target, 'utf8'), HELPER);
  const info = await lstat(state.target);
  assert.equal(info.isFile(), true);
  assert.equal(info.nlink, 1);
  assert.equal(info.uid, process.geteuid());
  assert.equal(info.gid, process.getegid());
  assert.equal(info.mode & 0o7777, 0o755);
  assert.deepEqual(state.records.map(record => record.phase), ['prepared', 'active']);
});

test('restores exact original bytes, ownership, and mode and is idempotent', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const original = Buffer.from('#!/bin/sh\nexit 0\n');
  await writeFile(state.target, original, { mode: 0o741 });
  const prepared = await state.transaction.prepare();
  assert.equal(prepared.snapshot.bytesBase64, original.toString('base64'));
  const active = await state.transaction.activate(prepared);
  const restored = await state.transaction.restore(active);
  assert.equal(restored.phase, 'restored');
  assert.deepEqual(await readFile(state.target), original);
  assert.equal((await lstat(state.target)).mode & 0o7777, 0o741);
  assert.deepEqual(await state.transaction.restore(restored), restored);
  assert.equal((await state.transaction.inspect(restored)).disposition, 'original');
});

test('reconcile repairs crashes both before and after the active checkpoint', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const prepared = await state.transaction.prepare();
  assert.deepEqual(await state.transaction.reconcile(prepared), prepared);

  await writeFile(state.target, HELPER, { mode: 0o755 });
  const recovered = await state.transaction.reconcile(prepared);
  assert.equal(recovered.phase, 'restored');
  await assert.rejects(lstat(state.target), error => error.code === 'ENOENT');

  const next = await state.transaction.prepare();
  const active = await state.transaction.activate(next);
  const afterActiveCrash = await state.transaction.reconcile(active);
  assert.equal(afterActiveCrash.phase, 'restored');
  await assert.rejects(lstat(state.target), error => error.code === 'ENOENT');
  assert.deepEqual(await state.transaction.reconcile(afterActiveCrash), afterActiveCrash);
});

test('refuses symlinks, hardlinks, nonregular targets, and unsafe parents', async t => {
  for (const kind of ['symlink', 'hardlink', 'directory', 'parent-mode']) {
    const state = await fixture();
    t.after(() => rm(state.root, { recursive: true, force: true }));
    if (kind === 'symlink') {
      await writeFile(join(state.root, 'elsewhere'), 'x');
      await symlink(join(state.root, 'elsewhere'), state.target);
    } else if (kind === 'hardlink') {
      await writeFile(state.target, 'x');
      await link(state.target, join(state.root, 'alias'));
    } else if (kind === 'directory') {
      await mkdir(state.target);
    } else {
      await chmod(join(state.root, 'usr', 'sbin'), 0o777);
    }
    await assert.rejects(state.transaction.prepare(), NativePolicyRcdError, kind);
  }
});

test('refuses drift and never restores an inode it cannot attribute', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await writeFile(state.target, 'original', { mode: 0o600 });
  const prepared = await state.transaction.prepare();
  await writeFile(state.target, 'third party replacement');
  await assert.rejects(state.transaction.activate(prepared), /changed after the prepared checkpoint/);

  await rm(state.target);
  await writeFile(state.target, Buffer.from(prepared.snapshot.bytesBase64, 'base64'), { mode: prepared.snapshot.mode });
  const active = await state.transaction.activate(await state.transaction.prepare());
  await writeFile(state.target, 'third party replacement');
  await assert.rejects(state.transaction.restore(active), /conflict/);
  assert.equal(await readFile(state.target, 'utf8'), 'third party replacement');
});

test('requires a canonical private test root and durable persistence', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await assert.rejects(createNativePolicyRcdTransaction({ testRoot: state.root, testOwner: process.geteuid(), testGroup: process.getegid() }), /persistence/);
  await assert.rejects(createNativePolicyRcdTransaction({
    persistence: state.persistence,
    testRoot: `${state.root}/.`,
    testOwner: process.geteuid(),
    testGroup: process.getegid(),
  }), /canonical/);
});

test('a failed prepared checkpoint cannot mutate policy-rc.d', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const transaction = await createNativePolicyRcdTransaction({
    persistence: {
      prepare: async () => { throw new Error('durability unavailable'); },
      update: async () => { throw new Error('unexpected update'); },
    },
    testRoot: state.root,
    testOwner: process.geteuid(),
    testGroup: process.getegid(),
  });
  await assert.rejects(transaction.prepare(), /durability unavailable/);
  await assert.rejects(lstat(state.target), error => error.code === 'ENOENT');
});
