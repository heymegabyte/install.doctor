import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ServiceStateAdapter } from './config-transaction.js';
import { SystemdServiceStateSchema } from './config-transaction.js';
import { NativeSystemdTransactionRecordSchema } from './native-systemd-transaction-record.js';
import type { NativeSystemdTransactionPersistence, NativeSystemdTransactionRecord } from './native-systemd-transaction-record.js';

const IdentitySchema = z.strictObject({
  runId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  hostId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const UnitSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(`${JSON.stringify(canonical(value))}\n`).digest('hex');
}
function same(left: { enabled: boolean; running: boolean }, right: { enabled: boolean; running: boolean }): boolean {
  return left.enabled === right.enabled && left.running === right.running;
}
function bounded(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\0\r\n]+/g, ' ').trim().slice(0, 1024) || 'systemd transaction failed';
}

export function createNativeSystemdTransaction(input: {
  identity: unknown;
  unit: string;
  desiredState: unknown;
  adapter: ServiceStateAdapter;
  persistence: NativeSystemdTransactionPersistence;
  now?: () => string;
}) {
  const identity = IdentitySchema.parse(input.identity);
  const unit = UnitSchema.parse(input.unit);
  const desiredState = SystemdServiceStateSchema.parse(input.desiredState);
  if (input.adapter.manager !== 'systemd') throw new Error('native systemd transaction requires a systemd adapter');
  const authority = { ...identity, unit, desiredState };
  const authorityDigest = digest(authority);
  const transactionId = digest({ kind: 'native-systemd', authority });
  const now = input.now ?? (() => new Date().toISOString());
  const observe = async () => SystemdServiceStateSchema.parse(await input.adapter.capture(unit));
  const load = async (): Promise<NativeSystemdTransactionRecord | undefined> => {
    const raw = await input.persistence.load(transactionId);
    if (raw === undefined) return undefined;
    const record = NativeSystemdTransactionRecordSchema.parse(raw);
    if (record.runId !== identity.runId || record.hostId !== identity.hostId || record.planDigest !== identity.planDigest
      || record.authorityDigest !== authorityDigest || record.unit !== unit || !same(record.desiredState, desiredState)) {
      throw new Error('native systemd transaction record differs from approved authority');
    }
    return record;
  };
  const save = async (record: NativeSystemdTransactionRecord, phase: NativeSystemdTransactionRecord['phase'], failure: string | null) => {
    const next = NativeSystemdTransactionRecordSchema.parse({ ...record, phase, failure, updatedAt: now() });
    await input.persistence.save(next);
    return next;
  };

  return Object.freeze({
    transactionId,
    authorityDigest,
    async check(): Promise<{ readonly status: 'verified' | 'needed'; readonly previousState: { readonly enabled: boolean; readonly running: boolean } }> {
      const observed = await observe();
      if (same(observed, desiredState)) return Object.freeze({ status: 'verified', previousState: observed });
      let record = await load();
      if (!record) {
        record = NativeSystemdTransactionRecordSchema.parse({
          schemaVersion: 1, kind: 'desktop-tools-native-systemd-transaction-record', transactionId,
          ...identity, authorityDigest, unit, desiredState, previousState: observed,
          phase: 'prepared', failure: null, createdAt: now(), updatedAt: now(),
        });
        await input.persistence.save(record);
      } else if (!same(observed, record.previousState)) {
        throw new Error('live systemd state changed outside the approved transaction');
      }
      return Object.freeze({ status: 'needed', previousState: record.previousState });
    },
    async apply(): Promise<void> {
      let record = await load();
      const observed = await observe();
      if (record?.phase === 'completed') {
        if (!same(observed, desiredState)) throw new Error('completed systemd transaction has drifted');
        return;
      }
      if (!record) {
        record = NativeSystemdTransactionRecordSchema.parse({
          schemaVersion: 1, kind: 'desktop-tools-native-systemd-transaction-record', transactionId,
          ...identity, authorityDigest, unit, desiredState, previousState: observed,
          phase: 'prepared', failure: null, createdAt: now(), updatedAt: now(),
        });
        await input.persistence.save(record);
      } else if (same(observed, desiredState) && ['prepared', 'applying'].includes(record.phase)) {
        await save(record, 'completed', null);
        return;
      } else if (!same(observed, record.previousState)) {
        await save(record, 'blocked', 'live systemd state differs from both saved and desired state');
        throw new Error('live systemd state changed outside the approved transaction');
      }
      record = await save(record, 'applying', null);
      try {
        await input.adapter.restore(unit, desiredState);
        if (!same(await observe(), desiredState)) throw new Error('systemd desired-state postcondition failed');
        await save(record, 'completed', null);
      } catch (error) {
        const failure = bounded(error);
        try {
          record = await save(record, 'restoring', failure);
          await input.adapter.restore(unit, record.previousState);
          if (!same(await observe(), record.previousState)) throw new Error('systemd restoration postcondition failed');
          await save(record, 'restored', failure);
        } catch (restoreError) {
          await save(record, 'blocked', `${failure}; restoration: ${bounded(restoreError)}`.slice(0, 1024));
        }
        throw error;
      }
    },
    async verify(): Promise<'verified' | 'pending'> {
      const record = await load();
      if (!record || record.phase !== 'completed') return 'pending';
      return same(await observe(), desiredState) ? 'verified' : 'pending';
    },
    async rollback(): Promise<void> {
      let record = await load();
      if (!record) throw new Error('native systemd rollback has no durable pre-state');
      if (record.phase === 'restored') return;
      const observed = await observe();
      if (!same(observed, desiredState)) throw new Error('systemd state changed after activation; refusing rollback');
      record = await save(record, 'restoring', 'explicit rollback');
      await input.adapter.restore(unit, record.previousState);
      if (!same(await observe(), record.previousState)) throw new Error('systemd rollback postcondition failed');
      await save(record, 'restored', 'explicit rollback');
    },
  });
}

export type { NativeSystemdTransactionPersistence, NativeSystemdTransactionRecord } from './native-systemd-transaction-record.js';
