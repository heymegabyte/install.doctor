import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { CompensationRecordSchema } from '@install-doctor/aid-core/installer-contracts';
import type { CompensationRecord } from '@install-doctor/aid-core/installer-contracts';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const launchdId = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/);
const absolutePath = z.string().min(1).max(4096).refine(isAbsolute, 'path must be absolute');

export const InstallerEffectClassSchema = z.enum([
  'installer-configuration',
  'service-state',
  'package',
  'operating-system',
  'network',
  'storage',
  'external',
]);
export type InstallerEffectClass = z.infer<typeof InstallerEffectClassSchema>;

export const EffectRollbackPolicySchema = z.object({
  schemaVersion: VERSION,
  effect: InstallerEffectClassSchema,
  automatic: z.boolean(),
  requiresExplicitConsent: z.boolean(),
}).strict().superRefine((value, context) => {
  const expectedAutomatic = value.effect === 'installer-configuration' || value.effect === 'service-state';
  if (value.automatic !== expectedAutomatic || value.requiresExplicitConsent === expectedAutomatic) {
    context.addIssue({ code: 'custom', message: 'effect rollback policy contradicts the bounded automatic-effect allowlist' });
  }
});
export type EffectRollbackPolicy = z.infer<typeof EffectRollbackPolicySchema>;

export const ConfigurationTransactionSpecSchema = z.object({
  schemaVersion: VERSION,
  taskId: id,
  targetPath: absolutePath,
  effect: z.literal('installer-configuration'),
  dependencies: z.array(id).max(512).default([]),
  candidateMode: z.number().int().min(0).max(0o7777).optional(),
}).strict();
export type ConfigurationTransactionSpec = z.infer<typeof ConfigurationTransactionSpecSchema>;

export const FileConfigurationSnapshotSchema = z.object({
  schemaVersion: VERSION,
  targetPath: absolutePath,
  existed: z.boolean(),
  mode: z.number().int().min(0).max(0o7777).nullable(),
  uid: z.number().int().nonnegative().nullable(),
  gid: z.number().int().nonnegative().nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export const MANAGED_DIRECTORY_AUTHORITY_MARKER = '.install-doctor-directory-authority';
export const DirectoryConfigurationSnapshotSchema = z.strictObject({
  schemaVersion: VERSION,
  kind: z.literal('directory'),
  targetPath: absolutePath,
  existed: z.literal(false),
  mode: z.literal(null),
  uid: z.literal(null),
  gid: z.literal(null),
  digest: z.literal(null),
  authority: z.strictObject({
    markerName: z.literal(MANAGED_DIRECTORY_AUTHORITY_MARKER),
    markerHex: z.string().regex(/^[a-f0-9]{64}$/),
    markerDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export const ServiceOnlyConfigurationSnapshotSchema = z.strictObject({
  schemaVersion: VERSION,
  kind: z.literal('service'),
  targetPath: z.string().regex(/^systemd:[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/),
  existed: z.literal(false),
  mode: z.literal(null),
  uid: z.literal(null),
  gid: z.literal(null),
  digest: z.literal(null),
});
export const ConfigurationSnapshotSchema = z.union([
  FileConfigurationSnapshotSchema,
  DirectoryConfigurationSnapshotSchema,
  ServiceOnlyConfigurationSnapshotSchema,
]);
export type ConfigurationSnapshot = z.infer<typeof ConfigurationSnapshotSchema>;

export const ServiceManagerSchema = z.enum(['systemd', 'launchd', 'windows-scm']);
export const SystemdServiceStateSchema = z.strictObject({
  enabled: z.boolean(),
  running: z.boolean(),
});
export const SystemdServiceStateSnapshotSchema = z.strictObject({
  schemaVersion: VERSION,
  serviceId: id,
  manager: z.literal('systemd'),
  ...SystemdServiceStateSchema.shape,
});
const LaunchdDomainSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.enum(['gui', 'user']), uid: z.number().int().nonnegative() }),
]);
const LaunchdDefinitionSchema = z.strictObject({
  canonicalPath: absolutePath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o7777),
});
export const LaunchdServiceStateSchema = z.strictObject({
  domain: LaunchdDomainSchema,
  definition: LaunchdDefinitionSchema,
  enablementOverride: z.enum(['default', 'enabled', 'disabled']),
  loaded: z.boolean(),
  activity: z.enum(['running', 'not-running']),
}).superRefine((value, context) => {
  if (!value.loaded && value.activity !== 'not-running') {
    context.addIssue({ code: 'custom', message: 'an unloaded launchd service cannot be running' });
  }
});
export const LaunchdServiceStateSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  serviceId: launchdId,
  manager: z.literal('launchd'),
  ...LaunchdServiceStateSchema.shape,
}).superRefine((value, context) => {
  if (!value.loaded && value.activity !== 'not-running') {
    context.addIssue({ code: 'custom', message: 'an unloaded launchd service cannot be running' });
  }
});
export const ServiceStateSnapshotSchema = z.discriminatedUnion('manager', [
  SystemdServiceStateSnapshotSchema,
  LaunchdServiceStateSnapshotSchema,
]);
export type ServiceStateSnapshot = z.infer<typeof ServiceStateSnapshotSchema>;
export type ServiceState = z.infer<typeof SystemdServiceStateSchema> | z.infer<typeof LaunchdServiceStateSchema>;
export interface ServiceStateAdapter {
  readonly manager: ServiceStateSnapshot['manager'];
  capture(serviceId: string): Promise<ServiceState>;
  restore(serviceId: string, state: ServiceState): Promise<void>;
}

export function serviceStateFromSnapshot(snapshot: ServiceStateSnapshot): ServiceState {
  if (snapshot.manager === 'systemd') {
    return SystemdServiceStateSchema.parse({ enabled: snapshot.enabled, running: snapshot.running });
  }
  return LaunchdServiceStateSchema.parse({
    domain: snapshot.domain,
    definition: snapshot.definition,
    enablementOverride: snapshot.enablementOverride,
    loaded: snapshot.loaded,
    activity: snapshot.activity,
  });
}

export function serviceStateEquals(snapshot: ServiceStateSnapshot, state: ServiceState | null): boolean {
  if (state === null) return false;
  return JSON.stringify(canonicalServiceState(serviceStateFromSnapshot(snapshot))) === JSON.stringify(canonicalServiceState(state));
}

function canonicalServiceState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalServiceState);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalServiceState(child)]));
  }
  return value;
}

export interface ConfigurationTransactionHooks {
  validateCandidate(candidatePath: string): Promise<void>;
  verifyPostcondition(targetPath: string): Promise<boolean>;
}

export interface ConfigurationCompensationArtifact {
  readonly record: CompensationRecord;
  readonly snapshot: ConfigurationSnapshot;
  readonly bytes: Uint8Array | null;
  readonly dependencies: readonly string[];
  readonly serviceSnapshot?: ServiceStateSnapshot | null;
  /** Digest of the installer-owned bytes that replaced the snapshot. */
  readonly appliedDigest?: string | null;
}

export interface ConfigurationCompensationPersistence {
  prepare(artifact: ConfigurationCompensationArtifact): Promise<void>;
  update(record: CompensationRecord): Promise<void>;
}

export interface ConfigurationTransactionRequest {
  spec: unknown;
  candidateBytes: Uint8Array;
  hooks: ConfigurationTransactionHooks;
  persistence?: ConfigurationCompensationPersistence;
  now?: () => string;
  service?: { readonly serviceId: string; readonly manager: ServiceStateSnapshot['manager']; readonly adapter: ServiceStateAdapter };
}

export interface AppliedConfigurationTransaction {
  readonly spec: ConfigurationTransactionSpec;
  readonly snapshot: ConfigurationSnapshot;
  readonly compensation: CompensationRecord;
  rollback(): Promise<CompensationRecord>;
}

export class ConfigurationTransactionError extends Error {
  readonly compensation: CompensationRecord | null;

  constructor(message: string, options: { cause?: unknown; compensation?: CompensationRecord | null } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ConfigurationTransactionError';
    this.compensation = options.compensation ?? null;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function configurationCompensationArtifactDigest(snapshot: ConfigurationSnapshot, bytes: Uint8Array | null, serviceSnapshot: ServiceStateSnapshot | null = null): string {
  if ('kind' in snapshot && snapshot.kind === 'directory') {
    if (bytes !== null || serviceSnapshot !== null) throw new ConfigurationTransactionError('directory compensation cannot contain file or service bytes');
    return createHash('sha256').update('install-doctor:managed-directory:v1\0').update(JSON.stringify({
      authority: snapshot.authority,
      targetPath: snapshot.targetPath,
    })).digest('hex');
  }
  if ('kind' in snapshot && snapshot.kind === 'service') {
    if (bytes !== null || serviceSnapshot === null || serviceSnapshot.manager !== 'systemd'
      || snapshot.targetPath !== `systemd:${serviceSnapshot.serviceId}`) {
      throw new ConfigurationTransactionError('service-only compensation requires its exact systemd snapshot');
    }
    return createHash('sha256').update('desktop-tools:service-only-compensation:v1\0')
      .update(JSON.stringify(snapshot)).update('\0').update(JSON.stringify(serviceSnapshot)).digest('hex');
  }
  const metadata = JSON.stringify({
    existed: snapshot.existed,
    mode: snapshot.mode,
    uid: snapshot.uid,
    gid: snapshot.gid,
    targetPath: snapshot.targetPath,
  });
  const hash = createHash('sha256').update(metadata).update('\0');
  if (bytes !== null) hash.update(bytes);
  // Preserve the established file-only digest identity. Service evidence is
  // an additive suffix only when it exists, so old durable artifacts remain
  // readable while service-aware artifacts cannot be confused with them.
  if (serviceSnapshot !== null) {
    const encoded = serviceSnapshot.manager === 'systemd'
      ? JSON.stringify(serviceSnapshot)
      : JSON.stringify(canonicalServiceState(serviceSnapshot));
    hash.update('\0service-state\0').update(encoded);
  }
  return hash.digest('hex');
}

export const ManagedDirectoryTransactionSpecSchema = ConfigurationTransactionSpecSchema.extend({
  candidateMode: z.literal(0o700),
}).strict();
export type ManagedDirectoryTransactionSpec = z.infer<typeof ManagedDirectoryTransactionSpecSchema>;
export interface ManagedDirectoryTransactionRequest {
  readonly spec: unknown;
  readonly persistence: ConfigurationCompensationPersistence;
  readonly now?: () => string;
}
export interface AppliedManagedDirectoryTransaction {
  readonly spec: ManagedDirectoryTransactionSpec;
  readonly created: boolean;
  readonly snapshot: ConfigurationSnapshot | null;
  readonly compensation: CompensationRecord | null;
  rollback(): Promise<CompensationRecord | null>;
}

export function effectRollbackPolicy(effectInput: unknown): EffectRollbackPolicy {
  const effect = InstallerEffectClassSchema.parse(effectInput);
  const automatic = effect === 'installer-configuration' || effect === 'service-state';
  return EffectRollbackPolicySchema.parse({
    schemaVersion: 1,
    effect,
    automatic,
    requiresExplicitConsent: !automatic,
  });
}

export function assertAutomaticConfigurationEffect(effectInput: unknown): void {
  const policy = effectRollbackPolicy(effectInput);
  if (policy.effect !== 'installer-configuration') {
    throw new ConfigurationTransactionError(
      `${policy.effect} effects are not automatically reversible configuration transactions; explicit consent and recovery guidance are required`,
    );
  }
}

async function assertSafeParent(targetPath: string): Promise<string> {
  const parent = dirname(targetPath);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new ConfigurationTransactionError('configuration target parent must be a real directory');
  }
  const canonicalParent = await realpath(parent);
  if (resolve(canonicalParent) !== resolve(parent)) {
    throw new ConfigurationTransactionError('configuration target parent must not traverse symbolic links');
  }
  return canonicalParent;
}

type ObservedConfiguration = {
  readonly snapshot: ConfigurationSnapshot;
  readonly bytes: Uint8Array | null;
  readonly device: number | null;
  readonly inode: number | null;
};

async function readSnapshot(targetPath: string): Promise<ObservedConfiguration> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      snapshot: ConfigurationSnapshotSchema.parse({
        schemaVersion: 1, targetPath, existed: false, mode: null, uid: null, gid: null, digest: null,
      }),
      bytes: null, device: null, inode: null,
    };
  }
  if (before.isSymbolicLink() || !before.isFile()) throw new ConfigurationTransactionError('existing configuration target must be a regular file and not a symbolic link');
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ConfigurationTransactionError('existing configuration target changed while its snapshot was opened');
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || before.dev !== info.dev || before.ino !== info.ino) {
      throw new ConfigurationTransactionError('existing configuration target changed while its snapshot was opened');
    }
    const bytes = await handle.readFile();
    return {
      snapshot: ConfigurationSnapshotSchema.parse({
        schemaVersion: 1, targetPath, existed: true, mode: info.mode & 0o7777,
        uid: process.platform === 'win32' ? null : info.uid,
        gid: process.platform === 'win32' ? null : info.gid, digest: sha256(bytes),
      }),
      bytes, device: info.dev, inode: info.ino,
    };
  } finally { await handle.close(); }
}

function sameObservedConfiguration(left: ObservedConfiguration, right: ObservedConfiguration): boolean {
  return left.device === right.device && left.inode === right.inode
    && JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot)
    && (left.bytes === null ? right.bytes === null : right.bytes !== null && Buffer.from(left.bytes).equals(right.bytes));
}

async function requireUnchangedTarget(expected: ObservedConfiguration, message: string): Promise<void> {
  const current = await readSnapshot(expected.snapshot.targetPath);
  if (!sameObservedConfiguration(expected, current)) throw new ConfigurationTransactionError(message);
}

async function writePrivateCandidate(parent: string, bytes: Uint8Array): Promise<string> {
  const path = join(parent, `.install-doctor-${process.pid}-${randomBytes(12).toString('hex')}.candidate`);
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

async function applyMetadata(path: string, mode: number, uid: number | null, gid: number | null): Promise<void> {
  await chmod(path, mode);
  if (process.platform !== 'win32' && uid !== null && gid !== null) await chown(path, uid, gid);
}

async function restoreSnapshot(snapshot: ConfigurationSnapshot, bytes: Uint8Array | null, expectedCurrent?: ObservedConfiguration): Promise<void> {
  const parent = await assertSafeParent(snapshot.targetPath);
  if (expectedCurrent) await requireUnchangedTarget(expectedCurrent, 'configuration target changed after installer activation; refusing automatic restoration');
  const current = await readSnapshot(snapshot.targetPath);
  if (!snapshot.existed) {
    if (current.snapshot.existed) await rm(snapshot.targetPath);
    return;
  }
  if (bytes === null || snapshot.mode === null) throw new ConfigurationTransactionError('compensation snapshot is incomplete');
  const candidatePath = await writePrivateCandidate(parent, bytes);
  try {
    await applyMetadata(candidatePath, snapshot.mode, snapshot.uid, snapshot.gid);
    await rename(candidatePath, snapshot.targetPath);
  } finally {
    await rm(candidatePath, { force: true });
  }
}

function recordFor(taskId: string, state: CompensationRecord['state'], digest: string, createdAt: string, restoresService = false): CompensationRecord {
  return CompensationRecordSchema.parse({
    schemaVersion: 1,
    taskId,
    kind: 'configuration',
    state,
    createdAt,
    artifactDigest: digest,
    restores: restoresService ? ['bytes', 'mode', 'ownership', 'service-state'] : ['bytes', 'mode', 'ownership'],
  });
}

export async function applyConfigurationTransaction(
  request: ConfigurationTransactionRequest,
): Promise<AppliedConfigurationTransaction> {
  const spec = ConfigurationTransactionSpecSchema.parse(request.spec);
  assertAutomaticConfigurationEffect(spec.effect);
  if (!(request.candidateBytes instanceof Uint8Array)) throw new ConfigurationTransactionError('candidateBytes must be a Uint8Array');
  const parent = await assertSafeParent(spec.targetPath);
  const previous = await readSnapshot(spec.targetPath);
  let serviceSnapshot: ServiceStateSnapshot | null = null;
  if (request.service !== undefined) {
    const manager = ServiceManagerSchema.parse(request.service.manager);
    if (request.service.adapter.manager !== manager) throw new ConfigurationTransactionError('service-state adapter does not match the declared service manager');
    const captured = await request.service.adapter.capture(id.parse(request.service.serviceId));
    serviceSnapshot = ServiceStateSnapshotSchema.parse({
      schemaVersion: manager === 'systemd' ? 1 : 2,
      serviceId: request.service.serviceId,
      manager,
      ...captured,
    });
  }
  const candidatePath = await writePrivateCandidate(parent, request.candidateBytes);
  const now = request.now ?? (() => new Date().toISOString());
  const artifactDigest = configurationCompensationArtifactDigest(previous.snapshot, previous.bytes, serviceSnapshot);
  let compensation = recordFor(spec.taskId, 'available', artifactDigest, now(), serviceSnapshot !== null);
  let activated = false;
  let applied: ObservedConfiguration | undefined;
  try {
    const mode = spec.candidateMode ?? previous.snapshot.mode ?? 0o600;
    await applyMetadata(candidatePath, mode, previous.snapshot.uid, previous.snapshot.gid);
    await request.hooks.validateCandidate(candidatePath);
    const candidateInfo = await lstat(candidatePath);
    if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.nlink !== 1) {
      throw new ConfigurationTransactionError('validated candidate ceased to be a private regular file');
    }
    if (!request.persistence) {
      throw new ConfigurationTransactionError('configuration activation requires durable compensation persistence');
    }
    await request.persistence.prepare({
      record: compensation,
      snapshot: previous.snapshot,
      bytes: previous.bytes,
      dependencies: spec.dependencies,
      serviceSnapshot,
      appliedDigest: sha256(request.candidateBytes),
    });
    await requireUnchangedTarget(previous, 'configuration target changed after its compensation snapshot');
    await rename(candidatePath, spec.targetPath);
    activated = true;
    applied = await readSnapshot(spec.targetPath);
    if (!await request.hooks.verifyPostcondition(spec.targetPath)) {
      throw new ConfigurationTransactionError('configuration postcondition failed');
    }
  } catch (error) {
    if (activated) {
      try {
        if (!applied) throw new ConfigurationTransactionError('installer-applied configuration state is unavailable');
        await restoreSnapshot(previous.snapshot, previous.bytes, applied);
        if (serviceSnapshot !== null) await request.service!.adapter.restore(serviceSnapshot.serviceId, serviceStateFromSnapshot(serviceSnapshot));
        compensation = recordFor(spec.taskId, 'applied', artifactDigest, now(), serviceSnapshot !== null);
        await request.persistence?.update(compensation);
        throw new ConfigurationTransactionError('configuration transaction failed and the previous state was restored', {
          cause: error,
          compensation,
        });
      } catch (restoreError) {
        if (restoreError instanceof ConfigurationTransactionError && restoreError.compensation?.state === 'applied') throw restoreError;
        compensation = recordFor(spec.taskId, 'failed', artifactDigest, now(), serviceSnapshot !== null);
        try { await request.persistence?.update(compensation); } catch { /* retain the restoration failure as the primary cause */ }
        throw new ConfigurationTransactionError('configuration transaction and automatic compensation both failed', {
          cause: restoreError,
          compensation,
        });
      }
    }
    throw error;
  } finally {
    await rm(candidatePath, { force: true });
  }

  return {
    spec,
    snapshot: previous.snapshot,
    get compensation() { return compensation; },
    async rollback() {
      if (compensation.state !== 'available') return compensation;
      try {
        if (!applied) throw new ConfigurationTransactionError('installer-applied configuration state is unavailable');
        await restoreSnapshot(previous.snapshot, previous.bytes, applied);
        if (serviceSnapshot !== null) await request.service!.adapter.restore(serviceSnapshot.serviceId, serviceStateFromSnapshot(serviceSnapshot));
        compensation = recordFor(spec.taskId, 'applied', artifactDigest, now(), serviceSnapshot !== null);
        await request.persistence?.update(compensation);
      } catch (error) {
        compensation = recordFor(spec.taskId, 'failed', artifactDigest, now(), serviceSnapshot !== null);
        try { await request.persistence?.update(compensation); } catch { /* preserve the restore failure */ }
        throw new ConfigurationTransactionError(`rollback failed for ${spec.taskId}`, { cause: error, compensation });
      }
      return compensation;
    },
  };
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function assertManagedDirectoryParent(targetPath: string): Promise<string> {
  if (process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number') {
    throw new ConfigurationTransactionError('managed directories require POSIX no-follow filesystem semantics');
  }
  if (resolve(targetPath) !== targetPath || dirname(targetPath) === targetPath) {
    throw new ConfigurationTransactionError('managed directory target must be a normalized non-root absolute path');
  }
  const uid = process.geteuid?.();
  if (uid === undefined) throw new ConfigurationTransactionError('managed directory ownership cannot be proven');
  const parent = dirname(targetPath);
  const info = await lstat(parent);
  const canonical = await realpath(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || resolve(canonical) !== resolve(parent)) {
    throw new ConfigurationTransactionError('managed directory parent must be a real nonsymlink directory');
  }
  if (info.uid !== uid || (info.mode & 0o022) !== 0) {
    throw new ConfigurationTransactionError('managed directory parent must be owned by the effective user and not group/other writable');
  }
  return canonical;
}

async function inspectManagedDirectory(path: string, mode: number): Promise<'absent' | 'compatible'> {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new ConfigurationTransactionError('managed directory ownership cannot be proven');
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o7777) !== mode) {
      throw new ConfigurationTransactionError('existing managed directory target is incompatible with the requested ownership or mode');
    }
    return 'compatible';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'absent';
    throw error;
  }
}

async function removeAuthorizedManagedDirectory(snapshot: z.infer<typeof DirectoryConfigurationSnapshotSchema>): Promise<void> {
  const parent = await assertManagedDirectoryParent(snapshot.targetPath);
  const uid = process.geteuid!();
  const info = await lstat(snapshot.targetPath);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o7777) !== 0o700) {
    throw new ConfigurationTransactionError('managed directory rollback target is no longer the installer-owned directory');
  }
  const names = await readdir(snapshot.targetPath);
  if (names.length !== 1 || names[0] !== MANAGED_DIRECTORY_AUTHORITY_MARKER) {
    throw new ConfigurationTransactionError('managed directory rollback refused because the directory has unexpected entries');
  }
  const markerPath = join(snapshot.targetPath, MANAGED_DIRECTORY_AUTHORITY_MARKER);
  const markerHandle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const markerInfo = await markerHandle.stat();
    const marker = await markerHandle.readFile();
    if (!markerInfo.isFile() || markerInfo.nlink !== 1 || markerInfo.uid !== uid || (markerInfo.mode & 0o7777) !== 0o600
      || sha256(marker) !== snapshot.authority.markerDigest || marker.toString('hex') !== snapshot.authority.markerHex) {
      throw new ConfigurationTransactionError('managed directory authority marker does not match durable compensation');
    }
  } finally { await markerHandle.close(); }
  const tombstone = join(parent, `.install-doctor-directory-rollback-${process.pid}-${randomBytes(12).toString('hex')}`);
  await rename(snapshot.targetPath, tombstone);
  await syncDirectory(parent);
  await rm(join(tombstone, MANAGED_DIRECTORY_AUTHORITY_MARKER));
  await rmdir(tombstone);
  await syncDirectory(parent);
}

export async function applyManagedDirectoryTransaction(
  request: ManagedDirectoryTransactionRequest,
): Promise<AppliedManagedDirectoryTransaction> {
  const spec = ManagedDirectoryTransactionSpecSchema.parse(request.spec);
  assertAutomaticConfigurationEffect(spec.effect);
  const parent = await assertManagedDirectoryParent(spec.targetPath);
  if (await inspectManagedDirectory(spec.targetPath, spec.candidateMode) === 'compatible') {
    return { spec, created: false, snapshot: null, compensation: null, rollback: async () => null };
  }
  const marker = randomBytes(32);
  const snapshot = DirectoryConfigurationSnapshotSchema.parse({
    schemaVersion: 1, kind: 'directory', targetPath: spec.targetPath, existed: false,
    mode: null, uid: null, gid: null, digest: null,
    authority: { markerName: MANAGED_DIRECTORY_AUTHORITY_MARKER, markerHex: marker.toString('hex'), markerDigest: sha256(marker) },
  });
  const now = request.now ?? (() => new Date().toISOString());
  const artifactDigest = configurationCompensationArtifactDigest(snapshot, null);
  let compensation = recordFor(spec.taskId, 'available', artifactDigest, now());
  const staging = join(parent, `.install-doctor-directory-${process.pid}-${randomBytes(12).toString('hex')}.candidate`);
  let activated = false;
  try {
    await mkdir(staging, { mode: spec.candidateMode });
    const markerHandle = await open(join(staging, MANAGED_DIRECTORY_AUTHORITY_MARKER), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await markerHandle.writeFile(marker); await markerHandle.sync(); } finally { await markerHandle.close(); }
    await syncDirectory(staging);
    await request.persistence.prepare({ record: compensation, snapshot, bytes: null, dependencies: spec.dependencies, serviceSnapshot: null, appliedDigest: snapshot.authority.markerDigest });
    if (await inspectManagedDirectory(spec.targetPath, spec.candidateMode) !== 'absent') {
      throw new ConfigurationTransactionError('managed directory target appeared after compensation was persisted');
    }
    await rename(staging, spec.targetPath);
    activated = true;
    await syncDirectory(parent);
  } catch (error) {
    if (activated) {
      try {
        await removeAuthorizedManagedDirectory(snapshot);
        compensation = recordFor(spec.taskId, 'applied', artifactDigest, now());
        await request.persistence.update(compensation);
      } catch (restoreError) {
        compensation = recordFor(spec.taskId, 'failed', artifactDigest, now());
        try { await request.persistence.update(compensation); } catch { /* preserve restoration failure */ }
        throw new ConfigurationTransactionError('managed directory activation and automatic compensation both failed', { cause: restoreError, compensation });
      }
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return {
    spec, created: true, snapshot,
    get compensation() { return compensation; },
    async rollback() {
      if (compensation.state !== 'available') return compensation;
      try {
        await removeAuthorizedManagedDirectory(snapshot);
        compensation = recordFor(spec.taskId, 'applied', artifactDigest, now());
        await request.persistence.update(compensation);
      } catch (error) {
        compensation = recordFor(spec.taskId, 'failed', artifactDigest, now());
        try { await request.persistence.update(compensation); } catch { /* preserve rollback failure */ }
        throw new ConfigurationTransactionError(`rollback failed for ${spec.taskId}`, { cause: error, compensation });
      }
      return compensation;
    },
  };
}

export async function rollbackConfigurationTransactions(
  transactions: readonly AppliedConfigurationTransaction[],
): Promise<CompensationRecord[]> {
  const byId = new Map(transactions.map(transaction => [transaction.spec.taskId, transaction]));
  if (byId.size !== transactions.length) throw new ConfigurationTransactionError('duplicate compensation task identifiers');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const dependencyFirst: AppliedConfigurationTransaction[] = [];
  const visit = (transaction: AppliedConfigurationTransaction): void => {
    if (visited.has(transaction.spec.taskId)) return;
    if (visiting.has(transaction.spec.taskId)) throw new ConfigurationTransactionError('compensation dependency graph contains a cycle');
    visiting.add(transaction.spec.taskId);
    for (const dependencyId of transaction.spec.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(transaction.spec.taskId);
    visited.add(transaction.spec.taskId);
    dependencyFirst.push(transaction);
  };
  for (const transaction of transactions) visit(transaction);
  const records: CompensationRecord[] = [];
  for (const transaction of dependencyFirst.reverse()) records.push(await transaction.rollback());
  return records;
}

export async function ensureConfigurationTransactionDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await stat(path);
  if (!info.isDirectory()) throw new ConfigurationTransactionError('configuration transaction directory is not a directory');
}
