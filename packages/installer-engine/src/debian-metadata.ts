import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { NativeOfflinePayloadDescriptor } from './contracts.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const FIELD = /^[A-Za-z0-9][A-Za-z0-9-]*:[ \t]?(.*)$/;
const HEX_64 = /^[a-f0-9]{64}$/;

export class DebianMetadataError extends Error {
  constructor(message: string) { super(message); this.name = 'DebianMetadataError'; }
}

export interface VerifiedInRelease {
  readonly cleartext: Buffer;
  readonly signingKeyFingerprint: string;
}

export interface DebianMetadataVerifier {
  readonly verifyInRelease: (bytes: Buffer, keyringBytes: Buffer) => Promise<VerifiedInRelease>;
  readonly decompressPackages?: (path: string, bytes: Buffer) => Promise<Buffer>;
  readonly now?: () => Date;
}

export interface VerifiedDebianMetadata {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageArchitecture: string;
  readonly packageFilename: string;
  readonly inReleaseFingerprint: string;
  readonly inReleaseDate: string;
  readonly inReleaseValidUntil: string;
  readonly packagesIndexSha256: string;
  readonly payloadSha256: string;
}

type Paragraph = ReadonlyMap<string, string>;

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

function exactArtifact(bytes: Buffer, expected: { readonly sizeBytes: number; readonly sha256: string }, label: string): void {
  if (bytes.length !== expected.sizeBytes) throw new DebianMetadataError(`${label} size does not match signed catalog authority`);
  if (sha256(bytes) !== expected.sha256) throw new DebianMetadataError(`${label} digest does not match signed catalog authority`);
}

function parseParagraphs(bytes: Buffer, label: string, maximumBytes: number, maximumParagraphs: number): Paragraph[] {
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new DebianMetadataError(`${label} exceeds its bounded size or is empty`);
  let text: string;
  try { text = decoder.decode(bytes); } catch { throw new DebianMetadataError(`${label} is not canonical UTF-8 text`); }
  if (text.includes('\0') || /\r(?!\n)/.test(text)) throw new DebianMetadataError(`${label} contains an unsafe control or newline encoding`);
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const paragraphs: Map<string, string>[] = [];
  let paragraph = new Map<string, string>();
  let priorKey: string | undefined;
  const finish = (): void => {
    if (paragraph.size === 0) return;
    paragraphs.push(paragraph); paragraph = new Map(); priorKey = undefined;
    if (paragraphs.length > maximumParagraphs) throw new DebianMetadataError(`${label} contains too many paragraphs`);
  };
  for (const line of lines) {
    if (line === '') { finish(); continue; }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (priorKey === undefined) throw new DebianMetadataError(`${label} contains an orphan continuation line`);
      paragraph.set(priorKey, `${paragraph.get(priorKey)!}\n${line.slice(1)}`);
      continue;
    }
    const match = FIELD.exec(line);
    if (!match) throw new DebianMetadataError(`${label} contains a malformed control field`);
    const key = line.slice(0, line.indexOf(':')).toLowerCase();
    if (paragraph.has(key)) throw new DebianMetadataError(`${label} contains duplicate field ${key}`);
    const value = match[1]!;
    if (value.length > 65_536) throw new DebianMetadataError(`${label} field ${key} exceeds its bound`);
    paragraph.set(key, value); priorKey = key;
  }
  finish();
  if (paragraphs.length === 0) throw new DebianMetadataError(`${label} has no control paragraph`);
  return paragraphs;
}

function required(paragraph: Paragraph, name: string, label: string): string {
  const value = paragraph.get(name.toLowerCase());
  if (value === undefined || value.length === 0) throw new DebianMetadataError(`${label} is missing ${name}`);
  return value;
}

function exactTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new DebianMetadataError(`${label} is not a valid timestamp`);
  return parsed;
}

function listContains(value: string, expected: string): boolean {
  return value.split(/[ \t]+/).filter(Boolean).includes(expected);
}

function releaseSha256Entry(release: Paragraph, path: string): { sha256: string; sizeBytes: number } {
  const raw = required(release, 'SHA256', 'InRelease');
  let found: { sha256: string; sizeBytes: number } | undefined;
  for (const line of raw.split('\n').filter(candidate => candidate.length > 0)) {
    const match = /^([a-f0-9]{64})[ \t]+(0|[1-9][0-9]*)[ \t]+([^\s]+)$/.exec(line);
    if (!match) throw new DebianMetadataError('InRelease SHA256 list is malformed');
    if (match[3] !== path) continue;
    if (found) throw new DebianMetadataError('InRelease contains duplicate Packages checksum authority');
    const sizeBytes = Number(match[2]);
    if (!Number.isSafeInteger(sizeBytes)) throw new DebianMetadataError('InRelease Packages size is unsafe');
    found = { sha256: match[1]!, sizeBytes };
  }
  if (!found) throw new DebianMetadataError('InRelease does not authorize the selected Packages index');
  return found;
}

function nullableExact(actual: string | undefined, expected: string | null, field: string): void {
  if ((actual ?? null) !== expected) throw new DebianMetadataError(`Packages stanza ${field} differs from signed catalog authority`);
}

export async function verifyDebianRepositoryMetadata(input: {
  readonly descriptor: NativeOfflinePayloadDescriptor;
  readonly inReleaseBytes: Buffer;
  readonly keyringBytes: Buffer;
  readonly packagesIndexBytes: Buffer;
  readonly payloadBytes: Buffer;
  readonly verifier: DebianMetadataVerifier;
}): Promise<VerifiedDebianMetadata> {
  const { descriptor } = input;
  exactArtifact(input.inReleaseBytes, descriptor.metadataProof.inRelease, 'InRelease');
  exactArtifact(input.keyringBytes, descriptor.metadataProof.inRelease.keyring, 'repository keyring');
  exactArtifact(input.packagesIndexBytes, descriptor.metadataProof.packagesIndex, 'Packages index');
  exactArtifact(input.payloadBytes, descriptor.artifact, 'Debian package payload');

  const signature = await input.verifier.verifyInRelease(Buffer.from(input.inReleaseBytes), Buffer.from(input.keyringBytes));
  const expectedFingerprint = descriptor.metadataProof.inRelease.signingKeyFingerprint.toUpperCase();
  if (!/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(signature.signingKeyFingerprint.toUpperCase())
    || signature.signingKeyFingerprint.toUpperCase() !== expectedFingerprint) {
    throw new DebianMetadataError('InRelease signature fingerprint does not match signed catalog authority');
  }
  const releaseParagraphs = parseParagraphs(signature.cleartext, 'InRelease', 16_777_216, 1);
  if (releaseParagraphs.length !== 1) throw new DebianMetadataError('InRelease must contain exactly one Release paragraph');
  const release = releaseParagraphs[0]!;
  const date = required(release, 'Date', 'InRelease');
  const validUntil = required(release, 'Valid-Until', 'InRelease');
  const dateMs = exactTimestamp(date, 'InRelease Date');
  const validUntilMs = exactTimestamp(validUntil, 'InRelease Valid-Until');
  if (dateMs !== Date.parse(descriptor.metadataProof.inRelease.signedAt)
    || validUntilMs !== Date.parse(descriptor.metadataProof.inRelease.validUntil)) {
    throw new DebianMetadataError('InRelease timestamps differ from signed catalog authority');
  }
  const nowMs = (input.verifier.now ?? (() => new Date()))().getTime();
  if (nowMs < dateMs || nowMs >= validUntilMs) throw new DebianMetadataError('InRelease is not currently valid');
  const suite = release.get('suite'); const codename = release.get('codename');
  if (suite !== descriptor.repository.suite && codename !== descriptor.repository.suite
    && codename !== descriptor.distro.codename) throw new DebianMetadataError('InRelease suite/codename does not match signed catalog authority');
  if (!listContains(required(release, 'Components', 'InRelease'), descriptor.repository.component)) throw new DebianMetadataError('InRelease does not authorize the selected component');
  const expectedArchitecture = descriptor.platform.arch === 'x64' ? 'amd64' : 'arm64';
  if (!listContains(required(release, 'Architectures', 'InRelease'), expectedArchitecture)) throw new DebianMetadataError('InRelease does not authorize the selected architecture');
  const releasePrefix = `dists/${descriptor.repository.suite}/`;
  if (!descriptor.metadataProof.packagesIndex.path.startsWith(releasePrefix)) {
    throw new DebianMetadataError('Packages index path is outside the signed Release directory');
  }
  const releaseIndexPath = descriptor.metadataProof.packagesIndex.path.slice(releasePrefix.length);
  const indexAuthority = releaseSha256Entry(release, releaseIndexPath);
  if (indexAuthority.sha256 !== descriptor.metadataProof.packagesIndex.sha256
    || indexAuthority.sizeBytes !== descriptor.metadataProof.packagesIndex.sizeBytes) {
    throw new DebianMetadataError('Packages index differs from the checksum and size certified by InRelease');
  }

  let packagesBytes = input.packagesIndexBytes;
  if (/\.(?:gz|xz)$/.test(descriptor.metadataProof.packagesIndex.path)) {
    if (!input.verifier.decompressPackages) throw new DebianMetadataError('compressed Packages index requires a bounded trusted decompressor');
    packagesBytes = await input.verifier.decompressPackages(descriptor.metadataProof.packagesIndex.path, Buffer.from(packagesBytes));
  }
  const stanzas = parseParagraphs(packagesBytes, 'Packages index', 268_435_456, 1_000_000);
  const candidates = stanzas.filter(stanza => stanza.get('package') === descriptor.package.name
    && stanza.get('version') === descriptor.package.version
    && stanza.get('architecture') === descriptor.package.architecture);
  if (candidates.length !== 1) throw new DebianMetadataError('Packages index must contain exactly one matching package stanza');
  const stanza = candidates[0]!;
  const proof = descriptor.metadataProof.packageStanza;
  if (required(stanza, 'Filename', 'Packages stanza') !== proof.filename
    || required(stanza, 'SHA256', 'Packages stanza') !== proof.sha256
    || required(stanza, 'Size', 'Packages stanza') !== String(proof.sizeBytes)) {
    throw new DebianMetadataError('Packages stanza payload authority differs from signed catalog authority');
  }
  if (!HEX_64.test(proof.sha256) || proof.sha256 !== descriptor.artifact.sha256 || proof.sizeBytes !== descriptor.artifact.sizeBytes) {
    throw new DebianMetadataError('Packages stanza does not bind the exact Debian payload');
  }
  nullableExact(stanza.get('depends'), proof.depends, 'Depends');
  nullableExact(stanza.get('pre-depends'), proof.preDepends, 'Pre-Depends');
  const essential = stanza.get('essential') ?? 'absent';
  if (essential !== proof.essential) throw new DebianMetadataError('Packages stanza Essential differs from signed catalog authority');
  const multiArch = stanza.get('multi-arch') ?? 'absent';
  if (multiArch !== proof.multiArch) throw new DebianMetadataError('Packages stanza Multi-Arch differs from signed catalog authority');

  return Object.freeze({
    packageName: descriptor.package.name, packageVersion: descriptor.package.version,
    packageArchitecture: descriptor.package.architecture, packageFilename: proof.filename,
    inReleaseFingerprint: expectedFingerprint, inReleaseDate: new Date(dateMs).toISOString(),
    inReleaseValidUntil: new Date(validUntilMs).toISOString(), packagesIndexSha256: indexAuthority.sha256,
    payloadSha256: descriptor.artifact.sha256,
  });
}
