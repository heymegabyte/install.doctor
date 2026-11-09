import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdtemp, open, realpath, readdir, rmdir, rm, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { z } from 'zod';

const authoritySchema = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  mode: z.enum(['0600', '0700']),
});
const artifactIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const releaseIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const releaseArtifactSchema = z.strictObject({
  artifactId: artifactIdSchema,
  url: z.string().url().max(2048),
  authority: authoritySchema,
});

export type VerifiedArtifactAuthority = z.infer<typeof authoritySchema>;
export interface VerifiedArtifactCandidate {
  readonly sourcePath: string;
  readonly authority: VerifiedArtifactAuthority;
}
export type VerifiedArtifactResolver = (artifactId: string) => Promise<VerifiedArtifactCandidate>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class VerifiedArtifactMaterializationError extends Error {
  constructor(message: string) { super(message); this.name = 'VerifiedArtifactMaterializationError'; }
}

/**
 * Transport-neutral admission boundary for online cache candidates and offline
 * bundle candidates. The returned descriptor refers to an unlinked private
 * snapshot, never to the transport-owned mutable inode.
 */
export async function openVerifiedArtifactSnapshot(input: {
  artifactId: string;
  sourcePath: string;
  authority: VerifiedArtifactAuthority;
}): Promise<FileHandle> {
  const authority = authoritySchema.parse(input.authority);
  if (!isAbsolute(input.sourcePath) || normalize(input.sourcePath) !== input.sourcePath || input.sourcePath.includes('\0')) {
    throw new VerifiedArtifactMaterializationError(`artifact source path is not canonical: ${input.artifactId}`);
  }
  let source: FileHandle | undefined;
  let snapshot: FileHandle | undefined;
  let writer: FileHandle | undefined;
  let directory: string | undefined;
  let snapshotPath: string | undefined;
  try {
    source = await open(input.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await source.stat();
    if (!metadata.isFile() || (process.platform !== 'win32' && metadata.nlink !== 1) || metadata.size !== authority.sizeBytes) {
      throw new VerifiedArtifactMaterializationError(`materialized artifact has unsafe inode metadata: ${input.artifactId}`);
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o777) !== Number.parseInt(authority.mode, 8)) {
      throw new VerifiedArtifactMaterializationError(`materialized artifact mode changed: ${input.artifactId}`);
    }
    const bytes = await source.readFile();
    if (bytes.length !== authority.sizeBytes
      || createHash('sha256').update(bytes).digest('hex') !== authority.sha256) {
      throw new VerifiedArtifactMaterializationError(`materialized artifact digest changed: ${input.artifactId}`);
    }
    directory = await mkdtemp(join(tmpdir(), 'installer-engine-artifact-'));
    snapshotPath = join(directory, 'verified');
    writer = await open(snapshotPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), Number.parseInt(authority.mode, 8));
    await writer.writeFile(bytes);
    await writer.sync();
    await writer.chmod(Number.parseInt(authority.mode, 8));
    await writer.close(); writer = undefined;
    snapshot = await open(snapshotPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const sealed = await snapshot.stat();
    if (!sealed.isFile() || (process.platform !== 'win32' && sealed.nlink !== 1) || sealed.size !== authority.sizeBytes) {
      throw new VerifiedArtifactMaterializationError(`verified artifact snapshot is unsafe: ${input.artifactId}`);
    }
    await unlink(snapshotPath); snapshotPath = undefined;
    await rmdir(directory); directory = undefined;
    await source.close(); source = undefined;
    return snapshot;
  } catch (error) {
    await source?.close(); await writer?.close(); await snapshot?.close();
    if (snapshotPath) await unlink(snapshotPath).catch(() => undefined);
    if (directory) await rmdir(directory).catch(() => undefined);
    if (error instanceof VerifiedArtifactMaterializationError) throw error;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
    const reason = error instanceof Error && !error.message.includes('/') ? `: ${error.message}` : '';
    throw new VerifiedArtifactMaterializationError(`materialized artifact could not be opened safely${code}: ${input.artifactId}${reason}`);
  }
}

/** Binds any transport-specific resolver to the single verified snapshot path. */
export function createVerifiedArtifactMaterializer(resolveCandidate: VerifiedArtifactResolver) {
  return async (artifactId: string): Promise<FileHandle> => {
    const candidate = await resolveCandidate(artifactId);
    return openVerifiedArtifactSnapshot({ artifactId, ...candidate });
  };
}

async function privateCanonicalDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path) || normalize(path) !== path) throw new VerifiedArtifactMaterializationError(`${label} must be an absolute canonical path`);
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new VerifiedArtifactMaterializationError(`${label} must be a real directory`);
  const canonical = await realpath(path);
  if (process.platform !== 'win32') {
    const uid = process.geteuid?.();
    if (uid === undefined || metadata.uid !== uid || (metadata.mode & 0o077) !== 0) {
      throw new VerifiedArtifactMaterializationError(`${label} must be private and owned by the current user`);
    }
  }
  return canonical;
}

async function boundedResponse(response: Response, expectedSize: number): Promise<Buffer> {
  if (response.status !== 200 || !response.body) throw new VerifiedArtifactMaterializationError(`release artifact transport returned HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) !== expectedSize)) {
    throw new VerifiedArtifactMaterializationError('release artifact response size does not match signed authority');
  }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > expectedSize) {
      await reader.cancel().catch(() => undefined);
      throw new VerifiedArtifactMaterializationError('release artifact response exceeds signed authority');
    }
    chunks.push(Buffer.from(part.value));
  }
  if (total !== expectedSize) throw new VerifiedArtifactMaterializationError('release artifact response is truncated');
  return Buffer.concat(chunks, total);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function recoverInterruptedPublication(cacheRoot: string, candidatePath: string, authority: VerifiedArtifactAuthority): Promise<void> {
  const pattern = new RegExp(`^\\.${authority.sha256}\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$`);
  const candidate = await lstat(candidatePath).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  let changed = false;
  for (const name of await readdir(cacheRoot)) {
    if (!pattern.test(name)) continue;
    const path = join(cacheRoot, name); const metadata = await lstat(path);
    const uid = process.geteuid?.();
    if (!metadata.isFile() || metadata.isSymbolicLink() || (process.platform !== 'win32'
      && (uid === undefined || metadata.uid !== uid || (metadata.mode & 0o777) !== Number.parseInt(authority.mode, 8)))) {
      throw new VerifiedArtifactMaterializationError('interrupted release artifact publication has unsafe metadata');
    }
    if (!candidate || metadata.dev !== candidate.dev || metadata.ino !== candidate.ino) {
      if (metadata.nlink > 1) {
        throw new VerifiedArtifactMaterializationError('interrupted release artifact publication has unexpected links');
      }
      continue;
    }
    if (metadata.nlink < 2 || candidate.nlink < 2) {
      throw new VerifiedArtifactMaterializationError('interrupted release artifact publication has unexpected links');
    }
    await rm(path); changed = true;
  }
  if (changed) await syncDirectory(cacheRoot);
}

async function inspectCandidate(path: string, artifactId: string, authority: VerifiedArtifactAuthority): Promise<boolean> {
  try {
    const snapshot = await openVerifiedArtifactSnapshot({ artifactId, sourcePath: path, authority });
    await snapshot.close();
    return true;
  } catch (error) {
    if (error instanceof VerifiedArtifactMaterializationError
      && /could not be opened safely/.test(error.message)) {
      const exists = await lstat(path).then(() => true, candidate => {
        if (candidate instanceof Error && 'code' in candidate && candidate.code === 'ENOENT') return false;
        throw candidate;
      });
      if (!exists) return false;
    }
    throw error;
  }
}

/** Resolve exact signed Desktop Tools release objects into a private content-addressed cache. */
export async function createOnlineReleaseArtifactResolver(input: {
  releaseId: string;
  artifacts: readonly unknown[];
  cacheRoot: string;
  fetcher?: Fetcher;
  offline?: boolean;
  timeoutMs?: number;
}): Promise<VerifiedArtifactResolver> {
  const releaseId = releaseIdSchema.parse(input.releaseId);
  const artifacts = z.array(releaseArtifactSchema).min(1).max(256).parse(input.artifacts);
  if (new Set(artifacts.map(value => value.artifactId)).size !== artifacts.length) {
    throw new VerifiedArtifactMaterializationError('release artifact identifiers must be unique');
  }
  const cacheRoot = await privateCanonicalDirectory(input.cacheRoot, 'release artifact cache root');
  const authorities = new Map(artifacts.map(value => {
    const url = new URL(value.url);
    const prefix = `/releases/${releaseId}/`;
    if (url.protocol !== 'https:' || url.hostname !== 'desktop.tools' || url.username || url.password
      || url.search || url.hash || !url.pathname.startsWith(prefix)
      || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(url.pathname.slice(prefix.length))) {
      throw new VerifiedArtifactMaterializationError(`release artifact URL is outside the immutable Desktop Tools namespace: ${value.artifactId}`);
    }
    return [value.artifactId, value] as const;
  }));
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = z.number().int().min(1_000).max(120_000).parse(input.timeoutMs ?? 30_000);
  return async artifactIdInput => {
    const artifactId = artifactIdSchema.parse(artifactIdInput);
    const artifact = authorities.get(artifactId);
    if (!artifact) throw new VerifiedArtifactMaterializationError(`release artifact is not authorized: ${artifactId}`);
    const candidatePath = join(cacheRoot, artifact.authority.sha256);
    await recoverInterruptedPublication(cacheRoot, candidatePath, artifact.authority);
    if (await inspectCandidate(candidatePath, artifactId, artifact.authority)) {
      return { sourcePath: candidatePath, authority: artifact.authority };
    }
    if (input.offline) throw new VerifiedArtifactMaterializationError(`offline cache is missing release artifact: ${artifactId}`);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let bytes: Buffer;
    try {
      response = await fetcher(artifact.url, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { accept: 'application/octet-stream', 'user-agent': 'desktop-tools-release-artifact/1' } });
      if (response.status >= 300 && response.status < 400) {
        throw new VerifiedArtifactMaterializationError(`release artifact redirects are forbidden: ${artifactId}`);
      }
      bytes = await boundedResponse(response, artifact.authority.sizeBytes);
    } catch (error) {
      if (error instanceof VerifiedArtifactMaterializationError) throw error;
      throw new VerifiedArtifactMaterializationError(`release artifact transport failed: ${artifactId}`);
    } finally { clearTimeout(timer); }
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.authority.sha256) {
      throw new VerifiedArtifactMaterializationError(`release artifact digest does not match signed authority: ${artifactId}`);
    }
    const stage = join(cacheRoot, `.${artifact.authority.sha256}.${randomUUID()}.tmp`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      await chmod(stage, Number.parseInt(artifact.authority.mode, 8));
      try { await link(stage, candidatePath); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      await syncDirectory(cacheRoot);
    } finally { await handle?.close(); await rm(stage, { force: true }); await syncDirectory(cacheRoot); }
    if (!await inspectCandidate(candidatePath, artifactId, artifact.authority)) {
      throw new VerifiedArtifactMaterializationError(`release artifact candidate was not published: ${artifactId}`);
    }
    return { sourcePath: candidatePath, authority: artifact.authority };
  };
}

/** Resolve an already verified/materialized offline closure through the same candidate contract. */
export async function createMaterializedArtifactResolver(input: {
  materializedRoot: string;
  artifacts: Readonly<Record<string, VerifiedArtifactAuthority>>;
}): Promise<VerifiedArtifactResolver> {
  const materializedRoot = await privateCanonicalDirectory(input.materializedRoot, 'materialized artifact root');
  const entries = Object.entries(input.artifacts).map(([artifactId, authority]) => [artifactIdSchema.parse(artifactId), authoritySchema.parse(authority)] as const);
  if (entries.length > 4096) throw new VerifiedArtifactMaterializationError('materialized artifact authority exceeds its bound');
  const authorities = new Map(entries);
  return async artifactIdInput => {
    const artifactId = artifactIdSchema.parse(artifactIdInput);
    const authority = authorities.get(artifactId);
    if (!authority) throw new VerifiedArtifactMaterializationError(`materialized artifact is not authorized: ${artifactId}`);
    return { sourcePath: join(materializedRoot, artifactId), authority };
  };
}
