import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HostFactsSchema, JournalSchema } from '@install-doctor/aid-core/installer-contracts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/);
const repository = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(256);
const sortedUnique = <T extends z.ZodType<string>>(schema: T, maximum: number, label: string) => z.array(schema).max(maximum)
  .superRefine((values, context) => {
    if (values.some((value, index) => index > 0 && values[index - 1]!.localeCompare(value) >= 0)) {
      context.addIssue({ code: 'custom', message: `${label} must be unique and sorted` });
    }
  });

const PlatformCellSchema = z.strictObject({
  os: z.enum(['linux', 'darwin', 'win32']),
  version: z.string().min(1).max(64),
  arch: z.enum(['x64', 'arm64']),
  environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']),
  role: id,
  packageManager: id,
});
export type AuthorityPlatformCell = z.infer<typeof PlatformCellSchema>;

const canonicalAbsoluteTarget = z.string().min(2).max(4096).superRefine((value, context) => {
  if (!value.startsWith('/') || value.includes('//') || /[\0-\x1f\x7f]/.test(value)
    || value.slice(1).split('/').some(part => part === '' || part === '.' || part === '..')) {
    context.addIssue({ code: 'custom', message: 'target must be a canonical absolute POSIX path' });
  }
});
const TargetSchema = z.strictObject({
  path: canonicalAbsoluteTarget,
  mode: z.enum(['0600', '0644', '0700', '0755']),
  ownership: z.enum(['current-user', 'root']),
});
const artifactClass = z.enum(['release-envelope', 'release-signature', 'engine', 'catalog', 'schema', 'desired-state', 'host-facts', 'normalized-plan', 'operation-manifest', 'immutable-executable', 'native-offline-package', 'repository-metadata']);
const ArtifactSchema = z.strictObject({
  id,
  artifactClass,
  sha256: digest,
  sizeBytes: z.number().int().positive().max(268_435_456),
  sourceIdentity: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/),
});
const workflow = z.strictObject({
  revision: gitCommit,
  event: z.enum(['workflow_dispatch', 'schedule', 'push']),
  ref: z.string().regex(/^refs\/(?:heads|tags)\/[A-Za-z0-9._\/-]+$/).max(512),
  runId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  runAttempt: z.number().int().min(1).max(1000),
  environment: z.literal('production'),
});

const RequestWithoutDigestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: id,
  nonce: z.string().min(48).max(128).regex(/^[A-Za-z0-9_-]+$/),
  createdAt: timestamp, expiresAt: timestamp, repository, workflow,
  release: z.strictObject({ releaseId: id, manifestDigest: digest }),
  requesterClaimDigest: digest, desiredStateRevision: id, hostIdentityDigest: digest,
  hostFacts: HostFactsSchema, hostFactsDigest: digest, platform: PlatformCellSchema,
  selectedTaskIds: sortedUnique(id, 10_000, 'selected task identifiers').min(1),
  normalizedPlanDigest: digest, operationManifestDigest: digest,
  targets: z.array(TargetSchema).max(4096), artifacts: z.array(ArtifactSchema).min(1).max(4096),
}).superRefine((value, context) => {
  const lifetime = new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime();
  if (lifetime <= 0 || lifetime > 600_000) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'request lifetime must be between one millisecond and ten minutes' });
  }
  if (value.hostFactsDigest !== canonicalAuthorityDigest(value.hostFacts)) {
    context.addIssue({ code: 'custom', path: ['hostFactsDigest'], message: 'host facts digest does not match canonical facts' });
  }
  if (value.hostFacts.os !== value.platform.os || value.hostFacts.arch !== value.platform.arch || value.hostFacts.environment !== value.platform.environment) {
    context.addIssue({ code: 'custom', path: ['platform'], message: 'platform must match normalized host facts' });
  }
  for (const [path, values] of [['targets', value.targets.map(item => item.path)], ['artifacts', value.artifacts.map(item => item.id)]] as const) {
    if (new Set(values).size !== values.length || values.some((item, index) => index > 0 && values[index - 1]!.localeCompare(item) >= 0)) {
      context.addIssue({ code: 'custom', path: [path], message: `${path} must be unique and sorted by canonical identity` });
    }
  }
});

export const BundleSigningRequestSchema = RequestWithoutDigestSchema.safeExtend({ requestDigest: digest }).superRefine((value, context) => {
  const { requestDigest, ...unsigned } = value;
  if (requestDigest !== canonicalAuthorityDigest(unsigned)) {
    context.addIssue({ code: 'custom', path: ['requestDigest'], message: 'request digest does not match canonical request' });
  }
});
export type BundleSigningRequest = z.infer<typeof BundleSigningRequestSchema>;

const signature = (namespace: string) => z.strictObject({
  keyId: id, algorithm: z.literal('sshsig-ed25519'), namespace: z.literal(namespace), detached: z.literal(true),
});
export const OfflineSignerDelegationSchema = z.strictObject({
  schemaVersion: z.literal(1), delegationId: id, signerId: id,
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  namespace: z.literal('install.doctor.offline-bundle'),
  allowedRepositories: sortedUnique(repository, 32, 'allowed repositories').min(1),
  allowedReleaseIds: sortedUnique(id, 256, 'allowed release identifiers').min(1),
  allowedPlatforms: z.array(PlatformCellSchema).min(1).max(128),
  allowedArtifactClasses: sortedUnique(artifactClass, artifactClass.options.length, 'allowed artifact classes').min(1),
  maxBundleLifetimeSeconds: z.number().int().min(60).max(604_800),
  maxBundleSizeBytes: z.number().int().positive().max(4_294_967_296),
  validFrom: timestamp, validUntil: timestamp, revocationEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rootSignature: signature('install.doctor.offline-signer-delegation'),
}).superRefine((value, context) => {
  if (new Date(value.validUntil).getTime() <= new Date(value.validFrom).getTime()) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'delegation expiry must follow activation' });
  }
  const identities = value.allowedPlatforms.map(platformIdentity);
  if (new Set(identities).size !== identities.length || identities.some((item, index) => index > 0 && identities[index - 1]!.localeCompare(item) >= 0)) {
    context.addIssue({ code: 'custom', path: ['allowedPlatforms'], message: 'allowed platforms must be unique and canonically sorted' });
  }
});
export type OfflineSignerDelegation = z.infer<typeof OfflineSignerDelegationSchema>;

export const PublicationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), receiptId: id, requestDigest: digest, delegationDigest: digest, manifestDigest: digest,
  storage: z.strictObject({ objectIdentity: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/), etag: z.string().min(1).max(256), createIfAbsent: z.literal(true) }),
  requesterClaimDigest: digest, authorityVersion: id, publishedAt: timestamp, expiresAt: timestamp,
  signature: signature('install.doctor.offline-publication-receipt'),
}).superRefine((value, context) => {
  if (new Date(value.expiresAt).getTime() <= new Date(value.publishedAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'publication expiry must follow publication' });
  }
});
export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
export function canonicalAuthorityBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}
export function canonicalAuthorityDigest(value: unknown): string {
  return createHash('sha256').update(canonicalAuthorityBytes(value)).digest('hex');
}
function platformIdentity(value: AuthorityPlatformCell): string {
  return `${value.os}/${value.version}/${value.arch}/${value.environment}/${value.role}/${value.packageManager}`;
}
function same(left: unknown, right: unknown): boolean { return canonicalAuthorityDigest(left) === canonicalAuthorityDigest(right); }
function unsignedRequest(value: BundleSigningRequest): Omit<BundleSigningRequest, 'requestDigest'> {
  const { requestDigest: _requestDigest, ...unsigned } = value;
  return unsigned;
}

export type BundleSigningRequestSemanticInput = Omit<z.input<typeof RequestWithoutDigestSchema>, 'hostFactsDigest'>;
export function reproduceBundleSigningRequest(input: BundleSigningRequestSemanticInput): BundleSigningRequest {
  const hostFacts = HostFactsSchema.parse(input.hostFacts);
  const unsigned = RequestWithoutDigestSchema.parse({ ...input, hostFacts, hostFactsDigest: canonicalAuthorityDigest(hostFacts) });
  return BundleSigningRequestSchema.parse({ ...unsigned, requestDigest: canonicalAuthorityDigest(unsigned) });
}

const BundleEvidenceSchema = z.strictObject({
  manifestDigest: digest, sizeBytes: z.number().int().positive().max(4_294_967_296), signerId: id, releaseId: id,
  platform: PlatformCellSchema, artifacts: z.array(ArtifactSchema).min(1).max(4096), expiresAt: timestamp,
});
const CiAttestationSchema = z.strictObject({
  schemaVersion: z.literal(1), repository, workflowRevision: gitCommit, workflowRunId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  runAttempt: z.number().int().min(1).max(1000), conclusion: z.literal('success'), subjectManifestDigest: digest, evidenceDigest: digest,
  issuer: z.literal('https://token.actions.githubusercontent.com'),
  subject: z.string().min(1).max(512), workflowRef: z.string().min(1).max(1024),
});
const RequestAuthorityDelegationSchema = z.strictObject({
  schemaVersion: z.literal(1), delegationId: id, signerId: id,
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  namespace: z.literal('install.doctor.offline-request-authority'),
  allowedRepositories: sortedUnique(repository, 32, 'request authority repositories').min(1),
  allowedWorkflowRefs: sortedUnique(z.string().min(1).max(1024), 32, 'request authority workflows').min(1),
  allowedWorkflowRevisions: sortedUnique(gitCommit, 32, 'request authority revisions').min(1),
  validFrom: timestamp, validUntil: timestamp, revocationEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rootSignature: signature('install.doctor.offline-request-authority-delegation'),
}).superRefine((value, context) => {
  if (new Date(value.validUntil).getTime() <= new Date(value.validFrom).getTime()) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'request authority delegation expiry must follow activation' });
  }
});
const RequestAttestationSchema = z.strictObject({
  schemaVersion: z.literal(1), attestationId: id, signerId: id, requestDigest: digest,
  repository, workflowRevision: gitCommit, workflowRunId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  workflowRef: z.string().min(1).max(1024), releaseManifestDigest: digest,
  normalizedPlanDigest: digest, operationManifestDigest: digest, hostIdentityDigest: digest,
  hostFactsDigest: digest, requesterClaimDigest: digest,
  reconstructedRelease: z.literal(true), reconstructedCatalog: z.literal(true), reconstructedPlan: z.literal(true),
  validatedTargets: z.literal(true), validatedArtifacts: z.literal(true),
  signature: signature('install.doctor.offline-request-authority'),
});
const NetworkIsolationAuthoritySchema = z.strictObject({
  kind: z.literal('linux-network-namespace'), parentNamespaceId: z.string().regex(/^net:\[[1-9][0-9]*\]$/),
  executionNamespaceId: z.string().regex(/^net:\[[1-9][0-9]*\]$/), defaultRoutePresent: z.literal(false),
  nonLoopbackInterfaces: z.array(z.never()).length(0), tcpProbe: z.literal('unreachable'),
  startedAt: timestamp, finishedAt: timestamp,
}).superRefine((value, context) => {
  if (value.parentNamespaceId === value.executionNamespaceId) context.addIssue({ code: 'custom', message: 'execution network namespace must differ from its parent' });
  if (new Date(value.finishedAt).getTime() <= new Date(value.startedAt).getTime()) context.addIssue({ code: 'custom', message: 'network isolation must have a positive bounded interval' });
});
const ExecutionAuthoritySchema = z.strictObject({
  journalCommitDigest: digest, networkIsolationDigest: digest, offline: z.literal(true),
  networkIsolation: NetworkIsolationAuthoritySchema,
}).superRefine((value, context) => {
  if (value.networkIsolationDigest !== canonicalAuthorityDigest(value.networkIsolation)) context.addIssue({ code: 'custom', path: ['networkIsolationDigest'], message: 'network isolation digest mismatch' });
});
const detachedProof = z.strictObject({ signatureBase64: z.string().min(64).max(65_536).regex(/^[A-Za-z0-9+/]+={0,2}$/) });
const PromotionInputSchema = z.strictObject({
  request: BundleSigningRequestSchema, delegation: OfflineSignerDelegationSchema, publicationReceipt: PublicationReceiptSchema,
  requestAuthorityDelegation: RequestAuthorityDelegationSchema, requestAttestation: RequestAttestationSchema,
  bundle: BundleEvidenceSchema, ciAttestation: CiAttestationSchema, journal: JournalSchema, executionAuthority: ExecutionAuthoritySchema,
  now: timestamp, minimumRevocationEpoch: z.number().int().nonnegative(),
  expected: z.strictObject({
    repository, releaseRootKeyId: id, releaseRootPublicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/), authorityVersion: id, releaseId: id, releaseManifestDigest: digest,
    hostIdentityDigest: digest, hostFacts: HostFactsSchema, platform: PlatformCellSchema, desiredStateRevision: id,
    selectedTaskIds: sortedUnique(id, 10_000, 'expected selected task identifiers').min(1),
    normalizedPlanDigest: digest, operationManifestDigest: digest,
    targets: z.array(TargetSchema).max(4096), artifacts: z.array(ArtifactSchema).min(1).max(4096),
    workflow: workflow.pick({ revision: true, event: true, ref: true, environment: true }),
    ci: z.strictObject({ issuer: z.literal('https://token.actions.githubusercontent.com'), subject: z.string().min(1).max(512), workflowRef: z.string().min(1).max(1024) }),
  }),
  proofs: z.strictObject({ delegation: detachedProof, requestAuthorityDelegation: detachedProof, requestAttestation: detachedProof, publicationReceipt: detachedProof, bundle: detachedProof, ciAttestation: detachedProof }),
  consumedNonces: z.array(z.string()).max(1_000_000).optional(),
});
export type IndependentPromotionEvidence = z.input<typeof PromotionInputSchema>;

export type PromotionCryptographicVerifiers = Readonly<{
  verifyDigestSignature: (input: Readonly<{ payloadDigest: string; signatureBase64: string; publicKey: string; keyId: string; namespace: string }>) => Promise<boolean>;
  verifyCiAttestation: (input: Readonly<{ attestation: z.infer<typeof CiAttestationSchema>; signatureBase64: string }>) => Promise<boolean>;
}>;

export async function verifyIndependentPromotionEvidence(input: IndependentPromotionEvidence, verifiers: PromotionCryptographicVerifiers): Promise<{
  verified: true; bindings: Readonly<Record<string, string | number>>; promotionDigest: string;
}> {
  const value = PromotionInputSchema.parse(input);
  const { request, delegation, requestAuthorityDelegation, requestAttestation, publicationReceipt: receipt, bundle, ciAttestation: ci, journal, executionAuthority } = value;
  const now = new Date(value.now).getTime();
  const fail = (message: string): never => { throw new Error(`independent promotion rejected: ${message}`); };
  if (value.consumedNonces?.includes(request.nonce)) fail('request nonce was already consumed');
  const publishedAt = new Date(receipt.publishedAt).getTime();
  if (publishedAt < new Date(request.createdAt).getTime() || publishedAt > new Date(request.expiresAt).getTime()) fail('bundle signing request was not valid at publication');
  if (delegation.revocationEpoch < value.minimumRevocationEpoch) fail('offline signer delegation is revoked');
  if (requestAuthorityDelegation.revocationEpoch < value.minimumRevocationEpoch) fail('request authority delegation is revoked');
  if (publishedAt < new Date(delegation.validFrom).getTime() || publishedAt > new Date(delegation.validUntil).getTime()) fail('offline signer delegation was not valid at publication');
  if (publishedAt < new Date(requestAuthorityDelegation.validFrom).getTime() || publishedAt > new Date(requestAuthorityDelegation.validUntil).getTime()) fail('request authority delegation was not valid at publication');
  if (now > new Date(receipt.expiresAt).getTime() || now > new Date(bundle.expiresAt).getTime()) fail('publication or bundle is expired');
  if (new Date(receipt.publishedAt).getTime() > new Date(request.expiresAt).getTime()) fail('request expired before publication');
  if (new Date(bundle.expiresAt).getTime() - new Date(receipt.publishedAt).getTime() > delegation.maxBundleLifetimeSeconds * 1000) fail('bundle lifetime exceeds delegation');
  if (receipt.requestDigest !== request.requestDigest || receipt.requestDigest !== canonicalAuthorityDigest(unsignedRequest(request))) fail('request digest binding mismatch');
  if (receipt.delegationDigest !== canonicalAuthorityDigest(delegation)) fail('delegation digest binding mismatch');
  if (delegation.rootSignature.keyId !== value.expected.releaseRootKeyId) fail('release-root signer identity mismatch');
  if (requestAuthorityDelegation.rootSignature.keyId !== value.expected.releaseRootKeyId) fail('request-authority release-root signer identity mismatch');
  if (requestAttestation.signerId !== requestAuthorityDelegation.signerId || requestAttestation.signature.keyId !== requestAuthorityDelegation.signerId) fail('request authority signer identity mismatch');
  if (!requestAuthorityDelegation.allowedRepositories.includes(request.repository)
    || !requestAuthorityDelegation.allowedWorkflowRefs.includes(requestAttestation.workflowRef)
    || !requestAuthorityDelegation.allowedWorkflowRevisions.includes(requestAttestation.workflowRevision)) fail('request attestation exceeds delegated scope');
  if (requestAttestation.requestDigest !== request.requestDigest || requestAttestation.repository !== request.repository
    || requestAttestation.workflowRevision !== request.workflow.revision || requestAttestation.workflowRunId !== request.workflow.runId
    || requestAttestation.releaseManifestDigest !== request.release.manifestDigest
    || requestAttestation.normalizedPlanDigest !== request.normalizedPlanDigest
    || requestAttestation.operationManifestDigest !== request.operationManifestDigest
    || requestAttestation.hostIdentityDigest !== request.hostIdentityDigest || requestAttestation.hostFactsDigest !== request.hostFactsDigest
    || requestAttestation.requesterClaimDigest !== request.requesterClaimDigest) fail('request attestation binding mismatch');
  if (receipt.requesterClaimDigest !== request.requesterClaimDigest) fail('requester claim binding mismatch');
  if (receipt.authorityVersion !== value.expected.authorityVersion) fail('publication authority version mismatch');
  if (receipt.signature.keyId !== delegation.signerId || bundle.signerId !== delegation.signerId) fail('offline signer identity mismatch');
  if (receipt.manifestDigest !== bundle.manifestDigest || ci.subjectManifestDigest !== bundle.manifestDigest) fail('immutable manifest binding mismatch');
  if (receipt.storage.objectIdentity !== `sha256/${receipt.manifestDigest.slice(0, 2)}/${receipt.manifestDigest}`) fail('storage identity is not content-addressed by the manifest');
  if (!delegation.allowedRepositories.includes(request.repository) || ci.repository !== request.repository) fail('repository is outside delegated scope');
  if (!delegation.allowedReleaseIds.includes(request.release.releaseId) || bundle.releaseId !== request.release.releaseId) fail('release is outside delegated scope');
  if (!delegation.allowedPlatforms.some(platform => same(platform, request.platform)) || !same(bundle.platform, request.platform)) fail('platform is outside delegated scope');
  if (bundle.artifacts.some(value => !delegation.allowedArtifactClasses.includes(value.artifactClass)) || request.artifacts.some(value => !delegation.allowedArtifactClasses.includes(value.artifactClass))) fail('artifact class is outside delegated scope');
  if (bundle.sizeBytes > delegation.maxBundleSizeBytes) fail('bundle exceeds delegated size');
  if (ci.workflowRevision !== request.workflow.revision || ci.workflowRunId !== request.workflow.runId || ci.runAttempt !== request.workflow.runAttempt) fail('CI identity does not match requester claim');
  if (ci.issuer !== value.expected.ci.issuer || ci.subject !== value.expected.ci.subject || ci.workflowRef !== value.expected.ci.workflowRef) fail('CI attestation authority or identity mismatch');
  if (ci.evidenceDigest !== canonicalAuthorityDigest({ journal, executionAuthority })) fail('CI attestation does not bind committed journal and network isolation authority');
  if (journal.planDigest !== request.normalizedPlanDigest || journal.releaseId !== request.release.releaseId || journal.desiredRevision !== request.desiredStateRevision || journal.hostId !== request.hostFacts.hostId || journal.hostFactsDigest !== request.hostFactsDigest) fail('committed journal scope mismatch');
  const expected = value.expected;
  if (request.repository !== expected.repository || request.release.releaseId !== expected.releaseId || request.release.manifestDigest !== expected.releaseManifestDigest) fail('release or repository differs from independent expected scope');
  if (request.hostIdentityDigest !== expected.hostIdentityDigest || request.hostFactsDigest !== canonicalAuthorityDigest(expected.hostFacts) || !same(request.hostFacts, expected.hostFacts)) fail('host identity or facts differ from independent expected scope');
  if (!same(request.platform, expected.platform) || request.desiredStateRevision !== expected.desiredStateRevision) fail('platform or desired state differs from independent expected scope');
  if (!same(request.selectedTaskIds, expected.selectedTaskIds) || request.normalizedPlanDigest !== expected.normalizedPlanDigest || request.operationManifestDigest !== expected.operationManifestDigest) fail('plan differs from independent expected scope');
  if (!same(request.targets, expected.targets)) fail('targets differ from independent expected scope');
  if (!same(request.artifacts, expected.artifacts) || !same(bundle.artifacts, expected.artifacts)) fail('artifacts differ from independent expected scope');
  if (!same({ revision: request.workflow.revision, event: request.workflow.event, ref: request.workflow.ref, environment: request.workflow.environment }, expected.workflow)) fail('workflow differs from independent expected scope');
  const journalTaskIds = journal.entries.map(entry => entry.taskId).sort((left, right) => left.localeCompare(right));
  if (!same(journalTaskIds, request.selectedTaskIds)) fail('journal does not prove the exact selected closure');
  const terminal = new Map(journal.entries.map(entry => [entry.taskId, entry.status]));
  if (request.selectedTaskIds.some(taskId => !['verified', 'inapplicable'].includes(terminal.get(taskId) ?? ''))) fail('journal does not prove successful terminal states');
  const delegationVerified = await verifiers.verifyDigestSignature({ payloadDigest: canonicalAuthorityDigest(delegation), signatureBase64: value.proofs.delegation.signatureBase64, publicKey: expected.releaseRootPublicKey, keyId: delegation.rootSignature.keyId, namespace: delegation.rootSignature.namespace });
  if (!delegationVerified) fail('release-root delegation signature is invalid');
  const requestDelegationVerified = await verifiers.verifyDigestSignature({ payloadDigest: canonicalAuthorityDigest(requestAuthorityDelegation), signatureBase64: value.proofs.requestAuthorityDelegation.signatureBase64, publicKey: expected.releaseRootPublicKey, keyId: requestAuthorityDelegation.rootSignature.keyId, namespace: requestAuthorityDelegation.rootSignature.namespace });
  if (!requestDelegationVerified) fail('request-authority release-root delegation signature is invalid');
  const requestAttestationVerified = await verifiers.verifyDigestSignature({ payloadDigest: canonicalAuthorityDigest(requestAttestation), signatureBase64: value.proofs.requestAttestation.signatureBase64, publicKey: requestAuthorityDelegation.publicKey, keyId: requestAttestation.signature.keyId, namespace: requestAttestation.signature.namespace });
  if (!requestAttestationVerified) fail('delegated request attestation signature is invalid');
  const publicationVerified = await verifiers.verifyDigestSignature({ payloadDigest: canonicalAuthorityDigest(receipt), signatureBase64: value.proofs.publicationReceipt.signatureBase64, publicKey: delegation.publicKey, keyId: receipt.signature.keyId, namespace: receipt.signature.namespace });
  if (!publicationVerified) fail('publication receipt signature is invalid');
  const bundleVerified = await verifiers.verifyDigestSignature({ payloadDigest: bundle.manifestDigest, signatureBase64: value.proofs.bundle.signatureBase64, publicKey: delegation.publicKey, keyId: bundle.signerId, namespace: delegation.namespace });
  if (!bundleVerified) fail('bundle signature is invalid');
  if (!await verifiers.verifyCiAttestation({ attestation: ci, signatureBase64: value.proofs.ciAttestation.signatureBase64 })) fail('CI platform attestation is invalid');
  const bindings = Object.freeze({ requestDigest: request.requestDigest, requestAuthorityDelegationDigest: canonicalAuthorityDigest(requestAuthorityDelegation), requestAttestationDigest: canonicalAuthorityDigest(requestAttestation), delegationDigest: receipt.delegationDigest, manifestDigest: bundle.manifestDigest, ciEvidenceDigest: ci.evidenceDigest, journalRevision: journal.revision, journalDigest: canonicalAuthorityDigest(journal), journalCommitDigest: executionAuthority.journalCommitDigest, networkIsolationDigest: executionAuthority.networkIsolationDigest });
  return { verified: true, bindings, promotionDigest: canonicalAuthorityDigest(bindings) };
}
