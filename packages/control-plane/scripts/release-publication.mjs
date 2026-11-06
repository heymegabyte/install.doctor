import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const positiveInteger = z.string().regex(/^[1-9][0-9]*$/).transform(Number)
  .refine(Number.isSafeInteger, 'integer is outside the safe range');
const RELEASE_FILES = Object.freeze([
  'catalog.json', 'install-doctor-engine.mjs', 'manifest.sig',
  'node-linux-arm64.tar.gz', 'node-linux-x64.tar.gz',
  'node-macos-arm64.tar.gz', 'node-macos-x64.tar.gz',
  'provision.sh', 'start', 'manifest',
]);
const ARTIFACTS = Object.freeze([
  ['artifact', 'provision.sh', 8_388_608],
  ['engine', 'install-doctor-engine.mjs', 8_388_608],
  ['catalog', 'catalog.json', 8_388_608],
  ['launcher', 'start', 8_388_608],
  ['runtime_macos_x64', 'node-macos-x64.tar.gz', 100_663_296],
  ['runtime_macos_arm64', 'node-macos-arm64.tar.gz', 100_663_296],
  ['runtime_linux_x64', 'node-linux-x64.tar.gz', 100_663_296],
  ['runtime_linux_arm64', 'node-linux-arm64.tar.gz', 100_663_296],
]);
const RENEWAL_PAYLOADS = Object.freeze(ARTIFACTS.filter(([prefix]) => prefix !== 'launcher'));
const REQUIRED_MANIFEST_KEYS = Object.freeze([
  'schema_version', 'release_id', 'source_commit', 'created_at', 'expires_at', 'key_id',
  'artifact_url', 'artifact_sha256', 'artifact_size',
  'engine_url', 'engine_sha256', 'engine_size', 'engine_node_min', 'runtime_node_version',
  'catalog_url', 'catalog_sha256', 'catalog_size',
  'launcher_url', 'launcher_sha256', 'launcher_size',
  ...['macos_x64', 'macos_arm64', 'linux_x64', 'linux_arm64'].flatMap(platform =>
    [`runtime_${platform}_url`, `runtime_${platform}_sha256`, `runtime_${platform}_size`]),
]);

const ActivationPointer = z.strictObject({
  schemaVersion: z.literal(1), channel: id, generation: z.number().int().positive(),
  kind: z.enum(['promote', 'rollback']), releaseId: id, signerId: id,
  manifestSha256: sha256, activatedAt: z.string().datetime({ offset: true }),
  activationId: z.string().uuid(),
  previous: z.nullable(z.strictObject({
    generation: z.number().int().positive(), activationId: z.string().uuid(), releaseId: id,
    manifestSha256: sha256, etag: z.string().min(1).max(512),
  })),
  rollbackOfActivationId: z.string().uuid().nullable(),
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');

function parseManifest(bytes) {
  if (bytes.byteLength < 1 || bytes.byteLength > 16_384) throw new Error('manifest size is outside policy');
  const values = new Map();
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('manifest contains a malformed line');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[a-z0-9_]+$/.test(key) || values.has(key)) throw new Error('manifest contains an invalid or duplicate key');
    values.set(key, value);
  }
  const keys = [...values.keys()].sort();
  if (JSON.stringify(keys) !== JSON.stringify([...REQUIRED_MANIFEST_KEYS].sort())) {
    throw new Error('manifest key set does not match schema v5');
  }
  return values;
}

function inspectReleaseFiles(files, expectedReleaseIdInput, options = {}) {
  const expectedReleaseId = id.parse(expectedReleaseIdInput);
  if (!(files instanceof Map) || files.size !== RELEASE_FILES.length || RELEASE_FILES.some(name => !files.has(name))) {
    throw new Error('release object set does not match the exact file allowlist');
  }
  if (files.get('manifest.sig').byteLength > 8_192) throw new Error('manifest signature size is outside policy');
  const manifest = parseManifest(files.get('manifest'));
  if (manifest.get('schema_version') !== '5' || id.parse(manifest.get('release_id')) !== expectedReleaseId) throw new Error('manifest release identity mismatch');
  if (!/^[a-f0-9]{40}$/.test(manifest.get('source_commit') ?? '')) throw new Error('manifest source commit is invalid');
  id.parse(manifest.get('key_id'));
  const createdAt = positiveInteger.parse(manifest.get('created_at'));
  const expiresAt = positiveInteger.parse(manifest.get('expires_at'));
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('release inspection clock is invalid');
  if (createdAt > now + 300 || (options.requireCurrent !== false && expiresAt <= now) || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new Error('manifest validity window is not current and bounded');
  }
  if (manifest.get('engine_node_min') !== '22' || !/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest.get('runtime_node_version') ?? '')) {
    throw new Error('manifest runtime contract is invalid');
  }
  for (const [prefix, filename, maximum] of ARTIFACTS) {
    const bytes = files.get(filename);
    const size = positiveInteger.parse(manifest.get(`${prefix}_size`));
    if (size !== bytes.byteLength || size > maximum || sha256.parse(manifest.get(`${prefix}_sha256`)) !== digest(bytes)) {
      throw new Error(`manifest artifact binding mismatch: ${filename}`);
    }
    const url = new URL(manifest.get(`${prefix}_url`));
    if (url.origin !== 'https://app.install.doctor' || url.pathname !== `/releases/${expectedReleaseId}/${filename}` || url.search || url.hash) {
      throw new Error(`manifest URL binding mismatch: ${filename}`);
    }
  }
  return {
    expectedReleaseId, signerId: manifest.get('key_id'), manifestSha256: digest(files.get('manifest')),
    sourceCommit: manifest.get('source_commit'), createdAt, expiresAt, files,
  };
}

export async function inspectReleaseDirectory(directoryInput, expectedReleaseIdInput) {
  const directory = resolve(directoryInput);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('release path is not a real directory');
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...RELEASE_FILES].sort())) throw new Error('release directory does not match the exact file allowlist');
  const files = new Map();
  for (const name of RELEASE_FILES) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1) throw new Error(`unsafe release artifact: ${name}`);
    files.set(name, await readFile(path));
  }
  return { directory, ...inspectReleaseFiles(files, expectedReleaseIdInput) };
}

async function createAndVerify(storage, key, bytes, contentType) {
  const created = await storage.create(key, bytes, { contentType, sha256: digest(bytes) });
  const stored = await storage.read(key);
  if (!stored || !equal(stored.bytes, bytes)) throw new Error(`remote read-back mismatch: ${key}`);
  if (!created && !equal(stored.bytes, bytes)) throw new Error(`immutable object collision: ${key}`);
  return created ? 'created' : 'already-present';
}

export async function publishRelease({ directory, expectedReleaseId, storage, verifySignature }) {
  if (typeof storage?.create !== 'function' || typeof storage?.read !== 'function') throw new Error('publication storage adapter is invalid');
  if (typeof verifySignature !== 'function') throw new Error('signature verifier is required');
  const release = await inspectReleaseDirectory(directory, expectedReleaseId);
  await verifySignature({ manifest: release.files.get('manifest'), signature: release.files.get('manifest.sig'), signerId: release.signerId });
  const outcomes = [];
  const contentTypes = {
    'manifest.sig': 'application/octet-stream', 'provision.sh': 'text/x-shellscript; charset=utf-8',
    'start': 'text/x-shellscript; charset=utf-8',
    'install-doctor-engine.mjs': 'text/javascript; charset=utf-8',
    'catalog.json': 'application/json; charset=utf-8',
  };
  for (const name of RELEASE_FILES.filter(name => name !== 'manifest')) {
    const outcome = await createAndVerify(storage, `bootstrap/${release.expectedReleaseId}/${name}`, release.files.get(name), contentTypes[name] ?? 'application/gzip');
    outcomes.push({ name, outcome });
  }
  outcomes.push({ name: 'manifest', outcome: await createAndVerify(
    storage, `bootstrap/${release.expectedReleaseId}/manifest`, release.files.get('manifest'), 'application/vnd.install-doctor.release-manifest',
  ) });
  return Object.freeze({ schemaVersion: 1, releaseId: release.expectedReleaseId, signerId: release.signerId, manifestSha256: release.manifestSha256, outcomes });
}

export async function inspectPublishedRelease({ expectedReleaseId, storage, verifySignature, now = Math.floor(Date.now() / 1_000) }) {
  if (typeof storage?.read !== 'function' || typeof verifySignature !== 'function') throw new Error('published release inspection dependencies are invalid');
  const files = new Map();
  for (const name of RELEASE_FILES) {
    const stored = await storage.read(`bootstrap/${id.parse(expectedReleaseId)}/${name}`);
    if (!stored?.bytes) throw new Error(`published release object is missing: ${name}`);
    files.set(name, Buffer.from(stored.bytes));
  }
  const release = inspectReleaseFiles(files, expectedReleaseId, { now });
  await verifySignature({ manifest: files.get('manifest'), signature: files.get('manifest.sig'), signerId: release.signerId });
  return Object.freeze({
    schemaVersion: 1, releaseId: release.expectedReleaseId, signerId: release.signerId,
    manifestSha256: release.manifestSha256, sourceCommit: release.sourceCommit,
    createdAt: release.createdAt, expiresAt: release.expiresAt, files,
  });
}

async function readActiveRelease({ channel, channelStorage, releaseStorage, verifySignature, now }) {
  const channelId = id.parse(channel);
  const pointerObject = await channelStorage.read(`bootstrap/channels/${channelId}.json`);
  if (!pointerObject?.bytes) throw new Error('active release channel is missing');
  if (pointerObject.bytes.byteLength > 16_384) throw new Error('active release channel is oversized');
  const pointerBytes = Buffer.from(pointerObject.bytes);
  const pointer = ActivationPointer.parse(JSON.parse(pointerBytes.toString('utf8')));
  if (!equal(pointerBytes, canonical(pointer))) throw new Error('active release channel is not canonical');
  if (pointer.channel !== channelId) throw new Error('active release channel identity mismatch');
  const files = new Map();
  for (const name of RELEASE_FILES) {
    const stored = await releaseStorage.read(`bootstrap/${pointer.releaseId}/${name}`);
    if (!stored?.bytes) throw new Error(`published release object is missing: ${name}`);
    files.set(name, Buffer.from(stored.bytes));
  }
  const release = inspectReleaseFiles(files, pointer.releaseId, { now, requireCurrent: false });
  if (release.manifestSha256 !== pointer.manifestSha256) throw new Error('active release manifest digest mismatch');
  if (release.signerId !== pointer.signerId) throw new Error('active release signer identity mismatch');
  await verifySignature({ manifest: files.get('manifest'), signature: files.get('manifest.sig'), signerId: release.signerId });
  return Object.freeze({ channelId, pointer, pointerEtag: pointerObject.etag, release, files });
}

export async function inspectActiveReleaseFreshness({
  channel, channelStorage, releaseStorage, verifySignature,
  now = Math.floor(Date.now() / 1_000), renewalWindowSeconds = 259_200,
}) {
  if (typeof channelStorage?.read !== 'function' || typeof releaseStorage?.read !== 'function' || typeof verifySignature !== 'function') {
    throw new Error('active release inspection dependencies are invalid');
  }
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('release inspection clock is invalid');
  if (!Number.isSafeInteger(renewalWindowSeconds) || renewalWindowSeconds < 3_600 || renewalWindowSeconds > 604_800) {
    throw new Error('release renewal window is outside policy');
  }
  const { channelId, pointer, release } = await readActiveRelease({ channel, channelStorage, releaseStorage, verifySignature, now });
  const remainingSeconds = release.expiresAt - now;
  const status = remainingSeconds <= 0 ? 'expired' : remainingSeconds <= renewalWindowSeconds ? 'renewal-required' : 'healthy';
  return Object.freeze({
    schemaVersion: 1, status, channel: channelId, generation: pointer.generation,
    releaseId: release.expectedReleaseId, sourceCommit: release.sourceCommit,
    signerId: release.signerId, manifestSha256: release.manifestSha256,
    createdAt: release.createdAt, expiresAt: release.expiresAt, remainingSeconds,
  });
}

function utcDay(value) {
  return new Date(value * 1_000).toISOString().slice(0, 10).replaceAll('-', '');
}

export async function prepareSamePayloadRenewal({
  channel, channelStorage, releaseStorage, verifySignature, newReleaseId, createdAt, expiresAt, now = Math.floor(Date.now() / 1_000),
}) {
  if (typeof channelStorage?.read !== 'function' || typeof releaseStorage?.read !== 'function' || typeof verifySignature !== 'function') {
    throw new Error('release renewal dependencies are invalid');
  }
  if (![now, createdAt, expiresAt].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('release renewal timestamps are invalid');
  if (createdAt % 86_400 !== 0 || now < createdAt || now >= createdAt + 86_400 || expiresAt !== createdAt + 604_800) {
    throw new Error('release renewal must use the current canonical UTC-day validity window');
  }
  const active = await readActiveRelease({ channel, channelStorage, releaseStorage, verifySignature, now });
  const derivedId = `renew-v1-${utcDay(createdAt)}-${active.release.manifestSha256.slice(0, 16)}`;
  if (id.parse(newReleaseId) !== derivedId || newReleaseId === active.release.expectedReleaseId) {
    throw new Error('release renewal identity does not match the active signed envelope');
  }
  const replacements = new Map([
    ['release_id', newReleaseId], ['created_at', String(createdAt)], ['expires_at', String(expiresAt)],
  ]);
  for (const [prefix, filename] of ARTIFACTS) replacements.set(`${prefix}_url`, `https://app.install.doctor/releases/${newReleaseId}/${filename}`);
  const sourceLauncher = active.files.get('start').toString('utf8');
  const renewedLauncher = sourceLauncher
    .replaceAll(`/releases/${active.release.expectedReleaseId}/manifest`, `/releases/${newReleaseId}/manifest`)
    .replace(`readonly EXPECTED_RELEASE_ID='${active.release.expectedReleaseId}'`, `readonly EXPECTED_RELEASE_ID='${newReleaseId}'`);
  if (renewedLauncher === sourceLauncher || renewedLauncher.includes(`/releases/${active.release.expectedReleaseId}/`)) {
    throw new Error('release renewal could not safely rebind the immutable launcher');
  }
  const renewedLauncherBytes = Buffer.from(renewedLauncher, 'utf8');
  replacements.set('launcher_sha256', digest(renewedLauncherBytes));
  replacements.set('launcher_size', String(renewedLauncherBytes.byteLength));
  const sourceLines = active.files.get('manifest').toString('utf8').split('\n');
  const targetLines = sourceLines.map(line => {
    if (!line) return line;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    return replacements.has(key) ? `${key}=${replacements.get(key)}` : line;
  });
  const files = new Map();
  for (const name of RELEASE_FILES.filter(name => name !== 'manifest.sig')) {
    files.set(name, name === 'manifest' ? Buffer.from(targetLines.join('\n'), 'utf8')
      : name === 'start' ? renewedLauncherBytes : Buffer.from(active.files.get(name)));
  }
  const validationFiles = new Map(files);
  validationFiles.set('manifest.sig', active.files.get('manifest.sig'));
  const renewed = inspectReleaseFiles(validationFiles, newReleaseId, { now, requireCurrent: true });
  if (renewed.sourceCommit !== active.release.sourceCommit || renewed.signerId !== active.release.signerId) {
    throw new Error('release renewal changed invariant source authority');
  }
  return Object.freeze({
    schemaVersion: 1, channel: active.channelId, sourceReleaseId: active.release.expectedReleaseId,
    sourceActivationId: active.pointer.activationId, sourceGeneration: active.pointer.generation,
    sourceEtag: active.pointerEtag, sourceManifestSha256: active.release.manifestSha256,
    sourceCommit: active.release.sourceCommit, releaseId: newReleaseId, createdAt, expiresAt,
    payloads: Object.freeze(RENEWAL_PAYLOADS.map(([, filename]) => Object.freeze({
      filename, sha256: digest(active.files.get(filename)), size: active.files.get(filename).byteLength,
    }))),
    sourceFiles: new Map([...active.files].map(([name, bytes]) => [name, Buffer.from(bytes)])), files,
  });
}

export async function activateSamePayloadRenewal({
  renewalPlan, channelStorage, releaseStorage, verifySignature, activationId, activatedAt,
  now = Math.floor(Date.now() / 1_000), minimumRemainingSeconds = 345_600,
}) {
  const plan = z.strictObject({
    schemaVersion: z.literal(1), channel: id, sourceReleaseId: id, sourceActivationId: z.string().uuid(),
    sourceGeneration: z.number().int().positive().safe(), sourceEtag: z.string().min(1).max(512),
    sourceManifestSha256: sha256, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), releaseId: id,
    createdAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
    payloads: z.array(z.strictObject({ filename: z.enum(RENEWAL_PAYLOADS.map(([, filename]) => filename)), sha256, size: z.number().int().positive().safe() })).length(RENEWAL_PAYLOADS.length),
  }).parse(renewalPlan);
  if (plan.channel !== 'stable' || new Set(plan.payloads.map(item => item.filename)).size !== RENEWAL_PAYLOADS.length) {
    throw new Error('renewal activation plan is not the canonical stable payload inventory');
  }
  const target = await inspectPublishedRelease({ expectedReleaseId: plan.releaseId, storage: releaseStorage, verifySignature, now });
  if (target.createdAt !== plan.createdAt || target.expiresAt !== plan.expiresAt || target.sourceCommit !== plan.sourceCommit) {
    throw new Error('renewal target authority or validity does not match its plan');
  }
  const expectedPointer = ActivationPointer.parse({
    schemaVersion: 1, channel: plan.channel, generation: plan.sourceGeneration + 1, kind: 'promote',
    releaseId: target.releaseId, signerId: target.signerId, manifestSha256: target.manifestSha256,
    activatedAt, activationId,
    previous: {
      generation: plan.sourceGeneration, activationId: plan.sourceActivationId, releaseId: plan.sourceReleaseId,
      manifestSha256: plan.sourceManifestSha256, etag: plan.sourceEtag,
    },
    rollbackOfActivationId: null,
  });
  const intentKey = `bootstrap/activations/${plan.channel}/${expectedPointer.activationId}.json`;
  const receiptKey = `bootstrap/activation-receipts/${plan.channel}/${String(expectedPointer.generation).padStart(12, '0')}-${expectedPointer.activationId}.json`;
  const expectedPointerBytes = canonical(expectedPointer);
  const existingIntent = await channelStorage.read(intentKey);
  if (existingIntent) {
    if (!equal(existingIntent.bytes, expectedPointerBytes)) throw new Error('renewal activation intent conflicts with the deterministic plan identity');
    const existingReceipt = await channelStorage.read(receiptKey);
    if (existingReceipt) {
      if (!equal(existingReceipt.bytes, expectedPointerBytes)) throw new Error('renewal activation receipt conflicts with deterministic intent');
      return Object.freeze({ schemaVersion: 1, status: 'already-activated', pointer: expectedPointer, previousEtag: plan.sourceEtag, etag: null, intentKey, receiptKey });
    }
    const currentPointer = await channelStorage.read(`bootstrap/channels/${plan.channel}.json`);
    if (currentPointer?.bytes && equal(currentPointer.bytes, expectedPointerBytes)) {
      await createAndVerify(channelStorage, receiptKey, expectedPointerBytes, 'application/json');
      return Object.freeze({ schemaVersion: 1, status: 'already-activated', pointer: expectedPointer, previousEtag: plan.sourceEtag, etag: currentPointer.etag, intentKey, receiptKey });
    }
  }
  const active = await readActiveRelease({ channel: plan.channel, channelStorage, releaseStorage, verifySignature, now });
  if (active.pointerEtag !== plan.sourceEtag || active.pointer.activationId !== plan.sourceActivationId
    || active.pointer.generation !== plan.sourceGeneration || active.release.expectedReleaseId !== plan.sourceReleaseId
    || active.release.manifestSha256 !== plan.sourceManifestSha256 || active.release.sourceCommit !== plan.sourceCommit) {
    throw new Error('renewal activation source is no longer the exact active release');
  }
  if (target.signerId !== active.release.signerId || target.sourceCommit !== active.release.sourceCommit) {
    throw new Error('renewal target authority does not match the active source');
  }
  for (const [, filename] of RENEWAL_PAYLOADS) {
    if (!equal(active.files.get(filename), target.files.get(filename))) throw new Error(`renewal target changed payload bytes: ${filename}`);
    const binding = plan.payloads.find(item => item.filename === filename);
    if (!binding || binding.sha256 !== digest(target.files.get(filename)) || binding.size !== target.files.get(filename).byteLength) {
      throw new Error(`renewal activation plan payload binding mismatch: ${filename}`);
    }
  }
  const sourceManifest = parseManifest(active.files.get('manifest'));
  const targetManifest = parseManifest(target.files.get('manifest'));
  const allowedChanges = new Set(['release_id', 'created_at', 'expires_at', 'launcher_sha256', 'launcher_size', ...ARTIFACTS.map(([prefix]) => `${prefix}_url`)]);
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (!allowedChanges.has(key) && sourceManifest.get(key) !== targetManifest.get(key)) throw new Error(`renewal target changed invariant manifest field: ${key}`);
  }
  return activateRelease({
    channel: plan.channel, release: target, storage: channelStorage, expectedEtag: plan.sourceEtag,
    activationId, activatedAt, now, minimumPromotionRemainingSeconds: minimumRemainingSeconds,
  });
}

export async function reconcileActivationReceipt({ channel, activationId, storage }) {
  if (typeof storage?.read !== 'function' || typeof storage?.create !== 'function') throw new Error('activation reconciliation storage adapter is invalid');
  const channelId = id.parse(channel);
  const activationUuid = z.string().uuid().parse(activationId);
  const intentKey = `bootstrap/activations/${channelId}/${activationUuid}.json`;
  const intentObject = await storage.read(intentKey);
  if (!intentObject?.bytes) throw new Error('activation intent is missing');
  const intentBytes = Buffer.from(intentObject.bytes);
  const intent = ActivationPointer.parse(JSON.parse(intentBytes.toString('utf8')));
  const expectedBytes = canonical(intent);
  if (!equal(intentBytes, expectedBytes) || intent.channel !== channelId || intent.activationId !== activationUuid) {
    throw new Error('activation intent does not match its canonical identity');
  }
  const receiptKey = `bootstrap/activation-receipts/${channelId}/${String(intent.generation).padStart(12, '0')}-${activationUuid}.json`;
  const receipt = await storage.read(receiptKey);
  if (receipt) {
    if (!equal(receipt.bytes, expectedBytes)) throw new Error('activation receipt conflicts with immutable intent');
    return Object.freeze({ schemaVersion: 1, status: 'already-present', intentKey, receiptKey });
  }
  const current = await storage.read(`bootstrap/channels/${channelId}.json`);
  if (!current?.bytes || !equal(current.bytes, expectedBytes)) throw new Error('activation commitment is not proven by the current channel pointer');
  const outcome = await createAndVerify(storage, receiptKey, expectedBytes, 'application/json');
  return Object.freeze({ schemaVersion: 1, status: outcome === 'created' ? 'reconciled' : 'already-present', intentKey, receiptKey });
}

export async function activateRelease({
  channel, release, storage, expectedEtag, activationId, activatedAt, kind = 'promote', rollbackOfActivationId = null,
  now = Math.floor(Date.now() / 1_000), minimumPromotionRemainingSeconds = 345_600,
  minimumRollbackRemainingSeconds = 3_600,
}) {
  if (typeof storage?.read !== 'function' || typeof storage?.create !== 'function' || typeof storage?.compareAndSwap !== 'function') {
    throw new Error('activation storage adapter is invalid');
  }
  const channelId = id.parse(channel);
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('release activation clock is invalid');
  const minimumRemaining = kind === 'rollback' ? minimumRollbackRemainingSeconds : minimumPromotionRemainingSeconds;
  if (!Number.isSafeInteger(minimumRemaining) || minimumRemaining < 3_600 || minimumRemaining > 604_800) {
    throw new Error('release activation freshness policy is invalid');
  }
  const releaseExpiresAt = z.number().int().positive().safe().parse(release?.expiresAt);
  if (releaseExpiresAt - now < minimumRemaining) throw new Error('release has insufficient remaining validity for activation');
  const channelKey = `bootstrap/channels/${channelId}.json`;
  const current = await storage.read(channelKey);
  if ((current?.etag ?? undefined) !== expectedEtag) throw new Error('release activation expected etag is stale');
  let previous = null;
  let generation = 1;
  if (current) {
    const parsed = ActivationPointer.parse(JSON.parse(Buffer.from(current.bytes).toString('utf8')));
    if (parsed.channel !== channelId) throw new Error('release activation channel identity mismatch');
    generation = parsed.generation + 1;
    previous = {
      generation: parsed.generation, activationId: parsed.activationId, releaseId: parsed.releaseId,
      manifestSha256: parsed.manifestSha256, etag: current.etag,
    };
  }
  if ((kind === 'rollback') !== (rollbackOfActivationId !== null)) throw new Error('rollback activation must identify the activation it rolls back');
  if (kind === 'rollback') {
    if (!previous || rollbackOfActivationId !== previous.activationId) throw new Error('rollback must identify the current activation');
    const currentPointer = ActivationPointer.parse(JSON.parse(Buffer.from(current.bytes).toString('utf8')));
    if (!currentPointer.previous || release.releaseId !== currentPointer.previous.releaseId || release.manifestSha256 !== currentPointer.previous.manifestSha256) {
      throw new Error('rollback target must be the exact prior activated release');
    }
  }
  const pointer = ActivationPointer.parse({
    schemaVersion: 1, channel: channelId, generation, kind, releaseId: release.releaseId, signerId: release.signerId,
    manifestSha256: release.manifestSha256, activatedAt, activationId,
    previous, rollbackOfActivationId,
  });
  const intentKey = `bootstrap/activations/${pointer.channel}/${pointer.activationId}.json`;
  await createAndVerify(storage, intentKey, canonical(pointer), 'application/json');
  const result = await storage.compareAndSwap(channelKey, canonical(pointer), expectedEtag);
  if (!result?.ok || typeof result.etag !== 'string') throw new Error('release activation compare-and-swap failed');
  const stored = await storage.read(channelKey);
  if (!stored || stored.etag !== result.etag || !equal(stored.bytes, canonical(pointer))) throw new Error('release activation read-back mismatch');
  const receiptKey = `bootstrap/activation-receipts/${pointer.channel}/${String(pointer.generation).padStart(12, '0')}-${pointer.activationId}.json`;
  try {
    await createAndVerify(storage, receiptKey, canonical(pointer), 'application/json');
    return Object.freeze({ schemaVersion: 1, status: 'activated', pointer, previousEtag: expectedEtag ?? null, etag: result.etag, intentKey, receiptKey });
  } catch {
    return Object.freeze({ schemaVersion: 1, status: 'activated_receipt_pending', pointer, previousEtag: expectedEtag ?? null, etag: result.etag, intentKey, receiptKey });
  }
}

export { RELEASE_FILES };
