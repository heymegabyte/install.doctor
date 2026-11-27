import { createHash, createPublicKey } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { releaseObjectUrl, releasePolicy } from '../src/release-policy.ts';

const policy = releasePolicy('desktop-tools');
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.string().regex(/^[1-9][0-9]*$/).transform(Number).refine(Number.isSafeInteger);
const nonnegative = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).refine(Number.isSafeInteger);
/** @typedef {readonly [prefix: string, filename: string, maximum: number]} Artifact */
/** @typedef {ReturnType<typeof import('./r2-publication-storage.mjs').createR2PublicationStorage>} ReleaseStorage */
/** @typedef {Pick<ReleaseStorage, 'read'>} ReadStorage */
/** @typedef {Pick<ReleaseStorage, 'read' | 'create'>} DesktopStorage */
/** @typedef {(input: { manifest: Uint8Array, signature: Uint8Array, signerId: string, namespace: string }) => void | Promise<void>} VerifyManifest */
/** @typedef {(input: { payload: Uint8Array, signature: Uint8Array, signerId: string, namespace: string }) => void | Promise<void>} VerifyPromotion */

/** @type {readonly Artifact[]} */
const V7_ARTIFACTS = Object.freeze([
  ['artifact', 'provision.sh', 8_388_608],
  ['engine', policy.engineFilename, 8_388_608],
  ['catalog', 'catalog.json', 8_388_608],
  ['launcher', 'start', 8_388_608],
  ['runtime_macos_x64', 'node-macos-x64.tar.gz', 100_663_296],
  ['runtime_macos_arm64', 'node-macos-arm64.tar.gz', 100_663_296],
  ['runtime_linux_x64', 'node-linux-x64.tar.gz', 100_663_296],
  ['runtime_linux_arm64', 'node-linux-arm64.tar.gz', 100_663_296],
  ['opencode_macos_x64', 'opencode-macos-x64.zip', 167_772_160],
  ['opencode_macos_arm64', 'opencode-macos-arm64.zip', 167_772_160],
  ['opencode_linux_x64', 'opencode-linux-x64.tar.gz', 167_772_160],
  ['opencode_linux_arm64', 'opencode-linux-arm64.tar.gz', 167_772_160],
  ['supervisor', 'desktop-tools-supervisor.mjs', 8_388_608],
  ['tools', 'desktop-tools-tools.tar.gz', 33_554_432],
  ['opencode_lock', 'opencode.lock.json', 8_388_608],
  ['sbom', 'release.sbom.json', 8_388_608],
  ['provenance', 'release.provenance.json', 8_388_608],
  ['licenses', 'THIRD_PARTY_LICENSES.txt', 8_388_608],
]);
/** @type {readonly Artifact[]} */
const V8_DEBIAN_ARTIFACTS = Object.freeze([
  ['debian_inrelease', 'debian-bookworm-inrelease', 16_777_216],
  ['debian_keyring', 'debian-bookworm-archive-keyring.gpg', 16_777_216],
  ['debian_packages', 'debian-bookworm-main-amd64-Packages.xz', 268_435_456],
  ['debian_tree', 'tree_2.1.0-1_amd64.deb', 268_435_456],
]);
/** @type {readonly Artifact[]} */
const V9_BROKER_ARTIFACTS = Object.freeze([
  ['broker_approval_delegation', 'broker-approval-signer-delegation.json', 65_536],
]);
/** @type {readonly Artifact[]} */
const V10_EVIDENCE_ARTIFACTS = Object.freeze([
  ['spdx', 'release.spdx.json', 8_388_608],
  ['exploitability', 'release.exploitability.json', 8_388_608],
]);
/** @param {string} schemaVersion */
const artifactsForSchema = schemaVersion => schemaVersion === '7' ? V7_ARTIFACTS
  : schemaVersion === '8' ? Object.freeze([...V7_ARTIFACTS, ...V8_DEBIAN_ARTIFACTS])
  : schemaVersion === '9' ? Object.freeze([...V7_ARTIFACTS, ...V8_DEBIAN_ARTIFACTS, ...V9_BROKER_ARTIFACTS])
  : Object.freeze([...V7_ARTIFACTS, ...V8_DEBIAN_ARTIFACTS, ...V9_BROKER_ARTIFACTS, ...V10_EVIDENCE_ARTIFACTS]);
/** @param {string} schemaVersion */
const filesForSchema = schemaVersion => Object.freeze([
  ...artifactsForSchema(schemaVersion).map(([, filename]) => filename), 'manifest.sig', 'manifest'
].sort());
export const DESKTOP_RELEASE_FILES = filesForSchema('7');
export const DESKTOP_RELEASE_V8_FILES = filesForSchema('8');
export const DESKTOP_RELEASE_V9_FILES = filesForSchema('9');
export const DESKTOP_RELEASE_V10_FILES = filesForSchema('10');
/** @param {string} schemaVersion */
const requiredKeysForSchema = schemaVersion => Object.freeze([
  'schema_version', 'product_id', 'release_id', 'source_commit', 'created_at', 'expires_at', 'key_id',
  ...artifactsForSchema(schemaVersion).flatMap(([prefix]) => [`${prefix}_url`, `${prefix}_sha256`, `${prefix}_size`]),
  'engine_node_min', 'runtime_node_version', 'opencode_version',
  ...(['9', '10'].includes(schemaVersion) ? ['broker_approval_minimum_revocation_epoch'] : [])
]);
/** @param {Uint8Array} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {Uint8Array} left @param {Uint8Array} right */
const same = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
/** @param {unknown} value */
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
/** @param {unknown} value @returns {unknown} */
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]))
    : value;
/** @param {string} domain @param {unknown} value */
const semanticDigest = (domain, value) => digest(Buffer.from(`${domain}\0${JSON.stringify(canonicalValue(value))}`, 'utf8'));
/** @param {readonly Artifact[]} artifacts */
const closurePayloadNames = artifacts => artifacts.map(([, name]) => name)
  .filter(name => !['release.sbom.json', 'release.provenance.json', 'release.spdx.json',
    'release.exploitability.json', 'THIRD_PARTY_LICENSES.txt'].includes(name));
const DesktopPointer = z.strictObject({
  schemaVersion: z.literal(2), product: z.literal('desktop-tools'), channel: id,
  generation: z.number().int().positive().safe(), kind: z.enum(['promote', 'rollback']),
  releaseId: id, signerId: id, manifestSha256: sha256, activatedAt: z.string().datetime({ offset: true }),
  activationId: z.string().uuid(),
  previous: z.nullable(z.strictObject({
    generation: z.number().int().positive().safe(), activationId: z.string().uuid(), releaseId: id,
    manifestSha256: sha256, etag: z.string().min(1).max(512)
  })),
  rollbackOfActivationId: z.string().uuid().nullable(), promotionEvidenceSha256: sha256.nullable()
});
const PromotionEvidence = z.strictObject({
  schemaVersion: z.literal(1), product: z.literal('desktop-tools'), kind: z.literal('cohort-health'),
  releaseId: id, sourceCohort: z.enum(['build', 'canary', 'early-access']),
  targetCohort: z.enum(['canary', 'early-access', 'stable']), result: z.enum(['passed', 'failed']),
  observedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  evidenceDigest: sha256, signerId: id, signature: z.string().min(16).max(16_384)
});
const COHORT_PREDECESSOR = Object.freeze({ canary: 'build', 'early-access': 'canary', stable: 'early-access' });

/** @param {{ evidence: unknown, release: { releaseId: string }, targetCohort: string, now?: number, verifySignature: VerifyPromotion | null }} input */
export async function admitDesktopPromotionEvidence({ evidence, release, targetCohort, now = Date.now(), verifySignature }) {
  if (typeof verifySignature !== 'function') throw new Error('promotion evidence verifier is required');
  const parsed = PromotionEvidence.parse(evidence);
  const cohort = z.enum(['canary', 'early-access', 'stable']).parse(targetCohort);
  if (parsed.releaseId !== release?.releaseId || parsed.targetCohort !== cohort
    || parsed.sourceCohort !== COHORT_PREDECESSOR[cohort]) {
    throw new Error('promotion evidence does not match the exact release cohort transition');
  }
  const observed = Date.parse(parsed.observedAt);
  const expires = Date.parse(parsed.expiresAt);
  if (!Number.isSafeInteger(now) || !Number.isFinite(observed) || !Number.isFinite(expires)
    || observed > now || expires <= now || expires - observed > 86_400_000) {
    throw new Error('promotion evidence is stale or has an invalid validity window');
  }
  const { signature, ...payload } = parsed;
  const bytes = canonical(canonicalValue(payload));
  await verifySignature({ payload: bytes, signature: Buffer.from(signature, 'base64url'), signerId: parsed.signerId,
    namespace: 'desktop.tools.promotion-health' });
  if (parsed.result !== 'passed') {
    throw Object.assign(new Error('promotion is suspended by failed cohort health evidence'), {
      promotionSuspended: true, evidenceDigest: digest(bytes), evidence: parsed,
    });
  }
  return Object.freeze({ ...parsed, signature: '[verified]', signaturePayloadSha256: digest(bytes) });
}

/** @param {Uint8Array} bytes */
function parseManifest(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16_384) throw new Error('manifest size is outside policy');
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 1 || !/^[a-z0-9_]+$/.test(key) || !value || values.has(key)) throw new Error('manifest contains malformed or duplicate data');
    values.set(key, value);
  }
  const schemaVersion = values.get('schema_version');
  if (schemaVersion === undefined || !['7', '8', '9', '10'].includes(schemaVersion)) throw new Error('manifest schema is unsupported');
  if (JSON.stringify([...values.keys()].sort()) !== JSON.stringify([...requiredKeysForSchema(schemaVersion)].sort())) {
    throw new Error(`manifest key set does not match Desktop Tools schema v${schemaVersion}`);
  }
  return { values, schemaVersion };
}

/** @param {Uint8Array} bytes @param {{ releaseId: string, createdAt: number, expiresAt: number, minimumRevocationEpoch: number }} expected */
function validateBrokerApprovalDelegation(bytes, { releaseId, createdAt, expiresAt, minimumRevocationEpoch }) {
  const delegation = parseJsonObject(bytes, 'broker approval signer delegation');
  const keys = ['algorithm', 'channel', 'delegationDigest', 'keyId', 'kind', 'maximumApprovalLifetimeSeconds',
    'notAfter', 'notBefore', 'product', 'publicKeySpki', 'releaseId', 'revocationEpoch', 'schemaVersion', 'signatureDomain'];
  if (JSON.stringify(Object.keys(delegation).sort()) !== JSON.stringify(keys)) {
    throw new Error('broker approval signer delegation key set is invalid');
  }
  if (!same(bytes, Buffer.from(`${JSON.stringify(canonicalValue(delegation))}\n`, 'utf8'))) {
    throw new Error('broker approval signer delegation is not canonical JSON');
  }
  if (delegation.schemaVersion !== 1 || delegation.kind !== 'desktop-tools-broker-approval-signer-delegation'
    || delegation.algorithm !== 'Ed25519' || delegation.signatureDomain !== 'desktop-tools-broker-approval-v1'
    || delegation.product !== 'desktop-tools' || delegation.releaseId !== releaseId || delegation.channel !== 'stable'
    || !id.safeParse(delegation.keyId).success || !sha256.safeParse(delegation.delegationDigest).success
    || typeof delegation.maximumApprovalLifetimeSeconds !== 'number' || !Number.isSafeInteger(delegation.maximumApprovalLifetimeSeconds)
    || delegation.maximumApprovalLifetimeSeconds < 1 || delegation.maximumApprovalLifetimeSeconds > 1_800
    || typeof delegation.revocationEpoch !== 'number' || !Number.isSafeInteger(delegation.revocationEpoch) || delegation.revocationEpoch < minimumRevocationEpoch) {
    throw new Error('broker approval signer delegation identity or policy is invalid');
  }
  const notBefore = typeof delegation.notBefore === 'string' ? Date.parse(delegation.notBefore) : NaN;
  const notAfter = typeof delegation.notAfter === 'string' ? Date.parse(delegation.notAfter) : NaN;
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)
    || new Date(notBefore).toISOString() !== delegation.notBefore || new Date(notAfter).toISOString() !== delegation.notAfter
    || notBefore > createdAt * 1_000 || notAfter < expiresAt * 1_000 || notBefore >= notAfter) {
    throw new Error('broker approval signer delegation does not contain the release validity window');
  }
  let publicKey;
  try {
    const encoded = delegation.publicKeySpki;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length < 32 || encoded.length > 512) throw new Error();
    const der = Buffer.from(encoded, 'base64url');
    if (der.toString('base64url') !== encoded) throw new Error();
    publicKey = createPublicKey({ key: der, type: 'spki', format: 'der' });
    if (publicKey.asymmetricKeyType !== 'ed25519'
      || !same(publicKey.export({ type: 'spki', format: 'der' }), der)) throw new Error();
  } catch { throw new Error('broker approval signer delegation SPKI is not an exact Ed25519 public key'); }
  const { delegationDigest, ...projection } = delegation;
  if (delegationDigest !== semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', projection)) {
    throw new Error('broker approval signer delegation digest is invalid');
  }
  return delegation;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
const record = value => isRecord(value) ? value : undefined;
/** @param {unknown} value @returns {unknown[]} */
function list(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('release metadata collection must be an array');
  return value;
}

/** @param {Uint8Array} bytes @param {string} label */
function parseJsonObject(bytes, label) {
  /** @type {unknown} */
  let value;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error(`${label} is not valid JSON`); }
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

/** @param {ReadonlyMap<string, Uint8Array>} files @param {string} name */
function releaseFile(files, name) {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`Desktop Tools release object is missing: ${name}`);
  return bytes;
}

/** @param {unknown} items @param {string} label @param {ReadonlyMap<string, Uint8Array>} files @param {readonly Artifact[]} artifacts */
function exactMetadataDigests(items, label, files, artifacts) {
  const actual = new Map();
  for (const entry of list(items)) {
    const item = record(entry);
    const name = item?.name;
    const value = label === 'SBOM'
      ? record(list(item?.hashes).find(hash => record(hash)?.alg === 'SHA-256'))?.content
      : record(item?.digest)?.sha256;
    if (typeof name !== 'string' || typeof value !== 'string' || actual.has(name)) throw new Error(`${label} payload bindings are ambiguous`);
    actual.set(name, value);
  }
  const expected = new Map(closurePayloadNames(artifacts).map(name => [name, digest(releaseFile(files, name))]));
  if (JSON.stringify([...actual.entries()].sort()) !== JSON.stringify([...expected.entries()].sort())) {
    throw new Error(`${label} does not bind the exact release payload closure`);
  }
}

/** @param {ReadonlyMap<string, Uint8Array>} files @param {string} releaseId @param {string} sourceCommit @param {string} opencodeVersion @param {readonly Artifact[]} artifacts @param {string} schemaVersion */
function validateClosureMetadata(files, releaseId, sourceCommit, opencodeVersion, artifacts, schemaVersion) {
  try { JSON.parse(Buffer.from(releaseFile(files, 'catalog.json')).toString('utf8')); } catch { throw new Error('catalog is not valid JSON'); }
  const lock = parseJsonObject(releaseFile(files, 'opencode.lock.json'), 'OpenCode lock');
  const sourceVerification = record(lock.sourceVerification);
  const artifactRecords = record(lock.artifacts);
  const expectedNames = { macos_x64: 'opencode-macos-x64.zip', macos_arm64: 'opencode-macos-arm64.zip',
    linux_x64: 'opencode-linux-x64.tar.gz', linux_arm64: 'opencode-linux-arm64.tar.gz' };
  if (lock.schemaVersion !== 1 || lock.name !== 'opencode' || lock.version !== opencodeVersion
    || typeof lock.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(lock.sourceCommit) || lock.license !== 'MIT'
    || sourceVerification?.tagCommit !== lock.sourceCommit
    || typeof sourceVerification?.gitHubVerified !== 'boolean'
    || sourceVerification?.assetDigestSource !== 'github-release-api'
    || !artifactRecords || Object.keys(artifactRecords).sort().join(',') !== Object.keys(expectedNames).sort().join(',')) {
    throw new Error('OpenCode lock identity is invalid');
  }
  const lockedDependencies = new Map();
  for (const [platform, filename] of Object.entries(expectedNames)) {
    const artifact = record(artifactRecords[platform]);
    const upstreamUrl = artifact?.upstreamUrl;
    let url;
    try { url = new URL(typeof upstreamUrl === 'string' ? upstreamUrl : ''); } catch { throw new Error(`OpenCode lock URL is invalid: ${platform}`); }
    if (typeof upstreamUrl !== 'string' || artifact?.releaseFilename !== filename || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.pathname.includes(`/v${opencodeVersion}/`) || artifact?.sha256 !== digest(releaseFile(files, filename))
      || artifact?.size !== releaseFile(files, filename).byteLength || artifact.size > 167_772_160) {
      throw new Error(`OpenCode lock binding mismatch: ${platform}`);
    }
    lockedDependencies.set(upstreamUrl, artifact.sha256);
  }
  const sbom = parseJsonObject(releaseFile(files, 'release.sbom.json'), 'release SBOM');
  const component = record(record(sbom.metadata)?.component);
  const properties = new Map(list(component?.properties).map(item => {
    const property = record(item);
    return [property?.name, property?.value];
  }));
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6' || sbom.version !== 1
    || component?.name !== 'desktop-tools-release' || component.version !== releaseId
    || properties.get('desktop.tools:source-commit') !== sourceCommit
    || properties.get('desktop.tools:opencode-version') !== opencodeVersion) throw new Error('SBOM identity or release pins are invalid');
  exactMetadataDigests(sbom.components, 'SBOM', files, artifacts);

  const provenance = parseJsonObject(releaseFile(files, 'release.provenance.json'), 'release provenance');
  const definition = record(record(provenance.predicate)?.buildDefinition);
  const parameters = record(definition?.externalParameters);
  if (provenance._type !== 'https://in-toto.io/Statement/v1' || provenance.predicateType !== 'https://slsa.dev/provenance/v1'
    || parameters?.releaseId !== releaseId || parameters?.sourceCommit !== sourceCommit
    || parameters?.opencodeVersion !== opencodeVersion) throw new Error('provenance identity or release pins are invalid');
  exactMetadataDigests(provenance.subject, 'provenance', files, artifacts);
  const resolvedDependencies = new Map();
  for (const item of list(definition?.resolvedDependencies)) {
    const dependency = record(item);
    const dependencyDigest = record(dependency?.digest)?.sha256;
    if (typeof dependency?.uri !== 'string' || typeof dependencyDigest !== 'string' || resolvedDependencies.has(dependency.uri)) {
      throw new Error('provenance resolved dependencies are ambiguous');
    }
    resolvedDependencies.set(dependency.uri, dependencyDigest);
  }
  for (const [uri, dependencyDigest] of lockedDependencies) {
    if (resolvedDependencies.get(uri) !== dependencyDigest) throw new Error('provenance does not bind the exact OpenCode upstream inputs');
    resolvedDependencies.delete(uri);
  }
  const expectedAdditionalDigests = schemaVersion !== '7' ? [
    digest(releaseFile(files, 'debian-bookworm-archive-keyring.gpg')), digest(releaseFile(files, 'debian-bookworm-inrelease')),
    digest(releaseFile(files, 'debian-bookworm-main-amd64-Packages.xz')), digest(releaseFile(files, 'tree_2.1.0-1_amd64.deb')),
    parameters?.debianTrustPolicySha256, parameters?.debianCompositionSha256
  ].sort() : [];
  if (JSON.stringify([...resolvedDependencies.values()].sort()) !== JSON.stringify(expectedAdditionalDigests)
    || expectedAdditionalDigests.some(value => !sha256.safeParse(value).success)) {
    throw new Error('provenance does not bind the exact upstream input closure');
  }

  const licenses = Buffer.from(releaseFile(files, 'THIRD_PARTY_LICENSES.txt')).toString('utf8');
  if (!Buffer.from(licenses, 'utf8').equals(Buffer.from(releaseFile(files, 'THIRD_PARTY_LICENSES.txt')))
    || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(licenses)
    || !/opencode/i.test(licenses) || !licenses.includes(opencodeVersion)) {
    throw new Error('third-party licenses do not identify the pinned OpenCode version');
  }

  if (schemaVersion === '10') {
    const spdxBytes = releaseFile(files, 'release.spdx.json');
    const spdx = parseJsonObject(spdxBytes, 'SPDX inventory');
    if (spdx['@context'] !== 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld' || !Array.isArray(spdx['@graph'])) {
      throw new Error('SPDX 3.0.1 envelope is invalid');
    }
    const graph = list(spdx['@graph']).flatMap(element => isRecord(element) ? [element] : []);
    const document = graph.find(element => element.type === 'SpdxDocument');
    if (list(document?.profileConformance).join(',') !== 'core,software') throw new Error('SPDX profile conformance is invalid');
    const spdxFiles = new Map();
    for (const element of graph.filter(item => item.type === 'software_File')) {
      const hashes = list(element.verifiedUsing).map(record).filter(item => item?.type === 'Hash' && item.algorithm === 'sha256');
      const hash = sha256.safeParse(hashes[0]?.hashValue);
      if (typeof element.name !== 'string' || hashes.length !== 1 || !hash.success
        || spdxFiles.has(element.name)) throw new Error('SPDX file evidence is ambiguous');
      spdxFiles.set(element.name, hash.data);
    }
    const expectedClosure = new Map(closurePayloadNames(artifacts).map(name => [name, digest(releaseFile(files, name))]));
    if (JSON.stringify([...spdxFiles.entries()].sort()) !== JSON.stringify([...expectedClosure.entries()].sort())) {
      throw new Error('SPDX inventory does not bind the exact release payload closure');
    }
    const exploitability = parseJsonObject(releaseFile(files, 'release.exploitability.json'), 'release exploitability statement');
    const closure = Object.fromEntries([...expectedClosure.entries()].sort());
    if (exploitability.schemaVersion !== 1 || exploitability.kind !== 'desktop-tools-release-exploitability'
      || exploitability.releaseId !== releaseId || record(exploitability.spdx)?.specVersion !== '3.0.1'
      || record(exploitability.spdx)?.sha256 !== digest(spdxBytes)
      || JSON.stringify(record(exploitability.releaseClosure)?.artifacts) !== JSON.stringify(closure)
      || record(exploitability.releaseClosure)?.sha256 !== digest(Buffer.from(`${JSON.stringify(closure)}\n`))
      || !Array.isArray(exploitability.assessments)) {
      throw new Error('release exploitability statement is invalid or not digest-bound');
    }
  }
}

/** @param {ReadonlyMap<string, Uint8Array>} files @param {unknown} expectedReleaseIdInput */
function inspectFiles(files, expectedReleaseIdInput, now = Math.floor(Date.now() / 1_000), requireCurrent = true) {
  const releaseId = id.parse(expectedReleaseIdInput);
  if (!(files instanceof Map) || !files.has('manifest')) throw new Error('Desktop Tools release object set does not match the exact allowlist');
  const { values: manifest, schemaVersion } = parseManifest(releaseFile(files, 'manifest'));
  const artifacts = artifactsForSchema(schemaVersion);
  const releaseFiles = filesForSchema(schemaVersion);
  if (files.size !== releaseFiles.length || releaseFiles.some(name => !files.has(name))) {
    throw new Error('Desktop Tools release object set does not match the exact allowlist');
  }
  if (manifest.get('product_id') !== 'desktop-tools' || manifest.get('release_id') !== releaseId) {
    throw new Error('Desktop Tools release identity mismatch');
  }
  const sourceCommit = manifest.get('source_commit');
  if (sourceCommit === undefined || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('source commit is invalid');
  const createdAt = positive.parse(manifest.get('created_at'));
  const expiresAt = positive.parse(manifest.get('expires_at'));
  if (!Number.isSafeInteger(now) || createdAt > now + 300 || (requireCurrent && expiresAt <= now)
    || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new Error('release validity window is not current and bounded');
  }
  if (manifest.get('engine_node_min') !== '22' || !/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest.get('runtime_node_version') ?? '')) {
    throw new Error('runtime policy is invalid');
  }
  const opencodeVersion = manifest.get('opencode_version');
  if (!/^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(opencodeVersion ?? '') || opencodeVersion === undefined) {
    throw new Error('OpenCode version pin is invalid');
  }
  for (const [prefix, filename, maximum] of artifacts) {
    const bytes = releaseFile(files, filename);
    const size = positive.parse(manifest.get(`${prefix}_size`));
    if (size !== bytes.byteLength || size > maximum || sha256.parse(manifest.get(`${prefix}_sha256`)) !== digest(bytes)) {
      throw new Error(`artifact binding mismatch: ${filename}`);
    }
    if (manifest.get(`${prefix}_url`) !== releaseObjectUrl('desktop-tools', releaseId, filename)) {
      throw new Error(`URL binding mismatch: ${filename}`);
    }
  }
  const minimumRevocationEpoch = ['9', '10'].includes(schemaVersion)
    ? nonnegative.parse(manifest.get('broker_approval_minimum_revocation_epoch')) : null;
  const brokerApprovalDelegation = minimumRevocationEpoch !== null
    ? validateBrokerApprovalDelegation(releaseFile(files, 'broker-approval-signer-delegation.json'), {
      releaseId, createdAt, expiresAt, minimumRevocationEpoch
    }) : null;
  validateClosureMetadata(files, releaseId, sourceCommit, opencodeVersion, artifacts, schemaVersion);
  return Object.freeze({ product: policy.product, releaseId, signerId: id.parse(manifest.get('key_id')), opencodeVersion,
    schemaVersion: Number(schemaVersion), releaseFiles, sourceCommit, createdAt, expiresAt,
    manifestSha256: digest(releaseFile(files, 'manifest')), minimumRevocationEpoch, brokerApprovalDelegation, files });
}

/** @param {string} directoryInput @param {unknown} expectedReleaseId @param {number} [now] */
export async function inspectDesktopReleaseDirectory(directoryInput, expectedReleaseId, now) {
  const directory = resolve(directoryInput);
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('release path is not a real directory');
  const names = (await readdir(directory)).sort();
  const releaseFiles = JSON.stringify(names) === JSON.stringify(DESKTOP_RELEASE_FILES) ? DESKTOP_RELEASE_FILES
    : JSON.stringify(names) === JSON.stringify(DESKTOP_RELEASE_V8_FILES) ? DESKTOP_RELEASE_V8_FILES
    : JSON.stringify(names) === JSON.stringify(DESKTOP_RELEASE_V9_FILES) ? DESKTOP_RELEASE_V9_FILES
    : JSON.stringify(names) === JSON.stringify(DESKTOP_RELEASE_V10_FILES) ? DESKTOP_RELEASE_V10_FILES : null;
  if (!releaseFiles) throw new Error('release directory does not match the exact allowlist');
  const files = new Map();
  for (const name of releaseFiles) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1) throw new Error(`unsafe release artifact: ${name}`);
    files.set(name, await readFile(path));
  }
  return inspectFiles(files, expectedReleaseId, now);
}

/** @param {{ directory: string, expectedReleaseId: string, storage: DesktopStorage, verifySignature: VerifyManifest, now?: number }} input */
export async function publishDesktopRelease({ directory, expectedReleaseId, storage, verifySignature, now }) {
  if (typeof storage?.create !== 'function' || typeof storage?.read !== 'function' || typeof verifySignature !== 'function') throw new Error('publication dependencies are invalid');
  const release = await inspectDesktopReleaseDirectory(directory, expectedReleaseId, now);
  await verifySignature({ manifest: releaseFile(release.files, 'manifest'), signature: releaseFile(release.files, 'manifest.sig'),
    signerId: release.signerId, namespace: policy.signatureNamespace });
  const outcomes = [];
  for (const name of release.releaseFiles.filter(name => name !== 'manifest')) {
    const key = `desktop-tools/bootstrap/${release.releaseId}/${name}`;
    const bytes = releaseFile(release.files, name);
    const created = await storage.create(key, bytes, { sha256: digest(bytes) });
    const stored = await storage.read(key);
    if (!stored?.bytes || !same(stored.bytes, bytes)) throw new Error(`immutable read-back mismatch: ${name}`);
    outcomes.push({ name, outcome: created ? 'created' : 'already-present' });
  }
  const manifestKey = `desktop-tools/bootstrap/${release.releaseId}/manifest`;
  const manifest = releaseFile(release.files, 'manifest');
  const created = await storage.create(manifestKey, manifest, { sha256: release.manifestSha256 });
  const stored = await storage.read(manifestKey);
  if (!stored?.bytes || !same(stored.bytes, manifest)) throw new Error('immutable read-back mismatch: manifest');
  outcomes.push({ name: 'manifest', outcome: created ? 'created' : 'already-present' });
  return Object.freeze({ schemaVersion: 1, product: policy.product, releaseId: release.releaseId,
    signerId: release.signerId, manifestSha256: release.manifestSha256, outcomes });
}

/** @param {{ expectedReleaseId: string, storage: ReadStorage, verifySignature: VerifyManifest, now?: number, requireCurrent?: boolean }} input */
export async function inspectPublishedDesktopRelease({ expectedReleaseId, storage, verifySignature, now, requireCurrent = true }) {
  if (typeof storage?.read !== 'function' || typeof verifySignature !== 'function') throw new Error('inspection dependencies are invalid');
  const releaseId = id.parse(expectedReleaseId);
  const files = new Map();
  const manifestStored = await storage.read(`desktop-tools/bootstrap/${releaseId}/manifest`);
  if (!manifestStored?.bytes) throw new Error('published Desktop Tools release object is missing: manifest');
  const manifest = Buffer.from(manifestStored.bytes);
  const releaseFiles = filesForSchema(parseManifest(manifest).schemaVersion);
  files.set('manifest', manifest);
  for (const name of releaseFiles.filter(name => name !== 'manifest')) {
    const stored = await storage.read(`desktop-tools/bootstrap/${releaseId}/${name}`);
    if (!stored?.bytes) throw new Error(`published Desktop Tools release object is missing: ${name}`);
    files.set(name, Buffer.from(stored.bytes));
  }
  const release = inspectFiles(files, releaseId, now, requireCurrent);
  await verifySignature({ manifest: releaseFile(files, 'manifest'), signature: releaseFile(files, 'manifest.sig'),
    signerId: release.signerId, namespace: policy.signatureNamespace });
  return release;
}

/** @param {{ channel: string, channelStorage: ReadStorage, releaseStorage: ReadStorage, verifySignature: VerifyManifest, now?: number, renewalWindowSeconds?: number }} input */
export async function inspectActiveDesktopReleaseFreshness({
  channel, channelStorage, releaseStorage, verifySignature,
  now = Math.floor(Date.now() / 1_000), renewalWindowSeconds = 259_200,
}) {
  if (typeof channelStorage?.read !== 'function' || typeof releaseStorage?.read !== 'function'
    || typeof verifySignature !== 'function') throw new Error('Desktop Tools freshness dependencies are invalid');
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('Desktop Tools freshness clock is invalid');
  if (!Number.isSafeInteger(renewalWindowSeconds) || renewalWindowSeconds < 3_600 || renewalWindowSeconds > 604_800) {
    throw new Error('Desktop Tools renewal window is outside policy');
  }
  const channelId = id.parse(channel);
  const stored = await channelStorage.read(`desktop-tools/channels/${channelId}.json`);
  if (!stored?.bytes || typeof stored.etag !== 'string') throw new Error('active Desktop Tools channel is missing');
  const bytes = Buffer.from(stored.bytes);
  const pointer = DesktopPointer.parse(JSON.parse(bytes.toString('utf8')));
  if (!same(bytes, canonical(pointer)) || pointer.channel !== channelId) {
    throw new Error('active Desktop Tools pointer is not canonical for its channel');
  }
  const release = await inspectPublishedDesktopRelease({ expectedReleaseId: pointer.releaseId,
    storage: releaseStorage, verifySignature, now, requireCurrent: false });
  if (release.manifestSha256 !== pointer.manifestSha256) throw new Error('active Desktop Tools manifest digest mismatch');
  if (release.signerId !== pointer.signerId) throw new Error('active Desktop Tools signer identity mismatch');
  const remainingSeconds = release.expiresAt - now;
  const status = remainingSeconds <= 0 ? 'expired' : remainingSeconds <= renewalWindowSeconds ? 'renewal-required' : 'healthy';
  return Object.freeze({ schemaVersion: 1, product: 'desktop-tools', status, channel: channelId,
    generation: pointer.generation, releaseId: release.releaseId, sourceCommit: release.sourceCommit,
    signerId: release.signerId, manifestSha256: release.manifestSha256,
    createdAt: release.createdAt, expiresAt: release.expiresAt, remainingSeconds });
}

/** @param {DesktopStorage} storage @param {string} key @param {unknown} value */
async function createCanonical(storage, key, value) {
  const bytes = canonical(value);
  const created = await storage.create(key, bytes, { sha256: digest(bytes) });
  const stored = await storage.read(key);
  if (!stored?.bytes || !same(stored.bytes, bytes)) throw new Error(`canonical read-back mismatch: ${key}`);
  return created;
}

/**
 * @param {{
 *   channel: string, release: Pick<Awaited<ReturnType<typeof inspectPublishedDesktopRelease>>, 'product' | 'releaseId' | 'signerId' | 'manifestSha256' | 'expiresAt'>,
 *   storage: DesktopStorage & Pick<ReleaseStorage, 'compareAndSwap'>, expectedEtag?: string,
 *   activationId: string, activatedAt: string, kind?: 'promote' | 'rollback', rollbackOfActivationId?: string | null,
 *   now?: number, minimumPromotionRemainingSeconds?: number, minimumRollbackRemainingSeconds?: number,
 *   promotionEvidence?: unknown, verifyPromotionSignature?: VerifyPromotion | null,
 * }} input
 */
export async function activateDesktopRelease({
  channel, release, storage, expectedEtag, activationId, activatedAt, kind = 'promote',
  rollbackOfActivationId = null, now = Math.floor(Date.now() / 1_000),
  minimumPromotionRemainingSeconds = 345_600, minimumRollbackRemainingSeconds = 3_600,
  promotionEvidence = null, verifyPromotionSignature = null
}) {
  if (typeof storage?.read !== 'function' || typeof storage?.create !== 'function' || typeof storage?.compareAndSwap !== 'function') {
    throw new Error('activation storage adapter is invalid');
  }
  const channelId = id.parse(channel);
  if (release?.product !== 'desktop-tools') throw new Error('activation release product mismatch');
  const expiresAt = z.number().int().positive().safe().parse(release.expiresAt);
  const minimum = kind === 'rollback' ? minimumRollbackRemainingSeconds : minimumPromotionRemainingSeconds;
  if (![now, minimum].every(value => Number.isSafeInteger(value) && value > 0) || minimum < 3_600 || minimum > 604_800) {
    throw new Error('activation freshness policy is invalid');
  }
  if (expiresAt - now < minimum) throw new Error('release has insufficient remaining validity for activation');
  let admittedPromotionEvidence = null;
  if (kind === 'promote' && promotionEvidence !== null) {
    try {
      admittedPromotionEvidence = await admitDesktopPromotionEvidence({ evidence: promotionEvidence, release, targetCohort: channel,
        now: now * 1_000, verifySignature: verifyPromotionSignature });
    } catch (error) {
      if (isRecord(error) && error.promotionSuspended === true && isRecord(error.evidence)) {
        await createCanonical(storage, `desktop-tools/promotion-suspensions/${release.releaseId}/${channel}.json`, {
          schemaVersion: 1, product: 'desktop-tools', releaseId: release.releaseId, cohort: channel,
          evidenceDigest: error.evidenceDigest, observedAt: error.evidence.observedAt,
          reason: 'failed-signed-health-evidence'
        });
      }
      throw error;
    }
  }
  const channelKey = `desktop-tools/channels/${channelId}.json`;
  const current = await storage.read(channelKey);
  if ((current?.etag ?? undefined) !== expectedEtag) throw new Error('activation expected etag is stale');
  let previous = null;
  let generation = 1;
  let currentPointer = null;
  if (current) {
    currentPointer = DesktopPointer.parse(JSON.parse(Buffer.from(current.bytes).toString('utf8')));
    if (!same(current.bytes, canonical(currentPointer)) || currentPointer.channel !== channelId) throw new Error('current pointer is not canonical for this channel');
    generation = currentPointer.generation + 1;
    previous = { generation: currentPointer.generation, activationId: currentPointer.activationId,
      releaseId: currentPointer.releaseId, manifestSha256: currentPointer.manifestSha256, etag: current.etag };
  }
  if ((kind === 'rollback') !== (rollbackOfActivationId !== null)) throw new Error('rollback must identify the activation it reverses');
  if (kind === 'rollback') {
    if (!currentPointer?.previous || rollbackOfActivationId !== currentPointer.activationId
      || release.releaseId !== currentPointer.previous.releaseId
      || release.manifestSha256 !== currentPointer.previous.manifestSha256) {
      throw new Error('rollback target must be the exact prior Desktop Tools release');
    }
  }
  const pointer = DesktopPointer.parse({
    schemaVersion: 2, product: 'desktop-tools', channel: channelId, generation, kind,
    releaseId: release.releaseId, signerId: release.signerId, manifestSha256: release.manifestSha256,
    activatedAt, activationId, previous, rollbackOfActivationId,
    promotionEvidenceSha256: admittedPromotionEvidence?.signaturePayloadSha256 ?? null
  });
  const pointerBytes = canonical(pointer);
  const intentKey = `desktop-tools/activations/${channelId}/${pointer.activationId}.json`;
  const receiptKey = `desktop-tools/activation-receipts/${channelId}/${String(generation).padStart(12, '0')}-${pointer.activationId}.json`;
  await createCanonical(storage, intentKey, pointer);
  const result = await storage.compareAndSwap(channelKey, pointerBytes, expectedEtag);
  if (!result?.ok || typeof result.etag !== 'string') throw new Error('activation compare-and-swap failed');
  const committed = await storage.read(channelKey);
  if (!committed?.bytes || committed.etag !== result.etag || !same(committed.bytes, pointerBytes)) throw new Error('activation read-back mismatch');
  try {
    await createCanonical(storage, receiptKey, pointer);
    return Object.freeze({ schemaVersion: 2, status: 'activated', product: 'desktop-tools', pointer, etag: result.etag, intentKey, receiptKey });
  } catch {
    return Object.freeze({ schemaVersion: 2, status: 'activated_receipt_pending', product: 'desktop-tools', pointer, etag: result.etag, intentKey, receiptKey });
  }
}

/** @param {{ channel: string, activationId: string, storage: DesktopStorage }} input */
export async function reconcileDesktopActivationReceipt({ channel, activationId, storage }) {
  if (typeof storage?.read !== 'function' || typeof storage?.create !== 'function') throw new Error('reconciliation storage adapter is invalid');
  const channelId = id.parse(channel);
  const activationUuid = z.string().uuid().parse(activationId);
  const intentKey = `desktop-tools/activations/${channelId}/${activationUuid}.json`;
  const intentObject = await storage.read(intentKey);
  if (!intentObject?.bytes) throw new Error('Desktop Tools activation intent is missing');
  const intentBytes = Buffer.from(intentObject.bytes);
  const pointer = DesktopPointer.parse(JSON.parse(intentBytes.toString('utf8')));
  const expected = canonical(pointer);
  if (!same(intentBytes, expected) || pointer.channel !== channelId || pointer.activationId !== activationUuid) {
    throw new Error('Desktop Tools activation intent is not canonical for its identity');
  }
  const receiptKey = `desktop-tools/activation-receipts/${channelId}/${String(pointer.generation).padStart(12, '0')}-${activationUuid}.json`;
  const receipt = await storage.read(receiptKey);
  if (receipt) {
    if (!same(receipt.bytes, expected)) throw new Error('Desktop Tools activation receipt conflicts with its intent');
    return Object.freeze({ schemaVersion: 2, product: 'desktop-tools', status: 'already-present', intentKey, receiptKey });
  }
  const current = await storage.read(`desktop-tools/channels/${channelId}.json`);
  if (!current?.bytes || !same(current.bytes, expected)) throw new Error('current Desktop Tools channel does not prove this activation');
  await createCanonical(storage, receiptKey, pointer);
  return Object.freeze({ schemaVersion: 2, product: 'desktop-tools', status: 'reconciled', intentKey, receiptKey });
}
