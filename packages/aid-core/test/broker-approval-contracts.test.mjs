import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrokerApprovalDurableState,
  BrokerApprovalGrant,
  BrokerApprovalRequest,
  BrokerApprovalSignerDelegation,
  SignedBrokerApproval,
} from '../dist/broker-approval-contracts.js';

const digest = 'a'.repeat(64);

function grant(overrides = {}) {
  return {
    schemaVersion: 1,
    grantId: 'grant-1',
    hostId: 'host-1',
    releaseId: 'release-1',
    runId: 'run-1',
    planDigest: digest,
    approvedPlanDigest: digest,
    enrolledUid: 1000,
    brokerExecutableDigest: digest,
    runtimeDigest: digest,
    workerDigest: digest,
    operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
    descriptorDigest: digest,
    closureDigest: digest,
    consentDigest: digest,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:15:00.000Z',
    ...overrides,
  };
}

test('broker approval contracts are published from aid-core', () => {
  assert.equal(BrokerApprovalGrant.parse(grant()).grantId, 'grant-1');
  assert.equal(typeof BrokerApprovalSignerDelegation.parse, 'function');
  assert.equal(typeof BrokerApprovalDurableState.parse, 'function');
  assert.equal(typeof BrokerApprovalRequest.parse, 'function');
  assert.equal(typeof SignedBrokerApproval.parse, 'function');
});

test('broker grant preserves approval binding, operation uniqueness, and strictness', () => {
  assert.throws(() => BrokerApprovalGrant.parse(grant({ approvedPlanDigest: 'b'.repeat(64) })),
    /grant is not bound to the approved plan/u);
  assert.throws(() => BrokerApprovalGrant.parse(grant({ operations: [
    { taskId: 'task-1', operationId: 'duplicate', phase: 'check' },
    { taskId: 'task-2', operationId: 'duplicate', phase: 'apply' },
  ] })), /duplicate operation identifiers/u);
  assert.throws(() => BrokerApprovalGrant.parse(grant({ unexpected: true })), /unrecognized key/iu);
});
