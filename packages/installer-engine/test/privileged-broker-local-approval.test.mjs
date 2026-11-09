import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTrustedLocalBrokerApproval } from '../dist/privileged-broker-local-approval.js';

const hex = character => character.repeat(64);
const grant = () => ({
  schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
  planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: 1000,
  brokerExecutableDigest: hex('6'), runtimeDigest: hex('7'), workerDigest: hex('8'),
  operations: [
    { taskId: 'package.tree', operationId: 'tree.check', phase: 'check' },
    { taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' },
    { taskId: 'package.tree', operationId: 'tree.verify', phase: 'verify' },
  ],
  descriptorDigest: hex('b'), closureDigest: hex('c'), consentDigest: hex('d'),
  issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z',
});

test('root-owned local ceremony issues evidence for only the exactly displayed grant', async () => {
  let displayed = '';
  const issued = await requestTrustedLocalBrokerApproval({
    grant: grant(), now: () => new Date('2026-11-08T12:01:00.000Z'),
    randomNonce: () => 'nonce_nonce_nonce_nonce_nonce_nonce_1', rootAuthority: () => true,
    confirmation: { confirm: async (summary, phrase) => { displayed = `${summary}\n${phrase}`; return true; } },
  });
  assert.match(displayed, /Host: host-1/);
  assert.match(displayed, new RegExp(`Plan: ${hex('a')}`));
  assert.equal(await issued.verify(issued.approval), true);
  assert.equal(await issued.verify({ ...issued.approval, workerDigest: hex('f') }), false);
  assert.equal(issued.approval.method, 'trusted-local');
});

test('local ceremony fails closed without root, exact confirmation, or valid time', async () => {
  const confirmation = { confirm: async () => true };
  await assert.rejects(requestTrustedLocalBrokerApproval({ grant: grant(), confirmation, rootAuthority: () => false }), /requires Linux root/);
  await assert.rejects(requestTrustedLocalBrokerApproval({ grant: grant(), confirmation: { confirm: async () => false },
    rootAuthority: () => true, now: () => new Date('2026-11-08T12:01:00.000Z') }), /was denied/);
  await assert.rejects(requestTrustedLocalBrokerApproval({ grant: grant(), confirmation, rootAuthority: () => true,
    now: () => new Date('2026-11-08T12:05:00.000Z') }), /currently valid grant/);
});
