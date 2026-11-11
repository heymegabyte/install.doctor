import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WslIdentitySchema,
  WslRestartContinuationSchema,
  coordinateWslRestart,
  inspectWslRestartReturn,
  preflightWslOperation,
} from '../dist/wsl-boundary.js';

const planDigest = 'a'.repeat(64);
const identity = {
  schemaVersion: 1,
  pairId: 'workstation-01-ubuntu',
  windows: { authority: 'windows-host', hostId: 'workstation-01', machineGuidDigest: 'b'.repeat(64), bootId: 'windows-boot-10' },
  linux: { authority: 'linux-guest', guestId: 'workstation-01-ubuntu', distroName: 'Ubuntu-24.04', distroId: 'ubuntu-2404', instanceId: 'guest-instance-10' },
};

const operation = overrides => ({
  schemaVersion: 1, pairId: identity.pairId, runId: 'run-01', planDigest,
  authority: 'linux-guest', principalId: identity.linux.guestId, action: 'read',
  path: { authority: 'linux-guest', value: '/home/operator/config.json', resolvedValue: '/home/operator/config.json' },
  ...overrides,
});

test('host and guest identities are strict, explicit, and never interchangeable', () => {
  assert.deepEqual(WslIdentitySchema.parse(identity), identity);
  assert.throws(() => WslIdentitySchema.parse({ ...identity,
    linux: { ...identity.linux, guestId: identity.windows.hostId } }), /must be distinct/);
  assert.throws(() => WslIdentitySchema.parse({ ...identity,
    windows: { ...identity.windows, authority: 'linux-guest' } }));
  assert.throws(() => WslIdentitySchema.parse({ ...identity, ambientAdministrator: true }), /unrecognized/i);
});

test('same-authority absolute paths are admitted without granting the other authority', () => {
  assert.deepEqual(preflightWslOperation(identity, operation({})),
    { decision: 'allow', reason: 'same-authority-path' });
  assert.deepEqual(preflightWslOperation(identity, operation({ authority: 'windows-host',
    principalId: identity.windows.hostId,
    path: { authority: 'windows-host', value: 'C:\\ProgramData\\DesktopTools\\state.json', resolvedValue: 'C:\\ProgramData\\DesktopTools\\state.json' } })),
  { decision: 'allow', reason: 'same-authority-path' });
  assert.deepEqual(preflightWslOperation(identity, operation({ pairId: 'another-pair' })),
    { decision: 'deny', reason: 'pair-identity-mismatch' });
  assert.deepEqual(preflightWslOperation(identity, operation({ authority: 'windows-host',
    principalId: identity.linux.guestId,
    path: { authority: 'windows-host', value: 'C:\\Windows\\System32', resolvedValue: 'C:\\Windows\\System32' } })),
  { decision: 'deny', reason: 'authority-identity-mismatch' });
  assert.deepEqual(preflightWslOperation(identity, operation({ path: { authority: 'windows-host', value: '/etc/shadow', resolvedValue: '/etc/shadow' } })),
    { decision: 'deny', reason: 'path-authority-mismatch' });
  assert.deepEqual(preflightWslOperation(identity, operation({ path: { authority: 'linux-guest', value: 'relative/file', resolvedValue: 'relative/file' } })),
    { decision: 'deny', reason: 'invalid-absolute-path' });
});

test('mounted drives and WSL UNC projections are denied as cross-boundary paths', () => {
  const cases = [
    operation({ path: { authority: 'linux-guest', value: '/mnt/c/Users/operator/.ssh/id_ed25519', resolvedValue: '/mnt/c/Users/operator/.ssh/id_ed25519' } }),
    operation({ authority: 'windows-host', principalId: identity.windows.hostId, path: { authority: 'windows-host', value: '\\\\wsl$\\Ubuntu-24.04\\home\\operator\\.ssh\\id_ed25519', resolvedValue: '\\\\wsl$\\Ubuntu-24.04\\home\\operator\\.ssh\\id_ed25519' } }),
    operation({ authority: 'windows-host', principalId: identity.windows.hostId, path: { authority: 'windows-host', value: '\\\\wsl.localhost\\Ubuntu-24.04\\etc\\shadow', resolvedValue: '\\\\wsl.localhost\\Ubuntu-24.04\\etc\\shadow' } }),
    operation({ path: { authority: 'linux-guest', value: '/home/operator/host-link', resolvedValue: '/mnt/c/Users/operator' } }),
  ];
  for (const candidate of cases) assert.deepEqual(preflightWslOperation(identity, candidate),
    { decision: 'deny', reason: 'cross-boundary-path' });
});

test('opaque credentials are usable only by their issuing authority', () => {
  const linuxCredential = operation({ action: 'credential-read', path: undefined,
    credential: { authority: 'linux-guest', reference: 'infisical://guest-ubuntu/service/token' } });
  assert.deepEqual(preflightWslOperation(identity, linuxCredential),
    { decision: 'allow', reason: 'same-authority-credential' });
  assert.deepEqual(preflightWslOperation(identity, { ...linuxCredential, authority: 'windows-host', principalId: identity.windows.hostId }),
    { decision: 'deny', reason: 'cross-boundary-credential' });
  const windowsCredential = { ...linuxCredential, authority: 'linux-guest',
    credential: { authority: 'windows-host', reference: 'credential-manager://desktop-tools/device' } };
  assert.deepEqual(preflightWslOperation(identity, windowsCredential),
    { decision: 'deny', reason: 'cross-boundary-credential' });
  assert.deepEqual(preflightWslOperation(identity, { ...linuxCredential,
    credential: { authority: 'linux-guest', reference: 'credential-manager://desktop-tools/device' } }),
  { decision: 'deny', reason: 'cross-boundary-credential' });
  assert.throws(() => preflightWslOperation(identity, operation({ action: 'credential-read', path: undefined })), /credential-read requires/);
});

const restart = overrides => ({ schemaVersion: 1, identity, runId: 'run-01', planDigest,
  target: 'linux-guest', authority: 'linux-guest', principalId: identity.linux.guestId,
  requestedAt: '2026-11-10T12:00:00.000Z',
  returnTimeoutMs: 300_000, ...overrides });

const heartbeat = (continuation, overrides = {}) => ({ schemaVersion: 1, pairId: identity.pairId,
  runId: 'run-01', planDigest, continuationId: continuation.continuationId,
  windowsBootId: 'windows-boot-10', linuxInstanceId: 'guest-instance-11',
  observedAt: '2026-11-10T12:01:00.000Z', ...overrides });

test('a guest restart requires guest authority and proves Windows stayed on the same boot', () => {
  assert.deepEqual(coordinateWslRestart(restart({ authority: 'windows-host', principalId: identity.windows.hostId })),
    { status: 'denied', reason: 'restart-authority-mismatch' });
  const { continuation } = coordinateWslRestart(restart({}));
  assert.deepEqual(WslRestartContinuationSchema.parse(structuredClone(continuation)), continuation);
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation), '2026-11-10T12:01:01.000Z'),
    { status: 'ready-to-resume', canResume: true, reason: 'linux-guest-restart-verified' });
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, { windowsBootId: 'windows-boot-11' }), '2026-11-10T12:01:01.000Z'),
    { status: 'identity-mismatch', canResume: false, reason: 'unexpected-windows-host-reboot' });
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, { linuxInstanceId: 'guest-instance-10' }), '2026-11-10T12:01:01.000Z'),
    { status: 'awaiting-return', canResume: false, reason: 'linux-guest-identity-unchanged' });
});

test('a Windows-host reboot requires host authority and fresh host and guest identities', () => {
  const { continuation } = coordinateWslRestart(restart({ target: 'windows-host', authority: 'windows-host', principalId: identity.windows.hostId }));
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, {
    windowsBootId: 'windows-boot-11', linuxInstanceId: 'guest-instance-11',
  }), '2026-11-10T12:01:01.000Z'),
  { status: 'ready-to-resume', canResume: true, reason: 'windows-host-restart-verified' });
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, {
    windowsBootId: 'windows-boot-10', linuxInstanceId: 'guest-instance-11',
  }), '2026-11-10T12:01:01.000Z'),
  { status: 'awaiting-return', canResume: false, reason: 'windows-host-identity-unchanged' });
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, {
    windowsBootId: 'windows-boot-11', linuxInstanceId: 'guest-instance-10',
  }), '2026-11-10T12:01:01.000Z'),
  { status: 'identity-mismatch', canResume: false, reason: 'stale-linux-guest-after-host-reboot' });
});

test('missing, late, wrong-continuation, and tampered restart evidence fail closed', () => {
  const { continuation } = coordinateWslRestart(restart({}));
  assert.deepEqual(inspectWslRestartReturn(continuation, null, '2026-11-10T12:04:59.000Z'),
    { status: 'awaiting-return', canResume: false, reason: 'return-heartbeat-missing' });
  assert.deepEqual(inspectWslRestartReturn(continuation, null, '2026-11-10T12:05:00.000Z'),
    { status: 'recovery-timeout', canResume: false, reason: 'return-heartbeat-missing' });
  assert.deepEqual(inspectWslRestartReturn(continuation, heartbeat(continuation, { continuationId: 'c'.repeat(64) }), '2026-11-10T12:01:01.000Z'),
    { status: 'identity-mismatch', canResume: false, reason: 'continuation-identity-mismatch' });
  assert.throws(() => WslRestartContinuationSchema.parse({ ...continuation, target: 'windows-host' }), /differs from its bound identities/);
});
