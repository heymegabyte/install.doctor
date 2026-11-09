import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerApprovalSemanticDigest } from '../../aid-core/dist/broker-approval-contracts.js';
import { orchestrateBrokerApproval } from '../dist/broker-approval-orchestrator.js';

const digest = 'a'.repeat(64);
const issuedAt = '2030-01-01T00:00:00.000Z';
const expiresAt = '2030-01-01T00:10:00.000Z';
const grant = { schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
  planDigest: digest, approvedPlanDigest: digest, enrolledUid: 501, brokerExecutableDigest: digest,
  runtimeDigest: digest, workerDigest: digest,
  operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
  descriptorDigest: digest, closureDigest: digest, consentDigest: digest, issuedAt, expiresAt };
const binding = { tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: digest,
  deviceCredentialId: 'device-1', deviceFingerprint: digest, runIntentId: 'intent-1', authorizationId: 'authorization-1' };
const identity = { deviceId: binding.deviceCredentialId, tenant: binding.tenantId, label: null, enrolledAt: issuedAt,
  grantedPermissions: ['authorize-privileged-run'], profileRevision: binding.profileRevisionDigest,
  machineFingerprint: binding.deviceFingerprint };

async function approval() {
  return { schemaVersion: 1, kind: 'desktop-tools-broker-approval', signerKeyId: 'signer-1',
    signatureDomain: 'desktop-tools-broker-approval-v1', approvalId: 'approval-1',
    authorizationId: binding.authorizationId, ownerDecisionId: 'decision-1', ownerActorId: 'owner-1',
    tenantId: binding.tenantId, profileId: binding.profileId, profileRevisionDigest: binding.profileRevisionDigest,
    deviceCredentialId: binding.deviceCredentialId, deviceFingerprint: binding.deviceFingerprint,
    runIntentId: binding.runIntentId, grant,
    grantDigest: await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', grant),
    delegationDigest: digest, revocationEpoch: 1, approvedAt: issuedAt, expiresAt,
    signature: 'A'.repeat(86), auditDigest: digest };
}

test('binds identity, submits one exact intent, backs off, and returns only claimed signed approval', async () => {
  const expected = await approval();
  const calls = [];
  const statuses = [
    { schemaVersion: 1, status: 'pending' },
    { schemaVersion: 1, status: 'pending' },
    { schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1' },
  ];
  let clock = 1_000;
  const transport = {
    async identity() { calls.push(['identity']); return identity; },
    async request(actualGrant, actualBinding) { calls.push(['request', actualGrant, actualBinding]); return {}; },
    async status(actualGrant, actualBinding) { calls.push(['status', actualGrant, actualBinding]); return statuses.shift(); },
    async claim(actualGrant, actualBinding, locator) { calls.push(['claim', actualGrant, actualBinding, locator]); return expected; },
  };
  const actual = await orchestrateBrokerApproval({ transport, grant, binding,
    poll: { timeoutMs: 10_000, initialDelayMs: 200, maximumDelayMs: 1_000, backoffFactor: 2 },
    now: () => clock, sleep: async milliseconds => { calls.push(['sleep', milliseconds]); clock += milliseconds; } });
  assert.deepEqual(actual, expected);
  assert.deepEqual(calls.map(call => call[0]), ['identity', 'request', 'status', 'sleep', 'status', 'sleep', 'status', 'claim']);
  assert.deepEqual(calls.filter(call => call[0] === 'sleep').map(call => call[1]), [200, 400]);
  assert.deepEqual(calls.at(-1)[3], { ownerDecisionId: 'decision-1' });
  assert.deepEqual(calls[1][1], grant);
  assert.deepEqual(calls[1][2], binding);
});

test('rejects mismatched bound identity before submitting a run intent', async () => {
  let requested = false;
  const transport = {
    async identity() { return { ...identity, machineFingerprint: 'b'.repeat(64) }; },
    async request() { requested = true; }, async status() {}, async claim() {},
  };
  await assert.rejects(orchestrateBrokerApproval({ transport, grant, binding }), /exact target binding/);
  assert.equal(requested, false);
});

for (const terminal of ['denied', 'expired', 'not-found']) {
  test(`fails immediately when approval status is ${terminal}`, async () => {
    let slept = false;
    const transport = { async identity() { return identity; }, async request() {},
      async status() { return { schemaVersion: 1, status: terminal }; }, async claim() {} };
    await assert.rejects(orchestrateBrokerApproval({ transport, grant, binding,
      sleep: async () => { slept = true; } }), new RegExp(`terminal status: ${terminal}`));
    assert.equal(slept, false);
  });
}

test('bounds pending polling by timeout and caps the final sleep to remaining time', async () => {
  let clock = 1_000;
  const sleeps = [];
  const transport = { async identity() { return identity; }, async request() {},
    async status() { return { schemaVersion: 1, status: 'pending' }; }, async claim() {} };
  await assert.rejects(orchestrateBrokerApproval({ transport, grant, binding,
    poll: { timeoutMs: 1_000, initialDelayMs: 700, maximumDelayMs: 900, backoffFactor: 2 },
    now: () => clock, sleep: async milliseconds => { sleeps.push(milliseconds); clock += milliseconds; } }), /timed out/);
  assert.deepEqual(sleeps, [700, 300]);
});
