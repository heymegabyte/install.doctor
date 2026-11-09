import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import test from 'node:test';
import {
  BrokerApprovalDurableState,
  BrokerApprovalGrant,
  BrokerApprovalRequest,
  BrokerApprovalSignerDelegation,
  SignedBrokerApproval,
  createBrokerApprovalSigningBoundary,
} from '../src/broker-approval-signer.ts';

const now = new Date('2026-11-09T12:00:00.000Z');
const hex = character => character.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function semanticDigest(domain, value) {
  return createHash('sha256').update(`${domain}\0${JSON.stringify(canonical(value))}`).digest('hex');
}

function grant(overrides = {}) {
  return {
    schemaVersion: 1,
    grantId: 'grant-1',
    hostId: 'host-1',
    releaseId: 'release-1',
    runId: 'run-1',
    planDigest: hex('a'),
    approvedPlanDigest: hex('a'),
    enrolledUid: 1000,
    brokerExecutableDigest: hex('b'),
    runtimeDigest: hex('c'),
    workerDigest: hex('d'),
    operations: [{ taskId: 'package.tree', operationId: 'package.tree.apply', phase: 'apply' }],
    descriptorDigest: hex('e'),
    closureDigest: hex('f'),
    consentDigest: hex('1'),
    issuedAt: '2026-11-09T11:59:00.000Z',
    expiresAt: '2026-11-09T12:20:00.000Z',
    ...overrides,
  };
}

function delegation(keyId, publicKey, overrides = {}) {
  const value = {
    schemaVersion: 1,
    kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId,
    algorithm: 'Ed25519',
    signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools',
    releaseId: 'release-1',
    channel: 'stable',
    publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    notBefore: '2026-11-09T11:00:00.000Z',
    notAfter: '2026-11-09T13:00:00.000Z',
    maximumApprovalLifetimeSeconds: 600,
    revocationEpoch: 7,
    ...overrides,
  };
  return { ...value, delegationDigest: semanticDigest(
    'desktop-tools:broker-approval-signer-delegation:v1', value,
  ) };
}

function state(signerDelegation, overrides = {}) {
  return {
    schemaVersion: 1,
    authorizationId: 'authorization-1',
    ownerDecisionId: 'owner-decision-1',
    ownerActorId: 'owner-1',
    ownerDecision: 'approved',
    ownerReauthenticatedAt: '2026-11-09T11:58:00.000Z',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    profileRevisionDigest: hex('4'),
    deviceCredentialId: 'device-credential-1',
    deviceFingerprint: hex('5'),
    runIntentId: 'run-intent-1',
    status: 'approved',
    grant: grant(),
    delegation: signerDelegation,
    ...overrides,
  };
}

function request(durableState, overrides = {}) {
  return {
    schemaVersion: 1,
    authorizationId: durableState.authorizationId,
    ownerDecisionId: durableState.ownerDecisionId,
    tenantId: durableState.tenantId,
    profileId: durableState.profileId,
    profileRevisionDigest: durableState.profileRevisionDigest,
    deviceCredentialId: durableState.deviceCredentialId,
    deviceFingerprint: durableState.deviceFingerprint,
    runIntentId: durableState.runIntentId,
    grantId: durableState.grant.grantId,
    ...overrides,
  };
}

function fixture(options = {}) {
  const keyPair = options.keyPair ?? generateKeyPairSync('ed25519');
  const keyId = options.keyId ?? 'approval-key-1';
  const exactState = options.state ?? state(delegation(keyId, keyPair.publicKey));
  let consumed = false;
  const signedMessages = [];
  const consumedInputs = [];
  const signer = Object.freeze({
    keyId,
    async sign(message) {
      signedMessages.push(Buffer.from(message));
      return new Uint8Array(sign(null, message, keyPair.privateKey));
    },
  });
  const store = {
    async loadExactState() { return exactState; },
    async consumeApproval(input) {
      consumedInputs.push(input);
      if (options.consume === false || consumed) return false;
      consumed = true;
      return true;
    },
  };
  const boundary = createBrokerApprovalSigningBoundary({
    store,
    signer,
    now: () => options.now ?? now,
    randomId: () => options.approvalId ?? 'approval-1',
    minimumRevocationEpoch: options.minimumRevocationEpoch ?? 7,
  });
  return { boundary, exactState, keyPair, signer, signedMessages, consumedInputs };
}

test('strict schemas reject unknown fields, grant broadening, and missing minimum operation scope', () => {
  const setup = fixture();
  const exactRequest = request(setup.exactState);
  assert.throws(() => BrokerApprovalRequest.parse({ ...exactRequest, grant: grant() }));
  assert.throws(() => BrokerApprovalRequest.parse({ ...exactRequest, operations: [] }));
  assert.throws(() => BrokerApprovalRequest.parse({ ...exactRequest, signerKeyId: 'caller-key' }));
  assert.throws(() => BrokerApprovalRequest.parse({ ...exactRequest, minimumRevocationEpoch: 0 }));
  assert.throws(() => BrokerApprovalGrant.parse(grant({ operations: [] })));
  assert.throws(() => BrokerApprovalGrant.parse(grant({ extraAuthority: true })));
  assert.throws(() => BrokerApprovalSignerDelegation.parse({ ...setup.exactState.delegation, privateKey: 'forbidden' }));
  assert.throws(() => BrokerApprovalDurableState.parse({ ...setup.exactState, unknown: true }));
});

test('reconstructs the exact grant from durable state and signs its complete audit correlation', async () => {
  const setup = fixture();
  const approval = await setup.boundary.approve(request(setup.exactState));
  assert.deepEqual(approval.grant, setup.exactState.grant);
  assert.equal(approval.authorizationId, setup.exactState.authorizationId);
  assert.equal(approval.ownerDecisionId, setup.exactState.ownerDecisionId);
  assert.equal(approval.ownerActorId, setup.exactState.ownerActorId);
  assert.equal(approval.runIntentId, setup.exactState.runIntentId);
  assert.equal(approval.signerKeyId, setup.exactState.delegation.keyId);
  assert.equal(approval.delegationDigest, setup.exactState.delegation.delegationDigest);
  assert.equal(approval.revocationEpoch, setup.exactState.delegation.revocationEpoch);
  assert.equal(approval.approvedAt, now.toISOString());
  assert.equal(approval.expiresAt, '2026-11-09T12:10:00.000Z');
  assert.deepEqual(setup.consumedInputs, [{
    approvalId: approval.approvalId,
    authorizationId: approval.authorizationId,
    ownerDecisionId: approval.ownerDecisionId,
    runIntentId: approval.runIntentId,
  }]);

  const { signature, auditDigest: _auditDigest, ...unsigned } = approval;
  const message = Buffer.from(`${approval.signatureDomain}\0${JSON.stringify(canonical(unsigned))}`);
  assert.deepEqual(setup.signedMessages, [message]);
  assert.equal(verify(null, message, setup.keyPair.publicKey, Buffer.from(signature, 'base64url')), true);
  assert.equal(approval.auditDigest,
    semanticDigest('desktop-tools:broker-approval-audit:v1', unsigned));
  assert.doesNotThrow(() => SignedBrokerApproval.parse(approval));
});

test('rejects denied, pending, or otherwise non-approved durable state before signing', async () => {
  for (const changed of [
    { ownerDecision: 'denied' },
    { status: 'pending' },
  ]) {
    const baseline = fixture();
    const setup = fixture({ state: { ...baseline.exactState, ...changed } });
    await assert.rejects(setup.boundary.approve(request(setup.exactState)));
    assert.equal(setup.signedMessages.length, 0);
    assert.equal(setup.consumedInputs.length, 0);
  }
});

test('requires a current authenticated owner decision in durable state', async () => {
  const baseline = fixture();
  for (const ownerReauthenticatedAt of [
    '2026-11-09T11:54:59.999Z',
    '2026-11-09T12:00:00.001Z',
  ]) {
    const durableState = { ...baseline.exactState, ownerReauthenticatedAt };
    const setup = fixture({ state: durableState });
    await assert.rejects(setup.boundary.approve(request(durableState)), /reauthentication is not current/);
    assert.equal(setup.signedMessages.length, 0);
    assert.equal(setup.consumedInputs.length, 0);
  }
});

test('rejects expired grants and expired or not-yet-valid delegations before signing', async () => {
  const baseline = fixture();
  for (const changedState of [
    { grant: grant({ expiresAt: now.toISOString() }) },
    { delegation: delegation('approval-key-1', baseline.keyPair.publicKey, { notAfter: now.toISOString() }) },
    { delegation: delegation('approval-key-1', baseline.keyPair.publicKey,
      { notBefore: '2026-11-09T12:00:00.001Z' }) },
  ]) {
    const setup = fixture({ state: { ...baseline.exactState, ...changedState } });
    await assert.rejects(setup.boundary.approve(request(setup.exactState)), /validity window/);
    assert.equal(setup.signedMessages.length, 0);
  }
});

test('atomically denies replay even when the reconstructed state remains approved', async () => {
  const setup = fixture();
  await setup.boundary.approve(request(setup.exactState));
  await assert.rejects(setup.boundary.approve(request(setup.exactState)), /already consumed/);
  assert.equal(setup.consumedInputs.length, 2);
});

test('rejects tenant, profile, revision, device, run, authorization, decision, and grant substitution', async () => {
  const baseline = fixture();
  const substitutions = [
    { tenantId: 'tenant-2' },
    { profileId: 'profile-2' },
    { profileRevisionDigest: hex('6') },
    { deviceCredentialId: 'device-credential-2' },
    { deviceFingerprint: hex('7') },
    { runIntentId: 'run-intent-2' },
    { authorizationId: 'authorization-2' },
    { ownerDecisionId: 'owner-decision-2' },
    { grantId: 'grant-2' },
  ];
  for (const changed of substitutions) {
    const setup = fixture({ state: baseline.exactState });
    await assert.rejects(setup.boundary.approve(request(setup.exactState, changed)), /differs from durable state/);
    assert.equal(setup.signedMessages.length, 0);
    assert.equal(setup.consumedInputs.length, 0);
  }
});

test('accepts both explicitly delegated signers during rotation overlap', async () => {
  const oldPair = generateKeyPairSync('ed25519');
  const newPair = generateKeyPairSync('ed25519');
  const oldState = state(delegation('approval-key-1', oldPair.publicKey, { revocationEpoch: 7 }));
  const newState = state(delegation('approval-key-2', newPair.publicKey, { revocationEpoch: 8,
  }));
  const oldSigner = fixture({ keyPair: oldPair, keyId: 'approval-key-1', state: oldState,
    minimumRevocationEpoch: 7, approvalId: 'approval-old' });
  const newSigner = fixture({ keyPair: newPair, keyId: 'approval-key-2', state: newState,
    minimumRevocationEpoch: 7, approvalId: 'approval-new' });
  assert.equal((await oldSigner.boundary.approve(request(oldState))).signerKeyId, 'approval-key-1');
  assert.equal((await newSigner.boundary.approve(request(newState))).signerKeyId, 'approval-key-2');
});

test('emergency revocation epoch rejects stale signer and permits the replacement', async () => {
  const oldPair = generateKeyPairSync('ed25519');
  const newPair = generateKeyPairSync('ed25519');
  const oldState = state(delegation('approval-key-1', oldPair.publicKey, { revocationEpoch: 7 }));
  const revoked = fixture({ keyPair: oldPair, keyId: 'approval-key-1', state: oldState,
    minimumRevocationEpoch: 8 });
  await assert.rejects(revoked.boundary.approve(request(oldState)), /revoked/);
  assert.equal(revoked.signedMessages.length, 0);

  const replacementState = state(delegation('approval-key-2', newPair.publicKey, { revocationEpoch: 8,
  }));
  const replacement = fixture({ keyPair: newPair, keyId: 'approval-key-2', state: replacementState,
    minimumRevocationEpoch: 8 });
  assert.equal((await replacement.boundary.approve(request(replacementState))).revocationEpoch, 8);
});

test('managed signer is isolated and no private key or export capability crosses the boundary', async () => {
  const setup = fixture();
  assert.deepEqual(Object.keys(setup.signer).sort(), ['keyId', 'sign']);
  assert.equal('privateKey' in setup.signer, false);
  assert.equal('export' in setup.signer, false);
  const serialized = JSON.stringify(await setup.boundary.approve(request(setup.exactState)));
  assert.doesNotMatch(serialized, /private|BEGIN PRIVATE KEY|export/i);
});

test('audit digest changes when a correlated durable authorization identity changes', async () => {
  const first = fixture({ approvalId: 'approval-shared' });
  const firstApproval = await first.boundary.approve(request(first.exactState));
  const secondState = { ...first.exactState, authorizationId: 'authorization-2' };
  const second = fixture({ state: secondState, approvalId: 'approval-shared' });
  const secondApproval = await second.boundary.approve(request(secondState));
  assert.notEqual(secondApproval.auditDigest, firstApproval.auditDigest);
  assert.equal(secondApproval.authorizationId, 'authorization-2');
});
