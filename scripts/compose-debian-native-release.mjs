#!/usr/bin/env node
// Credential-free, offline composition of one Debian 12/bookworm amd64 tree authority.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import {
  NativeOfflinePayloadDescriptorSchema,
  createDefaultDebianMetadataVerifier,
  createNativeDpkgDebControlArchiveRunner,
  parseDebianControlArchive,
  verifyDebianRepositoryMetadata,
} from '../packages/installer-engine/dist/index.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const id = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const fingerprint = /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/;
const MAXIMUM_DATE_AGE_SECONDS = 15_552_000;

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} has an invalid shape`);
  return value;
}

async function safeInput(pathInput, maximum, label) {
  if (!isAbsolute(pathInput) || normalize(pathInput) !== pathInput || pathInput.includes('\0')) throw new Error(`${label} path must be canonical and absolute`);
  const path = resolve(pathInput); const [info, parentInfo] = await Promise.all([lstat(path), lstat(dirname(path))]);
  const [canonicalPath, canonicalParent] = await Promise.all([realpath(path), realpath(dirname(path))]);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum
    || !parentInfo.isDirectory() || parentInfo.isSymbolicLink() || canonicalPath !== join(canonicalParent, basename(path))
    || (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || (process.geteuid?.() !== undefined && info.uid !== process.geteuid())))) {
    throw new Error(`${label} must be one bounded owner-controlled regular file beneath a canonical parent`);
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(); const bytes = await handle.readFile(); const after = await handle.stat();
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`${label} changed while read`);
    return { path, bytes };
  } finally { await handle.close(); }
}

function paragraphs(bytes, label) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0') || /\r(?!\n)/.test(text)) throw new Error(`${label} is not canonical text`);
  return text.replaceAll('\r\n', '\n').split(/\n\n+/).filter(Boolean).map(raw => {
    const result = new Map(); let prior;
    const lines = raw.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const line of lines) {
      if (/^[ \t]/.test(line)) { if (!prior) throw new Error(`${label} has orphan continuation`); result.set(prior, `${result.get(prior)}\n${line.slice(1)}`); continue; }
      const match = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]?(.*)$/.exec(line);
      if (!match || result.has(match[1].toLowerCase())) throw new Error(`${label} has malformed or duplicate fields`);
      prior = match[1].toLowerCase(); result.set(prior, match[2]);
    }
    return result;
  });
}

function required(record, key, label) { const value = record.get(key); if (!value) throw new Error(`${label} lacks ${key}`); return value; }

export async function composeDebianTreeRelease(input, dependencies = {}) {
  const policy = exactObject(input.policy, ['version','signingKeyFingerprint','dependencyClosure','affectedServiceUnits','conffiles'], 'policy');
  if (policy.version !== '2.1.0-1' || !fingerprint.test(policy.signingKeyFingerprint)) throw new Error('policy must bind tree version 2.1.0-1 and one fingerprint');
  for (const [name, values] of [['affectedServiceUnits', policy.affectedServiceUnits], ['conffiles', policy.conffiles]]) {
    if (!Array.isArray(values) || new Set(values).size !== values.length) throw new Error(`${name} must be a unique array`);
  }
  const closure = exactObject(policy.dependencyClosure, ['depends','preDepends'], 'dependency closure');
  for (const values of [closure.depends, closure.preDepends]) if (!Array.isArray(values) || values.some(value => !id.test(value?.packageKey ?? '') || !id.test(value?.artifactId ?? ''))) throw new Error('dependency closure is invalid');

  const [inRelease, packagesIndex, keyring, payload] = await Promise.all([
    safeInput(input.inReleasePath, 16_777_216, 'InRelease'), safeInput(input.packagesPath, 268_435_456, 'Packages index'),
    safeInput(input.keyringPath, 16_777_216, 'archive keyring'), safeInput(input.payloadPath, 268_435_456, 'tree payload'),
  ]);
  const verifier = dependencies.verifier ?? createDefaultDebianMetadataVerifier({ keyring: { kind: 'path', absolutePath: keyring.path }, ...(input.now ? { now: () => new Date(input.now) } : {}) });
  const signature = await verifier.verifyInRelease(inRelease.bytes, keyring.bytes);
  if (signature.signingKeyFingerprint.toUpperCase() !== policy.signingKeyFingerprint.toUpperCase()) throw new Error('InRelease signer is outside declared policy');
  const releaseRecords = paragraphs(signature.cleartext, 'InRelease');
  if (releaseRecords.length !== 1) throw new Error('InRelease must contain one Release record');
  const release = releaseRecords[0];
  if (required(release, 'suite', 'InRelease') !== 'oldstable' || required(release, 'codename', 'InRelease') !== 'bookworm'
    || !required(release, 'architectures', 'InRelease').split(/\s+/).includes('amd64')
    || !required(release, 'components', 'InRelease').split(/\s+/).includes('main')) throw new Error('InRelease is outside Debian 12/bookworm amd64 main policy');
  const signedAtMs = Date.parse(required(release, 'date', 'InRelease'));
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  if (!Number.isFinite(signedAtMs) || !Number.isFinite(nowMs)) throw new Error('composition freshness clock is invalid');
  if (signedAtMs > nowMs + 10_000) throw new Error('InRelease Date is more than 10 seconds in the future');
  const validUntilRaw = release.get('valid-until');
  const validUntilMs = validUntilRaw === undefined ? null : Date.parse(validUntilRaw);
  if (validUntilMs !== null && (!Number.isFinite(validUntilMs) || validUntilMs <= signedAtMs || nowMs >= validUntilMs)) {
    throw new Error('InRelease Valid-Until is invalid or expired');
  }
  if (validUntilMs === null && nowMs - signedAtMs > MAXIMUM_DATE_AGE_SECONDS * 1_000) {
    throw new Error('InRelease Date exceeds the 180-day freshness ceiling');
  }
  if (!input.packagesPath.endsWith('Packages.xz')) throw new Error('tree slice requires the exact Packages.xz index format');
  const packagesPath = 'dists/bookworm/main/binary-amd64/Packages.xz';
  const packagesBytes = await verifier.decompressPackages?.(packagesPath, packagesIndex.bytes);
  if (!packagesBytes) throw new Error('compressed Packages input requires trusted bounded decompression');
  const matches = paragraphs(packagesBytes, 'Packages').filter(value => value.get('package') === 'tree' && value.get('version') === policy.version && value.get('architecture') === 'amd64');
  if (matches.length !== 1) throw new Error('Packages must contain exactly one declared tree version');
  const stanza = matches[0];
  if (stanza.get('depends') !== 'libc6 (>= 2.34)' || stanza.has('pre-depends')
    || closure.depends.length !== 0 || closure.preDepends.length !== 0) {
    throw new Error('tree policy requires only the separately witnessed libc6 (>= 2.34) dependency');
  }
  const control = dependencies.inspectControl
    ? await dependencies.inspectControl(payload.path, payload.bytes)
    : await (async () => {
      const handle = await open(payload.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { return parseDebianControlArchive(await createNativeDpkgDebControlArchiveRunner().extractControlArchive({ payloadDescriptor: handle.fd, timeoutMilliseconds: 30_000, maximumOutputBytes: 16_777_216 })); }
      finally { await handle.close(); }
    })();
  const nullable = key => stanza.get(key) ?? null;
  if (control.control.packageName !== 'tree' || control.control.version !== policy.version || control.control.architecture !== 'amd64'
    || control.control.depends !== nullable('depends') || control.control.preDepends !== nullable('pre-depends')
    || JSON.stringify(control.conffiles) !== JSON.stringify(policy.conffiles)) throw new Error('tree control metadata differs from declared policy or signed Packages');
  const descriptor = NativeOfflinePayloadDescriptorSchema.parse({
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree', platform: { os: 'linux', arch: 'x64' },
    package: { name: 'tree', version: policy.version, architecture: 'amd64' },
    artifact: { id: 'tree-deb-bookworm-amd64', sha256: sha256(payload.bytes), sizeBytes: payload.bytes.length, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' }, repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: { artifactId: 'debian-bookworm-inrelease', path: 'dists/bookworm/InRelease', sha256: sha256(inRelease.bytes), sizeBytes: inRelease.bytes.length,
        signedAt: new Date(signedAtMs).toISOString(),
        validUntil: validUntilMs === null ? null : new Date(validUntilMs).toISOString(),
        maximumDateAgeSeconds: validUntilMs === null ? MAXIMUM_DATE_AGE_SECONDS : null,
        signingKeyFingerprint: policy.signingKeyFingerprint.toUpperCase(), keyring: { artifactId: 'debian-bookworm-archive-keyring', sha256: sha256(keyring.bytes), sizeBytes: keyring.bytes.length, mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'debian-bookworm-main-amd64-packages', path: packagesPath, sha256: sha256(packagesIndex.bytes), sizeBytes: packagesIndex.bytes.length, architecture: 'amd64' },
      packageStanza: { filename: required(stanza, 'filename', 'tree stanza'), sha256: required(stanza, 'sha256', 'tree stanza'), sizeBytes: Number(required(stanza, 'size', 'tree stanza')),
        depends: nullable('depends'), preDepends: nullable('pre-depends'), essential: stanza.get('essential') ?? 'absent', multiArch: stanza.get('multi-arch') ?? 'absent' },
    }, dependencyClosure: closure, affectedServiceUnits: policy.affectedServiceUnits, conffiles: policy.conffiles,
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  });
  await verifyDebianRepositoryMetadata({ descriptor, inReleaseBytes: inRelease.bytes, keyringBytes: keyring.bytes,
    packagesIndexBytes: packagesIndex.bytes, payloadBytes: payload.bytes, verifier });
  return Object.freeze({ schemaVersion: 1, descriptor, artifacts: Object.freeze([
    { id: descriptor.metadataProof.inRelease.artifactId, path: inRelease.path, sha256: sha256(inRelease.bytes), sizeBytes: inRelease.bytes.length, mode: '0600' },
    { id: descriptor.metadataProof.inRelease.keyring.artifactId, path: keyring.path, sha256: sha256(keyring.bytes), sizeBytes: keyring.bytes.length, mode: '0600' },
    { id: descriptor.metadataProof.packagesIndex.artifactId, path: packagesIndex.path, sha256: sha256(packagesIndex.bytes), sizeBytes: packagesIndex.bytes.length, mode: '0600' },
    { id: descriptor.artifact.id, path: payload.path, sha256: sha256(payload.bytes), sizeBytes: payload.bytes.length, mode: '0600' },
  ]) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [configurationPath] = process.argv.slice(2);
  if (!configurationPath) { process.stderr.write('usage: compose-debian-native-release.mjs CONFIG.json\n'); process.exitCode = 64; }
  else safeInput(configurationPath, 65_536, 'configuration').then(source => composeDebianTreeRelease(JSON.parse(source.bytes.toString('utf8'))))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`compose-debian-native-release: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
}
