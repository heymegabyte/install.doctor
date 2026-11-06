import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CompensationRecordSchema, InstallerEventSchema, JournalSchema, NormalizedPlanSchema, TerminalReceiptSchema } from '@install-doctor/aid-core/installer-contracts';
import type { InstallerEvent, Journal, NormalizedPlan, TerminalReceipt } from './contracts.js';
import { ConfigurationSnapshotSchema, ServiceStateSnapshotSchema, configurationCompensationArtifactDigest } from './config-transaction.js';
import type { ConfigurationCompensationArtifact } from './config-transaction.js';
import { isPlatformProcessIdentityAlive } from './process-identity.js';
import { HostMutationOwnerSchema } from './host-mutation-lease.js';
import type { HostMutationOwner } from './host-mutation-lease.js';
import { NativeDpkgTransactionRecordSchema } from './native-dpkg-transaction-record.js';
import type { NativeDpkgTransactionPersistence, NativeDpkgTransactionRecord } from './native-dpkg-transaction-record.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const taskIdentifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const JournalObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previousDigest: digest.nullable(),
  journal: JournalSchema,
});
const JournalHeadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  journalDigest: digest,
  previousDigest: digest.nullable(),
});
const FinalCommitSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: identifier,
  planDigest: digest,
  planArtifact: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  journalObject: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  journalHead: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  events: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  receipt: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  compensationIndex: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }).nullable(),
  nativeTransactionIndex: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }).nullable(),
  evidencePaths: z.array(z.string().min(1).max(4096)).min(1).max(64),
});
const TerminalAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: identifier,
  planDigest: digest,
  commit: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
});
const PersistedCompensationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  record: CompensationRecordSchema,
  snapshot: ConfigurationSnapshotSchema,
  bytesBase64: z.string().max(11_184_812).nullable(),
  dependencies: z.array(taskIdentifier).max(512),
  serviceSnapshot: ServiceStateSnapshotSchema.nullable().default(null),
  appliedDigest: digest.nullable().default(null),
});
export type PersistedConfigurationCompensation = z.infer<typeof PersistedCompensationSchema>;
const CompensationIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  artifacts: z.array(z.strictObject({ taskId: taskIdentifier, path: z.string().min(1).max(4096), sha256: digest })).max(10_000),
});
const NativeTransactionHeadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  transactionId: digest,
  rootPackageKey: identifier,
  recordDigest: digest,
});
const NativeTransactionIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  transactions: z.array(z.strictObject({
    transactionId: digest,
    rootPackageKey: identifier,
    current: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
    record: z.strictObject({ path: z.string().min(1).max(4096), sha256: digest }),
  })).max(10_000),
  objects: z.array(z.strictObject({ path: z.string().min(1).max(4096), sha256: digest })).max(100_000),
});

export const JournalRunSummarySchema = z.strictObject({
  schemaVersion: z.literal(1), runId: identifier, planDigest: digest,
  releaseId: identifier, desiredRevision: identifier, updatedAt: timestamp,
  journalRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  authority: z.enum(['committed', 'active', 'uncommitted', 'absent', 'corrupt']),
  resumeCandidate: z.boolean(),
  taskCounts: z.strictObject({
    running: z.number().int().nonnegative(), verified: z.number().int().nonnegative(),
    inapplicable: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(), interrupted: z.number().int().nonnegative(),
  }),
});
export type JournalRunSummary = z.infer<typeof JournalRunSummarySchema>;

export type RunOwner = HostMutationOwner;
export type JournalEntry = Journal['entries'][number];

export class LiveOwnerError extends Error {
  constructor(message = 'run already has a live owner') { super(message); this.name = 'LiveOwnerError'; }
}

export class JournalIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'JournalIntegrityError'; }
}

export interface JournalStoreOptions {
  readonly stateRoot: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly processStart: string;
  readonly pid?: number;
  readonly leaseMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly now?: () => string;
  readonly isProcessAlive?: (pid: number, processStart: string) => Promise<boolean>;
  readonly fault?: (point: 'after-object-sync' | 'after-head-sync' | 'after-events-sync' | 'after-receipt-sync' | 'after-commit-sync') => Promise<void>;
}

export interface JournalClaim {
  readonly owner: RunOwner;
  readonly journal: Journal;
  readonly resumed: boolean;
  readonly runDirectory: string;
}

export type CompletionAuthority = 'committed' | 'active' | 'uncommitted' | 'absent' | 'corrupt';

export interface CompletionInspection {
  readonly authority: CompletionAuthority;
  readonly runId: string;
  readonly planDigest: string;
  readonly receipt?: TerminalReceipt;
  readonly commitPath?: string;
  readonly problems: readonly string[];
}

interface DurableJournal {
  readonly journal: Journal;
  readonly digest: string;
  readonly objectPath: string;
  readonly headPath: string;
}

export interface JournalStore {
  readonly heartbeatIntervalMs: number;
  claim(runId: string, plan: NormalizedPlan, mode?: 'run' | 'resume'): Promise<JournalClaim>;
  checkpoint(owner: RunOwner, entry: JournalEntry): Promise<Journal>;
  persistCompensation(owner: RunOwner, artifact: ConfigurationCompensationArtifact): Promise<void>;
  updateCompensation(owner: RunOwner, record: PersistedConfigurationCompensation['record']): Promise<void>;
  readCompensations(runId: string, planDigest: string): Promise<readonly PersistedConfigurationCompensation[]>;
  bindNativeDpkgTransactionPersistence(owner: RunOwner): NativeDpkgTransactionPersistence;
  readPlan(runId: string, planDigest: string): Promise<NormalizedPlan | undefined>;
  read(runId: string, planDigest: string): Promise<Journal | undefined>;
  inspectCompletion(runId: string, planDigest: string): Promise<CompletionInspection>;
  listRuns(): Promise<readonly JournalRunSummary[]>;
  renew(owner: RunOwner): Promise<RunOwner>;
  finalize(owner: RunOwner, plan: NormalizedPlan, receipt: TerminalReceipt, events: readonly InstallerEvent[]): Promise<readonly string[]>;
  release(owner: RunOwner): Promise<void>;
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const temporary = join(resolve(path, '..'), publicationTempName());
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

function publicationTempName(): string {
  return `.publish.${process.pid}.${randomUUID()}.tmp`;
}

function withoutPublicationTemps(names: readonly string[]): string[] {
  return names.filter(name => !/^\.publish\.\d+\.[a-f0-9-]{36}\.tmp$/.test(name));
}

function canonicalBytes(value: unknown): Buffer {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
    }
    return input;
  };
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
  const directoryPath = resolve(path, '..');
  const temporary = join(directoryPath, publicationTempName());
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  let published = false;
  try {
    await link(temporary, path);
    published = true;
    // The final name becomes authoritative only as one atomic directory entry.
    // Remove the staging link before the directory fsync so a successful
    // publication is durably single-linked.
    await rm(temporary);
    await syncDirectory(directoryPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const existing = await readProtectedBytes(path);
    if (!existing.equals(bytes)) throw new JournalIntegrityError(`immutable journal artifact collision: ${path}`);
  } finally {
    await rm(temporary, { force: true });
    // Persist both publication and cleanup. A crash before cleanup may leave a
    // recognizable non-authoritative temp link, which readers ignore.
    if (published) await syncDirectory(directoryPath);
  }
}

async function writeExclusiveAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const directoryPath = resolve(path, '..');
  const temporary = join(directoryPath, publicationTempName());
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  let published = false;
  try {
    await link(temporary, path);
    published = true;
    await rm(temporary);
    await syncDirectory(directoryPath);
  } finally {
    await rm(temporary, { force: true });
    if (published) await syncDirectory(directoryPath);
  }
}

async function hasOnlyRecognizedPublicationLink(path: string, device: number, inode: number, links: number): Promise<boolean> {
  if (links === 1) return true;
  if (links !== 2) return false;
  let matches = 0;
  for (const name of await readdir(dirname(path))) {
    if (!/^\.publish\.\d+\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
    const candidate = join(dirname(path), name);
    const info = await lstat(candidate);
    if (info.dev === device && info.ino === inode) matches += 1;
  }
  return matches === 1;
}

async function readProtectedBytes(path: string): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new JournalIntegrityError(`journal artifact is not a regular file: ${path}`);
    if (before.size < 2 || before.size > 16_777_216) throw new JournalIntegrityError(`journal artifact size is outside policy: ${path}`);
    const safeLinks = process.platform === 'win32'
      || await hasOnlyRecognizedPublicationLink(path, before.dev, before.ino, before.nlink);
    if (process.platform !== 'win32' && ((before.mode & 0o022) !== 0 || !safeLinks)) {
      throw new JournalIntegrityError(`journal artifact has insecure permissions or links: ${path}`);
    }
    if (process.platform !== 'win32' && process.geteuid?.() !== before.uid) throw new JournalIntegrityError(`journal artifact is not owned by the effective user: ${path}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new JournalIntegrityError(`journal artifact changed during protected read: ${path}`);
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new JournalIntegrityError(`journal artifact grew during protected read: ${path}`);
    }
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink) {
      throw new JournalIntegrityError(`journal artifact identity changed during protected read: ${path}`);
    }
    return bytes;
  } finally { await handle.close(); }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readProtectedBytes(path)).toString('utf8')) as unknown;
}

function ensureWithin(root: string, path: string): void {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (path !== root && !path.startsWith(prefix)) throw new JournalIntegrityError('journal path escapes its protected root');
}

const terminalRunStatuses = new Set(['redirected', 'success', 'failed', 'cancelled', 'rejected']);
const terminalTaskStatuses = new Set(['verified', 'inapplicable', 'pending', 'pending-reboot', 'interrupted', 'blocked', 'failed']);

function validateFinalEvidence(
  plan: NormalizedPlan,
  receipt: TerminalReceipt,
  events: readonly InstallerEvent[],
  journal: Journal,
): void {
  const terminalRuns = events.filter(event => event.kind === 'run-status' && terminalRunStatuses.has(event.status));
  const finalEvent = events.at(-1);
  if (terminalRuns.length !== 1 || finalEvent?.kind !== 'run-status' || !terminalRunStatuses.has(finalEvent.status)) {
    throw new JournalIntegrityError('final evidence must end with exactly one terminal run status');
  }
  const expectedRunStatus = receipt.status === 'success'
    ? 'success'
    : receipt.status === 'cancelled'
      ? 'cancelled'
      : receipt.status === 'rejected'
        ? 'rejected'
      : receipt.status === 'redirected'
        ? 'redirected'
        : 'failed';
  if (finalEvent.status !== expectedRunStatus) {
    throw new JournalIntegrityError('terminal run status does not agree with the receipt status');
  }

  const recordEvents = events.filter(event => event.kind === 'phase-status' && event.phase === 'record');
  const penultimate = events.at(-2);
  if (recordEvents.length !== 2
    || recordEvents[0]?.kind !== 'phase-status' || recordEvents[0].status !== 'started'
    || penultimate?.kind !== 'phase-status' || penultimate.phase !== 'record' || penultimate.status !== 'succeeded') {
    throw new JournalIntegrityError('record phase must start once and succeed immediately before the terminal run status');
  }

  const selected = new Set(plan.selectedTaskIds);
  const outcomes = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 'task-status') continue;
    if (!selected.has(event.taskId)) throw new JournalIntegrityError(`final evidence contains an unselected task: ${event.taskId}`);
    if (terminalTaskStatuses.has(event.status)) outcomes.set(event.taskId, event.status);
  }
  for (const taskId of plan.selectedTaskIds) {
    if (!outcomes.has(taskId)) throw new JournalIntegrityError(`selected task has no terminal outcome: ${taskId}`);
  }

  const actualCounts = {
    verified: [...outcomes.values()].filter(status => status === 'verified').length,
    inapplicable: [...outcomes.values()].filter(status => status === 'inapplicable').length,
    skipped: 0,
    blocked: [...outcomes.values()].filter(status => status === 'blocked').length,
    pending: [...outcomes.values()].filter(status => status === 'pending' || status === 'pending-reboot' || status === 'interrupted').length,
    failed: [...outcomes.values()].filter(status => status === 'failed').length,
  };
  if (Object.entries(actualCounts).some(([key, value]) => receipt.taskCounts[key as keyof typeof receipt.taskCounts] !== value)) {
    throw new JournalIntegrityError('terminal task outcomes do not agree with receipt task counts');
  }

  const journalEntries = new Map(journal.entries.map(entry => [entry.taskId, entry.status]));
  for (const [taskId, status] of outcomes) {
    if (journalEntries.get(taskId) !== status) {
      throw new JournalIntegrityError(`terminal task outcome does not agree with the durable journal: ${taskId}`);
    }
  }
}

export function createJournalStore(options: JournalStoreOptions): JournalStore {
  const stateRoot = resolve(options.stateRoot);
  const hostId = identifier.parse(options.hostId);
  const bootId = z.string().min(1).max(256).parse(options.bootId);
  const processStart = z.string().min(1).max(256).parse(options.processStart);
  const pid = z.number().int().positive().parse(options.pid ?? process.pid);
  const leaseMs = z.number().int().min(1_000).max(86_400_000).parse(options.leaseMs ?? 30_000);
  const heartbeatIntervalMs = z.number().int().min(10).max(28_800_000).parse(options.heartbeatIntervalMs ?? Math.max(250, Math.floor(leaseMs / 3)));
  if (heartbeatIntervalMs >= leaseMs) throw new Error('journal heartbeat interval must be shorter than the lease');
  const now = options.now ?? (() => new Date().toISOString());
  const isProcessAlive = options.isProcessAlive ?? isPlatformProcessIdentityAlive;
  let writeQueue: Promise<void> = Promise.resolve();
  const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
    const prior = writeQueue;
    let release = (): void => undefined;
    writeQueue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  };

  const paths = (runIdInput: string, digestInput: string) => {
    const runId = identifier.parse(runIdInput);
    const planDigest = digest.parse(digestInput);
    const runDirectory = resolve(stateRoot, 'runs', planDigest, runId);
    ensureWithin(stateRoot, runDirectory);
    return {
      runDirectory,
      owner: join(stateRoot, 'owner.json'),
      terminalAuthority: join(runDirectory, 'terminal-authority.json'),
      plan: join(runDirectory, 'plan.json'),
      receipts: join(runDirectory, 'receipts'),
      commits: join(runDirectory, 'commits'),
      objects: join(runDirectory, 'objects', 'sha256'),
      heads: join(runDirectory, 'heads'),
      events: join(runDirectory, 'events'),
      compensations: join(runDirectory, 'compensations'),
      compensationIndexes: join(runDirectory, 'compensation-indexes'),
      nativeTransactionObjects: join(runDirectory, 'native-transactions', 'objects', 'sha256'),
      nativeTransactionCurrent: join(runDirectory, 'native-transactions', 'current'),
      nativeTransactionIndexes: join(runDirectory, 'native-transaction-indexes'),
    };
  };

  const prepare = async (runDirectory: string): Promise<void> => {
    const target = {
      objects: join(runDirectory, 'objects', 'sha256'), heads: join(runDirectory, 'heads'), events: join(runDirectory, 'events'),
      receipts: join(runDirectory, 'receipts'), commits: join(runDirectory, 'commits'), compensations: join(runDirectory, 'compensations'),
      compensationIndexes: join(runDirectory, 'compensation-indexes'),
      nativeTransactionObjects: join(runDirectory, 'native-transactions', 'objects', 'sha256'),
      nativeTransactionCurrent: join(runDirectory, 'native-transactions', 'current'),
      nativeTransactionIndexes: join(runDirectory, 'native-transaction-indexes'),
    };
    await mkdir(target.objects, { recursive: true, mode: 0o700 });
    await mkdir(target.heads, { recursive: true, mode: 0o700 });
    await mkdir(target.events, { recursive: true, mode: 0o700 });
    await mkdir(target.receipts, { recursive: true, mode: 0o700 });
    await mkdir(target.commits, { recursive: true, mode: 0o700 });
    await mkdir(target.compensations, { recursive: true, mode: 0o700 });
    await mkdir(target.compensationIndexes, { recursive: true, mode: 0o700 });
    await mkdir(target.nativeTransactionObjects, { recursive: true, mode: 0o700 });
    await mkdir(target.nativeTransactionCurrent, { recursive: true, mode: 0o700 });
    await mkdir(target.nativeTransactionIndexes, { recursive: true, mode: 0o700 });
    for (const candidate of [stateRoot, resolve(stateRoot, 'runs'), resolve(runDirectory, '..'), runDirectory, resolve(target.objects, '..'), target.objects, target.heads, target.events, target.receipts, target.commits, target.compensations, target.compensationIndexes, resolve(target.nativeTransactionObjects, '..', '..'), resolve(target.nativeTransactionObjects, '..'), target.nativeTransactionObjects, target.nativeTransactionCurrent, target.nativeTransactionIndexes]) {
      const info = await lstat(candidate);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new JournalIntegrityError(`journal path is not a protected directory: ${candidate}`);
      if (process.platform !== 'win32' && (info.mode & 0o022) !== 0) throw new JournalIntegrityError(`journal directory is writable by another user class: ${candidate}`);
      if (process.platform !== 'win32' && process.geteuid?.() !== info.uid) throw new JournalIntegrityError(`journal directory is not owned by the effective user: ${candidate}`);
    }
  };

  const ownerFor = (runId: string, planDigest: string): RunOwner => {
    const at = now();
    return HostMutationOwnerSchema.parse({
      schemaVersion: 1, runId, planDigest, hostId, pid, bootId, processStart,
      token: randomUUID(), claimedAt: at, heartbeatAt: at,
      leaseUntil: new Date(new Date(at).getTime() + leaseMs).toISOString(),
    });
  };

  const requireOwner = async (expected: RunOwner): Promise<RunOwner> => {
    const path = paths(expected.runId, expected.planDigest).owner;
    let current: RunOwner;
    try { current = HostMutationOwnerSchema.parse(await readJson(path)); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new LiveOwnerError('run lease is no longer held');
      throw error;
    }
    if (current.token !== expected.token || current.hostId !== hostId) throw new LiveOwnerError('journal owner token no longer holds the run lease');
    return current;
  };

  const loadDurable = async (target: ReturnType<typeof paths>): Promise<DurableJournal | undefined> => {
    let names: string[];
    try { names = await readdir(target.heads); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    const parsed = withoutPublicationTemps(names).map(name => {
      const match = /^(\d{16})-([a-f0-9]{64})\.json$/.exec(name);
      if (!match) throw new JournalIntegrityError(`unexpected journal head artifact: ${name}`);
      return { name, generation: Number(match[1]), digest: match[2] ?? '' };
    }).sort((left, right) => left.generation - right.generation);
    if (parsed.length === 0) return undefined;
    let previousDigest: string | null = null;
    let latest: DurableJournal | undefined;
    for (const [index, candidate] of parsed.entries()) {
      if (candidate.generation !== index + 1) throw new JournalIntegrityError('journal generation chain is not contiguous');
      const headPath = join(target.heads, candidate.name);
      const head = JournalHeadSchema.parse(await readJson(headPath));
      if (head.generation !== candidate.generation || head.journalDigest !== candidate.digest || head.previousDigest !== previousDigest) {
        throw new JournalIntegrityError('journal head does not match its immutable generation chain');
      }
      const objectPath = join(target.objects, `${candidate.digest}.json`);
      const bytes = await readProtectedBytes(objectPath);
      if (hash(bytes) !== candidate.digest) throw new JournalIntegrityError('journal object content hash mismatch');
      const object = JournalObjectSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
      if (object.generation !== candidate.generation || object.previousDigest !== previousDigest || object.journal.revision !== candidate.generation) {
        throw new JournalIntegrityError('journal object does not match its generation marker');
      }
      latest = { journal: object.journal, digest: candidate.digest, objectPath, headPath };
      previousDigest = candidate.digest;
    }
    return latest;
  };

  const commitDurable = async (target: ReturnType<typeof paths>, journalInput: Journal, previousDigest: string | null): Promise<DurableJournal> => {
    const journal = JournalSchema.parse(journalInput);
    const object = JournalObjectSchema.parse({ schemaVersion: 1, generation: journal.revision, previousDigest, journal });
    const bytes = canonicalBytes(object);
    const journalDigest = hash(bytes);
    const objectPath = join(target.objects, `${journalDigest}.json`);
    await writeImmutable(objectPath, bytes);
    await options.fault?.('after-object-sync');
    const head = JournalHeadSchema.parse({ schemaVersion: 1, generation: journal.revision, journalDigest, previousDigest });
    const headPath = join(target.heads, `${String(journal.revision).padStart(16, '0')}-${journalDigest}.json`);
    await writeImmutable(headPath, canonicalBytes(head));
    await options.fault?.('after-head-sync');
    return { journal, digest: journalDigest, objectPath, headPath };
  };

  interface DurableNativeTransaction {
    readonly record: NativeDpkgTransactionRecord;
    readonly currentPath: string;
    readonly currentDigest: string;
    readonly recordPath: string;
    readonly recordDigest: string;
  }

  const loadNativeTransactions = async (
    target: ReturnType<typeof paths>,
    runId: string,
    planDigest: string,
  ): Promise<readonly DurableNativeTransaction[]> => {
    let names: string[];
    try { names = withoutPublicationTemps(await readdir(target.nativeTransactionCurrent)).sort(); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return Object.freeze([]);
      throw error;
    }
    const transactions: DurableNativeTransaction[] = [];
    const rootPackageKeys = new Set<string>();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.json$/.exec(name);
      if (!match) throw new JournalIntegrityError(`unexpected native transaction current artifact: ${name}`);
      const transactionId = match[1] ?? '';
      const currentPath = join(target.nativeTransactionCurrent, name);
      const currentBytes = await readProtectedBytes(currentPath);
      const head = NativeTransactionHeadSchema.parse(JSON.parse(currentBytes.toString('utf8')) as unknown);
      if (head.transactionId !== transactionId) throw new JournalIntegrityError('native transaction current filename does not match its identity');
      const recordPath = join(target.nativeTransactionObjects, `${head.recordDigest}.json`);
      const recordBytes = await readProtectedBytes(recordPath);
      if (hash(recordBytes) !== head.recordDigest) throw new JournalIntegrityError('native transaction record digest mismatch');
      const record = NativeDpkgTransactionRecordSchema.parse(JSON.parse(recordBytes.toString('utf8')) as unknown);
      if (record.transactionId !== transactionId || record.rootPackageKey !== head.rootPackageKey) {
        throw new JournalIntegrityError('native transaction current head does not match its record identity');
      }
      if (record.runId !== runId || record.planDigest !== planDigest || record.hostId !== hostId) {
        throw new JournalIntegrityError('native transaction record identity does not match its journal run');
      }
      if (rootPackageKeys.has(record.rootPackageKey)) {
        throw new JournalIntegrityError(`native transaction root package task is duplicated: ${record.rootPackageKey}`);
      }
      rootPackageKeys.add(record.rootPackageKey);
      transactions.push({
        record, currentPath, currentDigest: hash(currentBytes), recordPath, recordDigest: head.recordDigest,
      });
    }
    return Object.freeze(transactions);
  };

  const nativeTransactionIdentityIsStable = (before: NativeDpkgTransactionRecord, after: NativeDpkgTransactionRecord): boolean => {
    const packageIdentity = (record: NativeDpkgTransactionRecord): unknown => record.packages.map(value => ({
      packageKey: value.packageKey, packageName: value.packageName, version: value.version, architecture: value.architecture,
    }));
    return before.transactionId === after.transactionId
      && before.runId === after.runId
      && before.hostId === after.hostId
      && before.planDigest === after.planDigest
      && before.rootPackageKey === after.rootPackageKey
      && before.authorityDigest === after.authorityDigest
      && before.createdAt === after.createdAt
      && JSON.stringify(packageIdentity(before)) === JSON.stringify(packageIdentity(after));
  };

  return {
    heartbeatIntervalMs,
    async claim(runIdInput, planInput, mode = 'run') {
      const plan = NormalizedPlanSchema.parse(planInput);
      const runId = identifier.parse(runIdInput);
      const target = paths(runId, plan.digest);
      await prepare(target.runDirectory);
      try {
        await readProtectedBytes(target.terminalAuthority);
        throw new JournalIntegrityError('run identity already has terminal commit evidence; start a new run identity');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      let resumed = false;
      let journal: Journal;
      let previousDigest: string | null = null;
      try {
        const durable = await loadDurable(target);
        if (!durable) throw Object.assign(new Error('journal absent'), { code: 'ENOENT' });
        journal = durable.journal;
        previousDigest = durable.digest;
        resumed = true;
        if (journal.planDigest !== plan.digest || journal.runId !== runId) throw new JournalIntegrityError('journal identity does not match the requested run');
        const persistedPlan = NormalizedPlanSchema.parse(await readJson(target.plan));
        const { createdAt: _persistedCreatedAt, ...persistedSemanticPlan } = persistedPlan;
        const { createdAt: _currentCreatedAt, ...currentSemanticPlan } = plan;
        if (JSON.stringify(persistedSemanticPlan) !== JSON.stringify(currentSemanticPlan)) throw new JournalIntegrityError('persisted plan does not match the normalized resume plan');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        journal = JournalSchema.parse({
          schemaVersion: 1, runId, planDigest: plan.digest, releaseId: plan.releaseId,
          desiredRevision: plan.desiredRevision, hostId, hostFactsDigest: plan.hostFactsDigest,
          ownerId: 'unclaimed', revision: 0, updatedAt: now(), entries: [],
        });
      }
      if (journal.releaseId !== plan.releaseId || journal.desiredRevision !== plan.desiredRevision || journal.hostId !== hostId || journal.hostFactsDigest !== plan.hostFactsDigest) {
        throw new JournalIntegrityError('journal semantic bindings do not match the requested plan');
      }
      const plannedTasks = new Map(plan.tasks.map(task => [task.id, task.inputDigest]));
      for (const entry of journal.entries) {
        if (plannedTasks.get(entry.taskId) !== entry.inputDigest) throw new JournalIntegrityError(`journal task binding does not match the resume plan: ${entry.taskId}`);
      }

      try {
        const existing = HostMutationOwnerSchema.parse(await readJson(target.owner));
        const expired = new Date(existing.leaseUntil).getTime() <= new Date(now()).getTime();
        const alive = existing.bootId === bootId && await isProcessAlive(existing.pid, existing.processStart);
        if (!expired || alive) throw new LiveOwnerError();
        if (mode === 'run' && resumed) {
          throw new JournalIntegrityError('fresh run requires absent journal evidence; use explicit resume for an interrupted run');
        }
        const quarantined = `${target.owner}.stale.${existing.token}`;
        await rename(target.owner, quarantined);
      } catch (error) {
        if (error instanceof LiveOwnerError) throw error;
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }

      if (mode === 'run' && resumed) {
        throw new JournalIntegrityError('fresh run requires absent journal evidence; use explicit resume for an interrupted run');
      }

      const owner = ownerFor(runId, plan.digest);
      try { await writeExclusiveAtomic(target.owner, canonicalBytes(owner)); }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new LiveOwnerError();
        try {
          const published = HostMutationOwnerSchema.parse(await readJson(target.owner));
          if (published.token === owner.token) {
            await rm(target.owner);
            await syncDirectory(dirname(target.owner));
          }
        } catch { /* Preserve the publication failure; never remove an unverified or competing owner. */ }
        throw error;
      }
      try {
        try {
          await readProtectedBytes(target.terminalAuthority);
          throw new JournalIntegrityError('run identity acquired terminal commit evidence before ownership; start a new run identity');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        if (mode === 'resume') {
          const currentDurable = await loadDurable(target);
          if (!resumed || !currentDurable) throw new JournalIntegrityError('resume requires existing uncommitted journal evidence');
          journal = currentDurable.journal;
          previousDigest = currentDurable.digest;
          const persistedPlan = NormalizedPlanSchema.parse(await readJson(target.plan));
          const { createdAt: _persistedCreatedAt, ...persistedSemanticPlan } = persistedPlan;
          const { createdAt: _currentCreatedAt, ...currentSemanticPlan } = plan;
          if (JSON.stringify(persistedSemanticPlan) !== JSON.stringify(currentSemanticPlan)) {
            throw new JournalIntegrityError('persisted plan changed before resume ownership was acquired');
          }
        }
        if (!resumed) await writeAtomic(target.plan, plan);
        journal = JournalSchema.parse({
          ...journal,
          ownerId: owner.token,
          revision: journal.revision + 1,
          updatedAt: now(),
          entries: journal.entries.map(entry => entry.status === 'running' ? { ...entry, status: 'interrupted' as const, updatedAt: now() } : entry),
        });
        await commitDurable(target, journal, previousDigest);
        return { owner, journal, resumed, runDirectory: target.runDirectory };
      } catch (error) {
        try {
          const current = HostMutationOwnerSchema.parse(await readJson(target.owner));
          if (current.token === owner.token) await rm(target.owner);
        } catch (cleanupError) {
          if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) throw new AggregateError([error, cleanupError], 'journal claim and token-safe lease cleanup failed');
        }
        throw error;
      }
    },

    async checkpoint(ownerInput, entryInput) {
      return serialize(async () => {
        const owner = HostMutationOwnerSchema.parse(ownerInput);
        await requireOwner(owner);
        const target = paths(owner.runId, owner.planDigest);
        const durable = await loadDurable(target);
        if (!durable) throw new JournalIntegrityError('journal disappeared while the run lease was held');
        const journal = durable.journal;
        const entry = JournalSchema.shape.entries.element.parse(entryInput);
        const existing = journal.entries.filter(candidate => candidate.taskId !== entry.taskId);
        const updated = JournalSchema.parse({
          ...journal, ownerId: owner.token, revision: journal.revision + 1, updatedAt: now(),
          entries: [...existing, entry].sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0),
        });
        await commitDurable(target, updated, durable.digest);
        return updated;
      });
    },

    async persistCompensation(ownerInput, artifactInput) {
      return serialize(async () => {
        const owner = HostMutationOwnerSchema.parse(ownerInput);
        await requireOwner(owner);
        const target = paths(owner.runId, owner.planDigest);
        const record = CompensationRecordSchema.parse(artifactInput.record);
        const snapshot = ConfigurationSnapshotSchema.parse(artifactInput.snapshot);
        const dependencies = z.array(taskIdentifier).max(512).parse(artifactInput.dependencies);
        const bytes = artifactInput.bytes === null ? null : Buffer.from(artifactInput.bytes);
        if (record.state !== 'available') throw new JournalIntegrityError('new compensation evidence must be available');
        if ('kind' in snapshot) {
          if (bytes !== null || serviceSnapshotFromInput(artifactInput) !== null) throw new JournalIntegrityError('directory compensation cannot contain file or service bytes');
        } else {
          if (snapshot.existed !== (bytes !== null)) throw new JournalIntegrityError('compensation snapshot bytes do not match prior file existence');
          if (snapshot.digest !== (bytes === null ? null : hash(bytes))) throw new JournalIntegrityError('compensation snapshot byte digest mismatch');
        }
        const serviceSnapshot = ServiceStateSnapshotSchema.nullable().parse(artifactInput.serviceSnapshot ?? null);
        const appliedDigest = digest.nullable().parse(artifactInput.appliedDigest ?? null);
        if (record.restores.includes('service-state') !== (serviceSnapshot !== null)) throw new JournalIntegrityError('service-state restoration declaration does not match captured evidence');
        if (record.artifactDigest !== configurationCompensationArtifactDigest(snapshot, bytes, serviceSnapshot)) {
          throw new JournalIntegrityError('compensation artifact digest does not bind its snapshot');
        }
        const persisted = PersistedCompensationSchema.parse({
          schemaVersion: 1, record, snapshot,
          bytesBase64: bytes?.toString('base64') ?? null,
          dependencies: [...dependencies].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
          serviceSnapshot, appliedDigest,
        });
        const path = join(target.compensations, `${hash(Buffer.from(record.taskId, 'utf8'))}.json`);
        try {
          const existing = PersistedCompensationSchema.parse(await readJson(path));
          if (JSON.stringify(existing) !== JSON.stringify(persisted)) {
            throw new JournalIntegrityError(`compensation evidence already exists with different content: ${record.taskId}`);
          }
          return;
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        await writeAtomic(path, persisted);
      });
    },

    async updateCompensation(ownerInput, recordInput) {
      return serialize(async () => {
        const owner = HostMutationOwnerSchema.parse(ownerInput);
        await requireOwner(owner);
        const record = CompensationRecordSchema.parse(recordInput);
        const target = paths(owner.runId, owner.planDigest);
        const path = join(target.compensations, `${hash(Buffer.from(record.taskId, 'utf8'))}.json`);
        const existing = PersistedCompensationSchema.parse(await readJson(path));
        if (existing.record.taskId !== record.taskId
          || existing.record.artifactDigest !== record.artifactDigest
          || JSON.stringify(existing.record.restores) !== JSON.stringify(record.restores)
          || existing.record.state !== 'available'
          || record.state === 'available') {
          throw new JournalIntegrityError('invalid compensation state transition');
        }
        await writeAtomic(path, PersistedCompensationSchema.parse({ ...existing, record }));
      });
    },

    async readCompensations(runIdInput, planDigestInput) {
      const target = paths(identifier.parse(runIdInput), digest.parse(planDigestInput));
      let names: string[];
      try { names = await readdir(target.compensations); }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return Object.freeze([]);
        throw error;
      }
      const artifacts: PersistedConfigurationCompensation[] = [];
      for (const name of withoutPublicationTemps(names).sort()) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new JournalIntegrityError(`unexpected compensation artifact: ${name}`);
        const persisted = PersistedCompensationSchema.parse(await readJson(join(target.compensations, name)));
        if (`${hash(Buffer.from(persisted.record.taskId, 'utf8'))}.json` !== name) {
          throw new JournalIntegrityError('compensation artifact filename does not match its task identity');
        }
        const bytes = persisted.bytesBase64 === null ? null : Buffer.from(persisted.bytesBase64, 'base64');
        if ((('kind' in persisted.snapshot)
          ? bytes !== null || persisted.serviceSnapshot !== null
          : persisted.snapshot.existed !== (bytes !== null) || persisted.snapshot.digest !== (bytes === null ? null : hash(bytes)))
          || persisted.record.restores.includes('service-state') !== (persisted.serviceSnapshot !== null)
          || persisted.record.artifactDigest !== configurationCompensationArtifactDigest(persisted.snapshot, bytes, persisted.serviceSnapshot)) {
          throw new JournalIntegrityError(`compensation artifact integrity mismatch: ${persisted.record.taskId}`);
        }
        artifacts.push(persisted);
      }
      return Object.freeze(artifacts);
    },

    bindNativeDpkgTransactionPersistence(ownerInput) {
      const boundOwner = HostMutationOwnerSchema.parse(ownerInput);
      const target = paths(boundOwner.runId, boundOwner.planDigest);
      return Object.freeze({
        load: async (transactionIdInput: string): Promise<unknown | undefined> => serialize(async () => {
          await requireOwner(boundOwner);
          const transactionId = digest.parse(transactionIdInput);
          const transactions = await loadNativeTransactions(target, boundOwner.runId, boundOwner.planDigest);
          return transactions.find(value => value.record.transactionId === transactionId)?.record;
        }),
        save: async (recordInput: NativeDpkgTransactionRecord): Promise<void> => serialize(async () => {
          await requireOwner(boundOwner);
          const record = NativeDpkgTransactionRecordSchema.parse(recordInput);
          if (record.runId !== boundOwner.runId || record.planDigest !== boundOwner.planDigest || record.hostId !== hostId) {
            throw new JournalIntegrityError('native transaction identity does not match its owner-bound journal run');
          }
          const transactions = await loadNativeTransactions(target, boundOwner.runId, boundOwner.planDigest);
          const existing = transactions.find(value => value.record.transactionId === record.transactionId);
          const competing = transactions.find(value => value.record.rootPackageKey === record.rootPackageKey
            && value.record.transactionId !== record.transactionId);
          if (competing) {
            throw new JournalIntegrityError(`native transaction root package task already has a different transaction: ${record.rootPackageKey}`);
          }
          if (!existing && record.phase !== 'prepared') {
            throw new JournalIntegrityError('native transaction write-ahead record must begin in the prepared phase');
          }
          if (existing) {
            if (!nativeTransactionIdentityIsStable(existing.record, record)) {
              throw new JournalIntegrityError('native transaction immutable identity binding changed during update');
            }
            if (new Date(record.updatedAt).getTime() < new Date(existing.record.updatedAt).getTime()) {
              throw new JournalIntegrityError('native transaction update timestamp regressed');
            }
          }
          const persistedPlan = NormalizedPlanSchema.parse(await readJson(target.plan));
          if (!persistedPlan.selectedTaskIds.includes(record.rootPackageKey)) {
            throw new JournalIntegrityError('native transaction root package task is outside the selected run plan');
          }
          const recordBytes = canonicalBytes(record);
          const recordDigest = hash(recordBytes);
          const recordPath = join(target.nativeTransactionObjects, `${recordDigest}.json`);
          await writeImmutable(recordPath, recordBytes);
          const current = NativeTransactionHeadSchema.parse({
            schemaVersion: 1,
            transactionId: record.transactionId,
            rootPackageKey: record.rootPackageKey,
            recordDigest,
          });
          await writeAtomic(join(target.nativeTransactionCurrent, `${record.transactionId}.json`), current);
        }),
      } satisfies NativeDpkgTransactionPersistence);
    },

    async read(runId, planDigest) {
      const target = paths(runId, planDigest);
      const durable = await loadDurable(target);
      return durable?.journal;
    },

    async readPlan(runIdInput, planDigestInput) {
      const runId = identifier.parse(runIdInput);
      const planDigest = digest.parse(planDigestInput);
      const target = paths(runId, planDigest);
      try {
        const plan = NormalizedPlanSchema.parse(await readJson(target.plan));
        if (plan.digest !== planDigest) throw new JournalIntegrityError('persisted plan identity does not match its requested digest');
        return plan;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
    },

    async inspectCompletion(runIdInput, planDigestInput) {
      const runId = identifier.parse(runIdInput);
      const planDigest = digest.parse(planDigestInput);
      const target = paths(runId, planDigest);
      const base = { runId, planDigest } as const;
      try {
        const runInfo = await lstat(target.runDirectory);
        if (!runInfo.isDirectory() || runInfo.isSymbolicLink()) throw new JournalIntegrityError('run evidence root is not a protected directory');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return Object.freeze({ ...base, authority: 'absent' as const, problems: Object.freeze([]) });
        }
        const problem = error instanceof Error ? error.message : 'unknown run evidence error';
        return Object.freeze({ ...base, authority: 'corrupt' as const, problems: Object.freeze([problem]) });
      }
      try {
        const commitDirectoryNames = withoutPublicationTemps(await readdir(target.commits));
        const commitNames = commitDirectoryNames.filter(name => name.endsWith('.commit.json'));
        const unexpectedCommitNames = commitDirectoryNames.filter(name => !/^[a-f0-9]{64}\.commit\.json$/.test(name));
        if (unexpectedCommitNames.length > 0) throw new JournalIntegrityError(`unexpected final commit artifact: ${unexpectedCommitNames[0]}`);
        let authority: z.infer<typeof TerminalAuthoritySchema> | undefined;
        try {
          authority = TerminalAuthoritySchema.parse(await readJson(target.terminalAuthority));
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        if (!authority) {
          try {
            const activeOwner = HostMutationOwnerSchema.parse(await readJson(target.owner));
            if (activeOwner.runId === runId && activeOwner.planDigest === planDigest) {
              const expired = new Date(activeOwner.leaseUntil).getTime() <= new Date(now()).getTime();
              const alive = activeOwner.bootId === bootId && await isProcessAlive(activeOwner.pid, activeOwner.processStart);
              if (!expired || alive) return Object.freeze({ ...base, authority: 'active' as const, problems: Object.freeze([]) });
            }
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          }
          const durable = await loadDurable(target);
          return Object.freeze({ ...base, authority: durable ? 'uncommitted' as const : 'absent' as const, problems: Object.freeze([]) });
        }
        if (authority.runId !== runId || authority.planDigest !== planDigest) throw new JournalIntegrityError('terminal authority identity mismatch');
        ensureWithin(target.commits, authority.commit.path);
        const authorityCommitName = authority.commit.path.slice(authority.commit.path.lastIndexOf(sep) + 1);
        if (!/^[a-f0-9]{64}\.commit\.json$/.test(authorityCommitName)
          || authority.commit.path !== join(target.commits, authorityCommitName)) {
          throw new JournalIntegrityError('terminal authority references an invalid commit name');
        }
        if (!commitNames.includes(authorityCommitName)) {
          throw new JournalIntegrityError('terminal authority references a missing commit');
        }
        const commitPath = authority.commit.path;
        const commitBytes = await readProtectedBytes(commitPath);
        if (hash(commitBytes) !== authority.commit.sha256) throw new JournalIntegrityError('terminal authority commit digest mismatch');
        const commit = FinalCommitSchema.parse(JSON.parse(commitBytes.toString('utf8')) as unknown);
        if (commit.runId !== runId || commit.planDigest !== planDigest) throw new JournalIntegrityError('final commit identity mismatch');
        const durable = await loadDurable(target);
        if (!durable) throw new JournalIntegrityError('final commit has no durable journal');
        const expectedPaths = [
          target.plan, durable.objectPath, durable.headPath, commit.events.path, commit.receipt.path,
          ...(commit.compensationIndex ? [commit.compensationIndex.path] : []), commitPath, target.terminalAuthority,
          ...(commit.nativeTransactionIndex ? [commit.nativeTransactionIndex.path] : []),
        ];
        const fixedArtifacts = [
          ['plan', commit.planArtifact, target.plan],
          ['journal object', commit.journalObject, durable.objectPath],
          ['journal head', commit.journalHead, durable.headPath],
          ['events', commit.events, commit.events.path],
          ['receipt', commit.receipt, commit.receipt.path],
        ] as const;
        for (const [label, artifact, expectedPath] of fixedArtifacts) {
          ensureWithin(target.runDirectory, artifact.path);
          if (artifact.path !== expectedPath) throw new JournalIntegrityError(`${label} path is not the authoritative run artifact`);
          const bytes = await readProtectedBytes(artifact.path);
          if (hash(bytes) !== artifact.sha256) throw new JournalIntegrityError(`${label} digest does not match the final commit`);
        }
        if (commit.compensationIndex) {
          ensureWithin(target.compensationIndexes, commit.compensationIndex.path);
          const indexBytes = await readProtectedBytes(commit.compensationIndex.path);
          if (hash(indexBytes) !== commit.compensationIndex.sha256) throw new JournalIntegrityError('compensation index digest does not match the final commit');
          const index = CompensationIndexSchema.parse(JSON.parse(indexBytes.toString('utf8')) as unknown);
          const indexedNames = index.artifacts.map(artifact => artifact.path.slice(artifact.path.lastIndexOf(sep) + 1)).sort();
          const actualNames = withoutPublicationTemps(await readdir(target.compensations)).sort();
          if (JSON.stringify(actualNames) !== JSON.stringify(indexedNames)) {
            throw new JournalIntegrityError('compensation directory does not exactly match the committed index');
          }
          for (const artifact of index.artifacts) {
            ensureWithin(target.compensations, artifact.path);
            const artifactBytes = await readProtectedBytes(artifact.path);
            if (hash(artifactBytes) !== artifact.sha256) throw new JournalIntegrityError(`compensation evidence digest mismatch: ${artifact.taskId}`);
            const persisted = PersistedCompensationSchema.parse(JSON.parse(artifactBytes.toString('utf8')) as unknown);
            if (persisted.record.taskId !== artifact.taskId) throw new JournalIntegrityError('compensation index task identity mismatch');
          }
        } else if (withoutPublicationTemps(await readdir(target.compensations)).length > 0) {
          throw new JournalIntegrityError('final commit omits existing compensation evidence');
        }
        if (commit.nativeTransactionIndex) {
          ensureWithin(target.nativeTransactionIndexes, commit.nativeTransactionIndex.path);
          const indexBytes = await readProtectedBytes(commit.nativeTransactionIndex.path);
          if (hash(indexBytes) !== commit.nativeTransactionIndex.sha256) {
            throw new JournalIntegrityError('native transaction index digest does not match the final commit');
          }
          const index = NativeTransactionIndexSchema.parse(JSON.parse(indexBytes.toString('utf8')) as unknown);
          const currentNames = index.transactions.map(value => value.current.path.slice(value.current.path.lastIndexOf(sep) + 1)).sort();
          const actualCurrentNames = withoutPublicationTemps(await readdir(target.nativeTransactionCurrent)).sort();
          if (JSON.stringify(currentNames) !== JSON.stringify(actualCurrentNames)) {
            throw new JournalIntegrityError('native transaction current directory does not exactly match the committed index');
          }
          const objectNames = index.objects.map(value => value.path.slice(value.path.lastIndexOf(sep) + 1)).sort();
          const actualObjectNames = withoutPublicationTemps(await readdir(target.nativeTransactionObjects)).sort();
          if (JSON.stringify(objectNames) !== JSON.stringify(actualObjectNames)) {
            throw new JournalIntegrityError('native transaction object directory does not exactly match the committed index');
          }
          for (const artifact of index.objects) {
            ensureWithin(target.nativeTransactionObjects, artifact.path);
            const name = artifact.path.slice(artifact.path.lastIndexOf(sep) + 1);
            if (artifact.path !== join(target.nativeTransactionObjects, name) || name !== `${artifact.sha256}.json`) {
              throw new JournalIntegrityError('native transaction index contains an invalid object path');
            }
            const bytes = await readProtectedBytes(artifact.path);
            if (hash(bytes) !== artifact.sha256) throw new JournalIntegrityError('native transaction record digest does not match the committed index');
            NativeDpkgTransactionRecordSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
          }
          for (const transaction of index.transactions) {
            ensureWithin(target.nativeTransactionCurrent, transaction.current.path);
            ensureWithin(target.nativeTransactionObjects, transaction.record.path);
            if (transaction.current.path !== join(target.nativeTransactionCurrent, `${transaction.transactionId}.json`)
              || transaction.record.path !== join(target.nativeTransactionObjects, `${transaction.record.sha256}.json`)) {
              throw new JournalIntegrityError('native transaction index contains a non-authoritative path');
            }
            const currentBytes = await readProtectedBytes(transaction.current.path);
            if (hash(currentBytes) !== transaction.current.sha256) throw new JournalIntegrityError('native transaction current digest does not match the committed index');
            const head = NativeTransactionHeadSchema.parse(JSON.parse(currentBytes.toString('utf8')) as unknown);
            if (head.transactionId !== transaction.transactionId || head.rootPackageKey !== transaction.rootPackageKey
              || head.recordDigest !== transaction.record.sha256) {
              throw new JournalIntegrityError('native transaction index binding does not match its current head');
            }
          }
          await loadNativeTransactions(target, runId, planDigest);
        } else if (withoutPublicationTemps(await readdir(target.nativeTransactionCurrent)).length > 0
          || withoutPublicationTemps(await readdir(target.nativeTransactionObjects)).length > 0) {
          throw new JournalIntegrityError('final commit omits existing native transaction evidence');
        }
        if (!commit.events.path.startsWith(`${target.events}${sep}`) || !commit.receipt.path.startsWith(`${target.receipts}${sep}`)) {
          throw new JournalIntegrityError('final commit evidence uses the wrong artifact namespace');
        }
        if (JSON.stringify(commit.evidencePaths) !== JSON.stringify(expectedPaths)) throw new JournalIntegrityError('final commit evidence path set is not authoritative');
        const plan = NormalizedPlanSchema.parse(await readJson(target.plan));
        if (plan.digest !== planDigest) throw new JournalIntegrityError('persisted plan identity does not match the final commit');
        const receipt = TerminalReceiptSchema.parse(await readJson(commit.receipt.path));
        if (receipt.runId !== runId || receipt.planDigest !== planDigest) throw new JournalIntegrityError('terminal receipt identity does not match the final commit');
        if (JSON.stringify(receipt.evidencePaths) !== JSON.stringify(expectedPaths)) throw new JournalIntegrityError('terminal receipt evidence paths do not match the final commit');
        const eventText = (await readProtectedBytes(commit.events.path)).toString('utf8');
        if (!eventText.endsWith('\n')) throw new JournalIntegrityError('event evidence is not newline terminated');
        const eventLines = eventText.slice(0, -1).split('\n');
        const events = eventLines.map(line => InstallerEventSchema.parse(JSON.parse(line) as unknown));
        if (events.some((event, index) => event.sequence !== index || event.runId !== runId)) throw new JournalIntegrityError('committed event stream has a sequence or run identity mismatch');
        validateFinalEvidence(plan, receipt, events, durable.journal);
        return Object.freeze({ ...base, authority: 'committed' as const, receipt, commitPath, problems: Object.freeze([]) });
      } catch (error) {
        const problem = error instanceof Error ? error.message : 'unknown completion evidence error';
        return Object.freeze({ ...base, authority: 'corrupt' as const, problems: Object.freeze([problem]) });
      }
    },

    async listRuns() {
      const runsRoot = join(stateRoot, 'runs');
      const validateDirectory = async (path: string): Promise<void> => {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new JournalIntegrityError(`journal path is not a protected directory: ${path}`);
        if (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.geteuid?.() !== info.uid)) {
          throw new JournalIntegrityError(`journal directory ownership or permissions are unsafe: ${path}`);
        }
      };
      try { await validateDirectory(stateRoot); }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return Object.freeze([]);
        throw error;
      }
      try { await validateDirectory(runsRoot); }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return Object.freeze([]);
        throw error;
      }

      const summaries: JournalRunSummary[] = [];
      for (const digestName of (await readdir(runsRoot)).sort()) {
        const planDigest = digest.parse(digestName);
        const digestDirectory = join(runsRoot, digestName);
        ensureWithin(runsRoot, digestDirectory);
        await validateDirectory(digestDirectory);
        for (const runName of (await readdir(digestDirectory)).sort()) {
          const runId = identifier.parse(runName);
          const target = paths(runId, planDigest);
          await validateDirectory(target.runDirectory);
          for (const protectedDirectory of [
            resolve(target.objects, '..'), target.objects, target.heads, target.events, target.receipts, target.commits,
            target.compensations, target.compensationIndexes, resolve(target.nativeTransactionObjects, '..', '..'),
            resolve(target.nativeTransactionObjects, '..'), target.nativeTransactionObjects, target.nativeTransactionCurrent,
            target.nativeTransactionIndexes,
          ]) await validateDirectory(protectedDirectory);
          const plan = NormalizedPlanSchema.parse(await readJson(target.plan));
          if (plan.digest !== planDigest) throw new JournalIntegrityError(`listed run plan digest does not match its directory: ${runId}`);
          const durable = await loadDurable(target);
          if (!durable || durable.journal.runId !== runId || durable.journal.planDigest !== planDigest) {
            throw new JournalIntegrityError(`listed run has no matching durable journal: ${runId}`);
          }
          const inspection = await this.inspectCompletion(runId, planDigest);
          const values = durable.journal.entries.map(entry => entry.status);
          summaries.push(JournalRunSummarySchema.parse({
            schemaVersion: 1, runId, planDigest, releaseId: durable.journal.releaseId,
            desiredRevision: durable.journal.desiredRevision, updatedAt: durable.journal.updatedAt,
            journalRevision: durable.journal.revision, authority: inspection.authority,
            resumeCandidate: inspection.authority === 'uncommitted',
            taskCounts: {
              running: values.filter(value => value === 'running').length,
              verified: values.filter(value => value === 'verified').length,
              inapplicable: values.filter(value => value === 'inapplicable').length,
              blocked: values.filter(value => value === 'blocked').length,
              failed: values.filter(value => value === 'failed').length,
              interrupted: values.filter(value => value === 'interrupted').length,
            },
          }));
        }
      }
      return Object.freeze(summaries);
    },

    async renew(ownerInput) {
      return serialize(async () => {
        const current = await requireOwner(HostMutationOwnerSchema.parse(ownerInput));
        const at = now();
        const renewed = HostMutationOwnerSchema.parse({ ...current, heartbeatAt: at, leaseUntil: new Date(new Date(at).getTime() + leaseMs).toISOString() });
        await writeAtomic(paths(current.runId, current.planDigest).owner, renewed);
        return renewed;
      });
    },

    async finalize(ownerInput, planInput, receiptInput, eventsInput) {
      return serialize(async () => {
        const owner = HostMutationOwnerSchema.parse(ownerInput);
        const plan = NormalizedPlanSchema.parse(planInput);
        const receipt = TerminalReceiptSchema.parse(receiptInput);
        await requireOwner(owner);
        if (owner.planDigest !== plan.digest || receipt.planDigest !== plan.digest || receipt.runId !== owner.runId) throw new JournalIntegrityError('final evidence identity mismatch');
        const events = z.array(InstallerEventSchema).min(1).max(1_000_000).parse(eventsInput);
        if (events.some((event, index) => event.sequence !== index || event.runId !== owner.runId)) throw new JournalIntegrityError('final event evidence has a sequence or run identity mismatch');
        const target = paths(owner.runId, owner.planDigest);
        try {
          await readProtectedBytes(target.terminalAuthority);
          throw new JournalIntegrityError('run identity already has terminal commit evidence');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        const durable = await loadDurable(target);
        if (!durable) throw new JournalIntegrityError('cannot finalize a run without durable journal evidence');
        validateFinalEvidence(plan, receipt, events, durable.journal);
        await writeAtomic(target.plan, plan);
      const eventBytes = Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8');
      if (eventBytes.byteLength > 16_777_216) throw new JournalIntegrityError('final event evidence exceeds the bounded size policy');
      const eventPath = join(target.events, `${hash(eventBytes)}.ndjson`);
      await writeImmutable(eventPath, eventBytes);
      await options.fault?.('after-events-sync');
      const eventDigest = hash(eventBytes);
      const compensationArtifacts = [];
      for (const name of withoutPublicationTemps(await readdir(target.compensations)).sort()) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new JournalIntegrityError(`unexpected compensation artifact: ${name}`);
        const path = join(target.compensations, name);
        const bytes = await readProtectedBytes(path);
        const persisted = PersistedCompensationSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
        compensationArtifacts.push({ taskId: persisted.record.taskId, path, sha256: hash(bytes) });
      }
      const compensationIndex = CompensationIndexSchema.parse({ schemaVersion: 1, artifacts: compensationArtifacts });
      const compensationIndexBytes = canonicalBytes(compensationIndex);
      const compensationIndexDigest = hash(compensationIndexBytes);
      const compensationIndexPath = compensationArtifacts.length > 0
        ? join(target.compensationIndexes, `${compensationIndexDigest}.json`)
        : null;
      if (compensationIndexPath) await writeImmutable(compensationIndexPath, compensationIndexBytes);
      const nativeTransactions = await loadNativeTransactions(target, owner.runId, owner.planDigest);
      if (receipt.status === 'success' && nativeTransactions.some(value => value.record.phase !== 'completed')) {
        throw new JournalIntegrityError('successful finalization requires every native transaction to be completed');
      }
      const nativeObjectArtifacts = [];
      for (const name of withoutPublicationTemps(await readdir(target.nativeTransactionObjects)).sort()) {
        const match = /^([a-f0-9]{64})\.json$/.exec(name);
        if (!match) throw new JournalIntegrityError(`unexpected native transaction object artifact: ${name}`);
        const path = join(target.nativeTransactionObjects, name);
        const bytes = await readProtectedBytes(path);
        const sha256 = hash(bytes);
        if (sha256 !== match[1]) throw new JournalIntegrityError('native transaction object filename does not match its digest');
        const objectRecord = NativeDpkgTransactionRecordSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
        if (objectRecord.runId !== owner.runId || objectRecord.planDigest !== owner.planDigest || objectRecord.hostId !== hostId) {
          throw new JournalIntegrityError('native transaction object identity does not match the finalizing run');
        }
        nativeObjectArtifacts.push({ path, sha256 });
      }
      const nativeTransactionIndex = NativeTransactionIndexSchema.parse({
        schemaVersion: 1,
        transactions: nativeTransactions.map(value => ({
          transactionId: value.record.transactionId,
          rootPackageKey: value.record.rootPackageKey,
          current: { path: value.currentPath, sha256: value.currentDigest },
          record: { path: value.recordPath, sha256: value.recordDigest },
        })),
        objects: nativeObjectArtifacts,
      });
      const nativeTransactionIndexBytes = canonicalBytes(nativeTransactionIndex);
      if (nativeTransactionIndexBytes.byteLength > 16_777_216) {
        throw new JournalIntegrityError('native transaction index exceeds the bounded size policy');
      }
      const nativeTransactionIndexDigest = hash(nativeTransactionIndexBytes);
      const nativeTransactionIndexPath = nativeTransactions.length > 0
        ? join(target.nativeTransactionIndexes, `${nativeTransactionIndexDigest}.json`)
        : null;
      if (nativeTransactionIndexPath) await writeImmutable(nativeTransactionIndexPath, nativeTransactionIndexBytes);
      const finalizationDigest = hash(canonicalBytes({
        eventDigest, journalDigest: durable.digest, compensationIndexDigest, nativeTransactionIndexDigest, receipt,
      }));
      const receiptPath = join(target.receipts, `${finalizationDigest}.receipt.json`);
      const commitPath = join(target.commits, `${finalizationDigest}.commit.json`);
      const evidencePaths = [
        target.plan, durable.objectPath, durable.headPath, eventPath, receiptPath,
        ...(compensationIndexPath ? [compensationIndexPath] : []), commitPath, target.terminalAuthority,
        ...(nativeTransactionIndexPath ? [nativeTransactionIndexPath] : []),
      ];
      const finalized = TerminalReceiptSchema.parse({ ...receipt, evidencePaths });
      await writeImmutable(receiptPath, Buffer.from(`${JSON.stringify(finalized, null, 2)}\n`, 'utf8'));
      await options.fault?.('after-receipt-sync');
      const [planBytes, headBytes, receiptBytes] = await Promise.all([
        readProtectedBytes(target.plan), readProtectedBytes(durable.headPath), readProtectedBytes(receiptPath),
      ]);
      const commit = FinalCommitSchema.parse({
        schemaVersion: 1,
        runId: owner.runId,
        planDigest: plan.digest,
        planArtifact: { path: target.plan, sha256: hash(planBytes) },
        journalObject: { path: durable.objectPath, sha256: durable.digest },
        journalHead: { path: durable.headPath, sha256: hash(headBytes) },
        events: { path: eventPath, sha256: hash(eventBytes) },
        receipt: { path: receiptPath, sha256: hash(receiptBytes) },
        compensationIndex: compensationIndexPath ? { path: compensationIndexPath, sha256: compensationIndexDigest } : null,
        nativeTransactionIndex: nativeTransactionIndexPath
          ? { path: nativeTransactionIndexPath, sha256: nativeTransactionIndexDigest }
          : null,
        evidencePaths,
      });
        await requireOwner(owner);
        const currentDurable = await loadDurable(target);
        if (!currentDurable || currentDurable.digest !== durable.digest || currentDurable.headPath !== durable.headPath) {
          throw new JournalIntegrityError('durable journal changed before terminal commit publication');
        }
        try {
          await readProtectedBytes(target.terminalAuthority);
          throw new JournalIntegrityError('terminal commit evidence appeared before publication');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        const commitBytes = canonicalBytes(commit);
        await writeImmutable(commitPath, commitBytes);
        await options.fault?.('after-commit-sync');
        const authority = TerminalAuthoritySchema.parse({
          schemaVersion: 1, runId: owner.runId, planDigest: plan.digest,
          commit: { path: commitPath, sha256: hash(commitBytes) },
        });
        await writeImmutable(target.terminalAuthority, canonicalBytes(authority));
        return evidencePaths;
      });
    },

    async release(ownerInput) {
      return serialize(async () => {
        const owner = HostMutationOwnerSchema.parse(ownerInput);
        await requireOwner(owner);
        await rm(paths(owner.runId, owner.planDigest).owner);
      });
    },
  };
}

function serviceSnapshotFromInput(artifact: ConfigurationCompensationArtifact): ConfigurationCompensationArtifact['serviceSnapshot'] {
  return artifact.serviceSnapshot ?? null;
}
