import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrivilegedBrokerReceipt,
  privilegedBrokerDigest,
  validatePrivilegedBrokerRequest,
} from '../dist/privileged-broker-protocol.js';

const hex = character => character.repeat(64);
const issuedAt = '2026-11-08T12:00:00.000Z';
const expiresAt = '2026-11-08T12:05:00.000Z';

function fixture() {
  const grant = {
    schemaVersion: 1,
    grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
    planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: 1000,
    brokerExecutableDigest: hex('6'), runtimeDigest: hex('7'), workerDigest: hex('8'),
    operations: [{ taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' }],
    descriptorDigest: hex('b'), closureDigest: hex('c'), consentDigest: hex('d'),
    issuedAt, expiresAt,
  };
  const request = {
    schemaVersion: 1,
    hostId: grant.hostId, releaseId: grant.releaseId, runId: grant.runId, planDigest: grant.planDigest,
    grantId: grant.grantId, grantDigest: privilegedBrokerDigest(grant), taskId: 'package.tree',
    operationId: 'tree.apply', phase: 'apply', consentDigest: grant.consentDigest,
    descriptorDigest: grant.descriptorDigest, closureDigest: grant.closureDigest,
    payload: { sha256: hex('e'), sizeBytes: 4096, requiredSeals: ['seal', 'shrink', 'grow', 'write'] },
    nonce: 'nonce_nonce_nonce_nonce_nonce_nonce_1', requestedAt: '2026-11-08T12:01:00.000Z',
  };
  return { grant, request };
}

test('exact grant admits one peer-bound request and creates a bound receipt', () => {
  const { grant, request } = fixture();
  const consumed = new Set();
  const validation = validatePrivilegedBrokerRequest({
    request, grant, peerUid: 1000, now: new Date(request.requestedAt),
    consumeNonce: value => consumed.has(value) ? false : (consumed.add(value), true),
  });
  assert.equal(validation.grantDigest, request.grantDigest);
  const receipt = createPrivilegedBrokerReceipt({
    request: validation.request, grantDigest: validation.grantDigest, status: 'applied',
    fenceDigest: hex('f'), completedAt: '2026-11-08T12:01:01.000Z',
  });
  assert.equal(receipt.requestDigest, validation.requestDigest);
  assert.equal(receipt.payloadSha256, request.payload.sha256);
});

test('broker rejects peer substitution, authority drift, replay, unknown fields, and expired grants', () => {
  const cases = [
    ['peer substitution', ({ grant, request }) => ({ request, grant, peerUid: 1001, now: new Date(request.requestedAt) }), /peer uid/],
    ['authority drift', ({ grant, request }) => ({ request: { ...request, descriptorDigest: hex('f') }, grant, peerUid: 1000, now: new Date(request.requestedAt) }), /descriptorDigest differs/],
    ['phase drift', ({ grant, request }) => ({ request: { ...request, phase: 'verify' }, grant, peerUid: 1000, now: new Date(request.requestedAt) }), /outside the exact grant/],
    ['unknown field', ({ grant, request }) => ({ request: { ...request, argv: ['/bin/sh'] }, grant, peerUid: 1000, now: new Date(request.requestedAt) }), /unrecognized key/i],
    ['expired grant', ({ grant, request }) => ({ request, grant, peerUid: 1000, now: new Date(expiresAt) }), /validity window/],
  ];
  for (const [name, make, pattern] of cases) {
    const input = make(fixture());
    assert.throws(() => validatePrivilegedBrokerRequest({ ...input, consumeNonce: () => true }), pattern, name);
  }
  const { grant, request } = fixture();
  const consumed = new Set();
  const consumeNonce = value => consumed.has(value) ? false : (consumed.add(value), true);
  validatePrivilegedBrokerRequest({ request, grant, peerUid: 1000, now: new Date(request.requestedAt), consumeNonce });
  assert.throws(() => validatePrivilegedBrokerRequest({ request, grant, peerUid: 1000, now: new Date(request.requestedAt), consumeNonce }), /already consumed/);
});
