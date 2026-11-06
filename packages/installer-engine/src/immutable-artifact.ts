import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, open, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { ImmutableArtifactDescriptorSchema } from './contracts.js';
import type { ImmutableArtifactDescriptor } from './contracts.js';

export class ImmutableArtifactError extends Error {
  constructor(message: string) { super(message); this.name = 'ImmutableArtifactError'; }
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const redirectOrigins = new Set(['https://github.com', 'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertPrivateCacheRoot(cacheRoot: string): Promise<string> {
  if (!isAbsolute(cacheRoot)) throw new ImmutableArtifactError('artifact cache root must be absolute');
  let metadata;
  try { metadata = await lstat(cacheRoot); }
  catch { throw new ImmutableArtifactError('artifact cache root must already exist'); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ImmutableArtifactError('artifact cache root must be a real directory');
  if (process.platform !== 'win32') {
    const uid = process.geteuid?.();
    if (uid === undefined || metadata.uid !== uid || (metadata.mode & 0o077) !== 0) {
      throw new ImmutableArtifactError('artifact cache root must be private and owned by the current user');
    }
  }
  const canonical = await realpath(cacheRoot);
  return canonical;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function recoverInterruptedPublication(
  cacheRoot: string,
  candidatePath: string,
  expected: ImmutableArtifactDescriptor['source'],
): Promise<void> {
  let candidate;
  try { candidate = await lstat(candidatePath); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw new ImmutableArtifactError('cached artifact cannot be inspected safely');
  }
  if (process.platform === 'win32' || candidate.nlink <= 1) return;
  const uid = process.geteuid?.();
  if (!candidate.isFile() || candidate.isSymbolicLink() || uid === undefined || candidate.uid !== uid
    || (candidate.mode & 0o777) !== 0o600 || candidate.size !== expected.sizeBytes) return;
  const handle = await open(candidatePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (current.dev !== candidate.dev || current.ino !== candidate.ino || current.nlink !== candidate.nlink
      || sha256(await handle.readFile()) !== expected.sha256) return;
  } finally { await handle.close(); }
  const publicationName = new RegExp(`^\\.${expected.sha256}\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$`);
  let removed = false;
  for (const name of await readdir(cacheRoot)) {
    if (!publicationName.test(name)) continue;
    const path = join(cacheRoot, name);
    let metadata;
    try { metadata = await lstat(path); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw new ImmutableArtifactError('interrupted artifact publication cannot be inspected safely');
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== uid || (metadata.mode & 0o777) !== 0o600
      || metadata.dev !== candidate.dev || metadata.ino !== candidate.ino) continue;
    await rm(path);
    removed = true;
  }
  if (removed) await syncDirectory(cacheRoot);
}

async function inspectCandidate(path: string, expected: ImmutableArtifactDescriptor['source']): Promise<'absent' | 'valid'> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'absent';
    throw new ImmutableArtifactError('cached artifact cannot be inspected safely');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (process.platform !== 'win32' && metadata.nlink !== 1)) {
    throw new ImmutableArtifactError('cached artifact has unsafe inode metadata');
  }
  if (process.platform !== 'win32') {
    const uid = process.geteuid?.();
    if (uid === undefined || metadata.uid !== uid || (metadata.mode & 0o777) !== 0o600) {
      throw new ImmutableArtifactError('cached artifact has unsafe ownership or permissions');
    }
  }
  if (metadata.size !== expected.sizeBytes) throw new ImmutableArtifactError('cached artifact size mismatch');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    if (current.dev !== metadata.dev || current.ino !== metadata.ino || current.size !== metadata.size) {
      throw new ImmutableArtifactError('cached artifact changed during inspection');
    }
    const bytes = await handle.readFile();
    if (sha256(bytes) !== expected.sha256) throw new ImmutableArtifactError('cached artifact digest mismatch');
  } finally { await handle.close(); }
  return 'valid';
}

function parseContentLength(response: Response, expected: number): void {
  const header = response.headers.get('content-length');
  if (header === null) return;
  if (!/^[0-9]+$/.test(header) || Number(header) !== expected) {
    throw new ImmutableArtifactError('artifact response size does not match its descriptor');
  }
}

async function boundedBody(response: Response, expected: number): Promise<Buffer> {
  if (!response.body) throw new ImmutableArtifactError('artifact response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > expected) {
      await reader.cancel().catch(() => undefined);
      throw new ImmutableArtifactError('artifact response exceeds its declared size');
    }
    chunks.push(part.value);
  }
  if (total !== expected) throw new ImmutableArtifactError('artifact response size does not match its descriptor');
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

async function download(input: {
  url: string; expectedSize: number; fetcher: Fetcher; timeoutMs: number; maximumRedirects: number;
}): Promise<Buffer> {
  let current = input.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    for (let redirects = 0; redirects <= input.maximumRedirects; redirects += 1) {
      let response: Response;
      try {
        response = await input.fetcher(current, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { accept: 'application/octet-stream', 'user-agent': 'install.doctor-artifact/1' },
        });
      } catch {
        throw new ImmutableArtifactError('artifact transport failed or timed out');
      }
      if (redirectStatuses.has(response.status)) {
        if (redirects === input.maximumRedirects) throw new ImmutableArtifactError('artifact redirect limit exceeded');
        const location = response.headers.get('location');
        if (!location) throw new ImmutableArtifactError('artifact redirect is missing a location');
        const next = new URL(location, current);
        if (next.protocol !== 'https:' || next.username || next.password || !redirectOrigins.has(next.origin)) {
          throw new ImmutableArtifactError('artifact redirect origin is not allowed');
        }
        current = next.toString();
        continue;
      }
      if (response.status !== 200) throw new ImmutableArtifactError(`artifact transport returned HTTP ${response.status}`);
      parseContentLength(response, input.expectedSize);
      return await boundedBody(response, input.expectedSize);
    }
    throw new ImmutableArtifactError('artifact redirect limit exceeded');
  } finally { clearTimeout(timer); }
}

export async function fetchImmutableArtifact(input: {
  descriptor: unknown;
  cacheRoot: string;
  offline?: boolean;
  fetcher?: Fetcher;
  timeoutMs?: number;
  maximumRedirects?: number;
}): Promise<{ candidatePath: string; sha256: string; sizeBytes: number; cacheHit: boolean }> {
  const descriptor = ImmutableArtifactDescriptorSchema.parse(input.descriptor);
  const cacheRoot = await assertPrivateCacheRoot(input.cacheRoot);
  const candidatePath = join(cacheRoot, descriptor.source.sha256);
  await recoverInterruptedPublication(cacheRoot, candidatePath, descriptor.source);
  const existing = await inspectCandidate(candidatePath, descriptor.source);
  if (existing === 'valid') {
    return { candidatePath, sha256: descriptor.source.sha256, sizeBytes: descriptor.source.sizeBytes, cacheHit: true };
  }
  if (input.offline) {
    throw new ImmutableArtifactError(`offline bundle is missing immutable artifact ${descriptor.id}`);
  }
  const timeoutMs = z.number().int().min(1_000).max(120_000).parse(input.timeoutMs ?? 30_000);
  const maximumRedirects = z.number().int().min(0).max(5).parse(input.maximumRedirects ?? 3);
  const bytes = await download({
    url: descriptor.source.url,
    expectedSize: descriptor.source.sizeBytes,
    fetcher: input.fetcher ?? fetch,
    timeoutMs,
    maximumRedirects,
  });
  if (sha256(bytes) !== descriptor.source.sha256) throw new ImmutableArtifactError('artifact digest does not match its descriptor');
  const stage = join(cacheRoot, `.${descriptor.source.sha256}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(stage, 0o600);
    try { await link(stage, candidatePath); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw new ImmutableArtifactError('artifact candidate could not be published atomically');
      }
    }
    await syncDirectory(cacheRoot);
    await rm(stage, { force: true });
    await syncDirectory(cacheRoot);
    await inspectCandidate(candidatePath, descriptor.source);
    return { candidatePath, sha256: descriptor.source.sha256, sizeBytes: descriptor.source.sizeBytes, cacheHit: false };
  } finally {
    await handle?.close();
    await rm(stage, { force: true });
  }
}
