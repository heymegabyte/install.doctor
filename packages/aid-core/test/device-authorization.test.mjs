import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeviceAuthorizationApprovalSchema,
  DeviceAuthorizationAuditSchema,
  DeviceAuthorizationClaimSchema,
  DeviceAuthorizationDenialSchema,
  DeviceAuthorizationPollSchema,
  DeviceAuthorizationRequestSchema,
  DeviceAuthorizationRevocationSchema,
  TargetDeviceAuthorizationBindingSchema,
  assertDeviceAuthorizationTransition,
} from '../dist/device-authorization.js';

const binding = {
  tenantId: 'tenant-1', profileId: 'workstation', targetPublicKey: 'A'.repeat(43),
  targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read', 'session:create'],
  nonce: 'n'.repeat(32), expiresAt: '2026-11-08T15:10:00.000Z',
};
const request = {
  schemaVersion: 1, requestId: 'request-1', binding, machineLabel: 'Zen workstation',
  verificationCode: 'ABCD-EF12', pollKeyFingerprint: 'b'.repeat(64), createdAt: '2026-11-08T15:00:00.000Z',
};
const common = { schemaVersion: 1, requestId: request.requestId, binding };

test('target start authority excludes the server-owned tenant binding', () => {
  const { tenantId: _tenantId, ...targetBinding } = binding;
  assert.deepEqual(TargetDeviceAuthorizationBindingSchema.parse(targetBinding), targetBinding);
  assert.throws(() => TargetDeviceAuthorizationBindingSchema.parse(binding));
});

test('strictly parses every authorization protocol and audit payload', () => {
  DeviceAuthorizationRequestSchema.parse(request);
  DeviceAuthorizationApprovalSchema.parse({ ...common, actorId: 'owner-1', approvedAt: '2026-11-08T15:01:00.000Z' });
  DeviceAuthorizationPollSchema.parse({ ...common, pollProof: 'c'.repeat(64), polledAt: '2026-11-08T15:02:00.000Z' });
  DeviceAuthorizationClaimSchema.parse({ ...common, credentialId: 'credential-1', claimedAt: '2026-11-08T15:03:00.000Z', credentialExpiresAt: '2026-11-08T16:00:00.000Z' });
  DeviceAuthorizationDenialSchema.parse({ ...common, actorId: 'owner-1', deniedAt: '2026-11-08T15:03:00.000Z', reason: 'owner-denied' });
  DeviceAuthorizationRevocationSchema.parse({ ...common, credentialId: 'credential-1', actorId: 'owner-1', revokedAt: '2026-11-08T15:04:00.000Z', reason: 'device-lost' });
  DeviceAuthorizationAuditSchema.parse({ ...common, eventId: 'event-1', event: 'claimed', outcome: 'accepted', actorId: null, credentialId: 'credential-1', occurredAt: '2026-11-08T15:03:00.000Z', reasonCode: null });
});

test('rejects unknown fields at the top level and in nested bindings', () => {
  assert.throws(() => DeviceAuthorizationRequestSchema.parse({ ...request, secret: 'must-not-pass' }));
  assert.throws(() => DeviceAuthorizationRequestSchema.parse({ ...request, binding: { ...binding, region: 'hidden-authority' } }));
  assert.throws(() => DeviceAuthorizationApprovalSchema.parse({ ...common, actorId: 'owner-1', approvedAt: '2026-11-08T15:01:00.000Z', credential: 'secret' }));
});

test('binds transitions to tenant, profile, target key, fingerprint, nonce, expiry, and scopes', () => {
  assert.deepEqual(assertDeviceAuthorizationTransition(request, common), binding);
  for (const changed of [
    { tenantId: 'tenant-2' }, { profileId: 'server' }, { targetPublicKey: 'B'.repeat(43) },
    { targetKeyFingerprint: 'f'.repeat(64) }, { nonce: 'x'.repeat(32) },
    { expiresAt: '2026-11-08T15:11:00.000Z' },
  ]) {
    assert.throws(() => assertDeviceAuthorizationTransition(request, { ...common, binding: { ...binding, ...changed } }), /not bound/);
  }
});

test('permits narrowing but rejects scope broadening', () => {
  assert.deepEqual(
    assertDeviceAuthorizationTransition(request, { ...common, binding: { ...binding, scopes: ['profile:read'] } }).scopes,
    ['profile:read'],
  );
  assert.throws(
    () => assertDeviceAuthorizationTransition(request, { ...common, binding: { ...binding, scopes: [...binding.scopes, 'tenant:admin'] } }),
    /broadens requested scopes/,
  );
});

test('rejects approval, polling, and claiming outside bounded lifetimes', () => {
  assert.throws(() => DeviceAuthorizationApprovalSchema.parse({ ...common, actorId: 'owner-1', approvedAt: '2026-11-08T15:11:00.000Z' }));
  assert.throws(() => DeviceAuthorizationPollSchema.parse({ ...common, pollProof: 'c'.repeat(64), polledAt: '2026-11-08T15:11:00.000Z' }));
  assert.throws(() => DeviceAuthorizationClaimSchema.parse({ ...common, credentialId: 'credential-1', claimedAt: '2026-11-08T15:03:00.000Z', credentialExpiresAt: '2026-11-08T15:02:00.000Z' }));
});
