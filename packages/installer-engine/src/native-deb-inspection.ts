import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath, type FileHandle } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { z } from 'zod';

import {
  NativeOfflinePayloadDescriptorSchema,
  type NativeOfflinePayloadDescriptor,
} from './contracts.js';

const DPKG_DEB = '/usr/bin/dpkg-deb';
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 8_388_608;
const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const fieldName = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const packageName = z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,127}$/);
const version = z.string().min(1).max(256).refine(value => !/[\0\r\n]/.test(value));
const architecture = z.enum(['amd64', 'arm64', 'all']);
const dependency = z.string().min(1).max(16_384).refine(value => !/[\0\r]/.test(value));
const canonicalConffile = z.string().min(2).max(4096).refine(value => {
  if (!value.startsWith('/') || value.includes('\0') || value.includes('//')) return false;
  return value.split('/').slice(1).every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}, 'conffile must be a canonical absolute path');

export class NativeDebInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeDebInspectionError';
  }
}

export interface DebianControlMetadata {
  readonly packageName: string;
  readonly version: string;
  readonly architecture: 'amd64' | 'arm64' | 'all';
  readonly depends: string | null;
  readonly preDepends: string | null;
  readonly essential: 'absent' | 'no' | 'yes';
  readonly multiArch: 'absent' | 'foreign' | 'same' | 'allowed';
}

export interface DebianControlArchiveMember {
  readonly name: 'control' | 'conffiles' | 'md5sums';
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface ParsedDebianControlArchive {
  readonly control: DebianControlMetadata;
  readonly conffiles: readonly string[];
  readonly members: readonly DebianControlArchiveMember[];
}

export interface DpkgDebControlArchiveRunner {
  readonly extractControlArchive: (input: {
    readonly payloadDescriptor: number;
    readonly timeoutMilliseconds: number;
    readonly maximumOutputBytes: number;
    readonly signal?: AbortSignal;
  }) => Promise<Buffer>;
}

export interface NativeDebInspectionInput {
  readonly descriptor: NativeOfflinePayloadDescriptor;
  /** Borrowed authority: this function never closes or changes the caller's handle offset. */
  readonly payloadHandle: Pick<FileHandle, 'fd' | 'stat'>;
  readonly runner?: DpkgDebControlArchiveRunner;
  readonly timeoutMilliseconds?: number;
  readonly maximumOutputBytes?: number;
  readonly signal?: AbortSignal;
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new NativeDebInspectionError(`${label} must be a positive safe integer`);
  return value;
}

function decode(bytes: Buffer, label: string): string {
  try { return utf8.decode(bytes); }
  catch { throw new NativeDebInspectionError(`${label} is not canonical UTF-8`); }
}

function parseOctal(bytes: Buffer, label: string): number {
  const raw = bytes.toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(raw)) throw new NativeDebInspectionError(`control archive ${label} is not canonical octal`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new NativeDebInspectionError(`control archive ${label} exceeds the safe integer range`);
  return value;
}

function tarHeaderChecksum(header: Buffer): number {
  let total = 0;
  for (let index = 0; index < header.length; index += 1) {
    total += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  return total;
}

function tarString(bytes: Buffer, label: string): string {
  const nul = bytes.indexOf(0);
  const value = decode(nul < 0 ? bytes : bytes.subarray(0, nul), label);
  if (value.includes('\0') || /[\r\n]/.test(value)) throw new NativeDebInspectionError(`control archive ${label} contains unsafe controls`);
  return value;
}

function canonicalMemberName(raw: string): string {
  const name = raw.startsWith('./') ? raw.slice(2) : raw;
  if (name.length === 0 || name.startsWith('/') || name.includes('/') || name === '.' || name === '..') {
    throw new NativeDebInspectionError('control archive member path is unsafe, non-canonical, or traverses directories');
  }
  return name;
}

function parseControl(bytes: Buffer): DebianControlMetadata {
  if (bytes.length === 0 || bytes.length > 1_048_576) throw new NativeDebInspectionError('control metadata is empty or exceeds its byte bound');
  const source = decode(bytes, 'control metadata');
  if (source.includes('\0') || /\r(?!\n)/.test(source)) throw new NativeDebInspectionError('control metadata contains unsafe controls');
  const fields = new Map<string, string>();
  let priorKey: string | undefined;
  let sawParagraphEnd = false;
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    if (line === '') { sawParagraphEnd = fields.size > 0; continue; }
    if (sawParagraphEnd) throw new NativeDebInspectionError('control metadata must contain exactly one paragraph');
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (priorKey === undefined) throw new NativeDebInspectionError('control metadata has an orphan continuation');
      fields.set(priorKey, `${fields.get(priorKey)!}\n${line.slice(1)}`);
      continue;
    }
    const separator = line.indexOf(':');
    const rawName = separator < 1 ? '' : line.slice(0, separator);
    if (!fieldName.test(rawName)) throw new NativeDebInspectionError('control metadata contains a malformed field');
    const key = rawName.toLowerCase();
    if (fields.has(key)) throw new NativeDebInspectionError(`control metadata contains duplicate field ${rawName}`);
    const rawValue = line.slice(separator + 1);
    const value = rawValue.startsWith(' ') || rawValue.startsWith('\t') ? rawValue.slice(1) : rawValue;
    if (value.length > 65_536) throw new NativeDebInspectionError(`control metadata field ${rawName} exceeds its bound`);
    fields.set(key, value);
    priorKey = key;
  }
  const required = (name: string): string => {
    const value = fields.get(name.toLowerCase());
    if (!value) throw new NativeDebInspectionError(`control metadata is missing ${name}`);
    return value;
  };
  const optional = (name: string): string | null => fields.get(name.toLowerCase()) ?? null;
  return Object.freeze({
    packageName: packageName.parse(required('Package')),
    version: version.parse(required('Version')),
    architecture: architecture.parse(required('Architecture')),
    depends: optional('Depends') === null ? null : dependency.parse(optional('Depends')),
    preDepends: optional('Pre-Depends') === null ? null : dependency.parse(optional('Pre-Depends')),
    essential: z.enum(['no', 'yes']).nullable().transform(value => value ?? 'absent').parse(optional('Essential')),
    multiArch: z.enum(['foreign', 'same', 'allowed']).nullable().transform(value => value ?? 'absent').parse(optional('Multi-Arch')),
  });
}

function parseConffiles(bytes: Buffer): readonly string[] {
  if (bytes.length === 0 || bytes.length > 1_048_576) throw new NativeDebInspectionError('conffiles metadata is empty or exceeds its byte bound');
  const source = decode(bytes, 'conffiles metadata');
  if (source.includes('\0') || source.includes('\r')) throw new NativeDebInspectionError('conffiles metadata contains unsafe controls');
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const values = lines.map(value => canonicalConffile.parse(value));
  if (values.length === 0 || new Set(values).size !== values.length) throw new NativeDebInspectionError('conffiles metadata is empty or contains duplicates');
  return Object.freeze(values);
}

function validateMd5sums(bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > 4_194_304) throw new NativeDebInspectionError('md5sums metadata is empty or exceeds its byte bound');
  const source = decode(bytes, 'md5sums metadata');
  if (source.includes('\0') || source.includes('\r')) throw new NativeDebInspectionError('md5sums metadata contains unsafe controls');
  const paths = new Set<string>();
  for (const line of source.split('\n').filter(value => value.length > 0)) {
    const match = /^[a-f0-9]{32}  (.+)$/.exec(line);
    if (!match) throw new NativeDebInspectionError('md5sums metadata contains a malformed record');
    const path = match[1]!;
    if (path.startsWith('/') || path.includes('//') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      throw new NativeDebInspectionError('md5sums metadata contains an unsafe payload path');
    }
    if (paths.has(path)) throw new NativeDebInspectionError('md5sums metadata contains a duplicate payload path');
    paths.add(path);
  }
  if (paths.size === 0) throw new NativeDebInspectionError('md5sums metadata has no records');
}

export function parseDebianControlArchive(bytes: Buffer): ParsedDebianControlArchive {
  if (bytes.length < TAR_END_BYTES || bytes.length > DEFAULT_MAXIMUM_OUTPUT_BYTES || bytes.length % TAR_BLOCK_BYTES !== 0) {
    throw new NativeDebInspectionError('control archive is empty, oversized, not block aligned, or contains trailing data');
  }
  const bodies = new Map<string, Buffer>();
  let cursor = 0;
  let ended = false;
  let sawRootDirectory = false;
  while (cursor + TAR_BLOCK_BYTES <= bytes.length) {
    const header = bytes.subarray(cursor, cursor + TAR_BLOCK_BYTES);
    if (header.every(byte => byte === 0)) {
      const second = bytes.subarray(cursor + TAR_BLOCK_BYTES, cursor + TAR_END_BYTES);
      if (second.length !== TAR_BLOCK_BYTES || !second.every(byte => byte === 0)
        || !bytes.subarray(cursor + TAR_END_BYTES).every(byte => byte === 0)) {
        throw new NativeDebInspectionError('control archive has malformed end blocks or trailing data');
      }
      ended = true;
      break;
    }
    const storedChecksum = parseOctal(header.subarray(148, 156), 'header checksum');
    if (storedChecksum !== tarHeaderChecksum(header)) throw new NativeDebInspectionError('control archive header checksum does not match');
    const magic = header.subarray(257, 263).toString('binary');
    if (magic !== 'ustar\0' && magic !== 'ustar ') throw new NativeDebInspectionError('control archive is not a supported ustar archive');
    const rawName = tarString(header.subarray(0, 100), 'member name');
    const prefix = tarString(header.subarray(345, 500), 'member prefix');
    const linkName = tarString(header.subarray(157, 257), 'link name');
    const type = header[156];
    const size = parseOctal(header.subarray(124, 136), 'member size');
    if (rawName === './' && type === 0x35 && prefix === '' && linkName === '' && size === 0) {
      if (sawRootDirectory) throw new NativeDebInspectionError('control archive contains a duplicate root directory member');
      sawRootDirectory = true;
      cursor += TAR_BLOCK_BYTES;
      continue;
    }
    const name = canonicalMemberName(rawName);
    if (prefix !== '' || linkName !== '' || (type !== 0 && type !== 0x30)) {
      throw new NativeDebInspectionError('control archive members must be plain regular files without links or prefixes');
    }
    if (bodies.has(name)) throw new NativeDebInspectionError(`control archive contains duplicate member ${name}`);
    if (!['control', 'conffiles', 'md5sums'].includes(name)) {
      if (['preinst', 'postinst', 'prerm', 'postrm', 'config'].includes(name)) {
        throw new NativeDebInspectionError(`maintainer script ${name} is not admitted by the initial production profile`);
      }
      if (name === 'triggers') throw new NativeDebInspectionError('trigger metadata is not admitted by the initial production profile');
      throw new NativeDebInspectionError(`control archive member ${name} has unreviewed broad effects and is not admitted`);
    }
    const bodyStart = cursor + TAR_BLOCK_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > bytes.length || size > DEFAULT_MAXIMUM_OUTPUT_BYTES) throw new NativeDebInspectionError('control archive member exceeds its byte or archive boundary');
    bodies.set(name, Buffer.from(bytes.subarray(bodyStart, bodyEnd)));
    cursor = bodyStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }
  if (!ended) throw new NativeDebInspectionError('control archive has no canonical end marker');
  const controlBytes = bodies.get('control');
  if (!controlBytes) throw new NativeDebInspectionError('control archive has no control metadata member');
  const conffilesBytes = bodies.get('conffiles');
  const md5sumsBytes = bodies.get('md5sums');
  if (md5sumsBytes) validateMd5sums(md5sumsBytes);
  const members = [...bodies.entries()].map(([name, body]) => Object.freeze({
    name: name as DebianControlArchiveMember['name'], sizeBytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  })).sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({
    control: parseControl(controlBytes),
    conffiles: conffilesBytes ? parseConffiles(conffilesBytes) : Object.freeze([]),
    members: Object.freeze(members),
  });
}

async function assertTrustedDpkgDeb(): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  let canonical: string;
  try {
    [metadata, canonical] = await Promise.all([lstat(DPKG_DEB), realpath(DPKG_DEB)]);
    await access(DPKG_DEB, constants.X_OK);
  } catch { throw new NativeDebInspectionError('fixed /usr/bin/dpkg-deb executable is unavailable'); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink < 1 || metadata.uid !== 0
    || (metadata.mode & 0o022) !== 0 || canonical !== DPKG_DEB) {
    throw new NativeDebInspectionError('fixed /usr/bin/dpkg-deb is not a trusted root-owned executable');
  }
}

export function createNativeDpkgDebControlArchiveRunner(): DpkgDebControlArchiveRunner {
  return Object.freeze({
    extractControlArchive: async (input: Parameters<DpkgDebControlArchiveRunner['extractControlArchive']>[0]) => {
      await assertTrustedDpkgDeb();
      return await new Promise<Buffer>((resolve, reject) => {
        const child = spawn(DPKG_DEB, ['--ctrl-tarfile', '/proc/self/fd/3'], {
          shell: false,
          env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' },
          stdio: ['ignore', 'pipe', 'pipe', input.payloadDescriptor],
          windowsHide: true,
        });
        const output: Buffer[] = [];
        const diagnostics: Buffer[] = [];
        let outputBytes = 0;
        let diagnosticBytes = 0;
        let terminalError: NativeDebInspectionError | undefined;
        let settled = false;
        const fail = (error: NativeDebInspectionError): void => {
          terminalError ??= error;
          child.kill('SIGKILL');
        };
        const timer = setTimeout(() => fail(new NativeDebInspectionError('dpkg-deb control extraction timed out')), input.timeoutMilliseconds);
        timer.unref();
        const abort = (): void => fail(new NativeDebInspectionError('dpkg-deb control extraction was cancelled'));
        input.signal?.addEventListener('abort', abort, { once: true });
        if (input.signal?.aborted) abort();
        child.stdout!.on('data', (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > input.maximumOutputBytes) fail(new NativeDebInspectionError('dpkg-deb control archive exceeded its output bound'));
          else output.push(Buffer.from(chunk));
        });
        child.stderr!.on('data', (chunk: Buffer) => {
          diagnosticBytes += chunk.length;
          if (diagnosticBytes > 65_536) fail(new NativeDebInspectionError('dpkg-deb diagnostics exceeded their output bound'));
          else diagnostics.push(Buffer.from(chunk));
        });
        child.once('error', error => {
          if (settled) return;
          settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
          reject(new NativeDebInspectionError(`dpkg-deb could not start: ${error.message}`));
        });
        child.once('close', (code, signal) => {
          if (settled) return;
          settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
          if (terminalError) return reject(terminalError);
          if (code !== 0) {
            const diagnostic = Buffer.concat(diagnostics).toString('utf8').replaceAll(/[\r\n]+/g, ' ').trim().slice(0, 512);
            return reject(new NativeDebInspectionError(`dpkg-deb failed (${signal ?? `exit ${String(code)}`})${diagnostic ? `: ${diagnostic}` : ''}`));
          }
          resolve(Buffer.concat(output));
        });
      });
    },
  });
}

function assertExactAuthority(actual: string | null, expected: string | null, field: string): void {
  if (actual !== expected) throw new NativeDebInspectionError(`control ${field} differs from signed catalog authority`);
}

export async function inspectNativeDebianPackage(input: NativeDebInspectionInput): Promise<ParsedDebianControlArchive> {
  const descriptor = NativeOfflinePayloadDescriptorSchema.parse(input.descriptor);
  const timeoutMilliseconds = positiveBound(input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS, 'timeoutMilliseconds');
  const maximumOutputBytes = positiveBound(input.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES, 'maximumOutputBytes');
  if (maximumOutputBytes > DEFAULT_MAXIMUM_OUTPUT_BYTES) throw new NativeDebInspectionError('maximumOutputBytes cannot exceed the audited control archive ceiling');
  if (!Number.isSafeInteger(input.payloadHandle.fd) || input.payloadHandle.fd < 0) throw new NativeDebInspectionError('borrowed payload descriptor is invalid');
  const before = await input.payloadHandle.stat();
  if (!before.isFile() || before.size !== descriptor.artifact.sizeBytes || before.size <= 0) {
    throw new NativeDebInspectionError('borrowed payload is not a regular file with the exact authorized size');
  }
  const archive = await (input.runner ?? createNativeDpkgDebControlArchiveRunner()).extractControlArchive({
    payloadDescriptor: input.payloadHandle.fd, timeoutMilliseconds, maximumOutputBytes,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (archive.length > maximumOutputBytes) throw new NativeDebInspectionError('control archive exceeded its output bound');
  const after = await input.payloadHandle.stat();
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new NativeDebInspectionError('borrowed payload changed while its control archive was inspected');
  }
  const result = parseDebianControlArchive(archive);
  if (result.control.packageName !== descriptor.package.name) throw new NativeDebInspectionError('control Package differs from signed catalog authority');
  if (result.control.version !== descriptor.package.version) throw new NativeDebInspectionError('control Version differs from signed catalog authority');
  if (result.control.architecture !== descriptor.package.architecture) throw new NativeDebInspectionError('control Architecture differs from signed catalog authority');
  assertExactAuthority(result.control.depends, descriptor.metadataProof.packageStanza.depends, 'Depends');
  assertExactAuthority(result.control.preDepends, descriptor.metadataProof.packageStanza.preDepends, 'Pre-Depends');
  assertExactAuthority(result.control.essential, descriptor.metadataProof.packageStanza.essential, 'Essential');
  assertExactAuthority(result.control.multiArch, descriptor.metadataProof.packageStanza.multiArch, 'Multi-Arch');
  if (result.conffiles.length !== descriptor.conffiles.length
    || result.conffiles.some((value, index) => value !== descriptor.conffiles[index])) {
    throw new NativeDebInspectionError('control conffiles differ from signed catalog authority');
  }
  return result;
}
