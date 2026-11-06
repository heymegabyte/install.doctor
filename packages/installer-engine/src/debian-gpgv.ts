import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import { access, lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { TextDecoder } from 'node:util';

import type { DebianMetadataVerifier, VerifiedInRelease } from './debian-metadata.js';

const GPGV = '/usr/bin/gpgv';
const GZIP = '/usr/bin/gzip';
const XZ = '/usr/bin/xz';
const DEFAULT_MAXIMUM_PROCESS_OUTPUT_BYTES = 1_048_576;
const DEFAULT_MAXIMUM_DECOMPRESSED_BYTES = 268_435_456;
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class DebianGpgvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebianGpgvError';
  }
}

/**
 * Trust is deliberately established by the caller. This module neither discovers nor
 * downloads keys. A FileHandle is preferred because it keeps authority pinned to the
 * already-open object while gpgv runs.
 */
export type VerifiedDebianKeyringAuthority =
  | { readonly kind: 'file-handle'; readonly handle: FileHandle }
  | { readonly kind: 'path'; readonly absolutePath: string };

export interface DefaultDebianMetadataVerifierOptions {
  readonly keyring: VerifiedDebianKeyringAuthority;
  readonly maximumProcessOutputBytes?: number;
  readonly maximumDecompressedBytes?: number;
  readonly timeoutMilliseconds?: number;
  readonly now?: () => Date;
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DebianGpgvError(`${label} must be a positive safe integer`);
  return value;
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new DebianGpgvError(`${label} is not canonical UTF-8`);
  }
}

export function extractInReleaseCleartext(bytes: Buffer): Buffer {
  if (bytes.length === 0 || bytes.includes(0)) throw new DebianGpgvError('InRelease clear-sign envelope is empty or contains NUL');
  const source = decodeUtf8(bytes, 'InRelease clear-sign envelope');
  if (/\r(?!\n)/.test(source)) throw new DebianGpgvError('InRelease clear-sign envelope contains a bare carriage return');
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  if (lines[0] !== '-----BEGIN PGP SIGNED MESSAGE-----') throw new DebianGpgvError('InRelease is not an OpenPGP clear-signed message');

  let cursor = 1;
  let hashHeaders = 0;
  while (cursor < lines.length && lines[cursor] !== '') {
    if (!/^Hash: [A-Za-z0-9][A-Za-z0-9, -]*$/.test(lines[cursor]!)) {
      throw new DebianGpgvError('InRelease clear-sign armor contains an unsupported header');
    }
    hashHeaders += 1;
    cursor += 1;
  }
  if (hashHeaders === 0 || cursor >= lines.length) throw new DebianGpgvError('InRelease clear-sign armor has no Hash header or body separator');
  cursor += 1;

  const cleartext: string[] = [];
  while (cursor < lines.length && lines[cursor] !== '-----BEGIN PGP SIGNATURE-----') {
    const line = lines[cursor]!;
    if (line.startsWith('- ')) cleartext.push(line.slice(2));
    else if (line.startsWith('-')) throw new DebianGpgvError('InRelease cleartext contains malformed dash escaping');
    else cleartext.push(line);
    cursor += 1;
  }
  if (cursor >= lines.length || cleartext.length === 0) throw new DebianGpgvError('InRelease clear-sign envelope has no signature or cleartext');

  const remaining = lines.slice(cursor);
  const endIndexes = remaining.flatMap((line, index) => line === '-----END PGP SIGNATURE-----' ? [index] : []);
  if (endIndexes.length !== 1 || endIndexes[0] === 0) throw new DebianGpgvError('InRelease contains a malformed signature armor block');
  const afterEnd = remaining.slice(endIndexes[0]! + 1);
  if (afterEnd.some(line => line !== '')) throw new DebianGpgvError('InRelease contains trailing data after its signature');
  if (remaining.slice(1, endIndexes[0]).some(line => line === '-----BEGIN PGP SIGNATURE-----')) {
    throw new DebianGpgvError('InRelease contains multiple signature armor blocks');
  }
  return Buffer.from(`${cleartext.join('\n')}\n`, 'utf8');
}

export function parseGpgvValidSignature(status: Buffer): string {
  const text = decodeUtf8(status, 'gpgv status output');
  if (/^\[GNUPG:\] (?:BADSIG|ERRSIG|NO_PUBKEY|EXPSIG|EXPKEYSIG|REVKEYSIG)(?: |$)/m.test(text)) {
    throw new DebianGpgvError('gpgv reported an invalid, unavailable, expired, or revoked signature');
  }
  const fingerprints: string[] = [];
  let validSignatureRecords = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('[GNUPG:] VALIDSIG ')) validSignatureRecords += 1;
    const match = /^\[GNUPG:\] VALIDSIG ([A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})(?: |$)/.exec(line);
    if (match) fingerprints.push(match[1]!.toUpperCase());
  }
  if (validSignatureRecords !== 1 || fingerprints.length !== 1) {
    throw new DebianGpgvError('gpgv status must contain exactly one VALIDSIG full fingerprint');
  }
  return fingerprints[0]!;
}

interface FixedProcessResult { readonly stdout: Buffer; readonly stderr: Buffer }

async function assertTrustedFixedExecutable(executable: typeof GPGV | typeof GZIP | typeof XZ): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  let canonical: string;
  try {
    [metadata, canonical] = await Promise.all([lstat(executable), realpath(executable)]);
    await access(executable, constants.X_OK);
  } catch {
    throw new DebianGpgvError(`${executable} is unavailable or not executable`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink < 1 || metadata.uid !== 0
    || (metadata.mode & 0o022) !== 0 || canonical !== executable) {
    throw new DebianGpgvError(`${executable} is not a trusted fixed root-owned executable`);
  }
}

async function readPinnedFile(handle: FileHandle, maximumBytes: number): Promise<Buffer> {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes || !Number.isSafeInteger(stat.size)) {
    throw new DebianGpgvError('verified Debian keyring authority is empty, not regular, or exceeds its byte bound');
  }
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (result.bytesRead === 0) throw new DebianGpgvError('verified Debian keyring authority changed while being read');
    offset += result.bytesRead;
  }
  const after = await handle.stat();
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
    throw new DebianGpgvError('verified Debian keyring authority changed while being read');
  }
  return bytes;
}

async function runFixedProcess(input: {
  readonly executable: typeof GPGV | typeof GZIP | typeof XZ;
  readonly arguments: readonly string[];
  readonly stdin: Buffer;
  readonly maximumStdoutBytes: number;
  readonly maximumStderrBytes: number;
  readonly timeoutMilliseconds: number;
  readonly inheritedDescriptor?: number;
}): Promise<FixedProcessResult> {
  await assertTrustedFixedExecutable(input.executable);
  return await new Promise((resolve, reject) => {
    const stdio: ['pipe', 'pipe', 'pipe', ...number[]] = input.inheritedDescriptor === undefined
      ? ['pipe', 'pipe', 'pipe']
      : ['pipe', 'pipe', 'pipe', input.inheritedDescriptor];
    const child = spawn(input.executable, [...input.arguments], {
      env: { LANG: 'C', LC_ALL: 'C' },
      shell: false,
      stdio,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: DebianGpgvError | undefined;
    let settled = false;
    const fail = (error: DebianGpgvError): void => {
      terminalError ??= error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(new DebianGpgvError(`${input.executable} timed out`)), input.timeoutMilliseconds);
    timer.unref();
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > input.maximumStdoutBytes) fail(new DebianGpgvError(`${input.executable} output exceeded its byte bound`));
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > input.maximumStderrBytes) fail(new DebianGpgvError(`${input.executable} diagnostic output exceeded its byte bound`));
      else stderr.push(Buffer.from(chunk));
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DebianGpgvError(`${input.executable} could not start: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminalError) return reject(terminalError);
      if (code !== 0) {
        const diagnostic = Buffer.concat(stderr).toString('utf8').replaceAll(/[\r\n]+/g, ' ').trim().slice(0, 512);
        return reject(new DebianGpgvError(`${input.executable} failed (${signal ?? `exit ${String(code)}`})${diagnostic ? `: ${diagnostic}` : ''}`));
      }
      resolve(Object.freeze({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    });
    child.stdin!.on('error', error => fail(new DebianGpgvError(`${input.executable} input failed: ${error.message}`)));
    child.stdin!.end(input.stdin);
  });
}

export function createDefaultDebianMetadataVerifier(options: DefaultDebianMetadataVerifierOptions): DebianMetadataVerifier {
  if (options.keyring.kind === 'path' && !isAbsolute(options.keyring.absolutePath)) {
    throw new DebianGpgvError('verified Debian keyring path authority must be absolute');
  }
  const maximumProcessOutputBytes = positiveBound(options.maximumProcessOutputBytes ?? DEFAULT_MAXIMUM_PROCESS_OUTPUT_BYTES, 'maximumProcessOutputBytes');
  const maximumDecompressedBytes = positiveBound(options.maximumDecompressedBytes ?? DEFAULT_MAXIMUM_DECOMPRESSED_BYTES, 'maximumDecompressedBytes');
  const timeoutMilliseconds = positiveBound(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS, 'timeoutMilliseconds');
  const keyring = options.keyring;

  const verifyInRelease = async (bytes: Buffer, keyringBytes: Buffer): Promise<VerifiedInRelease> => {
    const ownedHandle = keyring.kind === 'path' ? await open(keyring.absolutePath, 'r') : undefined;
    const authorityHandle = keyring.kind === 'file-handle' ? keyring.handle : ownedHandle!;
    try {
      const pinnedBytes = await readPinnedFile(authorityHandle, maximumProcessOutputBytes);
      if (pinnedBytes.length !== keyringBytes.length || !timingSafeEqual(pinnedBytes, keyringBytes)) {
        throw new DebianGpgvError('repository keyring bytes differ from the explicitly supplied verified authority');
      }
      const result = await runFixedProcess({
        executable: GPGV,
        arguments: ['--status-fd=1', '--keyring', '/proc/self/fd/3', '-'],
        stdin: bytes,
        maximumStdoutBytes: maximumProcessOutputBytes,
        maximumStderrBytes: maximumProcessOutputBytes,
        timeoutMilliseconds,
        inheritedDescriptor: authorityHandle.fd,
      });
      return Object.freeze({
        cleartext: extractInReleaseCleartext(bytes),
        signingKeyFingerprint: parseGpgvValidSignature(result.stdout),
      });
    } finally {
      await ownedHandle?.close();
    }
  };

  const decompressPackages = async (path: string, bytes: Buffer): Promise<Buffer> => {
    const compressed: { readonly executable: typeof GZIP | typeof XZ; readonly arguments: readonly string[] } | undefined = path.endsWith('.gz')
      ? { executable: GZIP, arguments: ['--decompress', '--stdout'] as const }
      : path.endsWith('.xz')
        ? { executable: XZ, arguments: ['--decompress', '--stdout'] as const }
        : undefined;
    if (!compressed) throw new DebianGpgvError('unsupported Packages compression; only .gz and .xz are admitted');
    try {
      const result = await runFixedProcess({
        executable: compressed.executable,
        arguments: compressed.arguments,
        stdin: bytes,
        maximumStdoutBytes: maximumDecompressedBytes,
        maximumStderrBytes: maximumProcessOutputBytes,
        timeoutMilliseconds,
      });
      return result.stdout;
    } catch (error) {
      if (error instanceof DebianGpgvError && error.message.includes('output exceeded')) throw error;
      throw new DebianGpgvError(`Packages decompression failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
  };

  return Object.freeze({ verifyInRelease, decompressPackages, ...(options.now ? { now: options.now } : {}) });
}
