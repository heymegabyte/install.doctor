import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const serviceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/);
const state = z.strictObject({ enabled: z.boolean(), running: z.boolean() });

export const NativeSystemdTransactionRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('desktop-tools-native-systemd-transaction-record'),
  transactionId: digest,
  runId: identifier,
  hostId: identifier,
  planDigest: digest,
  authorityDigest: digest,
  unit: serviceId,
  desiredState: state,
  previousState: state,
  phase: z.enum(['prepared', 'applying', 'completed', 'restoring', 'restored', 'blocked']),
  failure: z.string().min(1).max(1024).refine(value => !/[\0\r\n]/.test(value)).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).superRefine((record, context) => {
  if (record.phase === 'completed' && record.failure !== null) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'completed systemd transaction cannot retain failure evidence' });
  }
  if (record.phase === 'blocked' && record.failure === null) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'blocked systemd transaction requires failure evidence' });
  }
});

export type NativeSystemdTransactionRecord = z.infer<typeof NativeSystemdTransactionRecordSchema>;
export interface NativeSystemdTransactionPersistence {
  readonly load: (transactionId: string) => Promise<unknown | undefined>;
  readonly save: (record: NativeSystemdTransactionRecord) => Promise<void>;
}
