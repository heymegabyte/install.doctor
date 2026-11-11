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
  const calls = { intents: [], decisions: [], lookups: [], statuses: [], states: [], approvals: [], reviewedPlans: [] };
  let reviewedPlan = null;
  const currentAuthority = {
    tenantId: intent.tenantId,
    profile: { id: intent.profileId, revision: 'revision-1', digest: intent.profileRevisionDigest },
    host: { id: intent.hostId, factsDigest: hex('5') },
    release: { id: intent.releaseId, manifestDigest: hex('6') },
    policyDigest: hex('7'), normalizedPlanDigest: intent.planDigest,
    operationClosureDigest: intent.closureDigest, approvalSetDigest: intent.consentDigest,
    rollbackLimits: { automaticEffects: ['configuration'],
      separatelyApprovedEffects: ['external-provider', 'network', 'operating-system', 'package', 'storage'],
      destructiveAutomaticRepair: false },
    now: now.toISOString(),
  };
  const reconstruction = {
    schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
    ownerActorId: 'owner-1', ownerDecision: 'approved',
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
      async persistReviewedPlan(runIntentId, value) {
        assert.equal(runIntentId, intent.runIntentId);
        if (reviewedPlan && JSON.stringify(reviewedPlan) !== JSON.stringify(value)) throw new Error('collision');
        reviewedPlan = value; calls.reviewedPlans.push(value); return reviewedPlan === value;
      },
      async loadReviewedPlan() { return reviewedPlan; },
    },
    authority: {
      async reconstructRunIntent() { return intent; },
      async loadRunIntent(id) { return id === intent.runIntentId ? intent : null; },
      async ownerForTenant() { return { authenticationActor: 'owner@example.com', ownerActorId: 'owner-1' }; },
      async reconstructCurrentPlanAuthority() { return currentAuthority; },
      ...overrides,
    },
    approval: {
      async delegationForRelease(releaseId) {
        assert.equal(releaseId, intent.releaseId);
        return { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
          keyId: 'approval-key-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
          product: 'desktop-tools', releaseId, channel: 'stable', publicKeySpki: 'A'.repeat(64),
          notBefore: '2026-11-09T11:00:00.000Z', notAfter: '2026-11-09T13:00:00.000Z',
          maximumApprovalLifetimeSeconds: 600, revocationEpoch: 1, delegationDigest: hex('4') };
      },
      async persistApprovedState(value) { calls.states.push(value); return true; },
      async approve(value) { calls.approvals.push(value); return { approvalId: 'approval-1' }; },
    },
  });
  return { service, calls, reconstruction, currentAuthority };
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

test('claim is exact, device-scoped, persists reconstructed authority, and returns only signed evidence', async () => {
  const { service, calls, reconstruction } = fixture();
  await service.reviewAuthorization(intent.runIntentId, owner);
  const lookup = {
    schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
    tenantId: intent.tenantId, profileId: intent.profileId,
    profileRevisionDigest: intent.profileRevisionDigest, deviceCredentialId: intent.deviceCredentialId,
    deviceFingerprint: intent.deviceFingerprint, runIntentId: intent.runIntentId, grantId: intent.grantId,
  };
  assert.deepEqual(await service.claimApprovedAuthorization(lookup, principal), { approval: { approvalId: 'approval-1' } });
  assert.deepEqual(calls.lookups, [lookup]);
  assert.equal(calls.states.length, 1);
  assert.deepEqual(calls.states[0].grant, reconstruction.grant);
  assert.deepEqual(calls.approvals, [lookup]);
  await assert.rejects(service.claimApprovedAuthorization({ ...lookup, extra: true }, principal));
});

test('fact, profile, release, policy, approval, closure, plan, and rollback drift deny before any privileged effect', async () => {
  const axes = [
    current => ({ ...current, host: { ...current.host, factsDigest: hex('8') } }),
    current => ({ ...current, profile: { ...current.profile, revision: 'revision-2' } }),
    current => ({ ...current, release: { ...current.release, manifestDigest: hex('8') } }),
    current => ({ ...current, policyDigest: hex('8') }),
    current => ({ ...current, approvalSetDigest: hex('8') }),
    current => ({ ...current, operationClosureDigest: hex('8') }),
    current => ({ ...current, normalizedPlanDigest: hex('8') }),
    current => ({ ...current, rollbackLimits: { ...current.rollbackLimits, automaticEffects: [] } }),
  ];
  for (const drift of axes) {
    let current;
    const setup = fixture({ async reconstructCurrentPlanAuthority() { return current; } });
    current = setup.currentAuthority;
    await setup.service.reviewAuthorization(intent.runIntentId, owner);
    const lookup = { schemaVersion: 1, authorizationId: intent.authorizationId, ownerDecisionId: 'decision-1',
      tenantId: intent.tenantId, profileId: intent.profileId, profileRevisionDigest: intent.profileRevisionDigest,
      deviceCredentialId: intent.deviceCredentialId, deviceFingerprint: intent.deviceFingerprint,
      runIntentId: intent.runIntentId, grantId: intent.grantId };
    // Capture a clean review, then introduce independently reconstructed drift.
    current = drift(setup.currentAuthority);
    await rejectsCode(setup.service.claimApprovedAuthorization(lookup, principal), 'reviewed_plan_drift');
    assert.equal(setup.calls.states.length, 0);
    assert.equal(setup.calls.approvals.length, 0);
  }
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
