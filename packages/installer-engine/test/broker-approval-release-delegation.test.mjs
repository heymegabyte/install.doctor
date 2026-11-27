import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { deriveReleaseBrokerApprovalTrust } from '../dist/broker-approval-release-delegation.js';

/** @param {import("node:crypto").BinaryLike} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/**
 * @param {unknown} value
 * @returns {unknown}
 */
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
/** @satisfies {Parameters<typeof deriveReleaseBrokerApprovalTrust>[0]['grant']} */
const grant = {
  schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
  planDigest: 'a'.repeat(64), approvedPlanDigest: 'a'.repeat(64), enrolledUid: 501,
  brokerExecutableDigest: '6'.repeat(64), runtimeDigest: '7'.repeat(64), workerDigest: '8'.repeat(64),
  operations: [{ taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' }],
  descriptorDigest: 'b'.repeat(64), closureDigest: 'c'.repeat(64), consentDigest: 'd'.repeat(64),
  issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z',
};

function fixture(overrides = {}) {
  const pair = generateKeyPairSync('ed25519');
  const projection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId: 'approval-key-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools', releaseId: 'release-1', channel: 'stable',
    publicKeySpki: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    notBefore: '2026-11-08T11:59:00.000Z', notAfter: '2026-11-08T12:06:00.000Z',
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 3, ...overrides };
  const delegationDigest = hash(`desktop-tools:broker-approval-signer-delegation:v1\0${JSON.stringify(canonical(projection))}`);
  const bytes = Buffer.from(`${JSON.stringify(canonical({ ...projection, delegationDigest }))}\n`);
  return { bytes, digest: hash(bytes) };
}

test('derives approval trust only from exact release-bound canonical delegation', () => {
  const exact = fixture();
  const trust = deriveReleaseBrokerApprovalTrust({ bytes: exact.bytes, expectedDigest: exact.digest,
    minimumRevocationEpoch: 3, grant });
  assert.equal(trust.signerKeyId, 'approval-key-1');
  assert.match(trust.publicKey, /BEGIN PUBLIC KEY/);
  assert.throws(() => deriveReleaseBrokerApprovalTrust({ bytes: exact.bytes, expectedDigest: '0'.repeat(64),
    minimumRevocationEpoch: 3, grant }), /signed release authority/);
  assert.throws(() => deriveReleaseBrokerApprovalTrust({ bytes: exact.bytes, expectedDigest: exact.digest,
    minimumRevocationEpoch: 4, grant }), /revoked/);
});

test('rejects wrong release, validity, and noncanonical delegated authority', () => {
  for (const value of [fixture({ releaseId: 'release-2' }), fixture({ notAfter: '2026-11-08T12:04:00.000Z' })]) {
    assert.throws(() => deriveReleaseBrokerApprovalTrust({ bytes: value.bytes, expectedDigest: value.digest,
      minimumRevocationEpoch: 3, grant }), /scope|lifetime/);
  }
  const exact = fixture();
  const pretty = Buffer.from(`${JSON.stringify(JSON.parse(exact.bytes.toString("utf8")), null, 2)}\n`);
  assert.throws(() => deriveReleaseBrokerApprovalTrust({ bytes: pretty, expectedDigest: hash(pretty),
    minimumRevocationEpoch: 3, grant }), /canonical/);
});
