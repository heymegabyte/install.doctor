import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { brokerApprovalAuditDigest, brokerApprovalSemanticDigest, brokerApprovalSigningBytes } from '../../aid-core/dist/broker-approval-contracts.js';
import { createSignedDeviceBrokerApproval, verifyControlPlaneBrokerApproval,
  verifySignedDeviceBrokerApproval } from '../dist/privileged-broker-device-approval.js';

const hex = character => character.repeat(64);
const grant = (overrides = {}) => ({ schemaVersion: 1, grantId: 'grant-device-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
  planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: 1000,
  brokerExecutableDigest: hex('6'), runtimeDigest: hex('7'), workerDigest: hex('8'),
  operations: [{ taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' }],
  descriptorDigest: hex('b'), closureDigest: hex('c'), consentDigest: hex('d'),
  issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z', ...overrides });

test('signed device approval verifies only for its exact grant and pinned Ed25519 signer', () => {
  const signer = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const trust = { signerKeyId: 'device-approval-key-1', publicKey: signer.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const exactGrant = grant();
  const approval = createSignedDeviceBrokerApproval({ grant: exactGrant, approvalId: 'device-approval-1',
    signerKeyId: trust.signerKeyId, privateKey: signer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), approvedAt: '2026-11-08T12:01:00.000Z' });
  assert.equal(verifySignedDeviceBrokerApproval({ grant: exactGrant, approval, trust }), true);
  assert.equal(verifySignedDeviceBrokerApproval({ grant: exactGrant, approval,
    trust: { ...trust, publicKey: other.publicKey.export({ type: 'spki', format: 'pem' }).toString() } }), false);
  assert.equal(verifySignedDeviceBrokerApproval({ grant: grant({ consentDigest: hex('e') }), approval, trust }), false);
  assert.equal(verifySignedDeviceBrokerApproval({ grant: exactGrant,
    approval: { ...approval, proof: { ...approval.proof,
      signature: `${approval.proof.signature[0] === 'A' ? 'B' : 'A'}${approval.proof.signature.slice(1)}` } }, trust }), false);
});

test('root verifier accepts exact shared control-plane signature bytes and rejects substitutions', async () => {
  const signer = generateKeyPairSync('ed25519');
  const exactGrant = grant();
  const unsigned = {
    schemaVersion: 1, kind: 'desktop-tools-broker-approval', signerKeyId: 'device-approval-key-1',
    signatureDomain: 'desktop-tools-broker-approval-v1', approvalId: 'approval-shared-1',
    authorizationId: 'authorization-1', ownerDecisionId: 'decision-1', ownerActorId: 'owner-1',
    tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: hex('1'),
    deviceCredentialId: 'credential-1', deviceFingerprint: hex('2'), runIntentId: 'intent-1',
    grant: exactGrant, grantDigest: await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', exactGrant),
    delegationDigest: hex('3'), revocationEpoch: 7, approvedAt: '2026-11-08T12:01:00.000Z',
    expiresAt: '2026-11-08T12:04:00.000Z',
  };
  const approval = { ...unsigned,
    signature: sign(null, brokerApprovalSigningBytes(unsigned), signer.privateKey).toString('base64url'),
    auditDigest: await brokerApprovalAuditDigest(unsigned) };
  const input = { grant: exactGrant, approval,
    trust: { signerKeyId: unsigned.signerKeyId, publicKey: signer.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    delegationDigest: unsigned.delegationDigest, minimumRevocationEpoch: 7,
    maximumApprovalLifetimeSeconds: 600,
    now: new Date('2026-11-08T12:02:00.000Z') };
  assert.equal(await verifyControlPlaneBrokerApproval(input), true);
  assert.equal(await verifyControlPlaneBrokerApproval({ ...input,
    approval: { ...approval, deviceFingerprint: hex('4') } }), false);
  assert.equal(await verifyControlPlaneBrokerApproval({ ...input, minimumRevocationEpoch: 8 }), false);
});

test('signed device approval rejects invalid time, key type, and unknown fields', () => {
  const signer = generateKeyPairSync('ed25519');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signerPrivateKey = signer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rsaPrivateKey = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const common = { grant: grant(), approvalId: 'device-approval-2', signerKeyId: 'device-approval-key-1' };
  assert.throws(() => createSignedDeviceBrokerApproval({ ...common, privateKey: signerPrivateKey,
    approvedAt: '2026-11-08T11:59:59.999Z' }), /outside/);
  assert.throws(() => createSignedDeviceBrokerApproval({ ...common, privateKey: signerPrivateKey,
    approvedAt: '2026-11-08T12:05:00.000Z' }), /outside/);
  assert.throws(() => createSignedDeviceBrokerApproval({ ...common, privateKey: rsaPrivateKey,
    approvedAt: '2026-11-08T12:01:00.000Z' }), /Ed25519/);
  const approval = createSignedDeviceBrokerApproval({ ...common, privateKey: signerPrivateKey,
    approvedAt: '2026-11-08T12:01:00.000Z' });
  assert.throws(() => verifySignedDeviceBrokerApproval({ grant: common.grant, approval: { ...approval, extra: true },
    trust: { signerKeyId: common.signerKeyId, publicKey: signer.publicKey.export({ type: 'spki', format: 'pem' }).toString() } }));
});
