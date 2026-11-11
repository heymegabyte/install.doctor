import assert from 'node:assert/strict'; import test from 'node:test';
import { evaluateDevicePosture } from '../dist/index.js';
const proof = { proofId: 'proof-1', provider: 'tpm2', keyId: 'key-1', publicKeyDigest: 'a'.repeat(64), hardwareInventoryDigest: 'b'.repeat(64), challengeDigest: 'c'.repeat(64), observedAt: '2026-11-10T12:00:00.000Z', expiresAt: '2026-11-10T13:00:00.000Z', nonExportable: true, userPresence: true };
const request = { schemaVersion: 1, requestId: 'request-1', hostId: 'host-1', platform: 'linux', hardwareInventoryDigest: proof.hardwareInventoryDigest, challengeDigest: proof.challengeDigest, requiredUserPresence: true, now: '2026-11-10T12:30:00.000Z', supportedProviders: ['tpm2'], proofs: [proof], verifiedProofIds: [proof.proofId] };
test('externally verified nonexportable exact proof earns hardware-backed assurance', () => {
  const result = evaluateDevicePosture(request); assert.equal(result.assurance, 'hardware-backed'); assert.equal(result.provider, 'tpm2'); assert.deepEqual(result.reasons, ['verified-nonexportable-key']);
});
test('unsupported hardware receives explicit degraded assurance only', () => {
  const result = evaluateDevicePosture({ ...request, supportedProviders: [], proofs: [], verifiedProofIds: [] }); assert.equal(result.assurance, 'degraded'); assert.equal(result.provider, null); assert.deepEqual(result.reasons, ['hardware-provider-unsupported']);
});
test('unverified, substituted, expired, and presence-free proof never earns equivalence', () => {
  for (const candidate of [
    { ...request, verifiedProofIds: [] }, { ...request, challengeDigest: 'd'.repeat(64) },
    { ...request, now: proof.expiresAt }, { ...request, proofs: [{ ...proof, userPresence: false }] },
  ]) assert.equal(evaluateDevicePosture(candidate).assurance, 'degraded');
});
test('strict platform/provider and secret-free boundaries reject ambiguity', () => {
  assert.throws(() => evaluateDevicePosture({ ...request, platform: 'darwin' }), /compatible/);
  assert.throws(() => evaluateDevicePosture({ ...request, privateKey: 'forbidden' }), /unrecognized/i);
  assert.throws(() => evaluateDevicePosture({ ...request, supportedProviders: ['tpm2', 'tpm2'] }), /unique/);
});
