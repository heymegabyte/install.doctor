import { createHash, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const epoch = z.number().int().positive().safe();
const absoluteTarget = z.string().min(2).max(4096).regex(/^\/(?:[^\0\r\n]+)$/)
  .refine(value => value !== '/' && posix.normalize(value) === value, 'target must be canonical and non-root');

const SemanticClosure = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: id,
  releaseManifestDigest: hex,
  desiredStateRevision: hex,
  hostIdentityDigest: hex,
  hostFactsDigest: hex,
  platformCell: id,
  planDigest: hex,
  operationManifestDigest: hex,
  selectedTaskIds: z.array(id).min(1).max(4096),
  targets: z.array(absoluteTarget).max(4096),
  artifactDigests: z.array(hex).min(1).max(4096),
  artifactClasses: z.array(id).min(1).max(32),
});

const ProducerIdentity = z.strictObject({
  repository: z.literal('heymegabyte/install.doctor'),
  repositoryId: z.literal('588807533'),
  repositoryOwnerId: z.literal('82490183'),
  workflowRef: z.literal('heymegabyte/install.doctor/.github/workflows/offline-bundle-request.yml@refs/heads/master'),
  workflowSha: z.string().regex(/^[a-f0-9]{40}$/),
  ref: z.literal('refs/heads/master'),
  eventName: z.literal('workflow_dispatch'),
  runId: z.string().regex(/^[1-9][0-9]*$/),
  runAttempt: z.string().regex(/^[1-9][0-9]*$/),
  actorId: z.string().regex(/^[1-9][0-9]*$/),
});

const RequestAuthorityDelegation = z.strictObject({
  schemaVersion: z.literal(1), delegationId: id, signerId: id,
  namespace: z.literal('install.doctor.offline-request-authority'),
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  producerWorkflowRefs: z.array(ProducerIdentity.shape.workflowRef).length(1),
  producerWorkflowShas: z.array(z.string().regex(/^[a-f0-9]{40}$/)).min(1).max(8),
  validFrom: epoch, validUntil: epoch, revocationEpoch: z.number().int().nonnegative().safe(),
  releaseRootSignature: z.string().min(1).max(16_384),
});

function sortedUnique(values, label) {
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || values.some((value, index) => value !== sorted[index])) {
    throw new Error(`${label} must be unique and canonically sorted`);
  }
}

export const canonicalRequestBytes = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
export const requestDigest = value => createHash('sha256').update(canonicalRequestBytes(value)).digest('hex');

function same(left, right) {
  const a = canonicalRequestBytes(left); const b = canonicalRequestBytes(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Produces the exact credential-free authority input only after an independent
 * reconstruction has reproduced every semantic field. Signing is injected by
 * the protected request-authority; release-root material is intentionally not
 * accepted by this function.
 */
export async function reconstructOfflineBundleRequest(input) {
  const discovered = SemanticClosure.parse(input.discovered);
  const reconstructed = SemanticClosure.parse(input.reconstructed);
  const producer = ProducerIdentity.parse(input.producer);
  const delegation = RequestAuthorityDelegation.parse(input.requestAuthorityDelegation);
  const createdAt = epoch.parse(input.createdAt);
  const expiresAt = epoch.parse(input.expiresAt);
  const requesterClaimDigest = hex.parse(input.requesterClaimDigest);
  const bundle = Buffer.from(input.bundle ?? []);
  if (expiresAt <= createdAt || expiresAt - createdAt > 600) throw new Error('request validity must be positive and at most ten minutes');
  if (!same(discovered, reconstructed)) throw new Error('independent reconstruction does not match live-host discovery');
  if (!delegation.producerWorkflowRefs.includes(producer.workflowRef)
    || !delegation.producerWorkflowShas.includes(producer.workflowSha)
    || delegation.validFrom > createdAt || delegation.validUntil < expiresAt) {
    throw new Error('request authority delegation does not admit the immutable producer workflow and validity window');
  }
  sortedUnique(discovered.selectedTaskIds, 'selected task ids');
  sortedUnique(discovered.targets, 'targets');
  sortedUnique(discovered.artifactDigests, 'artifact digests');
  sortedUnique(discovered.artifactClasses, 'artifact classes');
  if (bundle.length < 1 || bundle.length > 1_073_741_824) throw new Error('bundle size is outside authority policy');
  const nonce = z.string().regex(/^[A-Za-z0-9._-]{32,128}$/).parse(input.nonce);
  const request = Object.freeze({
    schemaVersion: 1, nonce, createdAt, expiresAt,
    releaseId: discovered.releaseId, releaseManifestDigest: discovered.releaseManifestDigest,
    desiredStateRevision: discovered.desiredStateRevision, hostIdentityDigest: discovered.hostIdentityDigest,
    hostFactsDigest: discovered.hostFactsDigest, requesterClaimDigest, platformCell: discovered.platformCell,
    planDigest: discovered.planDigest, operationManifestDigest: discovered.operationManifestDigest,
    selectedTaskIds: discovered.selectedTaskIds, targets: discovered.targets, artifactDigests: discovered.artifactDigests,
  });
  const digest = requestDigest(request);
  const manifest = Object.freeze({
    schemaVersion: 2, releaseId: request.releaseId, requestDigest: digest, planDigest: request.planDigest,
    platformCell: request.platformCell, createdAt, expiresAt, artifactClasses: discovered.artifactClasses,
    bundleSha256: createHash('sha256').update(bundle).digest('hex'), bundleSize: bundle.length,
  });
  const unsignedAuthority = Object.freeze({
    schemaVersion: 1, signerId: delegation.signerId, requestDigest: digest,
    releaseManifestDigest: request.releaseManifestDigest, planDigest: request.planDigest,
    operationManifestDigest: request.operationManifestDigest, hostIdentityDigest: request.hostIdentityDigest,
    hostFactsDigest: request.hostFactsDigest, requesterClaimDigest,
    producerWorkflowRef: producer.workflowRef, producerWorkflowSha: producer.workflowSha, producerRunId: producer.runId,
    reconstructedRelease: true, reconstructedCatalog: true, reconstructedPlan: true,
    validatedTargets: true, validatedArtifacts: true,
  });
  if (typeof input.signRequestAuthority !== 'function') throw new Error('delegated request-authority signer is required');
  const signature = await input.signRequestAuthority(canonicalRequestBytes(unsignedAuthority), delegation);
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error('request-authority signature is invalid');
  return Object.freeze({ request, manifest, requestAuthority: { ...unsignedAuthority, authoritySignature: signature }, requestAuthorityDelegation: delegation });
}
