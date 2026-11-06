import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const epoch = z.number().int().positive().safe();

const Request = z.strictObject({
  schemaVersion: z.literal(1), nonce: z.string().regex(/^[A-Za-z0-9._-]{32,128}$/), createdAt: epoch, expiresAt: epoch,
  releaseId: id, releaseManifestDigest: hex, desiredStateRevision: hex, hostIdentityDigest: hex, hostFactsDigest: hex,
  requesterClaimDigest: hex, platformCell: id, planDigest: hex, operationManifestDigest: hex,
  selectedTaskIds: z.array(id).min(1).max(4096),
  targets: z.array(z.string().regex(/^\/(?:[^\0\r\n]+)$/).max(4096)).max(4096),
  artifactDigests: z.array(hex).min(1).max(4096),
});

const Delegation = z.strictObject({
  schemaVersion: z.literal(1), delegationId: id, signerId: id, namespace: z.literal('install.doctor.offline-bundle'),
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  releaseIds: z.array(id).min(1).max(128), platformCells: z.array(id).min(1).max(128),
  artifactClasses: z.array(id).min(1).max(32), maximumLifetimeSeconds: z.number().int().positive().max(86_400),
  maximumBytes: z.number().int().positive().max(1_073_741_824), validFrom: epoch, validUntil: epoch,
  revocationEpoch: z.number().int().nonnegative().safe(), releaseRootSignature: z.string().min(1).max(16_384),
});

const Manifest = z.strictObject({
  schemaVersion: z.literal(2), releaseId: id, requestDigest: hex, planDigest: hex, platformCell: id,
  createdAt: epoch, expiresAt: epoch, artifactClasses: z.array(id).min(1).max(32), bundleSha256: hex,
  bundleSize: z.number().int().positive().max(1_073_741_824),
});

const Claims = z.strictObject({
  repository: z.literal('heymegabyte/install.doctor'), repositoryId: z.literal('588807533'), repositoryOwnerId: z.literal('82490183'),
  ref: z.literal('refs/heads/master'), eventName: z.literal('workflow_dispatch'), environment: z.literal('offline-bundle-authority'),
  workflowRef: z.literal('heymegabyte/install.doctor/.github/workflows/offline-bundle-authority.yml@refs/heads/master'),
  workflowSha: z.string().regex(/^[a-f0-9]{40}$/), runId: z.string().regex(/^[1-9][0-9]*$/),
  runAttempt: z.string().regex(/^[1-9][0-9]*$/), actorId: z.string().regex(/^[1-9][0-9]*$/),
});

const RequestAuthority = z.strictObject({
  schemaVersion: z.literal(1), signerId: id, requestDigest: hex, releaseManifestDigest: hex, planDigest: hex,
  operationManifestDigest: hex, hostIdentityDigest: hex, hostFactsDigest: hex, requesterClaimDigest: hex,
  producerWorkflowRef: z.literal('heymegabyte/install.doctor/.github/workflows/offline-bundle-request.yml@refs/heads/master'),
  producerWorkflowSha: z.string().regex(/^[a-f0-9]{40}$/), producerRunId: z.string().regex(/^[1-9][0-9]*$/),
  reconstructedRelease: z.literal(true), reconstructedCatalog: z.literal(true), reconstructedPlan: z.literal(true),
  validatedTargets: z.literal(true), validatedArtifacts: z.literal(true), authoritySignature: z.string().min(1).max(16_384),
});

const RequestAuthorityDelegation = z.strictObject({
  schemaVersion: z.literal(1), delegationId: id, signerId: id,
  namespace: z.literal('install.doctor.offline-request-authority'),
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  producerWorkflowRefs: z.array(z.literal('heymegabyte/install.doctor/.github/workflows/offline-bundle-request.yml@refs/heads/master')).length(1),
  producerWorkflowShas: z.array(z.string().regex(/^[a-f0-9]{40}$/)).min(1).max(8),
  validFrom: epoch, validUntil: epoch, revocationEpoch: z.number().int().nonnegative().safe(),
  releaseRootSignature: z.string().min(1).max(16_384),
});

function exactUnique(values, label) {
  if (new Set(values).size !== values.length || [...values].sort().some((value, index) => value !== values[index])) {
    throw new Error(`${label} must be unique and canonically sorted`);
  }
}

async function createOrMatch(storage, key, bytes, metadata, collisionMessage) {
  if (await storage.create(key, bytes, metadata)) return 'created';
  const existing = await storage.read(key);
  if (!existing?.bytes || !Buffer.from(existing.bytes).equals(bytes)) throw new Error(collisionMessage);
  return 'already-present';
}

/**
 * Publish a host-bound bundle inside the dedicated authority. The caller injects
 * the release-root delegation verifier and the protected Ed25519 signing
 * process; neither secret is accepted as serializable configuration.
 */
export async function publishOfflineBundle(input) {
  const request = Request.parse(input.request);
  const delegation = Delegation.parse(input.delegation);
  const manifest = Manifest.parse(input.manifest);
  const parsedClaims = Claims.safeParse(input.claims);
  if (!parsedClaims.success) throw new Error('caller lacks the exact protected environment and immutable workflow SHA claims');
  const claims = parsedClaims.data;
  const now = epoch.parse(input.now);
  const authorityVersion = z.string().regex(/^[a-f0-9]{40}$/).parse(input.authorityVersion);
  const requestAuthority = RequestAuthority.parse(input.requestAuthority);
  const requestAuthorityDelegation = RequestAuthorityDelegation.parse(input.requestAuthorityDelegation);
  if (authorityVersion !== claims.workflowSha) throw new Error('authority version must equal the immutable workflow SHA');
  if (typeof input.storage?.create !== 'function' || typeof input.storage?.read !== 'function') throw new Error('create-only private storage is required');
  if (typeof input.sign !== 'function' || typeof input.verifyDelegation !== 'function'
    || typeof input.verifyRequestAuthorityDelegation !== 'function' || typeof input.verifyRequestAuthority !== 'function') {
    throw new Error('protected signer, delegation verifiers, and independent request-authority verifier are required');
  }
  exactUnique(request.selectedTaskIds, 'selected task ids');
  exactUnique(request.targets, 'absolute targets');
  if (request.targets.some(target => target === '/' || posix.normalize(target) !== target)) throw new Error('absolute targets must be canonical non-root paths');
  exactUnique(request.artifactDigests, 'artifact digests');
  exactUnique(manifest.artifactClasses, 'artifact classes');
  if (request.createdAt > now || request.expiresAt <= now || request.expiresAt <= request.createdAt) throw new Error('request validity window is not current');
  if (manifest.createdAt !== request.createdAt || manifest.expiresAt !== request.expiresAt) throw new Error('manifest validity does not bind the request');
  if (request.expiresAt - request.createdAt > delegation.maximumLifetimeSeconds) throw new Error('request lifetime exceeds delegated scope');
  if (delegation.validFrom > now || delegation.validUntil <= now || request.expiresAt > delegation.validUntil) throw new Error('delegation is not valid for the request window');
  if (!delegation.releaseIds.includes(request.releaseId) || !delegation.platformCells.includes(request.platformCell)) throw new Error('request release or platform scope is not delegated');
  if (manifest.artifactClasses.some(value => !delegation.artifactClasses.includes(value))) throw new Error('manifest artifact class exceeds delegated scope');
  const requestBytes = canonical(request);
  const requestDigest = digest(requestBytes);
  if (!await input.verifyRequestAuthorityDelegation({ delegation: requestAuthorityDelegation })) {
    throw new Error('request-authority delegation signature verification failed');
  }
  if (requestAuthorityDelegation.validFrom > now || requestAuthorityDelegation.validUntil <= now
    || requestAuthority.signerId !== requestAuthorityDelegation.signerId
    || !requestAuthorityDelegation.producerWorkflowRefs.includes(requestAuthority.producerWorkflowRef)
    || !requestAuthorityDelegation.producerWorkflowShas.includes(requestAuthority.producerWorkflowSha)) {
    throw new Error('request authority exceeds its delegated signer/workflow/validity scope');
  }
  if (requestAuthority.requestDigest !== requestDigest || requestAuthority.releaseManifestDigest !== request.releaseManifestDigest
    || requestAuthority.planDigest !== request.planDigest || requestAuthority.operationManifestDigest !== request.operationManifestDigest
    || requestAuthority.hostIdentityDigest !== request.hostIdentityDigest || requestAuthority.hostFactsDigest !== request.hostFactsDigest
    || requestAuthority.requesterClaimDigest !== request.requesterClaimDigest) throw new Error('independent request authority does not bind the exact request');
  if (!await input.verifyRequestAuthority({ authority: requestAuthority, delegation: requestAuthorityDelegation })) throw new Error('independent request-authority signature verification failed');
  if (manifest.requestDigest !== requestDigest || manifest.releaseId !== request.releaseId
    || manifest.platformCell !== request.platformCell || manifest.planDigest !== request.planDigest) {
    throw new Error('manifest request digest or semantic binding mismatch');
  }
  const bundle = Buffer.from(input.bundle ?? []);
  if (bundle.byteLength < 1 || bundle.byteLength > delegation.maximumBytes || bundle.byteLength !== manifest.bundleSize || digest(bundle) !== manifest.bundleSha256) {
    throw new Error('bundle bytes do not match the delegated manifest');
  }
  if (!await input.verifyDelegation({ delegation, bytes: canonical({ ...delegation, releaseRootSignature: undefined }) })) {
    throw new Error('release-root delegation signature verification failed');
  }

  const manifestBytes = canonical(manifest);
  const manifestSignature = await input.sign('install.doctor.offline-bundle', manifestBytes);
  if (typeof manifestSignature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(manifestSignature)) throw new Error('protected signer returned an invalid signature');
  const nonceKey = `offline-bundle-nonces/${digest(Buffer.from(request.nonce, 'utf8'))}`;
  const nonceBytes = Buffer.from(`${requestDigest}\n`);
  if (!await input.storage.create(nonceKey, nonceBytes,
    { contentType: 'text/plain; charset=utf-8', sha256: digest(nonceBytes), visibility: 'private' })) throw new Error('request nonce was already consumed');
  const objectKey = `offline-bundles/sha256/${manifest.bundleSha256}`;
  const objectOutcome = await createOrMatch(input.storage, objectKey, bundle,
    { contentType: 'application/octet-stream', sha256: manifest.bundleSha256, visibility: 'private' }, 'immutable bundle object collision');
  const stored = await input.storage.read(objectKey);
  if (!stored?.etag || !Buffer.from(stored.bytes).equals(bundle)) throw new Error('private bundle read-back verification failed');
  const delegationDigest = digest(canonical(delegation));
  const claimDigest = digest(canonical(claims));
  const receipt = Object.freeze({
    schemaVersion: 1, requestDigest, delegationDigest, manifestDigest: digest(manifestBytes), bundleDigest: manifest.bundleSha256,
    objectKey, objectEtag: stored.etag, requesterClaimDigest: request.requesterClaimDigest, authorityClaimDigest: claimDigest, authorityVersion,
    publishedAt: now, expiresAt: request.expiresAt, signerId: delegation.signerId, namespace: delegation.namespace,
    manifestSignature,
  });
  const receiptBytes = canonical(receipt);
  const receiptSignature = await input.sign('install.doctor.offline-publication-receipt', receiptBytes);
  if (typeof receiptSignature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(receiptSignature)) throw new Error('protected signer returned an invalid receipt signature');
  const publication = canonical({ schemaVersion: 1, manifest, receipt, receiptSignature });
  const receiptKey = `offline-bundle-receipts/sha256/${digest(receiptBytes)}.json`;
  const receiptOutcome = await createOrMatch(input.storage, receiptKey, publication,
    { contentType: 'application/json; charset=utf-8', sha256: digest(publication), visibility: 'private' }, 'immutable publication receipt collision');
  return Object.freeze({
    schemaVersion: 1, status: 'published',
    objectKey, receiptKey, receipt, receiptSignature,
  });
}
