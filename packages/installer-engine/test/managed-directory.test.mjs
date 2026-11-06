import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MANAGED_DIRECTORY_AUTHORITY_MARKER,
  applyManagedDirectoryTransaction,
  configurationCompensationArtifactDigest,
} from '../dist/index.js';

function persistence() {
  const prepared = [];
  const updated = [];
  return { prepared, updated, prepare: async value => prepared.push(value), update: async value => updated.push(value) };
}

test('managed directory creation is private, marker-authorized, journal-first, idempotent, and reversible', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-directory-')));
  await chmod(root, 0o700);
  const target = join(root, 'managed');
  const durable = persistence();
  const transaction = await applyManagedDirectoryTransaction({
    spec: { schemaVersion: 1, taskId: 'directory', targetPath: target, effect: 'installer-configuration', dependencies: [], candidateMode: 0o700 },
    persistence: durable,
  });
  assert.equal(durable.prepared.length, 1);
  assert.equal(durable.prepared[0].snapshot.kind, 'directory');
  assert.equal(durable.prepared[0].snapshot.existed, false);
  assert.equal(durable.prepared[0].record.artifactDigest,
    configurationCompensationArtifactDigest(durable.prepared[0].snapshot, null));
  assert.equal((await lstat(target)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(target, MANAGED_DIRECTORY_AUTHORITY_MARKER))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(target, MANAGED_DIRECTORY_AUTHORITY_MARKER))).toString('hex'),
    durable.prepared[0].snapshot.authority.markerHex);
  assert.deepEqual(await readdir(target), [MANAGED_DIRECTORY_AUTHORITY_MARKER]);

  await transaction.rollback();
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');
  assert.equal(durable.updated.at(-1).state, 'applied');
});

test('managed directory accepts an existing exact directory without mutation or compensation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-directory-existing-')));
  await chmod(root, 0o700);
  const target = join(root, 'managed');
  await mkdir(target, { mode: 0o700 });
  const durable = persistence();
  const result = await applyManagedDirectoryTransaction({
    spec: { schemaVersion: 1, taskId: 'directory', targetPath: target, effect: 'installer-configuration', dependencies: [], candidateMode: 0o700 },
    persistence: durable,
  });
  assert.equal(result.created, false);
  assert.equal(durable.prepared.length, 0);
  assert.deepEqual(await readdir(target), []);
});

test('managed directory rejects unsafe parents, incompatible targets, and nonempty rollback', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-directory-safe-')));
  await chmod(root, 0o700);
  const unsafe = join(root, 'unsafe');
  await mkdir(unsafe, { mode: 0o777 });
  await chmod(unsafe, 0o777);
  await assert.rejects(applyManagedDirectoryTransaction({
    spec: { schemaVersion: 1, taskId: 'unsafe', targetPath: join(unsafe, 'managed'), effect: 'installer-configuration', dependencies: [], candidateMode: 0o700 },
    persistence: persistence(),
  }), /parent.*not group\/other writable/i);

  const fileTarget = join(root, 'file');
  await writeFile(fileTarget, 'x');
  await assert.rejects(applyManagedDirectoryTransaction({
    spec: { schemaVersion: 1, taskId: 'file', targetPath: fileTarget, effect: 'installer-configuration', dependencies: [], candidateMode: 0o700 },
    persistence: persistence(),
  }), /existing managed directory target/i);

  const target = join(root, 'managed');
  const tx = await applyManagedDirectoryTransaction({
    spec: { schemaVersion: 1, taskId: 'nonempty', targetPath: target, effect: 'installer-configuration', dependencies: [], candidateMode: 0o700 },
    persistence: persistence(),
  });
  await writeFile(join(target, 'user-data'), 'preserve');
  await assert.rejects(tx.rollback(), /rollback failed/i);
  assert.equal(await readFile(join(target, 'user-data'), 'utf8'), 'preserve');
});
