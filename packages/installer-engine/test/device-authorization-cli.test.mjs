import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { ProtectedDeviceCredentialStore } from '../dist/target-device-credential.js';
import { ProtectedAuthorizationState } from '../dist/target-device-authorization.js';

const execute = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const secret = 'secret-device-credential-never-print';
const request = {
  schemaVersion: 1, requestId: 'request-1',
  binding: { tenantId: 'tenant-server', profileId: 'profile-1', targetPublicKey: 'A'.repeat(43),
    targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read'], nonce: 'n'.repeat(32),
    expiresAt: '2099-11-09T13:10:00.000Z' },
  machineLabel: 'Canary', verificationCode: 'ABCD-EF12', pollKeyFingerprint: 'b'.repeat(64),
  createdAt: '2026-11-09T13:00:00.000Z',
};

async function invoke(path) {
  return execute(process.execPath, [cli, '--input', path], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
}

test('device authorization status reports only nonsecret durable metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-auth-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const credentialPath = join(root, 'credential.json');
  const statePath = join(root, 'pending.json');
  await new ProtectedDeviceCredentialStore(credentialPath).save({ schemaVersion: 1, request,
    credential: secret, credentialId: 'credential-1', expiresAt: '2099-11-09T14:00:00.000Z',
    storedAt: '2026-11-09T13:01:00.000Z' });
  const invocationPath = join(root, 'status.json');
  await writeFile(invocationPath, `${JSON.stringify({ schemaVersion: 1, command: 'device-authorization-status',
    statePath, credentialPath })}\n`, { mode: 0o600 });
  const result = await invoke(invocationPath);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output, { schemaVersion: 1, status: 'approved', requestId: 'request-1',
    credentialId: 'credential-1', profileId: 'profile-1', targetKeyFingerprint: 'a'.repeat(64),
    scopes: ['profile:read'], expiresAt: '2099-11-09T14:00:00.000Z' });
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr, '');
});

test('device authorization start rejects caller-supplied tenant authority before network', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-auth-cli-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const invocationPath = join(root, 'start.json');
  await writeFile(invocationPath, `${JSON.stringify({ schemaVersion: 1, command: 'device-authorization-start',
    origin: 'https://unreachable.invalid', statePath: join(root, 'pending.json'),
    credentialPath: join(root, 'credential.json'), profileId: 'profile-1', machineLabel: 'Canary',
    scopes: ['profile:read'], expiresAt: '2099-11-09T13:10:00.000Z', tenantId: 'caller-tenant' })}\n`, { mode: 0o600 });
  await assert.rejects(invoke(invocationPath), error => error.code === 2
    && error.stderr.includes('invalid invocation')
    && !`${error.stdout}${error.stderr}`.includes('caller-tenant'));
});

test('device authorization wait reconciles a credential persisted before pending cleanup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-auth-cli-reconcile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const credentialPath = join(root, 'credential.json');
  const statePath = join(root, 'pending.json');
  await new ProtectedDeviceCredentialStore(credentialPath).save({ schemaVersion: 1, request,
    credential: secret, credentialId: 'credential-1', expiresAt: '2099-11-09T14:00:00.000Z',
    storedAt: '2026-11-09T13:01:00.000Z' });
  await new ProtectedAuthorizationState(statePath).save({ schemaVersion: 1, request,
    approvalUri: 'https://desktop.tools/pair?code=ABCD-EF12', pollIntervalMs: 2_000,
    pollSecret: 'p'.repeat(43),
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n' });
  const invocationPath = join(root, 'wait.json');
  await writeFile(invocationPath, `${JSON.stringify({ schemaVersion: 1, command: 'device-authorization-wait',
    origin: 'https://unreachable.invalid', statePath, credentialPath })}\n`, { mode: 0o600 });
  const result = await invoke(invocationPath);
  assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, status: 'approved',
    requestId: 'request-1', credentialId: 'credential-1', expiresAt: '2099-11-09T14:00:00.000Z' });
  assert.equal(result.stdout.includes(secret), false);
  await assert.rejects(readFile(statePath), error => error.code === 'ENOENT');
});
