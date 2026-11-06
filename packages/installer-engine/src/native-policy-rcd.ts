import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod, chown, lstat, open, readFile, realpath, rename, rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const PRODUCTION_ROOT = '/';
const POLICY_RELATIVE_PATH = 'usr/sbin/policy-rc.d';
const MAX_POLICY_BYTES = 64 * 1024;
const HELPER_BYTES = Buffer.from('#!/bin/sh\nexit 101\n', 'utf8');
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const HELPER_DIGEST = sha256(HELPER_BYTES);

const nullableId = z.number().int().nonnegative().nullable();
const nullableMode = z.number().int().min(0).max(0o7777).nullable();
const nullableInode = z.number().int().nonnegative().nullable();

export const PolicyRcdSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  existed: z.boolean(),
  bytesBase64: z.string().max(Math.ceil(MAX_POLICY_BYTES * 4 / 3) + 4).nullable(),
  uid: nullableId,
  gid: nullableId,
  mode: nullableMode,
  device: nullableInode,
  inode: nullableInode,
}).strict().superRefine((snapshot, context) => {
  const fields = [snapshot.bytesBase64, snapshot.uid, snapshot.gid, snapshot.mode, snapshot.device, snapshot.inode];
  if (snapshot.existed && fields.some(value => value === null)) {
    context.addIssue({ code: 'custom', message: 'an existing policy snapshot must contain exact bytes and metadata' });
  }
  if (!snapshot.existed && fields.some(value => value !== null)) {
    context.addIssue({ code: 'custom', message: 'an absent policy snapshot must not claim bytes or metadata' });
  }
  if (snapshot.bytesBase64 !== null) {
    const decoded = Buffer.from(snapshot.bytesBase64, 'base64');
    if (decoded.length > MAX_POLICY_BYTES || decoded.toString('base64') !== snapshot.bytesBase64) {
      context.addIssue({ code: 'custom', message: 'policy snapshot bytes must use canonical bounded base64' });
    }
  }
});
export type PolicyRcdSnapshot = z.infer<typeof PolicyRcdSnapshotSchema>;

export const PolicyRcdTransactionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.enum(['prepared', 'active', 'restored']),
  target: z.string().min(1),
  snapshot: PolicyRcdSnapshotSchema,
  helperDigest: z.string().regex(/^[a-f0-9]{64}$/),
  preparedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  if (!record.target.endsWith(`/${POLICY_RELATIVE_PATH}`)) {
    context.addIssue({ code: 'custom', message: 'policy transaction target must be the fixed policy-rc.d location' });
  }
  if (record.helperDigest !== HELPER_DIGEST) {
    context.addIssue({ code: 'custom', message: 'policy transaction helper digest is not recognized' });
  }
});
export type PolicyRcdTransactionRecord = z.infer<typeof PolicyRcdTransactionRecordSchema>;

export interface PolicyRcdPersistence {
  readonly prepare: (record: PolicyRcdTransactionRecord) => Promise<void>;
  readonly update: (record: PolicyRcdTransactionRecord) => Promise<void>;
}

export type PolicyRcdInspection = Readonly<{
  disposition: 'original' | 'helper' | 'conflict';
}>;

export interface NativePolicyRcdTransaction {
  readonly target: string;
  prepare(): Promise<PolicyRcdTransactionRecord>;
  activate(record: unknown): Promise<PolicyRcdTransactionRecord>;
  inspect(record: unknown): Promise<PolicyRcdInspection>;
  restore(record: unknown): Promise<PolicyRcdTransactionRecord>;
  reconcile(record: unknown): Promise<PolicyRcdTransactionRecord>;
}

export class NativePolicyRcdError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NativePolicyRcdError';
  }
}

export interface NativePolicyRcdTransactionRequest {
  readonly persistence: PolicyRcdPersistence;
  /** Test-only filesystem root. The target remains the fixed usr/sbin/policy-rc.d path. */
  readonly testRoot?: string;
  /** Test-only expected owner; accepted only with testRoot. */
  readonly testOwner?: number;
  /** Test-only expected group; accepted only with testRoot. */
  readonly testGroup?: number;
  readonly now?: () => string;
}

type ParentAuthority = Readonly<{ path: string; device: number; inode: number }>;
type Observed = Readonly<{
  kind: 'absent' | 'file';
  bytes: Buffer | null;
  uid: number | null;
  gid: number | null;
  mode: number | null;
  device: number | null;
  inode: number | null;
}>;

function errno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function validateRootAndParent(rootInput: string, owner: number): Promise<ParentAuthority> {
  if (process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number') {
    throw new NativePolicyRcdError('policy-rc.d transactions require POSIX no-follow filesystem semantics');
  }
  if (rootInput !== resolve(rootInput)) throw new NativePolicyRcdError('policy transaction root must be a canonical absolute path');
  let rootCanonical: string;
  try { rootCanonical = await realpath(rootInput); }
  catch (error) { throw new NativePolicyRcdError('policy transaction root is unavailable', { cause: error }); }
  if (rootCanonical !== rootInput) throw new NativePolicyRcdError('policy transaction root must be canonical and must not be a symbolic link');

  let current = rootInput;
  for (const component of ['usr', 'sbin']) {
    current = join(current, component);
    const info = await lstat(current).catch(error => {
      throw new NativePolicyRcdError(`policy transaction parent component is unavailable: ${component}`, { cause: error });
    });
    const canonical = await realpath(current);
    if (!info.isDirectory() || info.isSymbolicLink() || canonical !== current) {
      throw new NativePolicyRcdError('policy transaction parent must contain only real nonsymlink directories');
    }
    if (info.uid !== owner || (info.mode & 0o022) !== 0) {
      throw new NativePolicyRcdError('policy transaction parent must have the expected owner and not be group/other writable');
    }
  }
  const parent = await lstat(current);
  return Object.freeze({ path: current, device: parent.dev, inode: parent.ino });
}

async function assertParentIdentity(authority: ParentAuthority, owner: number): Promise<void> {
  const info = await lstat(authority.path);
  const canonical = await realpath(authority.path);
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== authority.path
    || info.dev !== authority.device || info.ino !== authority.inode
    || info.uid !== owner || (info.mode & 0o022) !== 0) {
    throw new NativePolicyRcdError('policy transaction parent identity changed');
  }
}

async function observe(target: string): Promise<Observed> {
  let pathInfo: Awaited<ReturnType<typeof lstat>>;
  try { pathInfo = await lstat(target); }
  catch (error) {
    if (errno(error, 'ENOENT')) return Object.freeze({ kind: 'absent', bytes: null, uid: null, gid: null, mode: null, device: null, inode: null });
    throw error;
  }
  if (pathInfo.isSymbolicLink() || !pathInfo.isFile() || pathInfo.nlink !== 1) {
    throw new NativePolicyRcdError('policy-rc.d target must be an absent path or a single-link regular file');
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { throw new NativePolicyRcdError('policy-rc.d target changed while being opened', { cause: error }); }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== pathInfo.dev || info.ino !== pathInfo.ino) {
      throw new NativePolicyRcdError('policy-rc.d target inode changed while being inspected');
    }
    if (info.size > MAX_POLICY_BYTES) throw new NativePolicyRcdError('existing policy-rc.d exceeds the snapshot size bound');
    const bytes = await handle.readFile();
    return Object.freeze({
      kind: 'file', bytes, uid: info.uid, gid: info.gid, mode: info.mode & 0o7777,
      device: info.dev, inode: info.ino,
    });
  } finally { await handle.close(); }
}

function snapshotFrom(observed: Observed): PolicyRcdSnapshot {
  return PolicyRcdSnapshotSchema.parse({
    schemaVersion: 1,
    existed: observed.kind === 'file',
    bytesBase64: observed.bytes?.toString('base64') ?? null,
    uid: observed.uid,
    gid: observed.gid,
    mode: observed.mode,
    device: observed.device,
    inode: observed.inode,
  });
}

function matchesSnapshot(observed: Observed, snapshot: PolicyRcdSnapshot, requireIdentity: boolean): boolean {
  if (!snapshot.existed) return observed.kind === 'absent';
  if (observed.kind !== 'file' || observed.bytes === null || snapshot.bytesBase64 === null) return false;
  return observed.bytes.equals(Buffer.from(snapshot.bytesBase64, 'base64'))
    && observed.uid === snapshot.uid && observed.gid === snapshot.gid && observed.mode === snapshot.mode
    && (!requireIdentity || (observed.device === snapshot.device && observed.inode === snapshot.inode));
}

function matchesHelper(observed: Observed, owner: number, group: number): boolean {
  return observed.kind === 'file' && observed.bytes !== null
    && sha256(observed.bytes) === HELPER_DIGEST && observed.bytes.equals(HELPER_BYTES)
    && observed.uid === owner && observed.gid === group && observed.mode === 0o755;
}

async function writeAtomic(input: {
  parent: ParentAuthority;
  target: string;
  bytes: Uint8Array;
  mode: number;
  uid: number;
  gid: number;
}): Promise<void> {
  const candidate = join(input.parent.path, `.install-doctor-policy-rcd-${process.pid}-${randomBytes(12).toString('hex')}`);
  const handle = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(input.bytes);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await chown(candidate, input.uid, input.gid);
    await chmod(candidate, input.mode);
    const candidateInfo = await lstat(candidate);
    if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.nlink !== 1
      || candidateInfo.uid !== input.uid || candidateInfo.gid !== input.gid || (candidateInfo.mode & 0o7777) !== input.mode) {
      throw new NativePolicyRcdError('private policy-rc.d candidate metadata could not be proven');
    }
    await rename(candidate, input.target);
    const publishedInfo = await lstat(input.target);
    if (!publishedInfo.isFile() || publishedInfo.isSymbolicLink() || publishedInfo.nlink !== 1
      || publishedInfo.dev !== candidateInfo.dev || publishedInfo.ino !== candidateInfo.ino) {
      throw new NativePolicyRcdError('published policy-rc.d inode does not match the private candidate');
    }
    await syncDirectory(input.parent.path);
  } finally { await rm(candidate, { force: true }); }
}

async function removeOwnedHelper(input: {
  parent: ParentAuthority;
  target: string;
  expected: Observed;
  owner: number;
  group: number;
}): Promise<void> {
  const tombstone = join(input.parent.path, `.install-doctor-policy-rcd-remove-${process.pid}-${randomBytes(12).toString('hex')}`);
  await rename(input.target, tombstone);
  let moved: Observed;
  try { moved = await observe(tombstone); }
  catch (error) {
    await rename(tombstone, input.target).catch(() => undefined);
    throw error;
  }
  if (!matchesHelper(moved, input.owner, input.group)
    || moved.device !== input.expected.device || moved.inode !== input.expected.inode) {
    try { await rename(tombstone, input.target); await syncDirectory(input.parent.path); }
    catch (restoreError) {
      throw new NativePolicyRcdError('policy-rc.d changed during removal and could not be put back', { cause: restoreError });
    }
    throw new NativePolicyRcdError('policy-rc.d changed during attributable removal');
  }
  await rm(tombstone);
  await syncDirectory(input.parent.path);
}

function nextPhase(record: PolicyRcdTransactionRecord, phase: PolicyRcdTransactionRecord['phase']): PolicyRcdTransactionRecord {
  return PolicyRcdTransactionRecordSchema.parse({ ...record, phase });
}

export async function createNativePolicyRcdTransaction(
  request: NativePolicyRcdTransactionRequest,
): Promise<NativePolicyRcdTransaction> {
  if (!request?.persistence || typeof request.persistence.prepare !== 'function' || typeof request.persistence.update !== 'function') {
    throw new NativePolicyRcdError('policy-rc.d activation requires durable persistence');
  }
  const isTest = request.testRoot !== undefined;
  if (!isTest && (request.testOwner !== undefined || request.testGroup !== undefined)) {
    throw new NativePolicyRcdError('test ownership overrides require a test root');
  }
  if (isTest && (request.testOwner === undefined || request.testGroup === undefined)) {
    throw new NativePolicyRcdError('a test root requires explicit test owner and group identities');
  }
  const root = request.testRoot ?? PRODUCTION_ROOT;
  const owner = request.testOwner ?? 0;
  const group = request.testGroup ?? 0;
  if (!Number.isSafeInteger(owner) || owner < 0 || !Number.isSafeInteger(group) || group < 0) {
    throw new NativePolicyRcdError('policy transaction owner and group must be nonnegative integers');
  }
  const parent = await validateRootAndParent(root, owner);
  const target = join(root, POLICY_RELATIVE_PATH);
  const now = request.now ?? (() => new Date().toISOString());

  const parseRecord = (input: unknown): PolicyRcdTransactionRecord => {
    const record = PolicyRcdTransactionRecordSchema.parse(input);
    if (record.target !== target) throw new NativePolicyRcdError('policy transaction record belongs to a different fixed target');
    return record;
  };

  const inspect = async (input: unknown): Promise<PolicyRcdInspection> => {
    const record = parseRecord(input);
    await assertParentIdentity(parent, owner);
    const current = await observe(target);
    if (matchesSnapshot(current, record.snapshot, false)) return Object.freeze({ disposition: 'original' });
    if (matchesHelper(current, owner, group)) return Object.freeze({ disposition: 'helper' });
    return Object.freeze({ disposition: 'conflict' });
  };

  const restoreExact = async (record: PolicyRcdTransactionRecord): Promise<void> => {
    await assertParentIdentity(parent, owner);
    const current = await observe(target);
    if (matchesSnapshot(current, record.snapshot, false)) return;
    if (!matchesHelper(current, owner, group)) throw new NativePolicyRcdError('policy-rc.d restoration conflict: current state is neither the original nor the installer helper');
    await assertParentIdentity(parent, owner);
    const revalidated = await observe(target);
    if (!matchesHelper(revalidated, owner, group)
      || revalidated.device !== current.device || revalidated.inode !== current.inode) {
      throw new NativePolicyRcdError('policy-rc.d helper inode changed before restoration');
    }
    if (!record.snapshot.existed) {
      await removeOwnedHelper({ parent, target, expected: revalidated, owner, group });
      return;
    }
    if (record.snapshot.bytesBase64 === null || record.snapshot.mode === null
      || record.snapshot.uid === null || record.snapshot.gid === null) {
      throw new NativePolicyRcdError('policy-rc.d restoration snapshot is incomplete');
    }
    await writeAtomic({
      parent, target, bytes: Buffer.from(record.snapshot.bytesBase64, 'base64'),
      mode: record.snapshot.mode, uid: record.snapshot.uid, gid: record.snapshot.gid,
    });
  };

  return Object.freeze({
    target,
    async prepare() {
      await assertParentIdentity(parent, owner);
      const observed = await observe(target);
      const record = PolicyRcdTransactionRecordSchema.parse({
        schemaVersion: 1,
        phase: 'prepared',
        target,
        snapshot: snapshotFrom(observed),
        helperDigest: HELPER_DIGEST,
        preparedAt: now(),
      });
      await request.persistence.prepare(record);
      return record;
    },
    async activate(input: unknown) {
      const record = parseRecord(input);
      if (record.phase === 'active') {
        if ((await inspect(record)).disposition !== 'helper') throw new NativePolicyRcdError('active policy transaction no longer owns the helper state');
        return record;
      }
      if (record.phase !== 'prepared') throw new NativePolicyRcdError('only a prepared policy transaction can be activated');
      await assertParentIdentity(parent, owner);
      const current = await observe(target);
      if (!matchesSnapshot(current, record.snapshot, true)) {
        throw new NativePolicyRcdError('policy-rc.d changed after the prepared checkpoint');
      }
      await assertParentIdentity(parent, owner);
      const revalidated = await observe(target);
      if (!matchesSnapshot(revalidated, record.snapshot, true)) {
        throw new NativePolicyRcdError('policy-rc.d changed after the prepared checkpoint');
      }
      await writeAtomic({ parent, target, bytes: HELPER_BYTES, mode: 0o755, uid: owner, gid: group });
      const landed = await observe(target);
      if (!matchesHelper(landed, owner, group)) throw new NativePolicyRcdError('policy-rc.d helper postcondition failed');
      const active = nextPhase(record, 'active');
      await request.persistence.update(active);
      return active;
    },
    inspect,
    async restore(input: unknown) {
      const record = parseRecord(input);
      if (record.phase === 'restored') {
        if ((await inspect(record)).disposition !== 'original') throw new NativePolicyRcdError('restored policy transaction has drifted');
        return record;
      }
      await restoreExact(record);
      const restored = nextPhase(record, 'restored');
      await request.persistence.update(restored);
      return restored;
    },
    async reconcile(input: unknown) {
      const record = parseRecord(input);
      const disposition = (await inspect(record)).disposition;
      if (disposition === 'conflict') throw new NativePolicyRcdError('policy-rc.d reconciliation conflict');
      if (record.phase === 'restored') {
        if (disposition !== 'original') throw new NativePolicyRcdError('a restored policy transaction unexpectedly owns an active helper');
        return record;
      }
      if (record.phase === 'prepared' && disposition === 'original') return record;
      if (disposition === 'helper') await restoreExact(record);
      const restored = nextPhase(record, 'restored');
      await request.persistence.update(restored);
      return restored;
    },
  });
}
