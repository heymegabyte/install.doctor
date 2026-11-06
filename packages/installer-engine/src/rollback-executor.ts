import { constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { RollbackPlanSchema, createRollbackPlan } from './rollback.js';
import type { RollbackPlan } from './rollback.js';
import type { PersistedConfigurationCompensation } from './journal.js';
import { MANAGED_DIRECTORY_AUTHORITY_MARKER, configurationCompensationArtifactDigest, serviceStateEquals } from './config-transaction.js';
import type { ServiceState, ServiceStateSnapshot } from './config-transaction.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const RequestSchema = z.strictObject({ plan: RollbackPlanSchema, approvedPlanDigest: digest });

export interface RollbackTaskOutcome { readonly taskId: string; readonly status: 'restored' | 'failed'; readonly detail: string; }
export interface UserFileRollbackResult {
  readonly status: 'succeeded' | 'failed'; readonly completed: boolean; readonly outcomes: readonly RollbackTaskOutcome[];
}
export interface UserFileRollbackObserver {
  beforeTask(taskId: string, target: RollbackTargetState): Promise<'execute' | 'skip-restored' | 'already-recorded'>;
  beforeMutation?(taskId: string): Promise<void>;
  captureService?(snapshot: ServiceStateSnapshot): Promise<ServiceState>;
  restoreService?(snapshot: ServiceStateSnapshot): Promise<void>;
  afterTask(outcome: RollbackTaskOutcome): Promise<void>;
}
export interface RollbackTargetState { readonly existed: boolean; readonly digest: string | null; readonly mode: number | null; readonly uid: number | null; readonly gid: number | null; readonly type: 'regular' | 'directory' | 'absent'; readonly links: number | null; readonly service: ServiceState | null; }

function isRestoredPostcondition(artifact: PersistedConfigurationCompensation, target: RollbackTargetState): boolean {
  const snapshot = artifact.snapshot;
  const fileRestored = 'kind' in snapshot ? !target.existed && target.type === 'absent' : snapshot.existed
    ? target.existed && target.type === 'regular' && target.links === 1
      && target.digest === snapshot.digest && target.mode === snapshot.mode
      && target.uid === snapshot.uid && target.gid === snapshot.gid
    : !target.existed && target.type === 'absent';
  const service = artifact.serviceSnapshot ?? null;
  const serviceRestored = service === null || serviceStateEquals(service, target.service);
  return fileRestored && serviceRestored;
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
async function observe(path: string, allowDirectory = false): Promise<RollbackTargetState> {
  try { const info = await lstat(path);
    if (allowDirectory && info.isDirectory() && !info.isSymbolicLink()) {
      let markerDigest: string | null = null;
      try {
        const marker = await open(join(path, MANAGED_DIRECTORY_AUTHORITY_MARKER), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const markerInfo = await marker.stat(); if (markerInfo.isFile() && markerInfo.nlink === 1) markerDigest = sha256(await marker.readFile()); }
        finally { await marker.close(); }
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      return { existed: true, digest: markerDigest, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, type: 'directory', links: info.nlink, service: null };
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('rollback target state is not a regular file');
    return { existed: true, digest: sha256(await readFile(path)), mode: info.mode & 0o7777, uid: process.platform === 'win32' ? null : info.uid,
      gid: process.platform === 'win32' ? null : info.gid, type: 'regular', links: info.nlink, service: null }; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { existed: false, digest: null, mode: null, uid: null, gid: null, type: 'absent', links: null, service: null }; throw error; }
}

async function restoreManagedDirectory(artifact: PersistedConfigurationCompensation, uid: number, beforeMutation?: () => Promise<void>): Promise<void> {
  const snapshot = artifact.snapshot;
  if (!('kind' in snapshot)) throw new Error('directory rollback snapshot is missing');
  const parent = await safeParent(snapshot.targetPath, uid);
  const info = await lstat(snapshot.targetPath);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o7777) !== 0o700) throw new Error('rollback directory is not installer-owned');
  const names = await readdir(snapshot.targetPath);
  if (names.length !== 1 || names[0] !== MANAGED_DIRECTORY_AUTHORITY_MARKER) throw new Error('rollback directory contains unexpected entries');
  const markerPath = join(snapshot.targetPath, MANAGED_DIRECTORY_AUTHORITY_MARKER);
  const handle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const markerInfo = await handle.stat(); const marker = await handle.readFile();
    if (!markerInfo.isFile() || markerInfo.nlink !== 1 || markerInfo.uid !== uid || (markerInfo.mode & 0o7777) !== 0o600
      || marker.toString('hex') !== snapshot.authority.markerHex || sha256(marker) !== snapshot.authority.markerDigest) throw new Error('rollback directory authority mismatch');
  } finally { await handle.close(); }
  const tombstone = join(parent, `.install-doctor-directory-rollback-${process.pid}-${randomBytes(12).toString('hex')}`);
  await beforeMutation?.();
  await rename(snapshot.targetPath, tombstone);
  const parentHandle = await open(parent, constants.O_RDONLY); try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  await rm(join(tombstone, MANAGED_DIRECTORY_AUTHORITY_MARKER)); await rmdir(tombstone);
}

async function safeParent(path: string, uid: number): Promise<string> {
  const parent = dirname(path);
  const info = await lstat(parent);
  const canonical = await realpath(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || resolve(canonical) !== resolve(parent)) throw new Error('rollback parent must be a real nonsymlink directory');
  if (info.uid !== uid || (info.mode & 0o022) !== 0) throw new Error('rollback parent must be owned by the effective user and not group/other writable');
  return canonical;
}

async function assertSafeTarget(path: string, uid: number): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid) throw new Error('rollback target must be a user-owned unlinked regular file');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function restore(artifact: PersistedConfigurationCompensation, uid: number, beforeMutation?: () => Promise<void>): Promise<void> {
  const snapshot = artifact.snapshot;
  if ('kind' in snapshot) return restoreManagedDirectory(artifact, uid, beforeMutation);
  const parent = await safeParent(snapshot.targetPath, uid);
  const exists = await assertSafeTarget(snapshot.targetPath, uid);
  if (!snapshot.existed) {
    if (exists) { await beforeMutation?.(); await rm(snapshot.targetPath); }
    if (await assertSafeTarget(snapshot.targetPath, uid)) throw new Error('rollback deletion postcondition failed');
    return;
  }
  if (artifact.bytesBase64 === null || snapshot.mode === null || snapshot.uid !== uid || snapshot.gid === null) throw new Error('rollback snapshot is incomplete or not owned by the effective user');
  const bytes = Buffer.from(artifact.bytesBase64, 'base64');
  if (sha256(bytes) !== snapshot.digest) throw new Error('rollback snapshot byte digest mismatch');
  if (process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number') throw new Error('platform cannot prove no-follow rollback safety');
  const candidate = `${parent}/.install-doctor-rollback-${process.pid}-${randomBytes(12).toString('hex')}`;
  const handle = await open(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.chmod(snapshot.mode); await handle.chown(snapshot.uid, snapshot.gid); await handle.sync(); }
  finally { await handle.close(); }
  try { await beforeMutation?.(); await rename(candidate, snapshot.targetPath); } finally { await rm(candidate, { force: true }); }
  const restored = await lstat(snapshot.targetPath);
  const restoredBytes = await readFile(snapshot.targetPath);
  if (!restored.isFile() || restored.isSymbolicLink() || restored.nlink !== 1 || restored.uid !== snapshot.uid || restored.gid !== snapshot.gid
    || (restored.mode & 0o7777) !== snapshot.mode || sha256(restoredBytes) !== snapshot.digest) throw new Error('rollback postcondition verification failed');
  await chmod(snapshot.targetPath, snapshot.mode);
}

export async function executeApprovedUserFileRollback(input: unknown, compensations: readonly PersistedConfigurationCompensation[], observer?: UserFileRollbackObserver): Promise<UserFileRollbackResult> {
  const request = RequestSchema.parse(input);
  if (request.approvedPlanDigest !== request.plan.digest) throw new Error('rollback requires approval of the exact rollback plan digest');
  const rebuilt = await createRollbackPlan({ sourceRunId: request.plan.sourceRunId, sourcePlanDigest: request.plan.sourcePlanDigest, compensations }, () => request.plan.createdAt);
  if (rebuilt.digest !== request.plan.digest) throw new Error('durable compensation evidence no longer matches the approved rollback plan');
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error('platform cannot prove effective-user rollback ownership');
  const byId = new Map(compensations.map(item => [item.record.taskId, item]));
  const outcomes: RollbackTaskOutcome[] = [];
  for (const taskId of request.plan.taskOrder) {
    const artifact = byId.get(taskId);
    if (!artifact || artifact.record.kind !== 'configuration' || artifact.record.state !== 'available') throw new Error(`rollback artifact is unavailable: ${taskId}`);
    const serviceSnapshot = artifact.serviceSnapshot ?? null;
    const artifactBytes = artifact.bytesBase64 === null ? null : Buffer.from(artifact.bytesBase64, 'base64');
    if (configurationCompensationArtifactDigest(artifact.snapshot, artifactBytes, serviceSnapshot) !== artifact.record.artifactDigest) {
      throw new Error(`rollback compensation artifact digest mismatch: ${taskId}`);
    }
    let target = await observe(artifact.snapshot.targetPath, 'kind' in artifact.snapshot);
    if (serviceSnapshot !== null) {
      if (observer?.captureService === undefined || observer.restoreService === undefined) throw new Error(`unsupported service manager for rollback: ${serviceSnapshot.manager}`);
      target = { ...target, service: await observer.captureService(serviceSnapshot) };
    }
    // A prior rollback attempt can complete the mutation and fail before its
    // durable task outcome is published. Exact postcondition reconciliation is
    // safe on a new run ID as well as a resumed run: do not rewrite an artifact
    // that is already restored, but do publish the verified outcome.
    if (isRestoredPostcondition(artifact, target)) {
      const outcome = { taskId, status: 'restored' as const, detail: 'already-restored' };
      outcomes.push(outcome); await observer?.afterTask(outcome); continue;
    }
    const decision = await observer?.beforeTask(taskId, target) ?? 'execute';
    if (decision === 'already-recorded') { outcomes.push({ taskId, status: 'restored', detail: 'previously-recorded' }); continue; }
    if (decision === 'skip-restored') { const outcome = { taskId, status: 'restored' as const, detail: 'reconciled-after-interruption' }; outcomes.push(outcome); await observer?.afterTask(outcome); continue; }
    try {
      await restore(artifact, uid, observer?.beforeMutation === undefined ? undefined : () => observer.beforeMutation!(taskId));
      if (serviceSnapshot !== null) { await observer!.beforeMutation?.(taskId); await observer!.restoreService!(serviceSnapshot); }
    } catch (error) {
      const outcome = { taskId, status: 'failed' as const, detail: error instanceof Error ? error.message : 'unknown failure' };
      outcomes.push(outcome); await observer?.afterTask(outcome);
      return Object.freeze({ status: 'failed', completed: false, outcomes: Object.freeze(outcomes) });
    }
    // Persistence failures are not rollback failures. Let them escape so the
    // caller cannot mistake an unrecorded mutation for a completed outcome.
    const outcome = { taskId, status: 'restored' as const, detail: 'verified' };
    outcomes.push(outcome); await observer?.afterTask(outcome);
  }
  return Object.freeze({ status: 'succeeded', completed: true, outcomes: Object.freeze(outcomes) });
}
