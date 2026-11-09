import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { z } from 'zod';

const authoritySchema = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  mode: z.enum(['0600', '0700']),
});

export type VerifiedArtifactAuthority = z.infer<typeof authoritySchema>;
export interface VerifiedArtifactCandidate {
  readonly sourcePath: string;
  readonly authority: VerifiedArtifactAuthority;
}
export type VerifiedArtifactResolver = (artifactId: string) => Promise<VerifiedArtifactCandidate>;

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
    throw new VerifiedArtifactMaterializationError(`materialized artifact could not be opened safely: ${input.artifactId}`);
  }
}

/** Binds any transport-specific resolver to the single verified snapshot path. */
export function createVerifiedArtifactMaterializer(resolveCandidate: VerifiedArtifactResolver) {
  return async (artifactId: string): Promise<FileHandle> => {
    const candidate = await resolveCandidate(artifactId);
    return openVerifiedArtifactSnapshot({ artifactId, ...candidate });
  };
}
