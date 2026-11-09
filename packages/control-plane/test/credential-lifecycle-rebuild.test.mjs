import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { DeviceAuthorizationAuditSchema } from '../../aid-core/src/device-authorization.ts';
import { claimDeviceCredential, revokeDeviceCredential } from '../src/atomic-credential-claim.ts';

const tenantId = 'tenant-lifecycle';
const profileId = 'profile-lifecycle';
const scopes = ['profile:read', 'session:create'];
const pollProof = 'c'.repeat(64);

function authorizationRequest(sequence, fingerprint, expiresAt) {
  return {
    schemaVersion: 1,
    requestId: `request-${sequence}`,
    binding: {
      tenantId,
      profileId,
      targetPublicKey: sequence === 1 ? 'A'.repeat(43) : 'B'.repeat(43),
      targetKeyFingerprint: fingerprint,
      scopes,
      nonce: `${sequence}`.repeat(32),
      expiresAt,
    },
    machineLabel: 'rebuild-fixture',
    verificationCode: sequence === 1 ? 'ABCD-EF12' : 'BCDE-FG23',
    pollKeyFingerprint: 'd'.repeat(64),
    createdAt: sequence === 1 ? '2026-11-09T09:55:00.000Z' : '2026-11-09T10:25:00.000Z',
  };
}

function disposableLifecycleStore() {
  const requests = new Map();
  const credentials = new Map();
  const receipts = [];

  const appendReceipt = (request, event, outcome, occurredAt, credentialId, reasonCode) => {
    const receipt = DeviceAuthorizationAuditSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      binding: request.binding,
      eventId: `event-${receipts.length + 1}`,
      event,
      outcome,
      actorId: event === 'revoked' ? 'owner-lifecycle' : null,
      credentialId,
      occurredAt,
      reasonCode,
    });
    receipts.push(receipt);
  };

  return {
    requests,
    credentials,
    receipts,
    addApproved(request) {
      requests.set(request.requestId, {
        request,
        status: 'approved',
        approvedScopes: scopes,
        lastPolledAt: null,
        revision: `revision-${request.requestId}`,
      });
    },
    async readForClaim(requestId) {
      return requests.get(requestId) ?? null;
    },
    async atomicClaim({ requestId, expectedRevision, expectedStatus, credential, claimedAt }) {
      const state = requests.get(requestId);
      if (!state || state.status !== expectedStatus || state.revision !== expectedRevision) return 'conflict';
      if (credentials.has(credential.id)) return 'credential-id-collision';
      requests.set(requestId, { ...state, status: 'claimed', revision: `${state.revision}-claimed` });
      credentials.set(credential.id, { ...credential, requestId, secretDigest: crypto.createHash('sha256').update(credential.secret).digest('hex'), revokedAt: null });
      appendReceipt(state.request, 'claimed', 'accepted', claimedAt, credential.id, null);
      return 'claimed';
    },
    async atomicRevoke({ credentialId, tenantId: presentedTenant, deviceKeyFingerprint, revokedAt, reason }) {
      const credential = credentials.get(credentialId);
      if (!credential) return 'not-found';
      if (credential.tenantId !== presentedTenant || credential.deviceKeyFingerprint !== deviceKeyFingerprint) return 'binding-mismatch';
      if (credential.revokedAt) return 'already-revoked';
      credentials.set(credentialId, { ...credential, revokedAt });
      const state = requests.get(credential.requestId);
      appendReceipt(state.request, 'revoked', 'accepted', revokedAt, credential.id, reason);
      return 'revoked';
    },
    authenticate(credentialId, secret) {
      const credential = credentials.get(credentialId);
      const digest = crypto.createHash('sha256').update(secret).digest('hex');
      return Boolean(credential && !credential.revokedAt && credential.secretDigest === digest);
    },
  };
}

test('revocation survives a disposable host rebuild and produces exact secret-free receipts', async () => {
  const store = disposableLifecycleStore();
  const oldFingerprint = 'a'.repeat(64);
  const rebuiltFingerprint = 'b'.repeat(64);
  const oldRequest = authorizationRequest(1, oldFingerprint, '2026-11-09T10:10:00.000Z');
  const rebuiltRequest = authorizationRequest(2, rebuiltFingerprint, '2026-11-09T10:40:00.000Z');
  store.addApproved(oldRequest);

  const claim = (request, now, credentialId) => claimDeviceCredential({
    requestId: request.requestId,
    tenantId,
    profileId,
    deviceKeyFingerprint: request.binding.targetKeyFingerprint,
    pollProof,
  }, {
    store,
    now: new Date(now),
    credentialLifetimeMs: 60 * 60 * 1000,
    verifyPollProof: async presented => presented === pollProof,
    mintCredential: async () => ({ id: credentialId, secret: `fixture-secret-${credentialId}` }),
  });

  const original = await claim(oldRequest, '2026-11-09T10:00:00.000Z', 'credential-1');
  assert.equal(original.ok, true);
  assert.equal(store.authenticate(original.credential.id, original.credential.secret), true);

  assert.deepEqual(await revokeDeviceCredential({
    credentialId: original.credential.id,
    tenantId,
    deviceKeyFingerprint: oldFingerprint,
    revokedAt: '2026-11-09T10:20:00.000Z',
    reason: 'device-lost',
  }, store), { ok: true });
  assert.equal(store.authenticate(original.credential.id, original.credential.secret), false);

  store.addApproved(rebuiltRequest);
  const rebuilt = await claim(rebuiltRequest, '2026-11-09T10:30:00.000Z', 'credential-2');
  assert.equal(rebuilt.ok, true);
  assert.equal(store.authenticate(rebuilt.credential.id, rebuilt.credential.secret), true);
  assert.equal(store.authenticate(original.credential.id, original.credential.secret), false,
    're-enrollment must not reactivate the revoked pre-rebuild credential');

  assert.deepEqual(store.receipts.map(receipt => ({
    requestId: receipt.requestId,
    fingerprint: receipt.binding.targetKeyFingerprint,
    event: receipt.event,
    outcome: receipt.outcome,
    credentialId: receipt.credentialId,
    occurredAt: receipt.occurredAt,
    reasonCode: receipt.reasonCode,
  })), [
    { requestId: 'request-1', fingerprint: oldFingerprint, event: 'claimed', outcome: 'accepted',
      credentialId: 'credential-1', occurredAt: '2026-11-09T10:00:00.000Z', reasonCode: null },
    { requestId: 'request-1', fingerprint: oldFingerprint, event: 'revoked', outcome: 'accepted',
      credentialId: 'credential-1', occurredAt: '2026-11-09T10:20:00.000Z', reasonCode: 'device-lost' },
    { requestId: 'request-2', fingerprint: rebuiltFingerprint, event: 'claimed', outcome: 'accepted',
      credentialId: 'credential-2', occurredAt: '2026-11-09T10:30:00.000Z', reasonCode: null },
  ]);
  assert.doesNotMatch(JSON.stringify(store.receipts), /fixture-secret|dtc_|aid_/,
    'lifecycle receipts must never contain reusable credential material');
});
