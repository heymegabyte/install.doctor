import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  ExtensionAdmissionReceiptSchema, ExtensionManifestSchema, ExtensionMaterializationPlanSchema,
  admitExtension, compileExtensionMaterializationPlan, extensionPayloadDigest, extensionSignatureBytes,
} from '../dist/extension-admission.js';

const now = '2026-11-10T12:00:00.000Z';
const validFrom = '2026-11-09T00:00:00.000Z';
const validUntil = '2026-12-10T00:00:00.000Z';
const digest = character => character.repeat(64);
const checks = ['artifact-load', 'capability-denial', 'lifecycle-hooks', 'path-containment', 'resource-cleanup']
  .map((id, index) => ({ id, outcome: 'passed', evidenceDigest: digest(String(index + 1)) }));

function key(usage, options = {}) {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  return {
    privateKey: pair.privateKey,
    trust: { keyId: `${usage}-1`, usage, publicKey: { kty: 'OKP', crv: 'Ed25519', x: publicKey.x }, validFrom, validUntil,
      catalogIds: ['official'], tenantIds: options.tenantIds ?? [], extensionIds: options.extensionIds ?? [] },
  };
}
function envelope(kind, payload, signer) {
  return { payload, signature: { algorithm: 'Ed25519', keyId: signer.trust.keyId,
    value: sign(null, extensionSignatureBytes(kind, payload), signer.privateKey).toString('base64url') } };
}

async function fixture(options = {}) {
  const publisher = key('extension-publisher', { extensionIds: ['com.desktop-tools.readonly'] });
  const catalogSigner = key('catalog-publisher'); const testAttestor = key('test-attestor'); const revoker = key('revocation-authority');
  const capability = { action: 'host.facts.read', resource: 'host://facts/os' };
  const evidence = { schemaVersion: 1, evidenceId: 'evidence-1', extensionId: 'com.desktop-tools.readonly', version: '1.2.3',
    artifactDigest: digest('a'), runnerId: 'isolated-runner-1', suiteDigest: digest('b'), testedAt: '2026-11-10T10:00:00.000Z',
    expiresAt: '2026-11-20T10:00:00.000Z', isolation: { network: 'denied', filesystem: 'ephemeral', process: 'unprivileged',
      secrets: 'none', privilegedBroker: 'unavailable' }, checks: checks.map(check => ({ ...check })) };
  const manifest = { schemaVersion: 1, extensionId: 'com.desktop-tools.readonly', version: '1.2.3', kind: 'plugin',
    displayName: 'Read-only host facts', description: 'Reads the explicitly approved operating-system fact.',
    apiCompatibility: { minimum: 2, maximum: 4 }, platforms: ['linux-x64'], capabilities: options.capabilities ?? [capability],
    lifecycleHooks: [{ event: 'activate', module: 'dist/lifecycle.mjs', exportName: 'activate', timeoutSeconds: 10 }],
    artifact: { format: 'desktop-tools-extension-tar-v1', mediaType: 'application/vnd.desktop-tools.extension.v1+tar+gzip',
      url: 'https://extensions.desktop.tools/artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz',
      sha256: digest('a'), size: 4096, provenanceDigest: digest('c'), entrypoint: 'dist/index.mjs' },
    isolatedTestEvidenceDigest: await extensionPayloadDigest(evidence), publisher: { id: 'desktop-tools', catalogId: 'official' } };
  const manifestDigest = await extensionPayloadDigest(manifest);
  const catalog = { schemaVersion: 1, catalogId: 'official', sequence: 12, visibility: 'public', tenantId: null,
    generatedAt: '2026-11-10T11:00:00.000Z', expiresAt: '2026-11-20T11:00:00.000Z', entries: [{ extensionId: manifest.extensionId,
      version: manifest.version, manifestDigest, artifactDigest: manifest.artifact.sha256,
      manifestUrl: `https://extensions.desktop.tools/manifests/${manifestDigest}.json` }] };
  const revocations = { schemaVersion: 1, statementId: 'revocations-12', sequence: 9, catalogId: 'official', coversCatalogSequence: 12,
    generatedAt: '2026-11-10T11:30:00.000Z', expiresAt: '2026-11-11T11:30:00.000Z',
    revokedManifestDigests: options.revokeManifest ? [manifestDigest] : [], revokedArtifactDigests: [], revokedPublisherKeyIds: [] };
  return { request: { schemaVersion: 1, now, apiVersion: options.apiVersion ?? 3, platform: 'linux-x64', tenantId: null,
    approvedCapabilities: options.approvedCapabilities ?? [capability], manifest: envelope('manifest', manifest, publisher),
    catalog: envelope('catalog', catalog, catalogSigner), testEvidence: envelope('evidence', evidence, testAttestor),
    revocations: envelope('revocations', revocations, revoker), trustStore: { schemaVersion: 1,
      keys: [publisher.trust, catalogSigner.trust, testAttestor.trust, revoker.trust] } }, manifestDigest,
    signers: { publisher, catalogSigner, testAttestor, revoker } };
}

test('admits exact signed catalog content and compiles only isolated content-addressed materialization', async () => {
  const { request, manifestDigest } = await fixture(); const receipt = await admitExtension(request);
  assert.equal(receipt.manifestDigest, manifestDigest); assert.equal(receipt.executionBoundary, 'isolated-unprivileged-worker');
  const plan = compileExtensionMaterializationPlan(receipt);
  assert.deepEqual(plan.activation, { kind: 'isolated-unprivileged-worker', entrypoint: 'dist/index.mjs' });
  assert.equal(plan.destination.digest, digest('a')); assert.equal(plan.source.kind, 'verified-extension-archive');
  assert.doesNotMatch(JSON.stringify(plan), /npm|package-manager|command|install-script|privileged-runtime/i);
});

test('fails closed on signature tampering, incompatible APIs, excess capability, and revocation', async () => {
  const tampered = await fixture(); tampered.request.manifest.payload.description = 'changed after signature';
  await assert.rejects(admitExtension(tampered.request), /signature is invalid/);
  await assert.rejects(admitExtension((await fixture({ apiVersion: 5 })).request), /incompatible/);
  const excess = { action: 'telemetry.emit', resource: 'telemetry://extension/metrics' };
  await assert.rejects(admitExtension((await fixture({ capabilities: [excess], approvedCapabilities: [] })).request), /outside the approved/);
  await assert.rejects(admitExtension((await fixture({ revokeManifest: true })).request), /revoked/);
});

test('requires complete fresh isolated evidence and a current revocation view', async () => {
  const incomplete = await fixture(); incomplete.request.testEvidence.payload.checks.pop();
  assert.throws(() => ExtensionManifestSchema.parse({ ...incomplete.request.manifest.payload, npm: 'hostile-package' }), /unrecognized/i);
  incomplete.request.testEvidence = envelope('evidence', incomplete.request.testEvidence.payload, incomplete.signers.testAttestor);
  await assert.rejects(admitExtension(incomplete.request), /mandatory check/);
  const stale = await fixture(); stale.request.revocations.payload.coversCatalogSequence = 11;
  stale.request.revocations = envelope('revocations', stale.request.revocations.payload, stale.signers.revoker);
  await assert.rejects(admitExtension(stale.request), /revocation state is stale/);
});

test('private catalogs and signer scopes cannot cross tenant boundaries', async () => {
  const item = await fixture(); item.request.catalog.payload.visibility = 'private'; item.request.catalog.payload.tenantId = 'tenant-a';
  item.request.catalog = envelope('catalog', item.request.catalog.payload, item.signers.catalogSigner);
  // A valid private catalog still cannot be opened by another tenant or public-only signer scope.
  item.request.tenantId = 'tenant-b';
  await assert.rejects(admitExtension(item.request), /tenant scope/);
  item.request.tenantId = 'tenant-a';
  await assert.rejects(admitExtension(item.request), /signer scope/);
});

test('arbitrary npm auto-install and privileged execution are structurally unrepresentable', async () => {
  const receipt = await admitExtension((await fixture()).request);
  assert.throws(() => ExtensionAdmissionReceiptSchema.parse({ ...receipt, executionBoundary: 'privileged-runtime' }), /invalid/i);
  assert.throws(() => ExtensionMaterializationPlanSchema.parse({ ...compileExtensionMaterializationPlan(receipt),
    npm: { package: 'postinstall-payload', lifecycleScripts: true } }), /unrecognized/i);
  assert.throws(() => ExtensionManifestSchema.parse({ ...receipt, schemaVersion: 1, kind: 'plugin', displayName: 'bad', description: 'bad',
    apiCompatibility: { minimum: 1, maximum: 1 }, platforms: ['linux-x64'], capabilities: [], lifecycleHooks: [],
    artifact: { format: 'npm', package: 'arbitrary' }, isolatedTestEvidenceDigest: digest('d'), publisher: { id: 'bad', catalogId: 'official' } }), /invalid|unrecognized/i);
});
