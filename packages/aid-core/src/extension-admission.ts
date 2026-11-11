/** Strict, side-effect-free extension trust and admission contracts. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/).max(512);
const timestamp = z.string().datetime({ offset: true });
const semver = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
const relativeModule = z.string().min(1).max(240).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)node_modules(?:\/|$))[A-Za-z0-9._/-]+\.mjs$/);
const immutableUrl = z.string().url().max(2_048).superRefine((value, context) => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    context.addIssue({ code: 'custom', message: 'Artifact URLs must be credential-free immutable HTTPS locations' });
  }
});
const unique = <T extends z.ZodTypeAny>(schema: T, label: string, maximum = 256) => z.array(schema).max(maximum)
  .superRefine((values, context) => {
    const encoded = values.map(value => JSON.stringify(value));
    if (new Set(encoded).size !== values.length) context.addIssue({ code: 'custom', message: `${label} must be unique` });
  });

export const ExtensionCapabilitySchema = z.strictObject({
  action: z.enum(['catalog.read', 'events.subscribe', 'host.facts.read', 'profile.read', 'telemetry.emit', 'ui.contribute']),
  resource: z.string().regex(/^[a-z][a-z0-9._:/-]{0,255}$/),
});

export const ExtensionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  extensionId: identifier,
  version: semver,
  kind: z.enum(['agent', 'integration', 'plugin', 'skill']),
  displayName: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  apiCompatibility: z.strictObject({ minimum: z.number().int().positive(), maximum: z.number().int().positive() }),
  platforms: unique(z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64']), 'Platforms', 8),
  capabilities: unique(ExtensionCapabilitySchema, 'Capabilities', 64),
  lifecycleHooks: unique(z.strictObject({
    event: z.enum(['activate', 'deactivate', 'health-check', 'upgrade', 'remove']),
    module: relativeModule,
    exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/),
    timeoutSeconds: z.number().int().min(1).max(300),
  }), 'Lifecycle hooks', 16),
  artifact: z.strictObject({
    format: z.literal('desktop-tools-extension-tar-v1'),
    mediaType: z.literal('application/vnd.desktop-tools.extension.v1+tar+gzip'),
    url: immutableUrl,
    sha256: digest,
    size: z.number().int().positive().max(256 * 1024 * 1024),
    provenanceDigest: digest,
    entrypoint: relativeModule,
  }),
  isolatedTestEvidenceDigest: digest,
  publisher: z.strictObject({ id: identifier, catalogId: identifier }),
}).superRefine((manifest, context) => {
  if (manifest.apiCompatibility.minimum > manifest.apiCompatibility.maximum) {
    context.addIssue({ code: 'custom', message: 'API compatibility range must be increasing' });
  }
  const events = manifest.lifecycleHooks.map(hook => hook.event);
  if (new Set(events).size !== events.length) context.addIssue({ code: 'custom', message: 'Lifecycle events must have one hook at most' });
});

const signature = z.strictObject({ algorithm: z.literal('Ed25519'), keyId: identifier, value: base64url });
const signed = <T extends z.ZodTypeAny>(payload: T) => z.strictObject({ payload, signature });
export const SignedExtensionManifestSchema = signed(ExtensionManifestSchema);

export const ExtensionCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1), catalogId: identifier, sequence: z.number().int().nonnegative(),
  visibility: z.enum(['public', 'private']), tenantId: identifier.nullable(),
  generatedAt: timestamp, expiresAt: timestamp,
  entries: unique(z.strictObject({
    extensionId: identifier, version: semver, manifestDigest: digest, artifactDigest: digest,
    manifestUrl: immutableUrl,
  }), 'Catalog entries', 10_000),
}).superRefine((catalog, context) => {
  if ((catalog.visibility === 'private') !== (catalog.tenantId !== null)) {
    context.addIssue({ code: 'custom', message: 'Only private catalogs bind a tenant' });
  }
  if (Date.parse(catalog.generatedAt) >= Date.parse(catalog.expiresAt)) context.addIssue({ code: 'custom', message: 'Catalog validity must be increasing' });
  const identities = catalog.entries.map(entry => `${entry.extensionId}@${entry.version}`);
  if (new Set(identities).size !== identities.length) context.addIssue({ code: 'custom', message: 'Catalog extension versions must be unique' });
});
export const SignedExtensionCatalogSchema = signed(ExtensionCatalogSchema);

export const ExtensionTestEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1), evidenceId: identifier, extensionId: identifier, version: semver, artifactDigest: digest,
  runnerId: identifier, suiteDigest: digest, testedAt: timestamp, expiresAt: timestamp,
  isolation: z.strictObject({ network: z.literal('denied'), filesystem: z.literal('ephemeral'),
    process: z.literal('unprivileged'), secrets: z.literal('none'), privilegedBroker: z.literal('unavailable') }),
  checks: unique(z.strictObject({
    id: z.enum(['artifact-load', 'capability-denial', 'lifecycle-hooks', 'path-containment', 'resource-cleanup']),
    outcome: z.literal('passed'), evidenceDigest: digest,
  }), 'Isolated checks', 16),
}).superRefine((evidence, context) => {
  if (Date.parse(evidence.testedAt) >= Date.parse(evidence.expiresAt)) context.addIssue({ code: 'custom', message: 'Test evidence validity must be increasing' });
  const required = ['artifact-load', 'capability-denial', 'lifecycle-hooks', 'path-containment', 'resource-cleanup'];
  const actual = new Set(evidence.checks.map(check => check.id));
  if (required.some(check => !actual.has(check as typeof evidence.checks[number]['id']))) {
    context.addIssue({ code: 'custom', message: 'Isolated evidence is missing a mandatory check' });
  }
});
export const SignedExtensionTestEvidenceSchema = signed(ExtensionTestEvidenceSchema);

export const ExtensionRevocationStatementSchema = z.strictObject({
  schemaVersion: z.literal(1), statementId: identifier, sequence: z.number().int().nonnegative(),
  catalogId: identifier, coversCatalogSequence: z.number().int().nonnegative(), generatedAt: timestamp, expiresAt: timestamp,
  revokedManifestDigests: unique(digest, 'Revoked manifests', 100_000),
  revokedArtifactDigests: unique(digest, 'Revoked artifacts', 100_000),
  revokedPublisherKeyIds: unique(identifier, 'Revoked publisher keys', 10_000),
}).superRefine((statement, context) => {
  if (Date.parse(statement.generatedAt) >= Date.parse(statement.expiresAt)) context.addIssue({ code: 'custom', message: 'Revocation validity must be increasing' });
});
export const SignedExtensionRevocationStatementSchema = signed(ExtensionRevocationStatementSchema);

export const ExtensionTrustKeySchema = z.strictObject({
  keyId: identifier,
  usage: z.enum(['catalog-publisher', 'extension-publisher', 'revocation-authority', 'test-attestor']),
  publicKey: z.strictObject({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: base64url }),
  validFrom: timestamp, validUntil: timestamp,
  catalogIds: unique(identifier, 'Key catalogs', 256),
  tenantIds: unique(identifier, 'Key tenants', 256),
  extensionIds: unique(identifier, 'Key extensions', 10_000),
}).superRefine((key, context) => {
  if (Date.parse(key.validFrom) >= Date.parse(key.validUntil)) context.addIssue({ code: 'custom', message: 'Trust-key validity must be increasing' });
  if (key.usage === 'extension-publisher' ? key.extensionIds.length === 0 : key.extensionIds.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Only extension publishers carry a nonempty exact extension scope' });
  }
});
export const ExtensionTrustStoreSchema = z.strictObject({ schemaVersion: z.literal(1), keys: unique(ExtensionTrustKeySchema, 'Trust keys', 10_000) })
  .superRefine((store, context) => {
    const ids = store.keys.map(key => key.keyId);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Trust key ids must be unique' });
  });

export const ExtensionAdmissionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), now: timestamp, apiVersion: z.number().int().positive(),
  platform: z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64']),
  tenantId: identifier.nullable(), approvedCapabilities: unique(ExtensionCapabilitySchema, 'Approved capabilities', 64),
  manifest: SignedExtensionManifestSchema, catalog: SignedExtensionCatalogSchema,
  testEvidence: SignedExtensionTestEvidenceSchema, revocations: SignedExtensionRevocationStatementSchema,
  trustStore: ExtensionTrustStoreSchema,
});

export const ExtensionAdmissionReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), extensionId: identifier, version: semver, manifestDigest: digest,
  artifactDigest: digest, catalogId: identifier, catalogSequence: z.number().int().nonnegative(),
  revocationSequence: z.number().int().nonnegative(), admittedAt: timestamp,
  executionBoundary: z.literal('isolated-unprivileged-worker'),
  grantedCapabilities: unique(ExtensionCapabilitySchema, 'Granted capabilities', 64),
  artifact: z.strictObject({ format: z.literal('desktop-tools-extension-tar-v1'), url: immutableUrl,
    sha256: digest, size: z.number().int().positive(), entrypoint: relativeModule }),
});

export const ExtensionMaterializationPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), extensionId: identifier, version: semver,
  source: z.strictObject({ kind: z.literal('verified-extension-archive'), url: immutableUrl, sha256: digest, size: z.number().int().positive() }),
  destination: z.strictObject({ kind: z.literal('content-addressed-extension-store'), digest }),
  activation: z.strictObject({ kind: z.literal('isolated-unprivileged-worker'), entrypoint: relativeModule }),
});

type TrustKey = z.infer<typeof ExtensionTrustKeySchema>;
type SignedValue = { payload: unknown; signature: z.infer<typeof signature> };
const domains = {
  manifest: 'desktop.tools/extension-manifest/v1', catalog: 'desktop.tools/extension-catalog/v1',
  evidence: 'desktop.tools/extension-test-evidence/v1', revocations: 'desktop.tools/extension-revocations/v1',
} as const;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}
function bytes(domain: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${domain}\n${canonical(payload)}`);
}
function decode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const decoded = atob(normalized); return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
async function sha256(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verify(value: SignedValue, domain: string, usage: TrustKey['usage'], trust: z.infer<typeof ExtensionTrustStoreSchema>, now: number): Promise<TrustKey> {
  const key = trust.keys.find(candidate => candidate.keyId === value.signature.keyId && candidate.usage === usage);
  if (!key) throw new Error(`No trusted ${usage} key matches the signature`);
  if (Date.parse(key.validFrom) > now || now >= Date.parse(key.validUntil)) throw new Error(`Trusted ${usage} key is outside its validity interval`);
  const imported = await crypto.subtle.importKey('jwk', { ...key.publicKey, ext: true }, { name: 'Ed25519' }, false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', imported, decode(value.signature.value), bytes(domain, value.payload))) {
    throw new Error(`${usage} signature is invalid`);
  }
  return key;
}
function scoped(key: TrustKey, catalogId: string, tenantId: string | null, extensionId?: string): boolean {
  return key.catalogIds.includes(catalogId) && (tenantId === null ? key.tenantIds.length === 0 : key.tenantIds.includes(tenantId))
    && (extensionId === undefined || key.extensionIds.includes(extensionId));
}
function capabilityKey(value: z.infer<typeof ExtensionCapabilitySchema>): string { return `${value.action}\u0000${value.resource}`; }

/** Verify all independent trust inputs and issue an immutable, unprivileged execution receipt. */
export async function admitExtension(input: unknown): Promise<z.infer<typeof ExtensionAdmissionReceiptSchema>> {
  const request = ExtensionAdmissionRequestSchema.parse(input); const now = Date.parse(request.now);
  const manifest = request.manifest.payload; const catalog = request.catalog.payload;
  const evidence = request.testEvidence.payload; const revocations = request.revocations.payload;
  const manifestDigest = await sha256(manifest);
  const [manifestKey, catalogKey, evidenceKey, revocationKey] = await Promise.all([
    verify(request.manifest, domains.manifest, 'extension-publisher', request.trustStore, now),
    verify(request.catalog, domains.catalog, 'catalog-publisher', request.trustStore, now),
    verify(request.testEvidence, domains.evidence, 'test-attestor', request.trustStore, now),
    verify(request.revocations, domains.revocations, 'revocation-authority', request.trustStore, now),
  ]);
  if (Date.parse(catalog.expiresAt) <= now || Date.parse(revocations.expiresAt) <= now || Date.parse(evidence.expiresAt) <= now) throw new Error('Extension admission evidence is expired');
  if (catalog.catalogId !== manifest.publisher.catalogId || revocations.catalogId !== catalog.catalogId) throw new Error('Extension catalog identities do not match');
  if (catalog.visibility === 'private' ? request.tenantId !== catalog.tenantId : request.tenantId !== null) throw new Error('Extension catalog tenant scope does not match');
  if (![manifestKey, catalogKey, evidenceKey, revocationKey].every(key => scoped(key, catalog.catalogId, catalog.tenantId,
    key.usage === 'extension-publisher' ? manifest.extensionId : undefined))) throw new Error('Extension signer scope does not match the catalog');
  if (!manifest.platforms.includes(request.platform)) throw new Error('Extension does not support this platform');
  if (request.apiVersion < manifest.apiCompatibility.minimum || request.apiVersion > manifest.apiCompatibility.maximum) throw new Error('Extension API version is incompatible');
  const entry = catalog.entries.find(candidate => candidate.extensionId === manifest.extensionId && candidate.version === manifest.version);
  if (!entry || entry.manifestDigest !== manifestDigest || entry.artifactDigest !== manifest.artifact.sha256) throw new Error('Extension is absent from the exact signed catalog');
  if (revocations.coversCatalogSequence < catalog.sequence) throw new Error('Extension revocation state is stale for this catalog');
  if (evidence.extensionId !== manifest.extensionId || evidence.version !== manifest.version || evidence.artifactDigest !== manifest.artifact.sha256
    || manifest.isolatedTestEvidenceDigest !== await sha256(evidence)) throw new Error('Isolated test evidence is not bound to the extension');
  if (revocations.revokedPublisherKeyIds.includes(manifestKey.keyId) || revocations.revokedManifestDigests.includes(manifestDigest)
    || revocations.revokedArtifactDigests.includes(manifest.artifact.sha256)) throw new Error('Extension authority is revoked');
  const approved = new Set(request.approvedCapabilities.map(capabilityKey));
  if (manifest.capabilities.some(capability => !approved.has(capabilityKey(capability)))) throw new Error('Extension requests capability outside the approved profile and task');
  return ExtensionAdmissionReceiptSchema.parse({ schemaVersion: 1, extensionId: manifest.extensionId, version: manifest.version,
    manifestDigest, artifactDigest: manifest.artifact.sha256, catalogId: catalog.catalogId, catalogSequence: catalog.sequence,
    revocationSequence: revocations.sequence, admittedAt: request.now, executionBoundary: 'isolated-unprivileged-worker',
    grantedCapabilities: manifest.capabilities, artifact: { format: manifest.artifact.format, url: manifest.artifact.url,
      sha256: manifest.artifact.sha256, size: manifest.artifact.size, entrypoint: manifest.artifact.entrypoint } });
}

/** Compile only a verified archive extraction. npm, commands, scripts, and privileged activation are unrepresentable. */
export function compileExtensionMaterializationPlan(receiptInput: unknown): z.infer<typeof ExtensionMaterializationPlanSchema> {
  const receipt = ExtensionAdmissionReceiptSchema.parse(receiptInput);
  return ExtensionMaterializationPlanSchema.parse({ schemaVersion: 1, extensionId: receipt.extensionId, version: receipt.version,
    source: { kind: 'verified-extension-archive', url: receipt.artifact.url, sha256: receipt.artifact.sha256, size: receipt.artifact.size },
    destination: { kind: 'content-addressed-extension-store', digest: receipt.artifactDigest },
    activation: { kind: receipt.executionBoundary, entrypoint: receipt.artifact.entrypoint } });
}

/** Exported solely so publishers and tests sign the exact protocol bytes. */
export function extensionSignatureBytes(kind: keyof typeof domains, payload: unknown): Uint8Array {
  return bytes(domains[kind], payload);
}

export async function extensionPayloadDigest(payload: unknown): Promise<string> { return sha256(payload); }
