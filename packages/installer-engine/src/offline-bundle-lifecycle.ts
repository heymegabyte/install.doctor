import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { OfflineBundleError, verifyOfflineBundle } from './offline-bundle.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const RecordSchema = z.strictObject({
  schemaVersion: z.literal(1), manifestDigest: digest, state: z.enum(['revoked', 'expired']),
  recordedAt: timestamp, reason: z.string().min(1).max(256),
});
export type OfflineBundleLifecycleRecord = z.infer<typeof RecordSchema>;

async function lifecycleDirectory(stateRootInput: string, create: boolean): Promise<string | undefined> {
  if (!isAbsolute(stateRootInput)) throw new OfflineBundleError('offline lifecycle state root must be absolute');
  const requestedRoot = resolve(stateRootInput);
  const metadata = await lstat(requestedRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new OfflineBundleError('offline lifecycle state root must be a real directory');
  const stateRoot = await realpath(requestedRoot);
  if (stateRoot !== requestedRoot) throw new OfflineBundleError('offline lifecycle state root must be canonical');
  const directory = join(stateRoot, 'offline-bundle-lifecycle');
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  else {
    try { await lstat(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  const child = await lstat(directory);
  if (!child.isDirectory() || child.isSymbolicLink()) throw new OfflineBundleError('offline lifecycle directory must be a real directory');
  const canonical = await realpath(directory);
  if (canonical !== directory) throw new OfflineBundleError('offline lifecycle directory must be canonical');
  return canonical;
}

async function readRecord(stateRoot: string, manifestDigest: string): Promise<OfflineBundleLifecycleRecord | undefined> {
  const directory = await lifecycleDirectory(stateRoot, false);
  if (!directory) return undefined;
  const path = join(directory, `${digest.parse(manifestDigest)}.json`);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 4096 || (process.platform !== 'win32' && metadata.nlink !== 1)) {
      throw new OfflineBundleError('offline lifecycle record is not a bounded regular file');
    }
    return RecordSchema.parse(JSON.parse(await handle.readFile('utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof OfflineBundleError) throw error;
    throw new OfflineBundleError('offline lifecycle record is invalid or unreadable');
  } finally { await handle?.close(); }
}

async function writeRecord(stateRoot: string, recordInput: OfflineBundleLifecycleRecord): Promise<OfflineBundleLifecycleRecord> {
  const record = RecordSchema.parse(recordInput);
  const directory = (await lifecycleDirectory(stateRoot, true))!;
  const existing = await readRecord(stateRoot, record.manifestDigest);
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(record)) return existing;
    throw new OfflineBundleError(`offline bundle already has a ${existing.state} lifecycle record`);
  }
  const target = join(directory, `${record.manifestDigest}.json`);
  const stage = join(directory, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); } finally { await handle.close(); }
    await link(stage, target);
    await rm(stage);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    await rm(stage, { force: true });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = await readRecord(stateRoot, record.manifestDigest);
      if (raced && JSON.stringify(raced) === JSON.stringify(record)) return raced;
    }
    throw new OfflineBundleError('offline lifecycle record could not be committed');
  }
  return record;
}

export async function inspectOfflineBundle(input: {
  bundleDirectory: string; trust: unknown; releaseTrust: unknown; stateRoot: string; now?: string;
}): Promise<{ manifestDigest: string; releaseId: string; state: 'active' | 'expired' | 'revoked'; expiresAt: string; record: OfflineBundleLifecycleRecord | null }> {
  const verified = await verifyOfflineBundle(input);
  const now = timestamp.parse(input.now ?? new Date().toISOString());
  const record = await readRecord(input.stateRoot, verified.manifestDigest);
  const naturallyExpired = Date.parse(verified.manifest.expiresAt) <= Date.parse(now);
  const state = record?.state === 'revoked' ? 'revoked' : (record?.state === 'expired' || naturallyExpired ? 'expired' : 'active');
  return { manifestDigest: verified.manifestDigest, releaseId: verified.manifest.releaseId, state, expiresAt: verified.manifest.expiresAt, record: record ?? null };
}

export async function revokeOfflineBundle(input: {
  bundleDirectory: string; trust: unknown; releaseTrust: unknown; stateRoot: string;
  approvedManifestDigest: string; revokedAt?: string; reason: string;
}): Promise<OfflineBundleLifecycleRecord> {
  const verified = await verifyOfflineBundle(input);
  if (verified.manifestDigest !== digest.parse(input.approvedManifestDigest)) throw new OfflineBundleError('offline revocation requires exact manifest approval');
  return writeRecord(input.stateRoot, { schemaVersion: 1, manifestDigest: verified.manifestDigest, state: 'revoked',
    recordedAt: timestamp.parse(input.revokedAt ?? new Date().toISOString()), reason: input.reason });
}

export async function expireOfflineBundle(input: {
  bundleDirectory: string; trust: unknown; releaseTrust: unknown; stateRoot: string;
  approvedManifestDigest: string; now?: string;
}): Promise<OfflineBundleLifecycleRecord> {
  const verified = await verifyOfflineBundle(input);
  if (verified.manifestDigest !== digest.parse(input.approvedManifestDigest)) throw new OfflineBundleError('offline expiry requires exact manifest approval');
  const now = timestamp.parse(input.now ?? new Date().toISOString());
  if (Date.parse(verified.manifest.expiresAt) > Date.parse(now)) throw new OfflineBundleError('offline bundle is not expired');
  return writeRecord(input.stateRoot, { schemaVersion: 1, manifestDigest: verified.manifestDigest, state: 'expired', recordedAt: now,
    reason: 'signed-validity-window-ended' });
}

export async function assertOfflineBundleActive(input: {
  bundleDirectory: string; trust: unknown; releaseTrust: unknown; stateRoot: string; now?: string;
}): Promise<void> {
  const inspected = await inspectOfflineBundle(input);
  if (inspected.state !== 'active') throw new OfflineBundleError(`offline bundle is ${inspected.state}`);
}
