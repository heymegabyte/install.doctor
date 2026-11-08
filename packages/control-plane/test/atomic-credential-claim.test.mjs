import assert from 'node:assert/strict';
import test from 'node:test';
import { claimDeviceCredential, revokeDeviceCredential } from '../src/atomic-credential-claim.ts';

const now = new Date('2026-11-08T12:00:00.000Z');
const binding = {
  tenantId: 'tenant-1', profileId: 'profile-1', targetPublicKey: 'A'.repeat(43),
  targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read', 'session:create'],
  nonce: 'n'.repeat(32), expiresAt: '2026-11-08T12:05:00.000Z',
};
const request = {
  schemaVersion: 1, requestId: 'request-1', binding, machineLabel: 'Zen',
  verificationCode: 'ABCD-EF12', pollKeyFingerprint: 'b'.repeat(64), createdAt: '2026-11-08T11:55:00.000Z',
};
const claim = { requestId: request.requestId, tenantId: binding.tenantId, profileId: binding.profileId, deviceKeyFingerprint: binding.targetKeyFingerprint, pollProof: 'c'.repeat(64) };
const unavailable = { ok: false, status: 404, error: 'claim_unavailable' };

function fixture(overrides = {}) {
  let state = { request, status: 'approved', approvedScopes: ['profile:read'], lastPolledAt: null, revision: 'revision-1', ...overrides };
  let storedCredential = null;
  const store = {
    async readForClaim() { return state; },
    async atomicClaim(input) {
      if (state.status !== input.expectedStatus || state.revision !== input.expectedRevision) return 'conflict';
      if (storedCredential?.id === input.credential.id) return 'credential-id-collision';
      state = { ...state, status: 'claimed', revision: 'revision-2' };
      storedCredential = input.credential;
      return 'claimed';
    },
    async atomicRevoke(input) {
      if (!storedCredential || storedCredential.id !== input.credentialId) return 'not-found';
      if (storedCredential.tenantId !== input.tenantId || storedCredential.deviceKeyFingerprint !== input.deviceKeyFingerprint) return 'binding-mismatch';
      if (storedCredential.revokedAt) return 'already-revoked';
      storedCredential = { ...storedCredential, revokedAt: input.revokedAt };
      return 'revoked';
    },
  };
  let id = 'credential-1';
  const dependencies = {
    store, now,
    verifyPollProof: async proof => proof === claim.pollProof,
    mintCredential: async authority => ({ id, secret: `secret-for-${authority.deviceKeyFingerprint}` }),
  };
  return { dependencies, store, setCredentialId(value) { id = value; }, get credential() { return storedCredential; } };
}

test('atomically claims once with only approved minimum scopes and a finite lifetime', async () => {
  const setup = fixture();
  const result = await claimDeviceCredential(claim, setup.dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.credential.scopes, ['profile:read']);
  assert.equal(result.credential.expiresAt, '2026-11-09T12:00:00.000Z');
  assert.deepEqual(await claimDeviceCredential(claim, setup.dependencies), unavailable);
});

test('normalizes atomic replay and credential-id collision without leaking state', async () => {
  const replay = fixture();
  const [left, right] = await Promise.all([
    claimDeviceCredential(claim, replay.dependencies), claimDeviceCredential(claim, replay.dependencies),
  ]);
  assert.equal([left, right].filter(result => result.ok).length, 1);
  assert.deepEqual([left, right].find(result => !result.ok), unavailable);

  const collision = fixture();
  collision.dependencies.store.atomicClaim = async () => 'credential-id-collision';
  assert.deepEqual(await claimDeviceCredential(claim, collision.dependencies), unavailable);
});

test('cross-device, cross-profile, and cross-tenant claims are indistinguishable', async () => {
  for (const changed of [
    { tenantId: 'tenant-2' }, { profileId: 'profile-2' }, { deviceKeyFingerprint: 'd'.repeat(64) },
  ]) assert.deepEqual(await claimDeviceCredential({ ...claim, ...changed }, fixture().dependencies), unavailable);
});

test('expired, denied, bad-proof, and over-broad scope claims fail closed', async () => {
  assert.deepEqual(await claimDeviceCredential(claim, fixture({ status: 'denied' }).dependencies), unavailable);
  assert.deepEqual(await claimDeviceCredential(claim, fixture({ request: { ...request, binding: { ...binding, expiresAt: now.toISOString() } } }).dependencies), unavailable);
  assert.deepEqual(await claimDeviceCredential({ ...claim, pollProof: 'd'.repeat(64) }, fixture().dependencies), unavailable);
  assert.deepEqual(await claimDeviceCredential(claim, fixture({ approvedScopes: [...binding.scopes, 'tenant:admin'] }).dependencies), unavailable);
});

test('over-polling returns bounded retry guidance without a credential', async () => {
  const result = await claimDeviceCredential(claim, fixture({ lastPolledAt: '2026-11-08T11:59:58.000Z' }).dependencies);
  assert.deepEqual(result, { ok: false, status: 429, error: 'retry_later', retryAfterSeconds: 3 });
});

test('credentials revoke independently with normalized unavailable errors', async () => {
  const setup = fixture();
  const claimed = await claimDeviceCredential(claim, setup.dependencies);
  assert.equal(claimed.ok, true);
  const revocation = { credentialId: claimed.credential.id, tenantId: binding.tenantId, deviceKeyFingerprint: binding.targetKeyFingerprint, revokedAt: now.toISOString(), reason: 'owner-revoked' };
  assert.deepEqual(await revokeDeviceCredential(revocation, setup.store), { ok: true });
  assert.deepEqual(await revokeDeviceCredential(revocation, setup.store), { ok: false, status: 404, error: 'credential_unavailable' });
  assert.deepEqual(await revokeDeviceCredential({ ...revocation, credentialId: 'other' }, setup.store), { ok: false, status: 404, error: 'credential_unavailable' });
});
