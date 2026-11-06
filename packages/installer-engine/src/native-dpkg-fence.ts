import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { isPlatformProcessIdentityAlive, resolvePlatformProcessIdentity } from './process-identity.js';

export const NATIVE_DPKG_FENCE_PATH = '/run/lock/install-doctor/dpkg-transaction.owner.json';

const MAX_OWNER_BYTES = 16 * 1024;
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

export const NativeDpkgFenceOwnerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('install-doctor-native-dpkg-transaction'),
  runId: identifier,
  hostId: identifier,
  planDigest: digest,
  pid: z.number().int().positive().safe(),
  bootId: z.string().min(1).max(256),
  processStart: z.string().min(1).max(256),
  token: z.string().uuid(),
  claimedAt: timestamp,
  heartbeatAt: timestamp,
  leaseUntil: timestamp,
}).superRefine((owner, context) => {
  const claimed = Date.parse(owner.claimedAt);
  const heartbeat = Date.parse(owner.heartbeatAt);
  const lease = Date.parse(owner.leaseUntil);
  if (heartbeat < claimed) context.addIssue({ code: 'custom', path: ['heartbeatAt'], message: 'heartbeat precedes claim' });
  if (lease <= heartbeat) context.addIssue({ code: 'custom', path: ['leaseUntil'], message: 'lease must follow heartbeat' });
});
export type NativeDpkgFenceOwner = z.infer<typeof NativeDpkgFenceOwnerSchema>;

const GuardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('install-doctor-native-dpkg-fence-guard'),
  pid: z.number().int().positive().safe(),
  bootId: z.string().min(1).max(256),
  processStart: z.string().min(1).max(256),
  token: z.string().uuid(),
  createdAt: timestamp,
});
type Guard = z.infer<typeof GuardSchema>;

export class NativeDpkgFenceIntegrityError extends Error {
  override readonly name = 'NativeDpkgFenceIntegrityError';
}

export class NativeDpkgFenceBusyError extends Error {
  override readonly name = 'NativeDpkgFenceBusyError';
  constructor(readonly owner: NativeDpkgFenceOwner | undefined) {
    super(owner === undefined
      ? 'native dpkg transaction fence remained contended within the bounded acquisition window'
      : `native dpkg transaction is owned by run ${owner.runId} (pid ${owner.pid})`);
  }
}

export class NativeDpkgFenceLostError extends Error {
  override readonly name = 'NativeDpkgFenceLostError';
  constructor() { super('native dpkg transaction fence ownership was lost or superseded'); }
}

export type NativeDpkgFenceInspection =
  | { readonly state: 'absent' }
  | { readonly state: 'owned'; readonly owner: NativeDpkgFenceOwner }
  | { readonly state: 'corrupt'; readonly problems: readonly string[] };

interface NativeDpkgFenceFixture {
  readonly ownerPath: string;
  readonly expectedUid: number;
}

interface NativeDpkgFenceOptions {
  /** Test-only escape hatch: production always uses the fixed root-owned path. */
  readonly fixture?: NativeDpkgFenceFixture;
  readonly bootId?: string;
  readonly processStart?: string;
  readonly pid?: number;
  readonly now?: () => string;
  readonly isProcessAlive?: (pid: number, processStart: string) => Promise<boolean>;
  readonly leaseMs?: number;
  readonly acquisitionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface NativeDpkgFenceClaim {
  readonly runId: string;
  readonly hostId: string;
  readonly planDigest: string;
}

interface Identity {
  readonly bootId: string;
  readonly processStart: string;
  readonly pid: number;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function canonicalBytes(value: unknown): Buffer {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return input;
  };
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(canonicalBytes(value));
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await syncDirectory(dirname(path));
}

async function validateParent(path: string, expectedUid: number): Promise<void> {
  const parent = dirname(path);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try { metadata = await lstat(parent); }
  catch (error) { throw new NativeDpkgFenceIntegrityError(`dpkg fence parent is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new NativeDpkgFenceIntegrityError('dpkg fence parent must be a real directory');
  if (metadata.uid !== expectedUid) throw new NativeDpkgFenceIntegrityError('dpkg fence parent has unexpected ownership');
  if ((metadata.mode & 0o077) !== 0) throw new NativeDpkgFenceIntegrityError('dpkg fence parent must not permit group or other access');
  if (await realpath(parent) !== parent) throw new NativeDpkgFenceIntegrityError('dpkg fence parent must be canonical and symlink-free');
}

async function readProtectedJson(path: string, expectedUid: number): Promise<unknown | undefined> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try { before = await lstat(path); }
  catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new NativeDpkgFenceIntegrityError('dpkg fence authority must be a regular file');
  if (before.uid !== expectedUid) throw new NativeDpkgFenceIntegrityError('dpkg fence authority has unexpected ownership');
  if ((before.mode & 0o777) !== 0o600) throw new NativeDpkgFenceIntegrityError('dpkg fence authority must have mode 0600');
  if (before.nlink !== 1) throw new NativeDpkgFenceIntegrityError('dpkg fence authority must have exactly one link');
  if (before.size > MAX_OWNER_BYTES) throw new NativeDpkgFenceIntegrityError('dpkg fence authority exceeds its read bound');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino) throw new NativeDpkgFenceIntegrityError('dpkg fence authority changed during protected open');
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_OWNER_BYTES) throw new NativeDpkgFenceIntegrityError('dpkg fence authority exceeds its read bound');
    try { return JSON.parse(bytes.toString('utf8')) as unknown; }
    catch { throw new NativeDpkgFenceIntegrityError('dpkg fence authority is not valid JSON'); }
  } finally { await handle.close(); }
}

function sameVersion(left: NativeDpkgFenceOwner, right: NativeDpkgFenceOwner): boolean {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

export function createNativeDpkgFence(options: NativeDpkgFenceOptions = {}) {
  const fixture = options.fixture;
  const ownerPath = fixture?.ownerPath ?? NATIVE_DPKG_FENCE_PATH;
  const expectedUid = fixture?.expectedUid ?? 0;
  const guardPath = `${ownerPath}.guard`;
  const leaseMs = options.leaseMs ?? 15_000;
  const acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const isAlive = options.isProcessAlive ?? isPlatformProcessIdentityAlive;
  if (!ownerPath.startsWith('/')) throw new Error('dpkg fence path must be absolute');
  if ((options.bootId === undefined) !== (options.processStart === undefined)) throw new Error('bootId and processStart must be supplied together');
  for (const [name, value] of Object.entries({ leaseMs, acquisitionTimeoutMs, pollIntervalMs })) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 86_400_000) throw new Error(`${name} is outside its safe bound`);
  }

  async function identity(): Promise<Identity> {
    const pid = options.pid ?? process.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('dpkg fence PID must be a positive safe integer');
    if (options.bootId !== undefined && options.processStart !== undefined) return { bootId: options.bootId, processStart: options.processStart, pid };
    const resolved = await resolvePlatformProcessIdentity(pid);
    return { ...resolved, pid };
  }

  async function prepareParent(): Promise<void> {
    if (fixture === undefined) {
      if (process.platform !== 'linux') throw new NativeDpkgFenceIntegrityError('native dpkg fencing is supported only on Linux');
      if (process.getuid?.() !== 0) throw new NativeDpkgFenceIntegrityError('native dpkg fencing requires root');
      await mkdir(dirname(ownerPath), { mode: 0o700 }).catch(error => { if (!isErrno(error, 'EEXIST')) throw error; });
    }
    await validateParent(ownerPath, expectedUid);
  }

  async function inspect(): Promise<NativeDpkgFenceInspection> {
    try {
      await validateParent(ownerPath, expectedUid);
      const raw = await readProtectedJson(ownerPath, expectedUid);
      if (raw === undefined) return { state: 'absent' };
      const parsed = NativeDpkgFenceOwnerSchema.safeParse(raw);
      return parsed.success
        ? { state: 'owned', owner: parsed.data }
        : { state: 'corrupt', problems: parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`) };
    } catch (error) {
      return { state: 'corrupt', problems: [error instanceof Error ? error.message : String(error)] };
    }
  }

  async function quarantine(path: string, token: string, at: string): Promise<void> {
    const suffix = `${at.replace(/[^0-9]/g, '')}.${token}`;
    await rename(path, `${path}.stale.${suffix}`);
    await syncDirectory(dirname(path));
  }

  async function acquireGuard(currentIdentity: Identity): Promise<Guard> {
    const attempts = Math.ceil(acquisitionTimeoutMs / pollIntervalMs) + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const createdAt = now();
      const guard = GuardSchema.parse({
        schemaVersion: 1, kind: 'install-doctor-native-dpkg-fence-guard', ...currentIdentity,
        token: randomUUID(), createdAt,
      });
      try {
        await writeExclusive(guardPath, guard);
        return guard;
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error;
        const raw = await readProtectedJson(guardPath, expectedUid);
        const parsed = GuardSchema.safeParse(raw);
        if (!parsed.success) throw new NativeDpkgFenceIntegrityError('dpkg fence guard is corrupt');
        if (parsed.data.bootId !== currentIdentity.bootId || !await isAlive(parsed.data.pid, parsed.data.processStart)) {
          await quarantine(guardPath, parsed.data.token, createdAt).catch(quarantineError => {
            if (!isErrno(quarantineError, 'ENOENT')) throw quarantineError;
          });
          continue;
        }
        if (attempt + 1 < attempts) await sleep(pollIntervalMs);
      }
    }
    throw new NativeDpkgFenceBusyError(undefined);
  }

  async function releaseGuard(guard: Guard): Promise<void> {
    const raw = await readProtectedJson(guardPath, expectedUid);
    const current = GuardSchema.safeParse(raw);
    if (!current.success || current.data.token !== guard.token) throw new NativeDpkgFenceIntegrityError('dpkg fence guard ownership was lost');
    await unlink(guardPath);
    await syncDirectory(dirname(guardPath));
  }

  async function withGuard<T>(operation: (currentIdentity: Identity) => Promise<T>): Promise<T> {
    await prepareParent();
    const currentIdentity = await identity();
    const guard = await acquireGuard(currentIdentity);
    try { return await operation(currentIdentity); }
    finally { await releaseGuard(guard); }
  }

  async function acquire(claim: NativeDpkgFenceClaim): Promise<NativeDpkgFenceOwner> {
    const parsedClaim = z.strictObject({ runId: identifier, hostId: identifier, planDigest: digest }).parse(claim);
    let lastOwner: NativeDpkgFenceOwner | undefined;
    const attempts = Math.ceil(acquisitionTimeoutMs / pollIntervalMs) + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await withGuard(async currentIdentity => {
        const inspection = await inspect();
        if (inspection.state === 'corrupt') throw new NativeDpkgFenceIntegrityError(inspection.problems.join('; '));
        if (inspection.state === 'owned') {
          const existing = inspection.owner;
          const at = now();
          const expired = Date.parse(existing.leaseUntil) <= Date.parse(at);
          const live = existing.bootId === currentIdentity.bootId && await isAlive(existing.pid, existing.processStart);
          if (existing.bootId === currentIdentity.bootId && (live || !expired)) return { acquired: undefined, busy: existing };
          await quarantine(ownerPath, existing.token, at);
        }
        const heartbeatAt = now();
        const owner = NativeDpkgFenceOwnerSchema.parse({
          schemaVersion: 1, kind: 'install-doctor-native-dpkg-transaction', ...parsedClaim, ...currentIdentity,
          token: randomUUID(), claimedAt: heartbeatAt, heartbeatAt,
          leaseUntil: new Date(Date.parse(heartbeatAt) + leaseMs).toISOString(),
        });
        try { await writeExclusive(ownerPath, owner); }
        catch (error) { if (isErrno(error, 'EEXIST')) return { acquired: undefined, busy: undefined }; throw error; }
        return { acquired: owner, busy: undefined };
      });
      if (result.acquired !== undefined) return result.acquired;
      lastOwner = result.busy;
      if (attempt + 1 < attempts) await sleep(pollIntervalMs);
    }
    throw new NativeDpkgFenceBusyError(lastOwner);
  }

  async function renew(expected: NativeDpkgFenceOwner): Promise<NativeDpkgFenceOwner> {
    const parsedExpected = NativeDpkgFenceOwnerSchema.parse(expected);
    return withGuard(async currentIdentity => {
      if (parsedExpected.pid !== currentIdentity.pid || parsedExpected.bootId !== currentIdentity.bootId || parsedExpected.processStart !== currentIdentity.processStart) {
        throw new NativeDpkgFenceLostError();
      }
      const inspection = await inspect();
      if (inspection.state !== 'owned' || !sameVersion(inspection.owner, parsedExpected)) throw new NativeDpkgFenceLostError();
      const heartbeatAt = now();
      const renewed = NativeDpkgFenceOwnerSchema.parse({
        ...inspection.owner, heartbeatAt, leaseUntil: new Date(Date.parse(heartbeatAt) + leaseMs).toISOString(),
      });
      const temporary = `${ownerPath}.next.${renewed.token}.${randomUUID()}`;
      await writeExclusive(temporary, renewed);
      try {
        const current = await inspect();
        if (current.state !== 'owned' || !sameVersion(current.owner, parsedExpected)) throw new NativeDpkgFenceLostError();
        await rename(temporary, ownerPath);
        await syncDirectory(dirname(ownerPath));
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return renewed;
    });
  }

  async function release(expected: NativeDpkgFenceOwner): Promise<void> {
    const parsedExpected = NativeDpkgFenceOwnerSchema.parse(expected);
    await withGuard(async currentIdentity => {
      if (parsedExpected.pid !== currentIdentity.pid || parsedExpected.bootId !== currentIdentity.bootId || parsedExpected.processStart !== currentIdentity.processStart) {
        throw new NativeDpkgFenceLostError();
      }
      const inspection = await inspect();
      if (inspection.state !== 'owned' || !sameVersion(inspection.owner, parsedExpected)) throw new NativeDpkgFenceLostError();
      await unlink(ownerPath);
      await syncDirectory(dirname(ownerPath));
    });
  }

  return { ownerPath, acquire, inspect, renew, release } as const;
}
