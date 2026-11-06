import assert from 'node:assert/strict';
import test from 'node:test';
import { reconstructOfflineBundleRequest, requestDigest } from '../scripts/offline-bundle-request.mjs';

const h = value => value.repeat(64);
const fixture = () => {
  const closure = { schemaVersion: 1, releaseId: 'release-1', releaseManifestDigest: h('a'), desiredStateRevision: h('b'), hostIdentityDigest: h('c'), hostFactsDigest: h('d'), platformCell: 'debian-12-x64-native', planDigest: h('e'), operationManifestDigest: h('f'), selectedTaskIds: ['task.one'], targets: ['/etc/install-doctor/file'], artifactDigests: [h('1')], artifactClasses: ['release-envelope'] };
  const producer = { repository: 'heymegabyte/install.doctor', repositoryId: '588807533', repositoryOwnerId: '82490183', workflowRef: 'heymegabyte/install.doctor/.github/workflows/offline-bundle-request.yml@refs/heads/master', workflowSha: '2'.repeat(40), ref: 'refs/heads/master', eventName: 'workflow_dispatch', runId: '123', runAttempt: '1', actorId: '82490183' };
  const requestAuthorityDelegation = { schemaVersion: 1, delegationId: 'request-authority-prod-1', signerId: 'request-authority-1', namespace: 'install.doctor.offline-request-authority', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnlyFixtureOnlyFixtureOnlyFix', producerWorkflowRefs: [producer.workflowRef], producerWorkflowShas: [producer.workflowSha], validFrom: 1_999_999_000, validUntil: 2_000_001_000, revocationEpoch: 1, releaseRootSignature: 'detached' };
  return { discovered: closure, reconstructed: structuredClone(closure), producer, requestAuthorityDelegation, createdAt: 2_000_000_000, expiresAt: 2_000_000_300, requesterClaimDigest: h('3'), nonce: 'n'.repeat(32), bundle: Buffer.from('bundle'), signRequestAuthority: async () => Buffer.from('signature').toString('base64') };
};

test('emits a canonical request, matching manifest, and delegated per-request attestation', async () => {
  const result = await reconstructOfflineBundleRequest(fixture());
  assert.equal(result.manifest.requestDigest, requestDigest(result.request));
  assert.equal(result.requestAuthority.requestDigest, result.manifest.requestDigest);
  assert.equal(result.requestAuthority.producerRunId, '123');
  assert.equal(result.requestAuthority.reconstructedPlan, true);
});

test('rejects substitution, mutable workflow identity, scope widening, stale delegation, and absent signer', async () => {
  const changed = fixture(); changed.reconstructed = { ...changed.reconstructed, targets: ['/etc/shadow'] };
  await assert.rejects(reconstructOfflineBundleRequest(changed), /reconstruction/);
  await assert.rejects(reconstructOfflineBundleRequest({ ...fixture(), producer: { ...fixture().producer, workflowSha: 'master' } }), /Invalid string/);
  const traversal = fixture(); traversal.discovered = { ...traversal.discovered, targets: ['/etc/install-doctor/../shadow'] }; traversal.reconstructed = traversal.discovered;
  await assert.rejects(reconstructOfflineBundleRequest(traversal), /canonical/);
  const stale = fixture(); stale.requestAuthorityDelegation = { ...stale.requestAuthorityDelegation, validUntil: 1_999_999_999 };
  await assert.rejects(reconstructOfflineBundleRequest(stale), /delegation/);
  await assert.rejects(reconstructOfflineBundleRequest({ ...fixture(), signRequestAuthority: undefined }), /signer is required/);
});
