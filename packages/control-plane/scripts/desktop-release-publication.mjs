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
]);
export const DESKTOP_RELEASE_FILES = Object.freeze([
  ...ARTIFACTS.map(([, filename]) => filename), 'manifest.sig', 'manifest'
].sort());
const REQUIRED_KEYS = Object.freeze([
  'schema_version', 'product_id', 'release_id', 'source_commit', 'created_at', 'expires_at', 'key_id',
  ...ARTIFACTS.flatMap(([prefix]) => [`${prefix}_url`, `${prefix}_sha256`, `${prefix}_size`]),
  'engine_node_min', 'runtime_node_version'
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;

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
  if (JSON.stringify([...values.keys()].sort()) !== JSON.stringify([...REQUIRED_KEYS].sort())) throw new Error('manifest key set does not match Desktop Tools schema v6');
  return values;
}

function inspectFiles(files, expectedReleaseIdInput, now = Math.floor(Date.now() / 1_000)) {
  const releaseId = id.parse(expectedReleaseIdInput);
  if (!(files instanceof Map) || files.size !== DESKTOP_RELEASE_FILES.length || DESKTOP_RELEASE_FILES.some(name => !files.has(name))) {
    throw new Error('Desktop Tools release object set does not match the exact allowlist');
  }
  const manifest = parseManifest(files.get('manifest'));
  if (manifest.get('schema_version') !== '6' || manifest.get('product_id') !== 'desktop-tools' || manifest.get('release_id') !== releaseId) {
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
  return Object.freeze({ product: policy.product, releaseId, signerId: id.parse(manifest.get('key_id')),
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
