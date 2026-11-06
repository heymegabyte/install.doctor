import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { publishOfflineBundle } from '../scripts/offline-bundle-publication.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`);

function storage() {
  const objects = new Map();
  return {
    objects,
    async create(key, bytes, metadata) {
      if (objects.has(key)) return false;
      objects.set(key, { bytes: Buffer.from(bytes), etag: `"${sha256(bytes)}"`, metadata });
      return true;
    },
    async read(key) { return objects.get(key) ?? null; },
  };
}

function fixture() {
  const request = {
    schemaVersion: 1, nonce: 'n'.repeat(32), createdAt: 2_000_000_000, expiresAt: 2_000_000_300,
    releaseId: 'release-1', releaseManifestDigest: 'a'.repeat(64), desiredStateRevision: 'b'.repeat(64),
    hostIdentityDigest: 'c'.repeat(64), hostFactsDigest: 'd'.repeat(64), requesterClaimDigest: '3'.repeat(64), platformCell: 'debian-12-x64-native',
    planDigest: 'e'.repeat(64), operationManifestDigest: 'f'.repeat(64),
    selectedTaskIds: ['task.one'], targets: ['/etc/install-doctor/fixture'], artifactDigests: ['1'.repeat(64)],
  };
  const delegation = {
    schemaVersion: 1, delegationId: 'offline-prod-1', signerId: 'offline-signer-1', namespace: 'install.doctor.offline-bundle',
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnlyFixtureOnlyFixtureOnlyFix',
    releaseIds: ['release-1'], platformCells: ['debian-12-x64-native'], artifactClasses: ['release-envelope'],
    maximumLifetimeSeconds: 600, maximumBytes: 1_048_576, validFrom: 1_999_999_000, validUntil: 2_000_001_000,
    revocationEpoch: 1, releaseRootSignature: 'fixture-detached-signature',
  };
  const bundle = Buffer.from('fixture private offline bundle');
  const manifest = {
    schemaVersion: 2, releaseId: request.releaseId, requestDigest: sha256(canonical(request)),
    planDigest: request.planDigest, platformCell: request.platformCell, createdAt: request.createdAt,
    expiresAt: request.expiresAt, artifactClasses: ['release-envelope'], bundleSha256: sha256(bundle), bundleSize: bundle.byteLength,
  };
  const claims = {
    repository: 'heymegabyte/install.doctor', repositoryId: '588807533', repositoryOwnerId: '82490183',
    ref: 'refs/heads/master', eventName: 'workflow_dispatch', environment: 'offline-bundle-authority',
    workflowRef: 'heymegabyte/install.doctor/.github/workflows/offline-bundle-authority.yml@refs/heads/master',
    workflowSha: '2'.repeat(40), runId: '123456', runAttempt: '1', actorId: '82490183',
  };
  const requestAuthority = {
    schemaVersion: 1, signerId: 'request-authority-1', requestDigest: sha256(canonical(request)), releaseManifestDigest: request.releaseManifestDigest,
    planDigest: request.planDigest, operationManifestDigest: request.operationManifestDigest,
    hostIdentityDigest: request.hostIdentityDigest, hostFactsDigest: request.hostFactsDigest, requesterClaimDigest: request.requesterClaimDigest,
    producerWorkflowRef: 'heymegabyte/install.doctor/.github/workflows/offline-bundle-request.yml@refs/heads/master',
    producerWorkflowSha: '4'.repeat(40), producerRunId: '234567', reconstructedRelease: true, reconstructedCatalog: true,
    reconstructedPlan: true, validatedTargets: true, validatedArtifacts: true, authoritySignature: 'fixture-request-authority-signature',
  };
  const requestAuthorityDelegation = {
    schemaVersion: 1, delegationId: 'request-authority-prod-1', signerId: requestAuthority.signerId,
    namespace: 'install.doctor.offline-request-authority',
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnlyFixtureOnlyFixtureOnlyFix',
    producerWorkflowRefs: [requestAuthority.producerWorkflowRef], producerWorkflowShas: [requestAuthority.producerWorkflowSha],
    validFrom: 1_999_999_000, validUntil: 2_000_001_000, revocationEpoch: 1, releaseRootSignature: 'fixture-delegation-signature',
  };
  return { request, delegation, manifest, bundle, claims, requestAuthority, requestAuthorityDelegation };
}

test('publishes one private content-addressed object and a signed receipt create-only', async () => {
  const input = fixture();
  const target = storage();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signer = async (_namespace, bytes) => sign(null, bytes, privateKey).toString('base64');
  const verifyDelegation = async () => true;
  const verifyRequestAuthority = async () => true;
  const verifyRequestAuthorityDelegation = async () => true;
  const first = await publishOfflineBundle({ ...input, storage: target, sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: input.claims.workflowSha });
  assert.equal(first.status, 'published');
  assert.match(first.objectKey, /^offline-bundles\/sha256\/[a-f0-9]{64}$/);
  assert.match(first.receiptKey, /^offline-bundle-receipts\/sha256\/[a-f0-9]{64}\.json$/);
  assert.equal(first.receipt.requestDigest, sha256(canonical(input.request)));
  assert.equal(first.receipt.requesterClaimDigest, input.request.requesterClaimDigest);
  assert.equal(first.receipt.authorityVersion, input.claims.workflowSha);
  assert.equal(target.objects.size, 3);
  assert.equal(target.objects.get(first.objectKey).metadata.visibility, 'private');
  assert.equal(target.objects.get(first.receiptKey).metadata.visibility, 'private');
  assert.equal(Buffer.from(first.receiptSignature, 'base64').length > 0, true);
  assert.equal(publicKey.asymmetricKeyType, 'ed25519');
  await assert.rejects(publishOfflineBundle({ ...input, storage: target, sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: input.claims.workflowSha }), /nonce was already consumed/);
});

test('fails closed on mutable workflow identity, replay, collision, scope widening, and missing delegation proof', async () => {
  const base = fixture();
  const signer = async () => 'c2ln';
  const verifyDelegation = async () => true;
  const verifyRequestAuthority = async () => true;
  const verifyRequestAuthorityDelegation = async () => true;
  await assert.rejects(publishOfflineBundle({ ...base, claims: { ...base.claims, workflowSha: 'master' }, storage: storage(), sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: '2'.repeat(40) }), /immutable workflow SHA/);
  await assert.rejects(publishOfflineBundle({ ...base, request: { ...base.request, platformCell: 'ubuntu-24-x64-native' }, storage: storage(), sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /request digest|platform scope|request authority/);
  await assert.rejects(publishOfflineBundle({ ...base, storage: storage(), sign: signer, verifyDelegation: async () => false, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /release-root delegation signature/);
  await assert.rejects(publishOfflineBundle({ ...base, storage: storage(), sign: signer, verifyDelegation, verifyRequestAuthorityDelegation: async () => false, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /request-authority delegation signature/);
  await assert.rejects(publishOfflineBundle({ ...base, storage: storage(), sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority: async () => false, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /request-authority signature/);
  const replay = storage();
  replay.objects.set(`offline-bundle-nonces/${sha256(Buffer.from(base.request.nonce))}`, { bytes: Buffer.from('foreign'), etag: 'foreign' });
  await assert.rejects(publishOfflineBundle({ ...base, storage: replay, sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /nonce was already consumed/);
  const collision = storage();
  collision.objects.set(`offline-bundles/sha256/${sha256(base.bundle)}`, { bytes: Buffer.from('collision'), etag: 'foreign' });
  await assert.rejects(publishOfflineBundle({ ...base, storage: collision, sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /immutable bundle object collision/);
  const traversal = { ...base, request: { ...base.request, targets: ['/etc/install-doctor/../shadow'] } };
  traversal.manifest = { ...base.manifest, requestDigest: sha256(canonical(traversal.request)) };
  traversal.requestAuthority = { ...base.requestAuthority, requestDigest: sha256(canonical(traversal.request)) };
  await assert.rejects(publishOfflineBundle({ ...traversal, storage: storage(), sign: signer, verifyDelegation, verifyRequestAuthorityDelegation, verifyRequestAuthority, now: 2_000_000_010, authorityVersion: base.claims.workflowSha }), /canonical non-root paths/);
});
