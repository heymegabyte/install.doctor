import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const action = z.enum(['discover', 'validate', 'plan', 'approve', 'apply', 'verify']);
const phaseOrder = action.options;

export const HostReconciliationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  cycleId: identifier,
  desiredRevision: identifier,
  status: z.enum(['active', 'paused', 'stopped', 'verified']),
  completedActions: z.array(action).max(phaseOrder.length),
  activeAction: action.nullable(),
  lastEvidenceDigest: digest.nullable(),
  updatedAt: timestamp,
}).superRefine((value, context) => {
  const expected = phaseOrder.slice(0, value.completedActions.length);
  if (JSON.stringify(value.completedActions) !== JSON.stringify(expected)) {
    context.addIssue({ code: 'custom', path: ['completedActions'], message: 'reconciliation actions must form an exact lifecycle prefix' });
  }
  if (value.status === 'verified' && value.completedActions.at(-1) !== 'verify') {
    context.addIssue({ code: 'custom', path: ['status'], message: 'verified reconciliation requires completed verification' });
  }
});
export type HostReconciliationState = z.infer<typeof HostReconciliationStateSchema>;

export const HostReconciliationLeaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  ownerId: identifier,
  token: z.string().uuid(),
  claimedAt: timestamp,
  heartbeatAt: timestamp,
  leaseUntil: timestamp,
});
export type HostReconciliationLease = z.infer<typeof HostReconciliationLeaseSchema>;

export class HostReconciliationLeaseError extends Error {
  constructor(message: string) { super(message); this.name = 'HostReconciliationLeaseError'; }
}

type Action = z.infer<typeof action>;
type ReconciliationResult = { readonly evidenceDigest: string };
type ReconciliationEffect = () => Promise<ReconciliationResult>;

export interface HostReconciler {
  discover(input: { cycleId: string; desiredRevision: string }, effect: ReconciliationEffect): Promise<HostReconciliationState>;
  validate(effect: ReconciliationEffect): Promise<HostReconciliationState>;
  plan(effect: ReconciliationEffect): Promise<HostReconciliationState>;
  approve(effect: ReconciliationEffect): Promise<HostReconciliationState>;
  apply(effect: ReconciliationEffect): Promise<HostReconciliationState>;
  verify(effect: ReconciliationEffect): Promise<HostReconciliationState>;
  status(): Promise<{ state: HostReconciliationState | null; lease: HostReconciliationLease | null }>;
  pause(): Promise<HostReconciliationState>;
  resume(): Promise<HostReconciliationState>;
  stop(): Promise<HostReconciliationState>;
}

interface Options {
  stateRoot: string;
  hostId: string;
  ownerId: string;
  leaseMs?: number;
  now?: () => string;
  isOwnerAlive?: (lease: HostReconciliationLease) => Promise<boolean>;
}

function exactDirectory(path: string, label: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || dirname(path) === path) throw new Error(`${label} must be a canonical absolute non-root path`);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp.${randomUUID()}`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await rm(temporary, { force: true }); }
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
      throw new Error('reconciliation durable file must be one private regular file');
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function createHostReconciler(options: Options): Promise<HostReconciler> {
  exactDirectory(options.stateRoot, 'reconciliation state root');
  const hostId = identifier.parse(options.hostId);
  const ownerId = identifier.parse(options.ownerId);
  const leaseMs = z.number().int().min(1_000).max(3_600_000).parse(options.leaseMs ?? 30_000);
  const now = options.now ?? (() => new Date().toISOString());
  const isOwnerAlive = options.isOwnerAlive ?? (async () => true);
  await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(options.stateRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('reconciliation state root must be a private real directory');
  }
  await chmod(options.stateRoot, 0o700);
  const hostsRoot = join(options.stateRoot, 'hosts');
  const hostRoot = join(hostsRoot, hostId);
  await mkdir(hostRoot, { recursive: true, mode: 0o700 });
  for (const path of [hostsRoot, hostRoot]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('reconciliation host state path must be a private real directory');
    }
    await chmod(path, 0o700);
  }
  const statePath = join(hostRoot, 'state.json');
  const leasePath = join(hostRoot, 'lease.json');
  const token = randomUUID();

  const readState = async () => {
    const value = await readJson(statePath);
    return value === null ? null : HostReconciliationStateSchema.parse(value);
  };
  const readLease = async () => {
    const value = await readJson(leasePath);
    return value === null ? null : HostReconciliationLeaseSchema.parse(value);
  };
  const owns = (lease: HostReconciliationLease | null) => lease?.ownerId === ownerId && lease.token === token;
  const leaseValue = (claimedAt: string): HostReconciliationLease => HostReconciliationLeaseSchema.parse({
    schemaVersion: 1, hostId, ownerId, token, claimedAt, heartbeatAt: now(),
    leaseUntil: new Date(new Date(now()).getTime() + leaseMs).toISOString(),
  });
  const claim = async (): Promise<HostReconciliationLease> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const at = now();
      const candidate = leaseValue(at);
      try {
        const handle = await open(leasePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        try { await handle.writeFile(`${JSON.stringify(candidate)}\n`); await handle.sync(); }
        finally { await handle.close(); }
        await syncDirectory(hostRoot);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const current = await readLease();
      if (owns(current)) return current!;
      if (current && new Date(current.leaseUntil).getTime() <= new Date(now()).getTime() && !await isOwnerAlive(current)) {
        const stale = `${leasePath}.stale.${current.token}`;
        try { await rename(leasePath, stale); await syncDirectory(hostRoot); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        continue;
      }
      throw new HostReconciliationLeaseError(`host ${hostId} already has an active reconciler`);
    }
    throw new HostReconciliationLeaseError(`host ${hostId} lease changed repeatedly during claim`);
  };
  const requireOwner = async () => {
    const current = await readLease();
    if (!owns(current)) throw new HostReconciliationLeaseError(`reconciler ${ownerId} does not own host ${hostId}`);
    const renewed = HostReconciliationLeaseSchema.parse({
      ...current, heartbeatAt: now(), leaseUntil: new Date(new Date(now()).getTime() + leaseMs).toISOString(),
    });
    await atomicJson(leasePath, renewed);
    return renewed;
  };
  const release = async () => {
    const current = await readLease();
    if (!owns(current)) throw new HostReconciliationLeaseError(`reconciler ${ownerId} cannot release another owner`);
    await rm(leasePath); await syncDirectory(hostRoot);
  };
  const writeState = async (value: unknown) => {
    const parsed = HostReconciliationStateSchema.parse(value);
    await atomicJson(statePath, parsed);
    return parsed;
  };
  const execute = async (requested: Action, effect: ReconciliationEffect) => {
    await requireOwner();
    const current = await readState();
    if (!current || current.status !== 'active') throw new Error(`host reconciliation is not active for ${requested}`);
    const expected = phaseOrder[current.completedActions.length];
    if (requested !== expected || (current.activeAction !== null && current.activeAction !== requested)) {
      throw new Error(`expected reconciliation action ${expected ?? 'none'}, received ${requested}`);
    }
    await writeState({ ...current, activeAction: requested, updatedAt: now() });
    try {
      const result = z.strictObject({ evidenceDigest: digest }).parse(await effect());
      const completed = await writeState({
        ...current, status: requested === 'verify' ? 'verified' : 'active',
        completedActions: [...current.completedActions, requested], activeAction: null,
        lastEvidenceDigest: result.evidenceDigest, updatedAt: now(),
      });
      if (requested === 'verify') await release();
      return completed;
    } catch (error) {
      await writeState({ ...current, status: 'paused', activeAction: requested, updatedAt: now() });
      await release();
      throw error;
    }
  };

  return {
    async discover(input, effect) {
      await claim();
      const existing = await readState();
      if (existing && !['stopped', 'verified'].includes(existing.status)) {
        await release();
        throw new Error('existing reconciliation cycle must be resumed or stopped');
      }
      await writeState({
        schemaVersion: 1, hostId, cycleId: identifier.parse(input.cycleId), desiredRevision: identifier.parse(input.desiredRevision),
        status: 'active', completedActions: [], activeAction: null, lastEvidenceDigest: null, updatedAt: now(),
      });
      return execute('discover', effect);
    },
    validate: effect => execute('validate', effect),
    plan: effect => execute('plan', effect),
    approve: effect => execute('approve', effect),
    apply: effect => execute('apply', effect),
    verify: effect => execute('verify', effect),
    async status() { return { state: await readState(), lease: await readLease() }; },
    async pause() {
      await requireOwner();
      const current = await readState();
      if (!current || current.status !== 'active' || current.activeAction !== null) throw new Error('only an idle active reconciliation can pause');
      const paused = await writeState({ ...current, status: 'paused', updatedAt: now() });
      await release();
      return paused;
    },
    async resume() {
      await claim();
      const current = await readState();
      if (!current || current.status !== 'paused') { await release(); throw new Error('only a paused reconciliation can resume'); }
      return writeState({ ...current, status: 'active', updatedAt: now() });
    },
    async stop() {
      const currentLease = await readLease();
      if (!owns(currentLease)) await claim();
      const current = await readState();
      if (!current || current.status === 'verified') { await release(); throw new Error('verified or absent reconciliation cannot be stopped'); }
      const stopped = await writeState({ ...current, status: 'stopped', activeAction: null, updatedAt: now() });
      await release();
      return stopped;
    },
  };
}
