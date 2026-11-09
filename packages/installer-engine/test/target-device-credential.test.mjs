import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProtectedDeviceCredentialStore } from '../dist/target-device-credential.js';

const request = {
  schemaVersion: 1, requestId: 'request-1',
  binding: { tenantId: 'tenant-server', profileId: 'profile-1', targetPublicKey: 'A'.repeat(43),
    targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read'], nonce: 'n'.repeat(32),
    expiresAt: '2026-11-09T13:10:00.000Z' },
  machineLabel: 'Canary', verificationCode: 'ABCD-EF12', pollKeyFingerprint: 'b'.repeat(64),
  createdAt: '2026-11-09T13:00:00.000Z',
};
const credential = { schemaVersion: 1, request, credential: 'secret-device-credential-never-print',
  credentialId: 'credential-1', expiresAt: '2026-11-09T14:00:00.000Z', storedAt: '2026-11-09T13:01:00.000Z' };

test('credential store atomically creates owner-only authority and is idempotent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-credential-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const path = join(root, 'device.json');
  const store = new ProtectedDeviceCredentialStore(path);
  await store.save(credential);
  await store.save(credential);
  assert.deepEqual(await store.load(), credential);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(path)).nlink, 1);
  assert.match(await readFile(path, 'utf8'), /secret-device-credential-never-print/);
  await assert.rejects(store.save({ ...credential, credentialId: 'credential-other' }), /different authority/);
});

test('credential store rejects permissive parents and credential files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-credential-open-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'device.json');
  const store = new ProtectedDeviceCredentialStore(path);
  if (process.platform !== 'win32') {
    await chmod(root, 0o755);
    await assert.rejects(store.save(credential), /mode 0700/);
    await chmod(root, 0o700);
    await store.save(credential);
    await chmod(path, 0o644);
    await assert.rejects(store.load(), /mode 0600/);
  }
});
