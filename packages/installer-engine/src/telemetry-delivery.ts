import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { TelemetryBatchSchema } from './telemetry.js';
import type { TelemetryBatch, TelemetryTransport } from './telemetry.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const RecordSchema = z.strictObject({
  schemaVersion: z.literal(1), id: digest, enqueuedAt: timestamp, nextAttemptAt: timestamp,
  attempts: z.number().int().min(0).max(32), batch: TelemetryBatchSchema,
});
const HeartbeatSchema = z.strictObject({
  schemaVersion: z.literal(1), collectorState: z.enum(['running', 'stopped']), heartbeatAt: timestamp,
  lastAttemptAt: timestamp.nullable(), lastSuccessAt: timestamp.nullable(),
  lastDeliveredId: digest.nullable(),
  queryProbe: z.strictObject({ id: digest, sentAt: timestamp, queriedAt: timestamp.nullable() }).nullable(),
});
export type TelemetryDeliveryHeartbeat = z.infer<typeof HeartbeatSchema> & {
  verification: 'unverified' | 'verified' | 'stale';
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function bytes(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(canonical(value))}\n`); }
function sha(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const parent = dirname(path);
  const stage = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(bytes(value)); await handle.sync(); } finally { await handle.close(); }
  try {
    await rename(stage, path);
    const parentHandle = await open(parent, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  } finally { await rm(stage, { force: true }); }
}

export function createTelemetryDeliveryStore(options: {
  stateRoot: string; now?: () => string; maxBytes?: number; maxAgeMs?: number; retryBaseMs?: number; retryMaximumMs?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const maxBytes = z.number().int().min(4096).max(1_073_741_824).parse(options.maxBytes ?? 16_777_216);
  const maxAgeMs = z.number().int().min(1_000).max(604_800_000).parse(options.maxAgeMs ?? 86_400_000);
  const retryBaseMs = z.number().int().min(100).max(60_000).parse(options.retryBaseMs ?? 1_000);
  const retryMaximumMs = z.number().int().min(retryBaseMs).max(3_600_000).parse(options.retryMaximumMs ?? 300_000);
  let root: string;

  async function initialize(): Promise<void> {
    if (!isAbsolute(options.stateRoot)) throw new Error('telemetry state root must be absolute');
    const requested = resolve(options.stateRoot);
    const metadata = await lstat(requested);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('telemetry state root must be a real directory');
    root = await realpath(requested);
    if (root !== requested) throw new Error('telemetry state root must be canonical');
    await mkdir(join(root, 'spool'), { recursive: true, mode: 0o700 });
    const spool = await lstat(join(root, 'spool'));
    if (!spool.isDirectory() || spool.isSymbolicLink()) throw new Error('telemetry spool must be a real directory');
  }
  const spoolPath = (): string => join(root, 'spool');

  async function records(): Promise<Array<{ path: string; record: z.infer<typeof RecordSchema>; size: number }>> {
    const found = [];
    for (const name of (await readdir(spoolPath())).sort()) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('telemetry spool contains an unexpected entry');
      const path = join(spoolPath(), name); const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 2_097_152) throw new Error('telemetry spool record is unsafe');
      const record = RecordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (`${record.id}.json` !== name || sha(bytes(record.batch)) !== record.id) throw new Error('telemetry spool identity mismatch');
      found.push({ path, record, size: metadata.size });
    }
    return found;
  }

  async function heartbeat(): Promise<z.infer<typeof HeartbeatSchema> | undefined> {
    let handle;
    try {
      handle = await open(join(root, 'heartbeat.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > 16_384
        || (process.platform !== 'win32' && (metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0))) {
        throw new Error('telemetry heartbeat must be one bounded private regular file');
      }
      return HeartbeatSchema.parse(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    } finally { await handle?.close(); }
  }

  return {
    initialize,
    async enqueue(batchInput: unknown): Promise<{ status: 'enqueued' | 'duplicate' | 'dropped-capacity'; id: string }> {
      const batch = TelemetryBatchSchema.parse(batchInput); const encoded = bytes(batch); const id = sha(encoded);
      const current = await records();
      if (current.some(item => item.record.id === id)) return { status: 'duplicate', id };
      const observed = Date.parse(now());
      if (batch.events.some(event => Date.parse(event.at) > observed + 300_000)) throw new Error('telemetry event timestamp is too far in the future');
      if (current.reduce((sum, item) => sum + item.size, 0) + encoded.length > maxBytes) return { status: 'dropped-capacity', id };
      const at = new Date(observed).toISOString();
      await atomicWrite(join(spoolPath(), `${id}.json`), { schemaVersion: 1, id, enqueuedAt: at, nextAttemptAt: at, attempts: 0, batch });
      return { status: 'enqueued', id };
    },
    async drain(transport: TelemetryTransport, endpoint: string): Promise<{ delivered: number; failed: number; deferred: number; expired: number }> {
      const parsedEndpoint = z.string().url().refine(value => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
      }, 'telemetry delivery endpoint must be credential-free HTTPS').parse(endpoint);
      const atMs = Date.parse(now()); let delivered = 0; let failed = 0; let deferred = 0; let expired = 0; let lastDeliveredId: string | null = null;
      for (const item of await records()) {
        if (atMs - Date.parse(item.record.enqueuedAt) >= maxAgeMs) { await rm(item.path); expired += 1; continue; }
        if (Date.parse(item.record.nextAttemptAt) > atMs) { deferred += 1; continue; }
        const controller = new AbortController();
        try {
          await transport({ endpoint: parsedEndpoint, batch: item.record.batch, signal: controller.signal });
          await rm(item.path); delivered += 1; lastDeliveredId = item.record.id;
        } catch {
          failed += 1; const attempts = Math.min(32, item.record.attempts + 1);
          const delay = Math.min(retryMaximumMs, retryBaseMs * (2 ** Math.min(20, attempts - 1)));
          await atomicWrite(item.path, { ...item.record, attempts, nextAttemptAt: new Date(atMs + delay).toISOString() });
        }
      }
      const prior = await heartbeat();
      await atomicWrite(join(root, 'heartbeat.json'), { schemaVersion: 1, collectorState: 'running', heartbeatAt: new Date(atMs).toISOString(),
        lastAttemptAt: new Date(atMs).toISOString(), lastSuccessAt: delivered > 0 ? new Date(atMs).toISOString() : prior?.lastSuccessAt ?? null,
        lastDeliveredId: lastDeliveredId ?? prior?.lastDeliveredId ?? null,
        queryProbe: prior?.queryProbe ?? null });
      return { delivered, failed, deferred, expired };
    },
    async recordHeartbeat(state: 'running' | 'stopped'): Promise<void> {
      const at = timestamp.parse(now()); const prior = await heartbeat();
      await atomicWrite(join(root, 'heartbeat.json'), { schemaVersion: 1, collectorState: state, heartbeatAt: at,
        lastAttemptAt: prior?.lastAttemptAt ?? null, lastSuccessAt: prior?.lastSuccessAt ?? null,
        lastDeliveredId: prior?.lastDeliveredId ?? null, queryProbe: prior?.queryProbe ?? null });
    },
    async recordDeliveryProbe(idInput: string): Promise<void> {
      const prior = await heartbeat(); if (!prior) throw new Error('telemetry heartbeat is absent');
      if (prior.lastDeliveredId !== idInput) throw new Error('telemetry probe was not the exact successfully delivered batch');
      const probe = { id: digest.parse(idInput), sentAt: timestamp.parse(now()), queriedAt: null };
      await atomicWrite(join(root, 'heartbeat.json'), { ...prior, queryProbe: probe });
    },
    async recordQueryableProbe(idInput: string): Promise<void> {
      const id = digest.parse(idInput); const prior = await heartbeat();
      if (!prior?.queryProbe || prior.queryProbe.id !== id) throw new Error('query result does not match the emitted telemetry probe');
      await atomicWrite(join(root, 'heartbeat.json'), { ...prior, queryProbe: { ...prior.queryProbe, queriedAt: timestamp.parse(now()) } });
    },
    async status(staleAfterMs = 120_000): Promise<TelemetryDeliveryHeartbeat | undefined> {
      const current = await heartbeat(); if (!current) return undefined;
      const stale = Date.parse(now()) - Date.parse(current.heartbeatAt) > z.number().int().min(1_000).max(86_400_000).parse(staleAfterMs);
      return { ...current, verification: stale || current.collectorState === 'stopped'
        ? 'stale' : current.queryProbe?.queriedAt ? 'verified' : 'unverified' };
    },
    async pending(): Promise<number> { return (await records()).length; },
  };
}
