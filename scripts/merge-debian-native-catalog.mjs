#!/usr/bin/env node
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const expectedArtifactIds = Object.freeze([
  'debian-bookworm-archive-keyring',
  'debian-bookworm-inrelease',
  'debian-bookworm-main-amd64-packages',
  'tree-deb-bookworm-amd64',
].sort());

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has an invalid shape`);
  }
  return value;
}

async function safeRead(pathInput, maximumBytes, label) {
  if (!isAbsolute(pathInput) || normalize(pathInput) !== pathInput || pathInput.includes('\0')) {
    throw new Error(`${label} path must be canonical and absolute`);
  }
  const path = resolve(pathInput);
  const [metadata, canonical, parentCanonical] = await Promise.all([
    lstat(path), realpath(path), realpath(dirname(path)),
  ]);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 1 || metadata.size > maximumBytes
    || canonical !== join(parentCanonical, basename(path))) {
    throw new Error(`${label} must be one bounded regular file`);
  }
  return readFile(path);
}

function parseJson(bytes, label) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${label} is not valid JSON`); }
  return value;
}

export function mergeDebianNativeCatalog(baseInput, receiptInput) {
  if (!Array.isArray(baseInput) || baseInput.length === 0 || baseInput.length > 4096) {
    throw new Error('base catalog must be a bounded non-empty array');
  }
  const receipt = exactKeys(receiptInput, ['schemaVersion', 'descriptor', 'artifacts'], 'composition receipt');
  if (receipt.schemaVersion !== 1 || !Array.isArray(receipt.artifacts) || receipt.artifacts.length !== 4) {
    throw new Error('composition receipt identity is invalid');
  }
  const descriptor = receipt.descriptor;
  if (!descriptor || descriptor.schemaVersion !== 1 || descriptor.kind !== 'native-offline-package'
    || descriptor.manager !== 'dpkg' || descriptor.packageKey !== 'tree'
    || descriptor.package?.name !== 'tree' || descriptor.package?.version !== '2.1.0-1'
    || descriptor.package?.architecture !== 'amd64' || descriptor.distro?.id !== 'debian'
    || descriptor.distro?.versionId !== '12' || descriptor.distro?.codename !== 'bookworm') {
    throw new Error('composition receipt descriptor is outside the tree cutover');
  }
  const artifactIds = receipt.artifacts.map(item => item?.id).sort();
  if (JSON.stringify(artifactIds) !== JSON.stringify(expectedArtifactIds)) {
    throw new Error('composition receipt does not contain the exact Debian artifact inventory');
  }
  const names = baseInput.map(entry => entry?.name);
  if (names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) {
    throw new Error('base catalog contains ambiguous entry identities');
  }
  const treeIndex = names.indexOf('tree');
  if (treeIndex < 0 || names.lastIndexOf('tree') !== treeIndex) throw new Error('base catalog must contain exactly one tree entry');
  const tree = baseInput[treeIndex];
  if (!tree || typeof tree !== 'object' || Array.isArray(tree) || Object.hasOwn(tree, 'offlinePayloads')) {
    throw new Error('base tree entry already contains native payload authority');
  }
  return Object.freeze(baseInput.map((entry, index) => index === treeIndex
    ? Object.freeze({ ...entry, offlinePayloads: Object.freeze([descriptor]) })
    : entry));
}

export async function mergeDebianNativeCatalogFiles({ baseCatalogPath, receiptPath, outputPath }) {
  if (!isAbsolute(outputPath) || normalize(outputPath) !== outputPath || outputPath.includes('\0')) {
    throw new Error('output path must be canonical and absolute');
  }
  const output = resolve(outputPath);
  if (output === resolve(baseCatalogPath) || output === resolve(receiptPath)) throw new Error('output must not replace an input');
  const [baseBytes, receiptBytes] = await Promise.all([
    safeRead(baseCatalogPath, 8_388_608, 'base catalog'),
    safeRead(receiptPath, 8_388_608, 'composition receipt'),
  ]);
  const merged = mergeDebianNativeCatalog(parseJson(baseBytes, 'base catalog'), parseJson(receiptBytes, 'composition receipt'));
  const bytes = `${JSON.stringify(merged)}\n`;
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${basename(output)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    const handle = await open(temporary, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  return Object.freeze({ outputPath: output, entries: merged.length });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [baseCatalogPath, receiptPath, outputPath] = process.argv.slice(2);
  if (!baseCatalogPath || !receiptPath || !outputPath) {
    process.stderr.write('usage: merge-debian-native-catalog.mjs BASE.json RECEIPT.json OUTPUT.json\n');
    process.exitCode = 64;
  } else {
    mergeDebianNativeCatalogFiles({ baseCatalogPath, receiptPath, outputPath })
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(error => {
        process.stderr.write(`merge-debian-native-catalog: ${error instanceof Error ? error.message : 'unknown failure'}\n`);
        process.exitCode = 1;
      });
  }
}
