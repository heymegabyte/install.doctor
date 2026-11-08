import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { releaseObjectUrl, releasePolicy } from '../src/release-policy.ts';

const policy = releasePolicy('desktop-tools');
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.string().regex(/^[1-9][0-9]*$/).transform(Number).refine(Number.isSafeInteger);
const ARTIFACTS = Object.freeze([
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
export const DESKTOP_RELEASE_FILES = Object.freeze([
  ...ARTIFACTS.map(([, filename]) => filename), 'manifest.sig', 'manifest'
].sort());
const REQUIRED_KEYS = Object.freeze([
  'schema_version', 'product_id', 'release_id', 'source_commit', 'created_at', 'expires_at', 'key_id',
  ...ARTIFACTS.flatMap(([prefix]) => [`${prefix}_url`, `${prefix}_sha256`, `${prefix}_size`]),
  'engine_node_min', 'runtime_node_version', 'opencode_version'
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
const CLOSURE_PAYLOAD_NAMES = Object.freeze(ARTIFACTS.map(([, name]) => name)
  .filter(name => !['release.sbom.json', 'release.provenance.json', 'THIRD_PARTY_LICENSES.txt'].includes(name)));
const DesktopPointer = z.strictObject({
  schemaVersion: z.literal(2), product: z.literal('desktop-tools'), channel: id,
  generation: z.number().int().positive().safe(), kind: z.enum(['promote', 'rollback']),
  releaseId: id, signerId: id, manifestSha256: sha256, activatedAt: z.string().datetime({ offset: true }),
  activationId: z.string().uuid(),
  previous: z.nullable(z.strictObject({
    generation: z.number().int().positive().safe(), activationId: z.string().uuid(), releaseId: id,
    manifestSha256: sha256, etag: z.string().min(1).max(512)
  })),
  rollbackOfActivationId: z.string().uuid().nullable()
});

function parseManifest(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16_384) throw new Error('manifest size is outside policy');
  const values = new Map();
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 1 || !/^[a-z0-9_]+$/.test(key) || !value || values.has(key)) throw new Error('manifest contains malformed or duplicate data');
    values.set(key, value);
  }
  if (JSON.stringify([...values.keys()].sort()) !== JSON.stringify([...REQUIRED_KEYS].sort())) throw new Error('manifest key set does not match Desktop Tools schema v7');
  return values;
}

function parseJsonObject(bytes, label) {
  let value;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error(`${label} is not valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function exactMetadataDigests(items, label, files) {
  const actual = new Map();
  for (const item of items ?? []) {
    const name = item?.name;
    const value = label === 'SBOM'
      ? item?.hashes?.find(hash => hash?.alg === 'SHA-256')?.content
      : item?.digest?.sha256;
    if (typeof name !== 'string' || typeof value !== 'string' || actual.has(name)) throw new Error(`${label} payload bindings are ambiguous`);
    actual.set(name, value);
  }
  const expected = new Map(CLOSURE_PAYLOAD_NAMES.map(name => [name, digest(files.get(name))]));
  if (JSON.stringify([...actual.entries()].sort()) !== JSON.stringify([...expected.entries()].sort())) {
    throw new Error(`${label} does not bind the exact release payload closure`);
  }
}

function validateClosureMetadata(files, releaseId, sourceCommit, opencodeVersion) {
  try { JSON.parse(Buffer.from(files.get('catalog.json')).toString('utf8')); } catch { throw new Error('catalog is not valid JSON'); }
  const lock = parseJsonObject(files.get('opencode.lock.json'), 'OpenCode lock');
  const expectedNames = { macos_x64: 'opencode-macos-x64.zip', macos_arm64: 'opencode-macos-arm64.zip',
    linux_x64: 'opencode-linux-x64.tar.gz', linux_arm64: 'opencode-linux-arm64.tar.gz' };
  if (lock.schemaVersion !== 1 || lock.name !== 'opencode' || lock.version !== opencodeVersion
    || !/^[a-f0-9]{40}$/.test(lock.sourceCommit ?? '') || lock.license !== 'MIT'
    || lock.sourceVerification?.tagCommit !== lock.sourceCommit
    || typeof lock.sourceVerification?.gitHubVerified !== 'boolean'
    || lock.sourceVerification?.assetDigestSource !== 'github-release-api'
    || !lock.artifacts || Object.keys(lock.artifacts).sort().join(',') !== Object.keys(expectedNames).sort().join(',')) {
    throw new Error('OpenCode lock identity is invalid');
  }
  const lockedDependencies = new Map();
  for (const [platform, filename] of Object.entries(expectedNames)) {
    const artifact = lock.artifacts[platform];
    let url;
    try { url = new URL(artifact?.upstreamUrl); } catch { throw new Error(`OpenCode lock URL is invalid: ${platform}`); }
    if (artifact?.releaseFilename !== filename || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.pathname.includes(`/v${opencodeVersion}/`) || artifact?.sha256 !== digest(files.get(filename))
      || artifact?.size !== files.get(filename).byteLength || artifact.size > 167_772_160) {
      throw new Error(`OpenCode lock binding mismatch: ${platform}`);
    }
    lockedDependencies.set(artifact.upstreamUrl, artifact.sha256);
  }
  const sbom = parseJsonObject(files.get('release.sbom.json'), 'release SBOM');
  const properties = new Map((sbom.metadata?.component?.properties ?? []).map(item => [item?.name, item?.value]));
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6' || sbom.version !== 1
    || sbom.metadata?.component?.name !== 'desktop-tools-release' || sbom.metadata.component.version !== releaseId
    || properties.get('desktop.tools:source-commit') !== sourceCommit
    || properties.get('desktop.tools:opencode-version') !== opencodeVersion) throw new Error('SBOM identity or release pins are invalid');
  exactMetadataDigests(sbom.components, 'SBOM', files);

  const provenance = parseJsonObject(files.get('release.provenance.json'), 'release provenance');
  const parameters = provenance.predicate?.buildDefinition?.externalParameters;
  if (provenance._type !== 'https://in-toto.io/Statement/v1' || provenance.predicateType !== 'https://slsa.dev/provenance/v1'
    || parameters?.releaseId !== releaseId || parameters?.sourceCommit !== sourceCommit
    || parameters?.opencodeVersion !== opencodeVersion) throw new Error('provenance identity or release pins are invalid');
  exactMetadataDigests(provenance.subject, 'provenance', files);
  const resolvedDependencies = new Map();
  for (const dependency of provenance.predicate?.buildDefinition?.resolvedDependencies ?? []) {
    if (typeof dependency?.uri !== 'string' || typeof dependency?.digest?.sha256 !== 'string' || resolvedDependencies.has(dependency.uri)) {
      throw new Error('provenance resolved dependencies are ambiguous');
    }
    resolvedDependencies.set(dependency.uri, dependency.digest.sha256);
  }
  if (JSON.stringify([...resolvedDependencies.entries()].sort()) !== JSON.stringify([...lockedDependencies.entries()].sort())) {
    throw new Error('provenance does not bind the exact OpenCode upstream inputs');
  }

  const licenses = Buffer.from(files.get('THIRD_PARTY_LICENSES.txt')).toString('utf8');
  if (!Buffer.from(licenses, 'utf8').equals(Buffer.from(files.get('THIRD_PARTY_LICENSES.txt')))
    || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(licenses)
    || !/opencode/i.test(licenses) || !licenses.includes(opencodeVersion)) {
    throw new Error('third-party licenses do not identify the pinned OpenCode version');
  }
}

function inspectFiles(files, expectedReleaseIdInput, now = Math.floor(Date.now() / 1_000)) {
  const releaseId = id.parse(expectedReleaseIdInput);
  if (!(files instanceof Map) || files.size !== DESKTOP_RELEASE_FILES.length || DESKTOP_RELEASE_FILES.some(name => !files.has(name))) {
    throw new Error('Desktop Tools release object set does not match the exact allowlist');
  }
  const manifest = parseManifest(files.get('manifest'));
  if (manifest.get('schema_version') !== '7' || manifest.get('product_id') !== 'desktop-tools' || manifest.get('release_id') !== releaseId) {
    throw new Error('Desktop Tools release identity mismatch');
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.get('source_commit') ?? '')) throw new Error('source commit is invalid');
  const createdAt = positive.parse(manifest.get('created_at'));
  const expiresAt = positive.parse(manifest.get('expires_at'));
  if (!Number.isSafeInteger(now) || createdAt > now + 300 || expiresAt <= now || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new Error('release validity window is not current and bounded');
  }
  if (manifest.get('engine_node_min') !== '22' || !/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest.get('runtime_node_version') ?? '')) {
    throw new Error('runtime policy is invalid');
  }
  const opencodeVersion = manifest.get('opencode_version');
  if (!/^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(opencodeVersion ?? '')) {
    throw new Error('OpenCode version pin is invalid');
  }
  for (const [prefix, filename, maximum] of ARTIFACTS) {
    const bytes = files.get(filename);
    const size = positive.parse(manifest.get(`${prefix}_size`));
    if (size !== bytes.byteLength || size > maximum || sha256.parse(manifest.get(`${prefix}_sha256`)) !== digest(bytes)) {
      throw new Error(`artifact binding mismatch: ${filename}`);
    }
    if (manifest.get(`${prefix}_url`) !== releaseObjectUrl('desktop-tools', releaseId, filename)) {
      throw new Error(`URL binding mismatch: ${filename}`);
    }
  }
  validateClosureMetadata(files, releaseId, manifest.get('source_commit'), opencodeVersion);
  return Object.freeze({ product: policy.product, releaseId, signerId: id.parse(manifest.get('key_id')), opencodeVersion,
    sourceCommit: manifest.get('source_commit'), createdAt, expiresAt, manifestSha256: digest(files.get('manifest')), files });
}

export async function inspectDesktopReleaseDirectory(directoryInput, expectedReleaseId, now) {
  const directory = resolve(directoryInput);
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('release path is not a real directory');
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(DESKTOP_RELEASE_FILES)) throw new Error('release directory does not match the exact allowlist');
  const files = new Map();
  for (const name of DESKTOP_RELEASE_FILES) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1) throw new Error(`unsafe release artifact: ${name}`);
    files.set(name, await readFile(path));
  }
  return inspectFiles(files, expectedReleaseId, now);
}

export async function publishDesktopRelease({ directory, expectedReleaseId, storage, verifySignature, now }) {
  if (typeof storage?.create !== 'function' || typeof storage?.read !== 'function' || typeof verifySignature !== 'function') throw new Error('publication dependencies are invalid');
  const release = await inspectDesktopReleaseDirectory(directory, expectedReleaseId, now);
  await verifySignature({ manifest: release.files.get('manifest'), signature: release.files.get('manifest.sig'),
    signerId: release.signerId, namespace: policy.signatureNamespace });
  const outcomes = [];
  for (const name of DESKTOP_RELEASE_FILES.filter(name => name !== 'manifest')) {
    const key = `desktop-tools/bootstrap/${release.releaseId}/${name}`;
    const bytes = release.files.get(name);
    const created = await storage.create(key, bytes, { sha256: digest(bytes) });
    const stored = await storage.read(key);
    if (!stored?.bytes || !same(stored.bytes, bytes)) throw new Error(`immutable read-back mismatch: ${name}`);
    outcomes.push({ name, outcome: created ? 'created' : 'already-present' });
  }
  const manifestKey = `desktop-tools/bootstrap/${release.releaseId}/manifest`;
  const manifest = release.files.get('manifest');
  const created = await storage.create(manifestKey, manifest, { sha256: release.manifestSha256 });
  const stored = await storage.read(manifestKey);
  if (!stored?.bytes || !same(stored.bytes, manifest)) throw new Error('immutable read-back mismatch: manifest');
  outcomes.push({ name: 'manifest', outcome: created ? 'created' : 'already-present' });
  return Object.freeze({ schemaVersion: 1, product: policy.product, releaseId: release.releaseId,
    signerId: release.signerId, manifestSha256: release.manifestSha256, outcomes });
}

export async function inspectPublishedDesktopRelease({ expectedReleaseId, storage, verifySignature, now }) {
  if (typeof storage?.read !== 'function' || typeof verifySignature !== 'function') throw new Error('inspection dependencies are invalid');
  const releaseId = id.parse(expectedReleaseId);
  const files = new Map();
  for (const name of DESKTOP_RELEASE_FILES) {
    const stored = await storage.read(`desktop-tools/bootstrap/${releaseId}/${name}`);
    if (!stored?.bytes) throw new Error(`published Desktop Tools release object is missing: ${name}`);
    files.set(name, Buffer.from(stored.bytes));
  }
  const release = inspectFiles(files, releaseId, now);
  await verifySignature({ manifest: files.get('manifest'), signature: files.get('manifest.sig'),
    signerId: release.signerId, namespace: policy.signatureNamespace });
  return release;
}

async function createCanonical(storage, key, value) {
  const bytes = canonical(value);
  const created = await storage.create(key, bytes, { sha256: digest(bytes) });
  const stored = await storage.read(key);
  if (!stored?.bytes || !same(stored.bytes, bytes)) throw new Error(`canonical read-back mismatch: ${key}`);
  return created;
}

export async function activateDesktopRelease({
  channel, release, storage, expectedEtag, activationId, activatedAt, kind = 'promote',
  rollbackOfActivationId = null, now = Math.floor(Date.now() / 1_000),
  minimumPromotionRemainingSeconds = 345_600, minimumRollbackRemainingSeconds = 3_600
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
    activatedAt, activationId, previous, rollbackOfActivationId
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
