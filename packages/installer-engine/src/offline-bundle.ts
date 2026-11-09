import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import {
  chmod, lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { parseStageZeroReleaseEnvelope } from '@install-doctor/aid-core/installer-contracts';
import { ImmutableArtifactDescriptorSchema, NativeOfflinePayloadDescriptorSchema } from './contracts.js';
import { LoadCatalogEntrySchema } from './lazy-plan.js';

const execute = promisify(execFile);
const SSH_KEYGEN = '/usr/bin/ssh-keygen';
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const signature = z.strictObject({
  keyId: id,
  algorithm: z.literal('sshsig-ed25519'),
  namespace: z.literal('install.doctor.offline-bundle'),
  detached: z.literal(true),
});
const platform = z.strictObject({
  os: z.enum(['linux', 'darwin', 'win32']),
  arch: z.enum(['x64', 'arm64']),
  environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']),
});
const artifactSchema = z.strictObject({ id, version: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) });
const artifact = z.strictObject({
  id,
  path: z.string().min(1).max(512),
  sha256: digest,
  sizeBytes: z.number().int().positive().max(268_435_456),
  mediaType: z.string().min(1).max(128).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  mode: z.enum(['0600', '0700']),
  license: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*(?: WITH [A-Za-z0-9][A-Za-z0-9.+-]*)?$/),
  schema: artifactSchema.nullable(),
  catalogDescriptor: z.discriminatedUnion('kind', [
    ImmutableArtifactDescriptorSchema.extend({ kind: z.literal('immutable-executable').default('immutable-executable') }),
    NativeOfflinePayloadDescriptorSchema,
  ]).nullable().default(null),
  containsSecrets: z.literal(false),
});

export const OfflineBundleManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  releaseId: id,
  planDigest: digest,
  graphDigest: digest,
  platform,
  selectedTaskIds: z.array(id).min(1).max(10_000),
  createdAt: timestamp,
  expiresAt: timestamp,
  containsSecrets: z.literal(false),
  signature,
  artifacts: z.array(artifact).min(1).max(4096),
}).superRefine((value, context) => {
  if (new Date(value.expiresAt).getTime() <= new Date(value.createdAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiry must follow creation' });
  }
  for (const [field, values] of [
    ['selectedTaskIds', value.selectedTaskIds],
    ['artifact ids', value.artifacts.map(item => item.id)],
    ['artifact paths', value.artifacts.map(item => item.path)],
    ['artifact digests', value.artifacts.map(item => item.sha256)],
  ] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `duplicate ${field}` });
  }
});
export type OfflineBundleManifest = z.infer<typeof OfflineBundleManifestSchema>;

const TrustSchema = z.strictObject({
  keyId: id,
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
});
export type OfflineBundleTrust = z.infer<typeof TrustSchema>;

const ExpectedSchema = z.strictObject({
  releaseId: id,
  planDigest: digest,
  platform,
  selectedTaskIds: z.array(id).min(1).max(10_000),
  artifactIds: z.array(id).min(1).max(4096),
});

export class OfflineBundleError extends Error {
  constructor(message: string) { super(message); this.name = 'OfflineBundleError'; }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function canonicalBundleManifestBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeArtifactPath(value: string, idValue: string): string {
  const expected = `artifacts/${idValue}`;
  if (value !== expected || value.includes('..') || value.includes('\\') || value.startsWith('/') || value.includes('//')) {
    throw new OfflineBundleError(`artifact path is not canonical and contained: ${value}`);
  }
  return value;
}

async function secureRead(path: string, maximumBytes: number): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes) {
      throw new OfflineBundleError(`artifact must be a regular file between 1 and ${maximumBytes} bytes`);
    }
    if (process.platform !== 'win32' && metadata.nlink !== 1) throw new OfflineBundleError('artifact must not be hard-linked');
    const bytes = await handle.readFile();
    if (bytes.length !== metadata.size) throw new OfflineBundleError('artifact changed while being read');
    return bytes;
  } catch (error) {
    if (error instanceof OfflineBundleError) throw error;
    throw new OfflineBundleError(`cannot safely read bundle file: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    await handle?.close();
  }
}

async function assertPrivateKey(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new OfflineBundleError('signing key path must be absolute');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new OfflineBundleError('signing key must be a regular non-symlink file');
  if (process.platform !== 'win32') {
    if (metadata.nlink !== 1) throw new OfflineBundleError('signing key must not be hard-linked');
    if ((metadata.mode & 0o077) !== 0) throw new OfflineBundleError('signing key has insecure permissions');
    const uid = process.geteuid?.();
    if (uid === undefined || metadata.uid !== uid) throw new OfflineBundleError('signing key must be owned by the current user');
  }
}

async function assertTrustedSshKeygen(): Promise<void> {
  if (process.platform === 'win32') throw new OfflineBundleError('offline SSHSIG verification is unsupported on win32');
  const metadata = await lstat(SSH_KEYGEN);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    throw new OfflineBundleError('SSH signature tool must be the root-owned, non-writable system executable');
  }
}

async function signManifest(manifestPath: string, privateKeyPath: string): Promise<void> {
  await assertPrivateKey(privateKeyPath);
  await assertTrustedSshKeygen();
  try {
    await execute(SSH_KEYGEN, ['-Y', 'sign', '-q', '-f', privateKeyPath, '-n', 'install.doctor.offline-bundle', manifestPath], {
      timeout: 30_000, maxBuffer: 64 * 1024,
    });
  } catch {
    throw new OfflineBundleError('offline bundle manifest signing failed');
  }
}

async function verifySignature(
  manifestBytes: Buffer, signaturePath: string, trustInput: unknown,
  namespace: 'install.doctor.offline-bundle' | 'install.doctor.release' | 'desktop.tools.release',
): Promise<void> {
  const trust = TrustSchema.parse(trustInput);
  await assertTrustedSshKeygen();
  const stage = await mkdtemp(join(tmpdir(), 'install-doctor-bundle-trust-'));
  try {
    await chmod(stage, 0o700);
    const allowedSigners = join(stage, 'allowed_signers');
    await writeFile(allowedSigners, `${trust.keyId} ${trust.publicKey}\n`, { mode: 0o600, flag: 'wx' });
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(SSH_KEYGEN, [
          '-Y', 'verify', '-f', allowedSigners, '-I', trust.keyId, '-n', namespace, '-s', signaturePath,
        ], { stdio: ['pipe', 'ignore', 'ignore'] });
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          rejectPromise(new Error('signature verifier timed out'));
        }, 30_000);
        child.once('error', error => { clearTimeout(timeout); rejectPromise(error); });
        child.once('exit', code => {
          clearTimeout(timeout);
          if (code === 0) resolvePromise();
          else rejectPromise(new Error(`signature verifier exited ${String(code)}`));
        });
        child.stdin.end(manifestBytes);
      });
    } catch {
      throw new OfflineBundleError('offline bundle manifest signature verification failed');
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Authenticate the Desktop Tools release authority and return its exact catalog membership. */
export async function verifyDesktopReleaseCatalog(input: {
  manifestPath: string;
  signaturePath: string;
  trust: OfflineBundleTrust;
  expectedReleaseId: string;
  catalogBytes: Buffer;
  nativeAuthority?: {
    descriptor: z.infer<typeof NativeOfflinePayloadDescriptorSchema>;
    artifacts: readonly { artifactId: string; url: string; authority: { sha256: string; sizeBytes: number; mode: '0600' } }[];
  };
  now?: number;
}): Promise<{ releaseId: string; catalogSha256: string; manifestSha256: string }> {
  const manifestBytes = await secureRead(input.manifestPath, 16_384);
  await secureRead(input.signaturePath, 8_192);
  const trust = TrustSchema.parse(input.trust);
  await verifySignature(manifestBytes, input.signaturePath, trust, 'desktop.tools.release');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  if (!text.endsWith('\n') || text.includes('\r') || text.includes('\0')) throw new OfflineBundleError('signed release manifest encoding is invalid');
  const lines = text.slice(0, -1).split('\n');
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator < 1) throw new OfflineBundleError('signed release manifest entry is invalid');
    const key = line.slice(0, separator); const value = line.slice(separator + 1);
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !value || values.has(key)) throw new OfflineBundleError('signed release manifest is ambiguous');
    values.set(key, value);
  }
  const schemaVersion = values.get('schema_version');
  if ((schemaVersion === '7' && lines.length !== 64) || (schemaVersion === '8' && lines.length !== 76)
    || (schemaVersion === '9' && lines.length !== 80)
    || (schemaVersion !== '7' && schemaVersion !== '8' && schemaVersion !== '9')) {
    throw new OfflineBundleError('signed release manifest key count or schema is invalid');
  }
  const releaseId = id.parse(values.get('release_id'));
  if (values.get('product_id') !== 'desktop-tools'
    || values.get('key_id') !== trust.keyId || releaseId !== id.parse(input.expectedReleaseId)) {
    throw new OfflineBundleError('signed release identity is not trusted');
  }
  if (schemaVersion === '9') {
    const minimumRevocationEpoch = Number(values.get('broker_approval_minimum_revocation_epoch'));
    const delegationSize = Number(values.get('broker_approval_delegation_size'));
    if (!Number.isSafeInteger(minimumRevocationEpoch) || minimumRevocationEpoch < 0
      || values.get('broker_approval_delegation_url')
        !== `https://desktop.tools/releases/${releaseId}/broker-approval-signer-delegation.json`
      || !digest.safeParse(values.get('broker_approval_delegation_sha256')).success
      || !Number.isSafeInteger(delegationSize) || delegationSize < 1 || delegationSize > 65_536) {
      throw new OfflineBundleError('signed release broker approval delegation authority is invalid');
    }
  }
  const createdAt = Number(values.get('created_at')); const expiresAt = Number(values.get('expires_at'));
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)
    || createdAt > now + 300 || expiresAt <= now || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new OfflineBundleError('signed release validity window is not current and bounded');
  }
  const catalogSha256 = digest.parse(values.get('catalog_sha256'));
  const catalogSize = Number(values.get('catalog_size'));
  if (values.get('catalog_url') !== `https://desktop.tools/releases/${releaseId}/catalog.json`
    || !Number.isSafeInteger(catalogSize) || catalogSize < 2 || catalogSize > 8_388_608
    || input.catalogBytes.byteLength !== catalogSize || sha256(input.catalogBytes) !== catalogSha256) {
    throw new OfflineBundleError('catalog is not an exact member of the authenticated release');
  }
  if (input.nativeAuthority) {
    if ((schemaVersion !== '8' && schemaVersion !== '9') || input.nativeAuthority.artifacts.length !== 4) {
      throw new OfflineBundleError('native Debian authority requires a signed schema-v8 or schema-v9 release closure');
    }
    let catalog;
    try { catalog = z.array(LoadCatalogEntrySchema).max(16_384).parse(JSON.parse(input.catalogBytes.toString('utf8'))); }
    catch { throw new OfflineBundleError('signed release catalog is not a valid strict catalog'); }
    const signedDescriptor = catalog.flatMap(entry => entry.offlinePayloads)
      .find(candidate => candidate.packageKey === input.nativeAuthority?.descriptor.packageKey
        && candidate.platform.os === input.nativeAuthority?.descriptor.platform.os
        && candidate.platform.arch === input.nativeAuthority?.descriptor.platform.arch);
    if (!signedDescriptor || JSON.stringify(canonical(signedDescriptor)) !== JSON.stringify(canonical(input.nativeAuthority.descriptor))) {
      throw new OfflineBundleError('native Debian descriptor is not an exact signed catalog member');
    }
    const descriptor = input.nativeAuthority.descriptor;
    const prefixes = new Map([
      [descriptor.metadataProof.inRelease.artifactId, 'debian_inrelease'],
      [descriptor.metadataProof.inRelease.keyring.artifactId, 'debian_keyring'],
      [descriptor.metadataProof.packagesIndex.artifactId, 'debian_packages'],
      [descriptor.artifact.id, 'debian_tree'],
    ]);
    if (prefixes.size !== 4 || new Set(input.nativeAuthority.artifacts.map(item => item.artifactId)).size !== 4) {
      throw new OfflineBundleError('native Debian release object identifiers are not exact');
    }
    for (const artifact of input.nativeAuthority.artifacts) {
      const prefix = prefixes.get(artifact.artifactId);
      if (!prefix || artifact.authority.mode !== '0600'
        || values.get(`${prefix}_url`) !== artifact.url
        || values.get(`${prefix}_sha256`) !== artifact.authority.sha256
        || Number(values.get(`${prefix}_size`)) !== artifact.authority.sizeBytes) {
        throw new OfflineBundleError(`native Debian object is not an exact member of the authenticated release: ${artifact.artifactId}`);
      }
    }
  }
  return Object.freeze({ releaseId, catalogSha256, manifestSha256: sha256(manifestBytes) });
}

export type CreateOfflineBundleInput = {
  outputRoot: string;
  releaseId: string;
  planDigest: string;
  graphDigest: string;
  platform: z.infer<typeof platform>;
  selectedTaskIds: string[];
  createdAt: string;
  expiresAt: string;
  signer: { keyId: string; privateKeyPath: string };
  releaseTrust: OfflineBundleTrust;
  artifacts: Array<{
    id: string; sourcePath: string; mediaType: string; mode: '0600' | '0700'; license: string;
    schema: { id: string; version: string } | null; containsSecrets: false;
    catalogDescriptor?: (
      | z.infer<typeof ImmutableArtifactDescriptorSchema>
      | (z.infer<typeof ImmutableArtifactDescriptorSchema> & { kind: 'immutable-executable' })
      | z.infer<typeof NativeOfflinePayloadDescriptorSchema>
    ) | null;
  }>;
  maxArtifactBytes?: number;
  maxTotalBytes?: number;
  fault?: (point: 'after-artifacts-durable' | 'before-bundle-publish') => Promise<void>;
};

const RELEASE_ENVELOPE_ID = 'release-envelope';
const RELEASE_SIGNATURE_ID = 'release-signature';
const EXECUTION_METADATA_IDS = ['normalized-plan', 'operation-manifest', 'desired-state', 'host-facts'] as const;

async function verifyReleaseMembership(
  artifacts: readonly z.infer<typeof artifact>[],
  readArtifact: (item: z.infer<typeof artifact>) => Promise<Buffer>,
  releaseTrustInput: unknown,
  expected: { releaseId: string; createdAt: string; expiresAt: string; platform: z.infer<typeof platform> },
): Promise<void> {
  const releaseTrust = TrustSchema.parse(releaseTrustInput);
  const byId = new Map(artifacts.map(item => [item.id, item]));
  const envelopeItem = byId.get(RELEASE_ENVELOPE_ID);
  const signatureItem = byId.get(RELEASE_SIGNATURE_ID);
  const engineItem = byId.get('engine');
  const catalogItem = byId.get('catalog');
  if (!envelopeItem || envelopeItem.mode !== '0600' || envelopeItem.mediaType !== 'text/plain') {
    throw new OfflineBundleError('offline bundle requires a private release-envelope artifact');
  }
  if (!signatureItem || signatureItem.mode !== '0600') {
    throw new OfflineBundleError('offline bundle requires a private release-signature artifact');
  }
  if (!engineItem || engineItem.mode !== '0700') throw new OfflineBundleError('offline bundle requires the release engine artifact');
  if (!catalogItem || catalogItem.mode !== '0600') throw new OfflineBundleError('offline bundle requires the release catalog artifact');
  const envelopeBytes = await readArtifact(envelopeItem);
  const signatureBytes = await readArtifact(signatureItem);
  const stage = await mkdtemp(join(tmpdir(), 'install-doctor-release-proof-'));
  try {
    await chmod(stage, 0o700);
    const signaturePath = join(stage, 'release.sig');
    await writeFile(signaturePath, signatureBytes, { mode: 0o600, flag: 'wx' });
    await verifySignature(envelopeBytes, signaturePath, releaseTrust, 'install.doctor.release');
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  let envelope;
  try { envelope = parseStageZeroReleaseEnvelope(envelopeBytes.toString('utf8')); }
  catch { throw new OfflineBundleError('offline bundle release envelope is invalid'); }
  if (envelope.keyId !== releaseTrust.keyId) throw new OfflineBundleError('release envelope signer is not trusted');
  if (envelope.releaseId !== expected.releaseId) throw new OfflineBundleError('offline bundle release identity is not signed');
  const bundleCreated = new Date(expected.createdAt).getTime();
  const bundleExpires = new Date(expected.expiresAt).getTime();
  if (bundleCreated < envelope.createdAt * 1000 || bundleExpires > envelope.expiresAt * 1000) {
    throw new OfflineBundleError('offline bundle validity exceeds its signed release validity');
  }
  if (engineItem.sha256 !== envelope.engineSha256 || engineItem.sizeBytes !== envelope.engineSize) {
    throw new OfflineBundleError('offline engine is not a member of the signed release');
  }
  if (catalogItem.sha256 !== envelope.catalogSha256 || catalogItem.sizeBytes !== envelope.catalogSize) {
    throw new OfflineBundleError('offline catalog is not a member of the signed release');
  }
  let catalogEntries;
  try {
    catalogEntries = z.array(LoadCatalogEntrySchema).max(16_384).parse(JSON.parse((await readArtifact(catalogItem)).toString('utf8')));
  } catch {
    throw new OfflineBundleError('offline signed catalog is not a valid strict catalog');
  }
  const catalogDescriptors = new Map<string, unknown>();
  for (const entry of catalogEntries) {
    for (const descriptor of entry.artifacts) {
      const keyed = { ...descriptor, kind: 'immutable-executable' as const };
      const key = `immutable-executable/${descriptor.id}/${descriptor.platform.os}/${descriptor.platform.arch}`;
      if (catalogDescriptors.has(key)) throw new OfflineBundleError(`signed catalog has duplicate artifact authority: ${key}`);
      catalogDescriptors.set(key, keyed);
    }
    for (const descriptor of entry.offlinePayloads) {
      const key = `native-offline-package/${descriptor.packageKey}/${descriptor.platform.os}/${descriptor.platform.arch}`;
      if (catalogDescriptors.has(key)) throw new OfflineBundleError(`signed catalog has duplicate artifact authority: ${key}`);
      catalogDescriptors.set(key, descriptor);
    }
  }
  for (const item of artifacts) {
    if (item.mode === '0700' && item.id !== 'engine' && !item.catalogDescriptor) {
      throw new OfflineBundleError(`offline executable lacks signed catalog authority: ${item.id}`);
    }
    if (!item.catalogDescriptor) continue;
    const descriptor = item.catalogDescriptor;
    const key = descriptor.kind === 'immutable-executable'
      ? `immutable-executable/${descriptor.id}/${descriptor.platform.os}/${descriptor.platform.arch}`
      : `native-offline-package/${descriptor.packageKey}/${descriptor.platform.os}/${descriptor.platform.arch}`;
    const signed = catalogDescriptors.get(key);
    if (!signed || JSON.stringify(canonical(signed)) !== JSON.stringify(canonical(descriptor))) {
      throw new OfflineBundleError(`offline artifact is not an exact signed catalog member: ${item.id}`);
    }
    if (descriptor.platform.os !== expectedPlatformOs(expected) || descriptor.platform.arch !== expected.platform.arch) {
      throw new OfflineBundleError(`offline artifact has the wrong signed catalog platform: ${item.id}`);
    }
    const bytesMatch = descriptor.kind === 'immutable-executable'
      ? item.id === descriptor.id && item.sha256 === descriptor.source.sha256
        && item.sizeBytes === descriptor.source.sizeBytes && item.mode === descriptor.destination.mode
      : item.id === descriptor.artifact.id && item.sha256 === descriptor.artifact.sha256
        && item.sizeBytes === descriptor.artifact.sizeBytes && item.mediaType === descriptor.artifact.mediaType && item.mode === '0600';
    if (!bytesMatch) {
      throw new OfflineBundleError(`offline artifact bytes or identity do not match its signed catalog descriptor: ${item.id}`);
    }
    if (descriptor.kind === 'native-offline-package') {
      for (const proof of [descriptor.metadataProof.inRelease, descriptor.metadataProof.packagesIndex]) {
        const proofItem = byId.get(proof.artifactId);
        if (!proofItem || proofItem.sha256 !== proof.sha256 || proofItem.sizeBytes !== proof.sizeBytes || proofItem.mode !== '0600') {
          throw new OfflineBundleError(`offline native payload proof artifact is missing or does not match signed catalog authority: ${proof.artifactId}`);
        }
      }
    }
  }
}

function expectedPlatformOs(expected: { platform: z.infer<typeof platform> }): 'linux' | 'darwin' | 'win32' {
  return expected.platform.os;
}

function assertNoOperationalSecrets(bytes: Buffer): void {
  const text = bytes.toString('utf8');
  const signatures = [
    /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PGP) PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_+\/@.-]{12,}["']?/i,
  ];
  if (signatures.some(pattern => pattern.test(text))) {
    throw new OfflineBundleError('offline bundle artifact contains credible operational secret material');
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeDurableExclusive(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createOfflineBundle(input: CreateOfflineBundleInput): Promise<{
  bundleDirectory: string; manifest: OfflineBundleManifest; manifestDigest: string;
}> {
  if (!isAbsolute(input.outputRoot)) throw new OfflineBundleError('bundle output root must be absolute');
  const outputRoot = await realpath(input.outputRoot);
  const rootMetadata = await stat(outputRoot);
  if (!rootMetadata.isDirectory()) throw new OfflineBundleError('bundle output root must be a directory');
  const maximum = z.number().int().positive().max(268_435_456).parse(input.maxArtifactBytes ?? 67_108_864);
  const totalMaximum = z.number().int().positive().max(1_073_741_824).parse(input.maxTotalBytes ?? 268_435_456);
  const ids = input.artifacts.map(item => id.parse(item.id));
  if (new Set(ids).size !== ids.length) throw new OfflineBundleError('duplicate artifact ids');
  let total = 0;
  const contents = new Map<string, Buffer>();
  const artifacts = [];
  for (const candidate of [...input.artifacts].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!isAbsolute(candidate.sourcePath)) throw new OfflineBundleError('artifact source path must be absolute');
    const bytes = await secureRead(candidate.sourcePath, maximum);
    assertNoOperationalSecrets(bytes);
    total += bytes.length;
    if (total > totalMaximum) throw new OfflineBundleError('offline bundle exceeds its total size policy');
    const artifactDigest = sha256(bytes);
    if ([...contents.values()].some(existing => sha256(existing) === artifactDigest)) throw new OfflineBundleError('duplicate artifact digests');
    contents.set(candidate.id, bytes);
    artifacts.push(artifact.parse({
      id: candidate.id, path: `artifacts/${candidate.id}`, sha256: artifactDigest,
      sizeBytes: bytes.length, mediaType: candidate.mediaType, mode: candidate.mode,
      license: candidate.license, schema: candidate.schema, containsSecrets: candidate.containsSecrets,
      catalogDescriptor: candidate.catalogDescriptor ?? null,
    }));
  }
  const manifest = OfflineBundleManifestSchema.parse({
    schemaVersion: 2, releaseId: input.releaseId, planDigest: input.planDigest, graphDigest: input.graphDigest,
    platform: input.platform, selectedTaskIds: [...input.selectedTaskIds].sort((left, right) => left.localeCompare(right)),
    createdAt: input.createdAt, expiresAt: input.expiresAt, containsSecrets: false,
    signature: { keyId: input.signer.keyId, algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-bundle', detached: true },
    artifacts,
  });
  await verifyReleaseMembership(manifest.artifacts, async item => contents.get(item.id)!, input.releaseTrust, manifest);
  const manifestBytes = canonicalBundleManifestBytes(manifest);
  const manifestDigest = sha256(manifestBytes);
  const target = join(outputRoot, manifestDigest);
  const stage = await mkdtemp(join(outputRoot, '.bundle-stage-'));
  try {
    await chmod(stage, 0o700);
    await mkdir(join(stage, 'artifacts'), { mode: 0o700 });
    for (const item of manifest.artifacts) {
      await writeDurableExclusive(join(stage, item.path), contents.get(item.id)!, Number.parseInt(item.mode, 8));
    }
    await syncDirectory(join(stage, 'artifacts'));
    const declaredExecutionMetadata = EXECUTION_METADATA_IDS.filter(metadataId => contents.has(metadataId));
    if (declaredExecutionMetadata.length > 0) {
      if (declaredExecutionMetadata.length !== EXECUTION_METADATA_IDS.length) {
        throw new OfflineBundleError('offline execution metadata closure is incomplete');
      }
      // Import lazily to keep the bundle byte-verification layer independent while
      // ensuring executable authority is proven before a signature or published
      // content address can make a malformed closure appear trustworthy.
      const { validateOfflineExecutionClosure } = await import('./offline-execution.js');
      await validateOfflineExecutionClosure({ bundleDirectory: stage, manifest, manifestDigest });
    }
    await input.fault?.('after-artifacts-durable');
    const manifestPath = join(stage, 'manifest.json');
    await writeDurableExclusive(manifestPath, manifestBytes, 0o600);
    await signManifest(manifestPath, input.signer.privateKeyPath);
    await chmod(`${manifestPath}.sig`, 0o600);
    const signatureHandle = await open(`${manifestPath}.sig`, constants.O_RDONLY);
    try { await signatureHandle.sync(); } finally { await signatureHandle.close(); }
    await rename(`${manifestPath}.sig`, join(stage, 'manifest.sig'));
    await syncDirectory(stage);
    await input.fault?.('before-bundle-publish');
    try { await rename(stage, target); }
    catch { throw new OfflineBundleError('content-addressed bundle already exists or cannot be published'); }
    await syncDirectory(outputRoot);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { bundleDirectory: target, manifest, manifestDigest };
}

async function listBundleFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new OfflineBundleError(`bundle contains a symbolic link: ${rel}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) found.push(rel);
      else throw new OfflineBundleError(`bundle contains a non-regular file: ${rel}`);
    }
  };
  await visit(root);
  return found.sort((left, right) => left.localeCompare(right));
}

export type VerifiedOfflineBundle = {
  bundleDirectory: string;
  manifest: OfflineBundleManifest;
  manifestDigest: string;
};

export async function readVerifiedOfflineArtifact(
  verified: VerifiedOfflineBundle,
  artifactId: string,
): Promise<Buffer> {
  const item = verified.manifest.artifacts.find(candidate => candidate.id === artifactId);
  if (!item) throw new OfflineBundleError(`verified bundle artifact is missing: ${artifactId}`);
  safeArtifactPath(item.path, item.id);
  const bytes = await secureRead(join(verified.bundleDirectory, item.path), item.sizeBytes);
  if (bytes.length !== item.sizeBytes || sha256(bytes) !== item.sha256) {
    throw new OfflineBundleError(`verified bundle artifact changed: ${artifactId}`);
  }
  return bytes;
}

export async function verifyOfflineBundle(input: { bundleDirectory: string; trust: unknown; releaseTrust: unknown }): Promise<VerifiedOfflineBundle> {
  if (!isAbsolute(input.bundleDirectory)) throw new OfflineBundleError('bundle directory must be absolute');
  const bundleDirectory = await realpath(input.bundleDirectory);
  const metadata = await lstat(bundleDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new OfflineBundleError('bundle must be a real directory');
  const manifestPath = join(bundleDirectory, 'manifest.json');
  const signaturePath = join(bundleDirectory, 'manifest.sig');
  const manifestBytes = await secureRead(manifestPath, 1_048_576);
  const signatureBytes = await secureRead(signaturePath, 65_536);
  void signatureBytes;
  const manifestDigest = sha256(manifestBytes);
  if (basename(bundleDirectory) !== manifestDigest) throw new OfflineBundleError('bundle directory is not the manifest content address');
  let decoded: unknown;
  try { decoded = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw new OfflineBundleError('bundle manifest is not valid JSON'); }
  const manifest = OfflineBundleManifestSchema.parse(decoded);
  if (!manifestBytes.equals(canonicalBundleManifestBytes(manifest))) throw new OfflineBundleError('bundle manifest is not canonical');
  const trust = TrustSchema.parse(input.trust);
  if (manifest.signature.keyId !== trust.keyId) throw new OfflineBundleError('bundle signer is not trusted');
  for (const item of manifest.artifacts) safeArtifactPath(item.path, item.id);
  await verifySignature(manifestBytes, signaturePath, trust, 'install.doctor.offline-bundle');
  const expectedFiles = ['manifest.json', 'manifest.sig', ...manifest.artifacts.map(item => item.path)].sort((left, right) => left.localeCompare(right));
  const actualFiles = await listBundleFiles(bundleDirectory);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new OfflineBundleError('bundle contains missing, unexpected, or undeclared files');
  let total = 0;
  for (const item of manifest.artifacts) {
    const bytes = await secureRead(join(bundleDirectory, item.path), 268_435_456);
    total += bytes.length;
    if (total > 1_073_741_824) throw new OfflineBundleError('offline bundle exceeds total verification size');
    if (bytes.length !== item.sizeBytes) throw new OfflineBundleError(`artifact size mismatch: ${item.id}`);
    if (sha256(bytes) !== item.sha256) throw new OfflineBundleError(`artifact digest mismatch: ${item.id}`);
    assertNoOperationalSecrets(bytes);
  }
  await verifyReleaseMembership(
    manifest.artifacts,
    item => secureRead(join(bundleDirectory, item.path), item.sizeBytes),
    input.releaseTrust,
    manifest,
  );
  return { bundleDirectory, manifest, manifestDigest };
}

export type OfflineBundlePlan = VerifiedOfflineBundle & {
  artifactIds: string[];
  plannedAt: string;
};

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort((a, b) => a.localeCompare(b))) === JSON.stringify([...right].sort((a, b) => a.localeCompare(b)));
}

export async function planOfflineBundle(input: {
  bundleDirectory: string; trust: unknown; releaseTrust: unknown; expected: unknown; now?: string;
}): Promise<OfflineBundlePlan> {
  const verified = await verifyOfflineBundle(input);
  const expected = ExpectedSchema.parse(input.expected);
  const now = timestamp.parse(input.now ?? new Date().toISOString());
  if (new Date(verified.manifest.createdAt).getTime() > new Date(now).getTime()) throw new OfflineBundleError('offline bundle is not valid yet');
  if (new Date(verified.manifest.expiresAt).getTime() <= new Date(now).getTime()) throw new OfflineBundleError('offline bundle expired');
  if (verified.manifest.releaseId !== expected.releaseId) throw new OfflineBundleError('offline bundle release does not match');
  if (verified.manifest.planDigest !== expected.planDigest) throw new OfflineBundleError('offline bundle plan digest does not match');
  if (JSON.stringify(verified.manifest.platform) !== JSON.stringify(expected.platform)) throw new OfflineBundleError('offline bundle platform does not match');
  if (!exactSet(verified.manifest.selectedTaskIds, expected.selectedTaskIds)) throw new OfflineBundleError('offline bundle selected task closure does not match');
  const artifactIds = verified.manifest.artifacts.map(item => item.id);
  if (!exactSet(artifactIds, expected.artifactIds)) throw new OfflineBundleError('offline bundle artifact closure is incomplete or contains extras');
  return { ...verified, artifactIds: [...artifactIds].sort((left, right) => left.localeCompare(right)), plannedAt: now };
}

export async function applyOfflineBundle(input: {
  plan: OfflineBundlePlan; destinationDirectory: string; trust: unknown; releaseTrust: unknown; now?: string;
  fault?: (point: 'after-materialization-durable' | 'before-materialization-publish') => Promise<void>;
}): Promise<{ schemaVersion: 1; manifestDigest: string; artifactIds: string[]; networkAllowed: false }> {
  if (!isAbsolute(input.destinationDirectory)) throw new OfflineBundleError('offline destination must be absolute');
  const verified = await verifyOfflineBundle({ bundleDirectory: input.plan.bundleDirectory, trust: input.trust, releaseTrust: input.releaseTrust });
  if (verified.manifestDigest !== input.plan.manifestDigest) throw new OfflineBundleError('offline bundle changed after planning');
  const now = timestamp.parse(input.now ?? new Date().toISOString());
  if (new Date(verified.manifest.createdAt).getTime() > new Date(now).getTime()) throw new OfflineBundleError('offline bundle is not valid yet');
  if (new Date(verified.manifest.expiresAt).getTime() <= new Date(now).getTime()) throw new OfflineBundleError('offline bundle expired before apply');
  const requestedDestination = resolve(input.destinationDirectory);
  const parent = await realpath(dirname(requestedDestination));
  const destination = join(parent, basename(requestedDestination));
  const fromBundle = relative(verified.bundleDirectory, destination);
  if (fromBundle === '' || (!fromBundle.startsWith(`..${sep}`) && fromBundle !== '..' && !isAbsolute(fromBundle))) {
    throw new OfflineBundleError('offline destination must not be inside the immutable bundle');
  }
  const stage = await mkdtemp(join(parent, '.offline-apply-'));
  try {
    await chmod(stage, 0o700);
    for (const item of verified.manifest.artifacts) {
      const bytes = await secureRead(join(verified.bundleDirectory, item.path), item.sizeBytes);
      if (sha256(bytes) !== item.sha256) throw new OfflineBundleError(`artifact changed during apply: ${item.id}`);
      await writeDurableExclusive(join(stage, item.id), bytes, Number.parseInt(item.mode, 8));
    }
    await syncDirectory(stage);
    await input.fault?.('after-materialization-durable');
    await input.fault?.('before-materialization-publish');
    try { await rename(stage, destination); }
    catch { throw new OfflineBundleError('offline destination already exists or cannot be activated'); }
    await syncDirectory(parent);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return {
    schemaVersion: 1, manifestDigest: verified.manifestDigest,
    artifactIds: verified.manifest.artifacts.map(item => item.id).sort((left, right) => left.localeCompare(right)),
    networkAllowed: false,
  };
}
