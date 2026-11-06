import { constants } from 'node:fs';
import { lstat, link, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  RollbackEventSchema,
  RollbackPlanSchema,
  RollbackRunReceiptSchema,
  prepareRollbackRun,
} from './rollback.js';
import type { RollbackEvent, RollbackPlan, RollbackRunReceipt } from './rollback.js';
import { executeApprovedUserFileRollback } from './rollback-executor.js';
import type { PersistedConfigurationCompensation } from './journal.js';
import { serviceStateEquals, serviceStateFromSnapshot } from './config-transaction.js';
import type { ServiceStateAdapter, ServiceStateSnapshot } from './config-transaction.js';
import { isPlatformProcessIdentityAlive } from './process-identity.js';
import { HostMutationOwnerSchema } from './host-mutation-lease.js';
import type { HostMutationOwner } from './host-mutation-lease.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z.strictObject({ path: z.string().min(1).max(4096), sha256: digest });
const CommitSchema = z.strictObject({
  schemaVersion: z.literal(1), rollbackRunId: identifier, planDigest: digest,
  plan: artifact, events: z.array(artifact).min(1).max(10_000), receipt: artifact,
  evidencePaths: z.array(z.string().min(1).max(4096)).min(3).max(10_004),
});
const RollbackSourceFenceSchema = z.strictObject({
  schemaVersion: z.literal(1), sourceRunId: identifier, sourcePlanDigest: digest,
  rollbackRunId: identifier, rollbackPlanDigest: digest,
});
type Owner = HostMutationOwner;

export class RollbackLiveOwnerError extends Error {
  constructor(message = 'another rollback run owns the rollback lease') { super(message); this.name = 'RollbackLiveOwnerError'; }
}

export class RollbackEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = 'RollbackEvidenceError'; }
}

export type RollbackRunAuthority = 'absent' | 'active' | 'uncommitted' | 'committed' | 'corrupt';
export interface RollbackRunInspection {
  readonly authority: RollbackRunAuthority;
  readonly rollbackRunId: string;
  readonly planDigest: string;
  readonly plan?: RollbackPlan;
  readonly events?: readonly RollbackEvent[];
  readonly receipt?: RollbackRunReceipt;
  readonly problems: readonly string[];
}

export interface RollbackRunStoreOptions {
  readonly stateRoot: string;
  readonly processStart: string;
  readonly bootId: string;
  readonly hostId?: string;
  readonly pid?: number;
  readonly leaseMs?: number;
  readonly now?: () => string;
  readonly isProcessAlive?: (pid: number, processStart: string) => Promise<boolean>;
  readonly fault?: (point: 'after-plan-sync' | 'after-event-sync' | 'before-outcome-sync' | 'after-receipt-sync' | 'before-release') => Promise<void>;
  readonly serviceAdapters?: Partial<Record<ServiceStateSnapshot['manager'], ServiceStateAdapter>>;
}

export interface RollbackRunStore {
  recordBlockedRun(rollbackRunId: string, plan: RollbackPlan, approvedPlanDigest: string): Promise<{
    readonly plan: RollbackPlan; readonly events: readonly RollbackEvent[]; readonly receipt: RollbackRunReceipt;
  }>;
  executeUserFileRollback(rollbackRunId: string, plan: RollbackPlan, approvedPlanDigest: string,
    loadCompensations: () => Promise<readonly PersistedConfigurationCompensation[]>): Promise<{
      readonly plan: RollbackPlan; readonly events: readonly RollbackEvent[]; readonly receipt: RollbackRunReceipt;
    }>;
  inspect(rollbackRunId: string, planDigest: string): Promise<RollbackRunInspection>;
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalBytes(value: unknown): Buffer {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonical(child)]));
    }
    return input;
  };
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

function ensureWithin(parent: string, child: string): void {
  if (child !== parent && !child.startsWith(`${parent}${sep}`)) throw new RollbackEvidenceError('rollback evidence path escapes its root');
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (!Buffer.from(await readProtected(path)).equals(bytes)) throw new RollbackEvidenceError(`immutable rollback artifact collision: ${path}`);
    }
    await syncDirectory(resolve(path, '..'));
  } finally { await rm(temporary, { force: true }); }
}

function isPublicationTemporary(name: string): boolean {
  return /\.tmp\.\d+\.[0-9a-f-]{36}$/.test(name);
}

async function readProtected(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 16_777_216) {
    throw new RollbackEvidenceError(`rollback artifact is not a bounded regular file: ${path}`);
  }
  if (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || info.nlink !== 1 || process.geteuid?.() !== info.uid)) {
    throw new RollbackEvidenceError(`rollback artifact ownership, permissions, or links are unsafe: ${path}`);
  }
  return readFile(path);
}

async function writeOwner(path: string, owner: Owner): Promise<void> {
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, path); await syncDirectory(resolve(path, '..'));
  } finally { await rm(temporary, { force: true }); }
}

function validateLifecycle(plan: RollbackPlan, events: readonly RollbackEvent[], receipt?: RollbackRunReceipt): void {
  if (events[0]?.kind !== 'rollback-run-started') throw new RollbackEvidenceError('rollback lifecycle must begin with one start event');
  if (events[1]?.kind !== 'rollback-plan-approved') throw new RollbackEvidenceError('rollback lifecycle must record exact-plan approval immediately after start');
  if (events.some((event, index) => event.kind === 'rollback-run-started' && index !== 0)
    || events.some((event, index) => event.kind === 'rollback-plan-approved' && index !== 1)) {
    throw new RollbackEvidenceError('rollback lifecycle contains duplicate or misplaced start/approval evidence');
  }
  const blocked = events.filter(event => event.kind === 'rollback-run-blocked');
  const finished = events.filter(event => event.kind === 'rollback-run-finished');
  if (blocked.length > 0) {
    if (events.length !== 3 || blocked.length !== 1 || events[2] !== blocked[0] || finished.length !== 0) {
      throw new RollbackEvidenceError('blocked rollback lifecycle has invalid boundaries');
    }
    if (receipt !== undefined && receipt.status !== 'approved-not-executed') {
      throw new RollbackEvidenceError('blocked rollback lifecycle does not agree with its receipt');
    }
    return;
  }
  const knownTasks = new Set(plan.taskOrder);
  const outcomes = new Map<string, 'restored' | 'failed'>();
  const started = new Set<string>();
  let orderIndex = 0;
  for (const event of events.slice(2)) {
    if (event.kind === 'rollback-task-started') {
      if (!knownTasks.has(event.taskId) || started.has(event.taskId) || event.taskId !== plan.taskOrder[orderIndex]) {
        throw new RollbackEvidenceError('rollback lifecycle contains an unknown, duplicate, or out-of-order task start');
      }
      started.add(event.taskId);
    } else if (event.kind === 'rollback-task-restored' || event.kind === 'rollback-task-failed') {
      if (!started.has(event.taskId) || outcomes.has(event.taskId) || event.taskId !== plan.taskOrder[orderIndex]) {
        throw new RollbackEvidenceError('rollback lifecycle contains an unmatched or out-of-order task outcome');
      }
      outcomes.set(event.taskId, event.kind === 'rollback-task-restored' ? 'restored' : 'failed');
      orderIndex += 1;
    } else if (event.kind === 'rollback-run-finished') {
      if (event !== events.at(-1) || finished.length !== 1) throw new RollbackEvidenceError('rollback lifecycle has an invalid terminal boundary');
    } else {
      throw new RollbackEvidenceError('rollback lifecycle contains an invalid event transition');
    }
  }
  if (receipt === undefined) return;
  const terminal = events.at(-1);
  if (terminal?.kind !== 'rollback-run-finished' || terminal.status !== receipt.status) {
    throw new RollbackEvidenceError('rollback terminal event does not agree with its receipt');
  }
  if (receipt.status === 'succeeded' && (outcomes.size !== plan.taskOrder.length || [...outcomes.values()].some(value => value !== 'restored'))) {
    throw new RollbackEvidenceError('successful rollback lifecycle does not restore every planned task');
  }
  if (receipt.status === 'failed' && ![...outcomes.values()].includes('failed')) {
    throw new RollbackEvidenceError('failed rollback lifecycle has no failed task outcome');
  }
}

export function createRollbackRunStore(options: RollbackRunStoreOptions): RollbackRunStore {
  const stateRoot = resolve(options.stateRoot);
  const processStart = z.string().min(1).max(256).parse(options.processStart);
  const bootId = z.string().min(1).max(256).parse(options.bootId);
  const hostId = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/).parse(options.hostId ?? 'rollback-store');
  const pid = z.number().int().positive().parse(options.pid ?? process.pid);
  const leaseMs = z.number().int().min(1_000).max(86_400_000).parse(options.leaseMs ?? 30_000);
  const now = options.now ?? (() => new Date().toISOString());
  const isProcessAlive = options.isProcessAlive ?? isPlatformProcessIdentityAlive;
  const ownerPath = join(stateRoot, 'owner.json');

  const paths = (rollbackRunIdInput: string, planDigestInput: string) => {
    const rollbackRunId = identifier.parse(rollbackRunIdInput);
    const planDigest = digest.parse(planDigestInput);
    const runRoot = resolve(stateRoot, 'rollback-runs', planDigest, rollbackRunId);
    ensureWithin(stateRoot, runRoot);
    return {
      runRoot, plan: join(runRoot, 'plan.json'), events: join(runRoot, 'events'), receipts: join(runRoot, 'receipts'), commits: join(runRoot, 'commits'),
    };
  };

  const sourceFencePath = (plan: RollbackPlan): string => {
    const sourceRoot = resolve(stateRoot, 'rollback-sources', digest.parse(plan.sourcePlanDigest));
    ensureWithin(stateRoot, sourceRoot);
    return join(sourceRoot, `${identifier.parse(plan.sourceRunId)}.json`);
  };

  const prepare = async (target: ReturnType<typeof paths>): Promise<void> => {
    for (const path of [stateRoot, resolve(stateRoot, 'rollback-runs'), resolve(target.runRoot, '..'), target.runRoot, target.events, target.receipts, target.commits]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new RollbackEvidenceError(`rollback evidence path is not a real directory: ${path}`);
      if (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.geteuid?.() !== info.uid)) {
        throw new RollbackEvidenceError(`rollback evidence directory is not private and owner-controlled: ${path}`);
      }
    }
  };

  const bindRollbackSource = async (owner: Owner, plan: RollbackPlan, rollbackRunId: string): Promise<void> => {
    await requireOwner(owner);
    const path = sourceFencePath(plan);
    const directory = resolve(path, '..');
    for (const parent of [resolve(stateRoot, 'rollback-sources'), directory]) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()
        || (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.geteuid?.() !== info.uid))) {
        throw new RollbackEvidenceError(`rollback source authority directory is unsafe: ${parent}`);
      }
    }
    const fence = RollbackSourceFenceSchema.parse({
      schemaVersion: 1, sourceRunId: plan.sourceRunId, sourcePlanDigest: plan.sourcePlanDigest,
      rollbackRunId, rollbackPlanDigest: plan.digest,
    });
    const bytes = canonicalBytes(fence);
    try {
      await writeImmutable(path, bytes);
    } catch (error) {
      if (error instanceof RollbackEvidenceError && /immutable rollback artifact collision/.test(error.message)) {
        throw new RollbackEvidenceError('rollback execution requires absent evidence; rollback source is already bound to another rollback run');
      }
      throw error;
    }
  };

  const claim = async (rollbackRunId: string, planDigest: string): Promise<Owner> => {
    const claimedAt = now();
    const owner = HostMutationOwnerSchema.parse({
      schemaVersion: 1, runId: rollbackRunId, planDigest, hostId, pid, bootId, processStart, token: randomUUID(), claimedAt,
      heartbeatAt: claimedAt,
      leaseUntil: new Date(new Date(claimedAt).getTime() + leaseMs).toISOString(),
    });
    try { await writeOwner(ownerPath, owner); return owner; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      let existing: Owner;
      try { existing = HostMutationOwnerSchema.parse(JSON.parse((await readProtected(ownerPath)).toString('utf8')) as unknown); }
      catch (ownerError) {
        // A recent malformed record may be a publication still in progress from
        // an older writer. Only quarantine stable, lease-expired evidence in an
        // owner-controlled directory; otherwise fail closed.
        const info = await lstat(ownerPath);
        const ageMs = new Date(now()).getTime() - info.mtimeMs;
        if (!info.isFile() || info.isSymbolicLink() || ageMs < leaseMs) {
          throw new RollbackLiveOwnerError('host mutation owner evidence is malformed and not safely reclaimable');
        }
        const quarantine = `${ownerPath}.malformed.${randomUUID()}`;
        await rename(ownerPath, quarantine); await syncDirectory(stateRoot);
        try { await writeOwner(ownerPath, owner); return owner; }
        catch (publicationError) {
          // Preserve the malformed evidence for diagnosis. Never overwrite a
          // concurrently published valid owner while attempting recovery.
          if (publicationError instanceof Error && 'code' in publicationError && publicationError.code === 'EEXIST') throw new RollbackLiveOwnerError();
          throw publicationError;
        }
      }
      const expired = new Date(existing.leaseUntil).getTime() <= new Date(now()).getTime();
      const alive = existing.bootId === bootId && await isProcessAlive(existing.pid, existing.processStart);
      if (!expired || alive) throw new RollbackLiveOwnerError();
      await rename(ownerPath, `${ownerPath}.stale.${existing.token}`);
      await syncDirectory(stateRoot);
      await writeOwner(ownerPath, owner);
      return owner;
    }
  };

  const release = async (owner: Owner): Promise<void> => {
    const current = HostMutationOwnerSchema.parse(JSON.parse((await readProtected(ownerPath)).toString('utf8')) as unknown);
    if (current.token !== owner.token) throw new RollbackLiveOwnerError('rollback lease token no longer owns the store');
    await rm(ownerPath);
    await syncDirectory(stateRoot);
  };
  const requireOwner = async (owner: Owner): Promise<void> => {
    const current = HostMutationOwnerSchema.parse(JSON.parse((await readProtected(ownerPath)).toString('utf8')) as unknown);
    if (current.token !== owner.token || current.runId !== owner.runId || current.planDigest !== owner.planDigest
      || new Date(current.leaseUntil).getTime() <= new Date(now()).getTime()) {
      throw new RollbackLiveOwnerError('rollback lease is no longer valid for evidence publication');
    }
  };
  const renew = async (owner: Owner): Promise<void> => {
    const current = HostMutationOwnerSchema.parse(JSON.parse((await readProtected(ownerPath)).toString('utf8')) as unknown);
    if (current.token !== owner.token) throw new RollbackLiveOwnerError('rollback lease token no longer owns the store');
    const at = now(); const renewed = HostMutationOwnerSchema.parse({ ...current, heartbeatAt: at, leaseUntil: new Date(new Date(at).getTime() + leaseMs).toISOString() });
    const temporary = `${ownerPath}.${owner.token}.renew`;
    try {
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try { await handle.writeFile(`${JSON.stringify(renewed, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, ownerPath); await syncDirectory(stateRoot);
    } finally { await rm(temporary, { force: true }); }
  };

  const persistTerminal = async (target: ReturnType<typeof paths>, rollbackRunId: string, plan: RollbackPlan,
    events: readonly RollbackEvent[], receipt: RollbackRunReceipt, assertOwned: () => Promise<void>): Promise<void> => {
    validateLifecycle(plan, events, receipt);
    const eventArtifacts = [];
    for (const event of events) {
      const bytes = canonicalBytes(event);
      const path = join(target.events, `${String(event.sequence).padStart(8, '0')}-${hash(bytes)}.json`);
      await writeImmutable(path, bytes); eventArtifacts.push({ path, sha256: hash(bytes) });
    }
    const receiptBytes = canonicalBytes(receipt);
    const receiptPath = join(target.receipts, `${hash(receiptBytes)}.json`);
    await writeImmutable(receiptPath, receiptBytes);
    await options.fault?.('after-receipt-sync');
    await assertOwned();
    const planBytes = await readProtected(target.plan);
    const commit = CommitSchema.parse({ schemaVersion: 1, rollbackRunId, planDigest: plan.digest,
      plan: { path: target.plan, sha256: hash(planBytes) }, events: eventArtifacts,
      receipt: { path: receiptPath, sha256: hash(receiptBytes) }, evidencePaths: [target.plan, ...eventArtifacts.map(item => item.path), receiptPath] });
    const commitBytes = canonicalBytes(commit);
    await writeImmutable(join(target.commits, `${hash(commitBytes)}.json`), commitBytes);
  };

  const persistEvent = async (target: ReturnType<typeof paths>, event: RollbackEvent): Promise<void> => {
    const bytes = canonicalBytes(event);
    const path = join(target.events, `${String(event.sequence).padStart(8, '0')}-${hash(bytes)}.json`);
    await writeImmutable(path, bytes);
    await options.fault?.('after-event-sync');
  };
  const loadEventPrefix = async (target: ReturnType<typeof paths>, rollbackRunId: string, planDigest: string): Promise<RollbackEvent[]> => {
    const events: RollbackEvent[] = [];
    for (const name of (await readdir(target.events)).filter(name => !isPublicationTemporary(name)).sort()) {
      const match = /^(\d{8})-([a-f0-9]{64})\.json$/.exec(name);
      if (!match || Number(match[1]) !== events.length) throw new RollbackEvidenceError('rollback event prefix is not contiguous');
      const bytes = await readProtected(join(target.events, name));
      if (hash(bytes) !== match[2]) throw new RollbackEvidenceError('rollback event prefix digest mismatch');
      const event = RollbackEventSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
      if (event.sequence !== events.length || event.rollbackRunId !== rollbackRunId || event.planDigest !== planDigest) throw new RollbackEvidenceError('rollback event prefix identity mismatch');
      events.push(event);
    }
    return events;
  };

  return {
    async executeUserFileRollback(rollbackRunIdInput, planInput, approvedPlanDigestInput, loadCompensations) {
      const rollbackRunId = identifier.parse(rollbackRunIdInput);
      const plan = RollbackPlanSchema.parse(planInput);
      const approvedPlanDigest = digest.parse(approvedPlanDigestInput);
      if (approvedPlanDigest !== plan.digest) throw new Error('rollback requires approval of the exact rollback plan digest');
      await prepareRollbackRun({ rollbackRunId, plan, approvedPlanDigest }, now);
      const target = paths(rollbackRunId, plan.digest);
      await prepare(target);
      const owner = await claim(rollbackRunId, plan.digest);
      let renewal = Promise.resolve();
      let renewalFailure: unknown;
      const renewalTimer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (renewalFailure !== undefined) return;
          try { await renew(owner); } catch (error) { renewalFailure ??= error; }
        });
      }, Math.max(250, Math.floor(leaseMs / 3)));
      const assertOwned = async (): Promise<void> => {
        const pendingRenewal = renewal;
        await pendingRenewal;
        if (renewalFailure !== undefined) throw renewalFailure;
        await requireOwner(owner);
      };
      let terminalPublished = false;
      try {
        await bindRollbackSource(owner, plan, rollbackRunId);
        await writeImmutable(target.plan, canonicalBytes(plan));
        await options.fault?.('after-plan-sync');
        if ((await readdir(target.commits)).some(name => !isPublicationTemporary(name))) {
          throw new RollbackEvidenceError('rollback run already has terminal commit evidence');
        }
        const events = await loadEventPrefix(target, rollbackRunId, plan.digest);
        const emit = async (body: Record<string, unknown>) => {
          const event = RollbackEventSchema.parse({ schemaVersion: 1, sequence: events.length, at: now(), rollbackRunId, planDigest: plan.digest, ...body });
          events.push(event); await persistEvent(target, event);
        };
        if (events.length === 0) await emit({ kind: 'rollback-run-started' });
        if (events.length === 1 && events[0]?.kind === 'rollback-run-started') await emit({ kind: 'rollback-plan-approved' });
        validateLifecycle(plan, events);
        const started = events.find(event => event.kind === 'rollback-run-started');
        if (!started) throw new RollbackEvidenceError('rollback event prefix has no start event');
        const finished = events.filter(event => event.kind === 'rollback-run-finished');
        if (finished.length > 1 || (finished.length === 1 && events.at(-1) !== finished[0])) {
          throw new RollbackEvidenceError('rollback event prefix has an invalid terminal boundary');
        }
        if (finished.length === 1) {
          const terminal = finished[0];
          if (!terminal || terminal.kind !== 'rollback-run-finished') throw new RollbackEvidenceError('rollback terminal event is invalid');
          const succeeded = terminal.status === 'succeeded';
          const receipt = RollbackRunReceiptSchema.parse({
            schemaVersion: 1, rollbackRunId, planDigest: plan.digest, sourceRunId: plan.sourceRunId,
            status: terminal.status, completed: succeeded, startedAt: started.at, finishedAt: terminal.at,
            nextAction: succeeded ? 'Verify dependent services before resuming installation.' : 'Inspect failed rollback evidence; do not treat restoration as complete.',
          });
          await persistTerminal(target, rollbackRunId, plan, events, receipt, assertOwned);
          terminalPublished = true;
          return Object.freeze({ plan, events: Object.freeze(events), receipt });
        }
        const compensations = await loadCompensations();
        const byId = new Map(compensations.map(item => [item.record.taskId, item]));
        const result = await executeApprovedUserFileRollback({ plan, approvedPlanDigest }, compensations, {
          beforeTask: async (taskId, current) => {
            await assertOwned();
            const prior = events.find(event => event.kind === 'rollback-task-started' && event.taskId === taskId);
            const recorded = events.find(event => event.kind === 'rollback-task-restored' && event.taskId === taskId);
            const artifact = byId.get(taskId); if (!artifact) throw new RollbackEvidenceError(`rollback artifact disappeared: ${taskId}`);
            if (recorded) return 'already-recorded';
            if (!prior || prior.kind !== 'rollback-task-started') {
              if (artifact?.appliedDigest !== null && artifact?.appliedDigest !== undefined
                && (!current.existed || current.digest !== artifact.appliedDigest)) {
                throw new RollbackEvidenceError(`rollback target changed after installation: ${taskId}`);
              }
              await emit({ kind: 'rollback-task-started', taskId, target: current }); return 'execute';
            }
            const serviceSnapshot = artifact.serviceSnapshot ?? null;
            const fileRestored = artifact.snapshot.existed
              ? current.existed && current.digest === artifact.snapshot.digest && current.mode === artifact.snapshot.mode && current.uid === artifact.snapshot.uid && current.gid === artifact.snapshot.gid && current.links === 1
              : !current.existed;
            const serviceRestored = serviceSnapshot === null || serviceStateEquals(serviceSnapshot, current.service);
            const restored = fileRestored && serviceRestored;
            if (restored) return 'skip-restored';
            if (serviceSnapshot !== null && fileRestored && JSON.stringify(current.service) === JSON.stringify(prior.target.service)) return 'execute';
            if (JSON.stringify(current) === JSON.stringify(prior.target)) return 'execute';
            throw new RollbackEvidenceError(`ambiguous post-crash rollback state: ${taskId}`);
          },
          beforeMutation: async () => { await assertOwned(); },
          captureService: async snapshot => {
            const adapter = options.serviceAdapters?.[snapshot.manager];
            if (adapter === undefined || adapter.manager !== snapshot.manager) throw new RollbackEvidenceError(`unsupported service manager for rollback: ${snapshot.manager}`);
            return await adapter.capture(snapshot.serviceId);
          },
          restoreService: async snapshot => {
            const adapter = options.serviceAdapters?.[snapshot.manager];
            if (adapter === undefined || adapter.manager !== snapshot.manager) throw new RollbackEvidenceError(`unsupported service manager for rollback: ${snapshot.manager}`);
            await adapter.restore(snapshot.serviceId, serviceStateFromSnapshot(snapshot));
          },
          afterTask: async outcome => {
            if (!events.some(event => event.kind === 'rollback-task-started' && event.taskId === outcome.taskId)) {
              await assertOwned();
              const artifact = byId.get(outcome.taskId);
              if (!artifact || outcome.status !== 'restored') throw new RollbackEvidenceError(`rollback outcome has no authorized task start: ${outcome.taskId}`);
              const snapshot = artifact.snapshot;
              const service = artifact.serviceSnapshot ?? null;
              await emit({ kind: 'rollback-task-started', taskId: outcome.taskId, target: {
                existed: snapshot.existed, digest: snapshot.digest, mode: snapshot.mode, uid: snapshot.uid, gid: snapshot.gid,
                type: snapshot.existed ? 'regular' : 'absent', links: snapshot.existed ? 1 : null,
                service: service === null ? null : serviceStateFromSnapshot(service),
              } });
            }
            await options.fault?.('before-outcome-sync');
            await emit(outcome.status === 'restored' ? { kind: 'rollback-task-restored', taskId: outcome.taskId }
              : { kind: 'rollback-task-failed', taskId: outcome.taskId, detail: outcome.detail });
          },
        });
        await assertOwned();
        await emit({ kind: 'rollback-run-finished', status: result.status });
        const terminal = events.at(-1);
        if (!terminal || terminal.kind !== 'rollback-run-finished') throw new RollbackEvidenceError('rollback terminal event was not persisted');
        const receipt = RollbackRunReceiptSchema.parse({ schemaVersion: 1, rollbackRunId, planDigest: plan.digest, sourceRunId: plan.sourceRunId,
          status: result.status, completed: result.completed, startedAt: started.at, finishedAt: terminal.at,
          nextAction: result.completed ? 'Verify dependent services before resuming installation.' : 'Inspect failed rollback evidence; do not treat restoration as complete.' });
        await persistTerminal(target, rollbackRunId, plan, events, receipt, assertOwned);
        terminalPublished = true;
        return Object.freeze({ plan, events: Object.freeze(events), receipt });
      } finally {
        clearInterval(renewalTimer);
        await renewal;
        let releaseFailure: unknown;
        try { await options.fault?.('before-release'); await release(owner); } catch (error) { releaseFailure = error; }
        if (!terminalPublished && renewalFailure !== undefined) throw renewalFailure;
        if (!terminalPublished && releaseFailure !== undefined) throw releaseFailure;
      }
    },
    async recordBlockedRun(rollbackRunIdInput, planInput, approvedPlanDigestInput) {
      const rollbackRunId = identifier.parse(rollbackRunIdInput);
      const plan = RollbackPlanSchema.parse(planInput);
      const approvedPlanDigest = digest.parse(approvedPlanDigestInput);
      if (approvedPlanDigest !== plan.digest) throw new Error('rollback requires approval of the exact rollback plan digest');
      // Validate integrity and produce the only currently permitted, explicitly
      // nonexecuting lifecycle before creating any persistent state.
      const lifecycle = await prepareRollbackRun({ rollbackRunId, plan, approvedPlanDigest }, now);
      const target = paths(rollbackRunId, plan.digest);
      await prepare(target);
      const owner = await claim(rollbackRunId, plan.digest);
      let terminalPublished = false;
      try {
        const planBytes = canonicalBytes(plan);
        await writeImmutable(target.plan, planBytes);
        await options.fault?.('after-plan-sync');
        if ((await readdir(target.commits)).some(name => !isPublicationTemporary(name))) {
          throw new RollbackEvidenceError('rollback run already has terminal commit evidence');
        }
        const eventArtifacts = [];
        for (const event of lifecycle.events) {
          const bytes = canonicalBytes(event);
          const path = join(target.events, `${String(event.sequence).padStart(8, '0')}-${hash(bytes)}.json`);
          await writeImmutable(path, bytes);
          eventArtifacts.push({ path, sha256: hash(bytes) });
          await options.fault?.('after-event-sync');
        }
        validateLifecycle(plan, lifecycle.events, lifecycle.receipt);
        await requireOwner(owner);
        const receiptBytes = canonicalBytes(lifecycle.receipt);
        const receiptPath = join(target.receipts, `${hash(receiptBytes)}.json`);
        await writeImmutable(receiptPath, receiptBytes);
        await options.fault?.('after-receipt-sync');
        await requireOwner(owner);
        const commit = CommitSchema.parse({
          schemaVersion: 1, rollbackRunId, planDigest: plan.digest,
          plan: { path: target.plan, sha256: hash(planBytes) }, events: eventArtifacts,
          receipt: { path: receiptPath, sha256: hash(receiptBytes) },
          evidencePaths: [target.plan, ...eventArtifacts.map(item => item.path), receiptPath],
        });
        const commitBytes = canonicalBytes(commit);
        await writeImmutable(join(target.commits, `${hash(commitBytes)}.json`), commitBytes);
        terminalPublished = true;
        return lifecycle;
      } finally {
        try { await options.fault?.('before-release'); await release(owner); }
        catch (error) { if (!terminalPublished) throw error; }
      }
    },

    async inspect(rollbackRunIdInput, planDigestInput) {
      const rollbackRunId = identifier.parse(rollbackRunIdInput);
      const planDigest = digest.parse(planDigestInput);
      const target = paths(rollbackRunId, planDigest);
      const base = { rollbackRunId, planDigest } as const;
      try {
        const rootInfo = await lstat(target.runRoot);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new RollbackEvidenceError('rollback run root is not a real directory');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { ...base, authority: 'absent' as const, problems: [] };
        return { ...base, authority: 'corrupt' as const, problems: [error instanceof Error ? error.message : 'unknown evidence error'] };
      }
      try {
        const commitNames = (await readdir(target.commits)).filter(name => !isPublicationTemporary(name));
        if (commitNames.length === 0) {
          try {
            const owner = HostMutationOwnerSchema.parse(JSON.parse((await readProtected(ownerPath)).toString('utf8')) as unknown);
            if (owner.runId === rollbackRunId && owner.planDigest === planDigest) {
              const leaseLive = new Date(owner.leaseUntil).getTime() > new Date(now()).getTime();
              const processLive = owner.bootId === bootId && await isProcessAlive(owner.pid, owner.processStart);
              if (leaseLive && processLive) return { ...base, authority: 'active' as const, problems: [] };
            }
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          }
          return { ...base, authority: 'uncommitted' as const, problems: [] };
        }
        if (commitNames.length !== 1 || !/^[a-f0-9]{64}\.json$/.test(commitNames[0] ?? '')) throw new RollbackEvidenceError('rollback run has invalid commit markers');
        const commitPath = join(target.commits, commitNames[0] ?? '');
        const commitBytes = await readProtected(commitPath);
        if (`${hash(commitBytes)}.json` !== commitNames[0]) throw new RollbackEvidenceError('rollback commit digest mismatch');
        const commit = CommitSchema.parse(JSON.parse(commitBytes.toString('utf8')) as unknown);
        if (commit.rollbackRunId !== rollbackRunId || commit.planDigest !== planDigest) throw new RollbackEvidenceError('rollback commit identity mismatch');
        const planBytes = await readProtected(commit.plan.path);
        if (hash(planBytes) !== commit.plan.sha256 || commit.plan.path !== target.plan) throw new RollbackEvidenceError('rollback plan digest or path mismatch');
        const plan = RollbackPlanSchema.parse(JSON.parse(planBytes.toString('utf8')) as unknown);
        if (plan.digest !== planDigest) throw new RollbackEvidenceError('rollback plan identity mismatch');
        const events = [];
        const eventNames = (await readdir(target.events)).filter(name => !isPublicationTemporary(name));
        if (eventNames.some(name => !/^\d{8}-[a-f0-9]{64}\.json$/.test(name))) throw new RollbackEvidenceError('rollback event directory contains temporary or unknown artifacts');
        const receiptNames = (await readdir(target.receipts)).filter(name => !isPublicationTemporary(name));
        if (receiptNames.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new RollbackEvidenceError('rollback receipt directory contains temporary or unknown artifacts');
        for (const [sequence, item] of commit.events.entries()) {
          ensureWithin(target.events, item.path);
          const bytes = await readProtected(item.path);
          if (hash(bytes) !== item.sha256) throw new RollbackEvidenceError('rollback event digest mismatch');
          const event = RollbackEventSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
          if (event.sequence !== sequence || event.rollbackRunId !== rollbackRunId || event.planDigest !== planDigest) {
            throw new RollbackEvidenceError('rollback event sequence or identity mismatch');
          }
          events.push(event);
        }
        ensureWithin(target.receipts, commit.receipt.path);
        const receiptBytes = await readProtected(commit.receipt.path);
        if (hash(receiptBytes) !== commit.receipt.sha256) throw new RollbackEvidenceError('rollback receipt digest mismatch');
        const receipt = RollbackRunReceiptSchema.parse(JSON.parse(receiptBytes.toString('utf8')) as unknown);
        const completionValid = receipt.status === 'succeeded' ? receipt.completed === true : receipt.completed === false;
        if (receipt.rollbackRunId !== rollbackRunId || receipt.planDigest !== planDigest || !completionValid) {
          throw new RollbackEvidenceError('rollback receipt identity or completion invariant mismatch');
        }
        if (receipt.sourceRunId !== plan.sourceRunId) throw new RollbackEvidenceError('rollback receipt source identity mismatch');
        validateLifecycle(plan, events, receipt);
        const evidencePaths = [target.plan, ...commit.events.map(item => item.path), commit.receipt.path];
        if (JSON.stringify(commit.evidencePaths) !== JSON.stringify(evidencePaths)) throw new RollbackEvidenceError('rollback evidence path set mismatch');
        return { ...base, authority: 'committed' as const, plan, events: Object.freeze(events), receipt, problems: [] };
      } catch (error) {
        return { ...base, authority: 'corrupt' as const, problems: [error instanceof Error ? error.message : 'unknown evidence error'] };
      }
    },
  };
}
