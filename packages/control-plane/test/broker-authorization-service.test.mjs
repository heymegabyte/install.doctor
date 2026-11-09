import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrokerAuthorizationServiceError,
  createBrokerAuthorizationService,
} from '../src/broker-authorization-service.ts';

const hex = value => value.repeat(64);
const now = new Date('2026-11-09T12:00:00.000Z');
const intent = {
  schemaVersion: 1,
  runIntentId: 'intent-1', authorizationId: 'authorization-1', tenantId: 'tenant-1',
  profileId: 'profile-1', profileRevisionDigest: hex('a'),
  deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), grantId: 'grant-1',
  hostId: 'host-1', releaseId: 'release-1', runId: 'run-1', planDigest: hex('c'),
  enrolledUid: 1000, brokerExecutableDigest: hex('d'), runtimeDigest: hex('e'),
  workerDigest: hex('f'), operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
  descriptorDigest: hex('1'), closureDigest: hex('2'), consentDigest: hex('3'),
  requestedAt: '2026-11-09T11:59:00.000Z', grantExpiresAt: '2026-11-09T12:20:00.000Z',
};
const principal = {
  deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), tenantId: 'tenant-1',
  permissions: ['authorize-privileged-run'],
};
const owner = { actor: 'OWNER@example.com', authenticatedAt: '2026-11-09T11:58:00.000Z' };

function fixture(overrides = {}) {
  const calls = { intents: [], decisions: [], lookups: [], statuses: [] };
  const reconstruction = {
    schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
    ownerActorId: 'owner@example.com', ownerDecision: 'approved',
    ownerReauthenticatedAt: owner.authenticatedAt, ownerDecidedAt: now.toISOString(),
    ownerDecisionExpiresAt: '2026-11-09T12:10:00.000Z', tenantId: intent.tenantId,
    profileId: intent.profileId, profileRevisionDigest: intent.profileRevisionDigest,
    deviceCredentialId: intent.deviceCredentialId, deviceFingerprint: intent.deviceFingerprint,
    runIntentId: intent.runIntentId, status: 'approved', grant: {
      schemaVersion: 1, grantId: intent.grantId, hostId: intent.hostId, releaseId: intent.releaseId,
      runId: intent.runId, planDigest: intent.planDigest, approvedPlanDigest: intent.planDigest,
      enrolledUid: intent.enrolledUid, brokerExecutableDigest: intent.brokerExecutableDigest,
      runtimeDigest: intent.runtimeDigest, workerDigest: intent.workerDigest,
      operations: intent.operations, descriptorDigest: intent.descriptorDigest,
      closureDigest: intent.closureDigest, consentDigest: intent.consentDigest,
      issuedAt: intent.requestedAt, expiresAt: intent.grantExpiresAt,
    },
  };
  const service = createBrokerAuthorizationService({
    now: () => now,
    store: {
      async persistRunIntent(value) { calls.intents.push(value); return true; },
      async persistOwnerDecision(value) { calls.decisions.push(value); return true; },
      async loadApprovedReconstruction(value) { calls.lookups.push(value); return reconstruction; },
      async loadAuthorizationStatus(value) { calls.statuses.push(value); return { schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1' }; },
    },
    authority: {
      async reconstructRunIntent() { return intent; },
      async loadRunIntent(id) { return id === intent.runIntentId ? intent : null; },
      async ownerForTenant() { return { authenticationActor: 'owner@example.com', ownerActorId: 'owner-1' }; },
      ...overrides,
    },
  });
  return { service, calls, reconstruction };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof BrokerAuthorizationServiceError && error.code === code);
}

test('persists only an exact authority-reconstructed run intent', async () => {
  const { service, calls } = fixture();
  const result = await service.requestAuthorization(intent, principal);
  assert.equal(result.created, true);
  assert.deepEqual(calls.intents, [intent]);

  const changed = { ...intent, planDigest: hex('9') };
  await rejectsCode(service.requestAuthorization(changed, principal), 'authoritative_state_mismatch');
  assert.equal(calls.intents.length, 1);
});

test('privileged endpoints reject legacy NULL scopes and identity substitutions', async () => {
  const { service } = fixture();
  await rejectsCode(service.requestAuthorization(intent, { ...principal, permissions: null }), 'insufficient_scope');
  await rejectsCode(service.requestAuthorization(intent, { ...principal, permissions: [] }), 'insufficient_scope');
  await rejectsCode(service.requestAuthorization(intent, { ...principal, tenantId: 'tenant-2' }), 'identity_mismatch');
  await rejectsCode(service.claimApprovedAuthorization({
    schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
    tenantId: intent.tenantId, profileId: intent.profileId,
    profileRevisionDigest: intent.profileRevisionDigest, deviceCredentialId: intent.deviceCredentialId,
    deviceFingerprint: intent.deviceFingerprint, runIntentId: intent.runIntentId, grantId: intent.grantId,
  }, { ...principal, deviceFingerprint: hex('8') }), 'identity_mismatch');
});

test('owner review and decision require current matching authentication and exact displayed bindings', async () => {
  const { service, calls } = fixture();
  await rejectsCode(service.reviewAuthorization(intent.runIntentId, null), 'reauthentication_required');
  await rejectsCode(service.reviewAuthorization(intent.runIntentId,
    { ...owner, actor: 'other@example.com' }), 'wrong_actor');
  await rejectsCode(service.reviewAuthorization(intent.runIntentId,
    { ...owner, authenticatedAt: '2026-11-09T11:54:59.999Z' }), 'reauthentication_required');

  const request = {
    schemaVersion: 1, ownerDecisionId: 'decision-1', runIntentId: intent.runIntentId,
    authorizationId: intent.authorizationId, approvedPlanDigest: intent.planDigest,
    consentDigest: intent.consentDigest, decision: 'approved',
  };
  await rejectsCode(service.decideAuthorization({ ...request, approvedPlanDigest: hex('9') }, owner),
    'exact_binding_mismatch');
  const result = await service.decideAuthorization(request, owner);
  assert.equal(result.decision.ownerActorId, 'owner-1');
  assert.equal(result.decision.expiresAt, '2026-11-09T12:10:00.000Z');
  assert.deepEqual(calls.decisions, [result.decision]);
});

test('claim is exact, device-scoped, bounded, and returns only durable reconstruction', async () => {
  const { service, calls, reconstruction } = fixture();
  const lookup = {
    schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
    tenantId: intent.tenantId, profileId: intent.profileId,
    profileRevisionDigest: intent.profileRevisionDigest, deviceCredentialId: intent.deviceCredentialId,
    deviceFingerprint: intent.deviceFingerprint, runIntentId: intent.runIntentId, grantId: intent.grantId,
  };
  assert.deepEqual(await service.claimApprovedAuthorization(lookup, principal), reconstruction);
  assert.deepEqual(calls.lookups, [lookup]);
  await assert.rejects(service.claimApprovedAuthorization({ ...lookup, extra: true }, principal));
});

test('authority failures fail closed and cannot persist caller facts', async () => {
  const unavailable = fixture({ async reconstructRunIntent() { throw new Error('down'); } });
  await rejectsCode(unavailable.service.requestAuthorization(intent, principal), 'authority_unavailable');
  assert.equal(unavailable.calls.intents.length, 0);

  const absent = fixture({ async reconstructRunIntent() { return null; } });
  await rejectsCode(absent.service.requestAuthorization(intent, principal), 'authoritative_state_mismatch');
  assert.equal(absent.calls.intents.length, 0);
});

test('target status derives hidden identity only from the authenticated principal', async () => {
  const { service, calls } = fixture();
  const request = { schemaVersion: 1, authorizationId: intent.authorizationId,
    runIntentId: intent.runIntentId, grantId: intent.grantId };
  assert.deepEqual(await service.authorizationStatus(request, principal), {
    schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1',
  });
  assert.deepEqual(calls.statuses, [{ ...request, tenantId: principal.tenantId,
    deviceCredentialId: principal.deviceCredentialId, deviceFingerprint: principal.deviceFingerprint }]);
  await rejectsCode(service.authorizationStatus(request, { ...principal, permissions: null }), 'insufficient_scope');
  await assert.rejects(service.authorizationStatus({ ...request, tenantId: 'tenant-2' }, principal));
});
