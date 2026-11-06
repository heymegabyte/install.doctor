import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BundleSigningRequestSchema, OfflineSignerDelegationSchema, PublicationReceiptSchema,
  canonicalAuthorityDigest, reproduceBundleSigningRequest, verifyIndependentPromotionEvidence,
} from '../dist/offline-authority.js';

const d = character => character.repeat(64);
const time = value => `2026-01-01T00:0${value}:00.000Z`;
const platform = { os: 'linux', version: '12', arch: 'arm64', environment: 'native', role: 'server', packageManager: 'apt' };
const facts = { schemaVersion: 1, hostId: 'zen', collectedAt: time(0), os: 'linux', osVersion: '12', arch: 'arm64', environment: 'native', roles: ['server'], packageManagers: ['apt'], capabilities: ['systemd'] };
const target = { path: '/usr/local/bin/tool', mode: '0700', ownership: 'root' };
const artifact = { id: 'tool', artifactClass: 'immutable-executable', sha256: d('a'), sizeBytes: 12, sourceIdentity: 'github-release:owner/repo:v1/tool' };
const semantic = {
  schemaVersion: 1, requestId: 'request-1', nonce: '0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRS',
  createdAt: time(0), expiresAt: time(9), repository: 'heymegabyte/install.doctor',
  workflow: { revision: '1'.repeat(40), event: 'workflow_dispatch', ref: 'refs/heads/master', runId: '42', runAttempt: 1, environment: 'production' },
  release: { releaseId: 'v1', manifestDigest: d('1') }, requesterClaimDigest: d('2'),
  desiredStateRevision: 'desired-v1', hostIdentityDigest: d('3'), hostFacts: facts,
  platform, selectedTaskIds: ['install-tool'], normalizedPlanDigest: d('4'), operationManifestDigest: d('5'),
  targets: [target], artifacts: [artifact],
};
const request = reproduceBundleSigningRequest(semantic);
const delegation = {
  schemaVersion: 1, delegationId: 'delegation-1', signerId: 'offline-1', publicKey: `ssh-ed25519 ${'A'.repeat(43)}=`,
  namespace: 'install.doctor.offline-bundle', allowedRepositories: ['heymegabyte/install.doctor'], allowedReleaseIds: ['v1'],
  allowedPlatforms: [platform], allowedArtifactClasses: ['immutable-executable'], maxBundleLifetimeSeconds: 600,
  maxBundleSizeBytes: 1024, validFrom: time(0), validUntil: time(9), revocationEpoch: 3,
  rootSignature: { keyId: 'release-root', algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-signer-delegation', detached: true },
};
const publication = {
  schemaVersion: 1, receiptId: 'publication-1', requestDigest: request.requestDigest,
  delegationDigest: canonicalAuthorityDigest(delegation), manifestDigest: d('6'),
  storage: { objectIdentity: `sha256/66/${d('6')}`, etag: d('6'), createIfAbsent: true },
  requesterClaimDigest: request.requesterClaimDigest, authorityVersion: 'authority-v1', publishedAt: time(4), expiresAt: time(8),
  signature: { keyId: 'offline-1', algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-publication-receipt', detached: true },
};
const requestAuthorityDelegation = {
  schemaVersion: 1, delegationId: 'request-delegation-1', signerId: 'request-authority-1', publicKey: `ssh-ed25519 ${'C'.repeat(43)}=`,
  namespace: 'install.doctor.offline-request-authority', allowedRepositories: [request.repository],
  allowedWorkflowRefs: ['heymegabyte/install.doctor/.github/workflows/promote.yml@refs/heads/master'],
  allowedWorkflowRevisions: [request.workflow.revision], validFrom: time(0), validUntil: time(9), revocationEpoch: 3,
  rootSignature: { keyId: 'release-root', algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-request-authority-delegation', detached: true },
};
const requestAttestation = {
  schemaVersion: 1, attestationId: 'request-attestation-1', signerId: requestAuthorityDelegation.signerId,
  requestDigest: request.requestDigest, repository: request.repository, workflowRevision: request.workflow.revision,
  workflowRunId: request.workflow.runId, workflowRef: requestAuthorityDelegation.allowedWorkflowRefs[0],
  releaseManifestDigest: request.release.manifestDigest, normalizedPlanDigest: request.normalizedPlanDigest,
  operationManifestDigest: request.operationManifestDigest, hostIdentityDigest: request.hostIdentityDigest,
  hostFactsDigest: request.hostFactsDigest, requesterClaimDigest: request.requesterClaimDigest,
  reconstructedRelease: true, reconstructedCatalog: true, reconstructedPlan: true, validatedTargets: true, validatedArtifacts: true,
  signature: { keyId: requestAuthorityDelegation.signerId, algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-request-authority', detached: true },
};
const networkIsolation = { kind: 'linux-network-namespace', parentNamespaceId: 'net:[1]', executionNamespaceId: 'net:[2]', defaultRoutePresent: false, nonLoopbackInterfaces: [], tcpProbe: 'unreachable', startedAt: time(5), finishedAt: time(6) };
const executionAuthority = { journalCommitDigest: d('9'), networkIsolationDigest: canonicalAuthorityDigest(networkIsolation), offline: true, networkIsolation };

test('contracts reject unknown fields and non-canonical collections', () => {
  assert.equal(BundleSigningRequestSchema.safeParse({ ...request, surprise: true }).success, false);
  assert.equal(OfflineSignerDelegationSchema.safeParse({ ...delegation, allowedReleaseIds: ['v1', 'v1'] }).success, false);
  assert.equal(PublicationReceiptSchema.safeParse({ ...publication, storage: { ...publication.storage, mutable: true } }).success, false);
  assert.equal(BundleSigningRequestSchema.safeParse({ ...request, targets: [{ ...target, path: '/usr/local/../bin/tool' }] }).success, false);
});

test('request reproduction binds facts and semantic fields canonically', () => {
  assert.equal(request.hostFactsDigest, canonicalAuthorityDigest(facts));
  const { requestDigest: _requestDigest, ...unsigned } = request;
  assert.equal(request.requestDigest, canonicalAuthorityDigest(unsigned));
  assert.deepEqual(reproduceBundleSigningRequest({ ...semantic, targets: [...semantic.targets] }), request);
  assert.throws(() => reproduceBundleSigningRequest({ ...semantic, selectedTaskIds: ['z', 'a'] }), /sorted/);
});

test('independent promotion accepts only complete, exact, immutable evidence', async () => {
  const journal = { schemaVersion: 1, runId: 'run-1', planDigest: request.normalizedPlanDigest, releaseId: 'v1', desiredRevision: 'desired-v1', hostId: 'zen', hostFactsDigest: request.hostFactsDigest, ownerId: 'owner-1', revision: 2, updatedAt: time(7), entries: [{ taskId: 'install-tool', inputDigest: d('7'), status: 'verified', attempts: 1, updatedAt: time(7) }] };
  const attestation = { schemaVersion: 1, repository: request.repository, workflowRevision: request.workflow.revision, workflowRunId: request.workflow.runId, runAttempt: 1, conclusion: 'success', subjectManifestDigest: publication.manifestDigest, evidenceDigest: canonicalAuthorityDigest({ journal, executionAuthority }), issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:heymegabyte/install.doctor:environment:production', workflowRef: `heymegabyte/install.doctor/.github/workflows/promote.yml@${request.workflow.revision}` };
  const expected = { repository: request.repository, releaseRootKeyId: 'release-root', releaseRootPublicKey: `ssh-ed25519 ${'B'.repeat(43)}=`, authorityVersion: 'authority-v1', releaseId: 'v1', releaseManifestDigest: request.release.manifestDigest, hostIdentityDigest: request.hostIdentityDigest, hostFacts: facts, platform, desiredStateRevision: request.desiredStateRevision, selectedTaskIds: request.selectedTaskIds, normalizedPlanDigest: request.normalizedPlanDigest, operationManifestDigest: request.operationManifestDigest, targets: request.targets, artifacts: request.artifacts, workflow: { revision: request.workflow.revision, event: request.workflow.event, ref: request.workflow.ref, environment: request.workflow.environment }, ci: { issuer: attestation.issuer, subject: attestation.subject, workflowRef: attestation.workflowRef } };
  const proofs = Object.fromEntries(['delegation', 'requestAuthorityDelegation', 'requestAttestation', 'publicationReceipt', 'bundle', 'ciAttestation'].map(key => [key, { signatureBase64: 'A'.repeat(64) }]));
  const verifiedNamespaces = [];
  const verifiers = { verifyDigestSignature: async proof => { verifiedNamespaces.push(proof.namespace); return true; }, verifyCiAttestation: async () => { verifiedNamespaces.push('github-oidc-attestation'); return true; } };
  const result = await verifyIndependentPromotionEvidence({ request, delegation, requestAuthorityDelegation, requestAttestation, publicationReceipt: publication, bundle: { manifestDigest: publication.manifestDigest, sizeBytes: 512, signerId: delegation.signerId, releaseId: 'v1', platform, artifacts: [artifact], expiresAt: time(8) }, ciAttestation: attestation, journal, executionAuthority, now: time(7), minimumRevocationEpoch: 3, expected, proofs }, verifiers);
  assert.equal(result.verified, true);
  assert.equal(result.promotionDigest, canonicalAuthorityDigest(result.bindings));
  assert.deepEqual(verifiedNamespaces, ['install.doctor.offline-signer-delegation', 'install.doctor.offline-request-authority-delegation', 'install.doctor.offline-request-authority', 'install.doctor.offline-publication-receipt', 'install.doctor.offline-bundle', 'github-oidc-attestation']);
});

test('independent promotion rejects replay, expiry, revocation, scope drift, and incomplete journal', async () => {
  const baseJournal = { schemaVersion: 1, runId: 'run-1', planDigest: request.normalizedPlanDigest, releaseId: 'v1', desiredRevision: 'desired-v1', hostId: 'zen', hostFactsDigest: request.hostFactsDigest, ownerId: 'owner-1', revision: 2, updatedAt: time(7), entries: [{ taskId: 'install-tool', inputDigest: d('7'), status: 'verified', attempts: 1, updatedAt: time(7) }] };
  const attestation = { schemaVersion: 1, repository: request.repository, workflowRevision: request.workflow.revision, workflowRunId: request.workflow.runId, runAttempt: 1, conclusion: 'success', subjectManifestDigest: publication.manifestDigest, evidenceDigest: canonicalAuthorityDigest({ journal: baseJournal, executionAuthority }), issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:heymegabyte/install.doctor:environment:production', workflowRef: `heymegabyte/install.doctor/.github/workflows/promote.yml@${request.workflow.revision}` };
  const expected = { repository: request.repository, releaseRootKeyId: 'release-root', releaseRootPublicKey: `ssh-ed25519 ${'B'.repeat(43)}=`, authorityVersion: 'authority-v1', releaseId: 'v1', releaseManifestDigest: request.release.manifestDigest, hostIdentityDigest: request.hostIdentityDigest, hostFacts: facts, platform, desiredStateRevision: request.desiredStateRevision, selectedTaskIds: request.selectedTaskIds, normalizedPlanDigest: request.normalizedPlanDigest, operationManifestDigest: request.operationManifestDigest, targets: request.targets, artifacts: request.artifacts, workflow: { revision: request.workflow.revision, event: request.workflow.event, ref: request.workflow.ref, environment: request.workflow.environment }, ci: { issuer: attestation.issuer, subject: attestation.subject, workflowRef: attestation.workflowRef } };
  const proofs = Object.fromEntries(['delegation', 'requestAuthorityDelegation', 'requestAttestation', 'publicationReceipt', 'bundle', 'ciAttestation'].map(key => [key, { signatureBase64: 'A'.repeat(64) }]));
  const verifiers = { verifyDigestSignature: async () => true, verifyCiAttestation: async () => true };
  const verify = overrides => verifyIndependentPromotionEvidence({ request, delegation, requestAuthorityDelegation, requestAttestation, publicationReceipt: publication, bundle: { manifestDigest: publication.manifestDigest, sizeBytes: 512, signerId: delegation.signerId, releaseId: 'v1', platform, artifacts: [artifact], expiresAt: time(8) }, ciAttestation: attestation, journal: baseJournal, executionAuthority, now: time(7), minimumRevocationEpoch: 3, expected, proofs, ...overrides }, verifiers);
  await assert.rejects(verify({ consumedNonces: [request.nonce] }), /nonce/);
  await assert.rejects(verify({ now: '2026-01-01T00:10:00.000Z' }), /expired/);
  await assert.rejects(verify({ minimumRevocationEpoch: 4 }), /revoked/);
  await assert.rejects(verify({ bundle: { manifestDigest: publication.manifestDigest, sizeBytes: 512, signerId: delegation.signerId, releaseId: 'other', platform, artifacts: [artifact], expiresAt: time(8) } }), /release/);
  await assert.rejects(verify({ journal: { ...baseJournal, entries: [] } }), /CI attestation|journal/);
  await assert.rejects(verify({ expected: { ...expected, hostIdentityDigest: d('9') } }), /host identity/);
  await assert.rejects(verify({ expected: { ...expected, targets: [{ ...target, path: '/usr/local/bin/other' }] } }), /targets/);
  await assert.rejects(verify({ ciAttestation: { ...attestation, subject: 'repo:attacker/project:environment:production' } }), /CI attestation authority/);
  await assert.rejects(verify({ requestAttestation: { ...requestAttestation, normalizedPlanDigest: d('0') } }), /request attestation binding/);
  await assert.rejects(verify({ executionAuthority: { ...executionAuthority, networkIsolation: { ...networkIsolation, tcpProbe: 'reachable' } } }), /Invalid input/);
  await assert.rejects(verifyIndependentPromotionEvidence({ request, delegation, requestAuthorityDelegation, requestAttestation, publicationReceipt: publication, bundle: { manifestDigest: publication.manifestDigest, sizeBytes: 512, signerId: delegation.signerId, releaseId: 'v1', platform, artifacts: [artifact], expiresAt: time(8) }, ciAttestation: attestation, journal: baseJournal, executionAuthority, now: time(7), minimumRevocationEpoch: 3, expected, proofs }, { verifyDigestSignature: async () => true, verifyCiAttestation: async () => false }), /CI platform attestation is invalid/);
});
