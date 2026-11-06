import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const nullableId = z.number().int().nonnegative().nullable();
const nullableMode = z.number().int().min(0).max(0o7777).nullable();
const nullableInode = z.number().int().nonnegative().nullable();
const policySnapshot = z.strictObject({
  schemaVersion: z.literal(1), existed: z.boolean(), bytesBase64: z.string().max(87_386).nullable(),
  uid: nullableId, gid: nullableId, mode: nullableMode, device: nullableInode, inode: nullableInode,
}).superRefine((snapshot, context) => {
  const fields = [snapshot.bytesBase64, snapshot.uid, snapshot.gid, snapshot.mode, snapshot.device, snapshot.inode];
  if (snapshot.existed && fields.some(value => value === null)) context.addIssue({ code: 'custom', message: 'existing policy snapshot is incomplete' });
  if (!snapshot.existed && fields.some(value => value !== null)) context.addIssue({ code: 'custom', message: 'absent policy snapshot claims metadata' });
  if (snapshot.bytesBase64 !== null) {
    const decoded = Buffer.from(snapshot.bytesBase64, 'base64');
    if (decoded.length > 65_536 || decoded.toString('base64') !== snapshot.bytesBase64) context.addIssue({ code: 'custom', message: 'policy snapshot bytes are not canonical bounded base64' });
  }
});
const policyRecord = z.strictObject({
  schemaVersion: z.literal(1), phase: z.enum(['prepared', 'active', 'restored']),
  target: z.string().min(1).refine(value => value.endsWith('/usr/sbin/policy-rc.d'), 'policy target is not recognized'), snapshot: policySnapshot,
  helperDigest: digest,
  preparedAt: timestamp,
}).superRefine((value, context) => {
  if (value.helperDigest !== 'c2bcd9decf63ff2c0d9f473f38bc3607900530aad80f99139855d56678456230') {
    context.addIssue({ code: 'custom', path: ['helperDigest'], message: 'policy helper digest is not recognized' });
  }
});
const systemdServiceSnapshot = z.strictObject({
  schemaVersion: z.literal(1), serviceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
  manager: z.literal('systemd'), enabled: z.boolean(), running: z.boolean(),
});
const packagePhase = z.enum(['pending', 'unpacked', 'configured']);
const transactionPhase = z.enum([
  'prepared', 'services-captured', 'policy-prepared', 'policy-active',
  'unpacking', 'unpacked', 'configuring', 'configured',
  'restoring-services', 'services-restored', 'restoring-policy', 'completed', 'blocked',
]);

const PackageProgressSchema = z.strictObject({
  packageKey: identifier,
  packageName: z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,127}$/),
  version: z.string().min(1).max(256).refine(value => !/[\0\r\n]/.test(value)),
  architecture: z.enum(['amd64', 'arm64', 'all']),
  phase: packagePhase,
});
const FailureSchema = z.strictObject({
  code: z.enum(['cancelled', 'dpkg-failed', 'state-conflict', 'cleanup-failed', 'runtime-failed']),
  message: z.string().min(1).max(1024).refine(value => !/[\0\r\n]/.test(value)),
});

/** Durable write-ahead evidence for exactly one signed native package closure. */
export const NativeDpkgTransactionRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('install-doctor-native-dpkg-transaction-record'),
  transactionId: digest,
  runId: identifier,
  hostId: identifier,
  planDigest: digest,
  rootPackageKey: identifier,
  authorityDigest: digest,
  phase: transactionPhase,
  packages: z.array(PackageProgressSchema).min(1).max(4096),
  serviceSnapshots: z.array(systemdServiceSnapshot).max(512),
  policyRecord: policyRecord.nullable(),
  activePackageKey: identifier.nullable(),
  failure: FailureSchema.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).superRefine((record, context) => {
  const packageKeys = record.packages.map(value => value.packageKey);
  if (new Set(packageKeys).size !== packageKeys.length) context.addIssue({ code: 'custom', path: ['packages'], message: 'package progress contains duplicates' });
  const services = record.serviceSnapshots.map(value => `${value.manager}\0${value.serviceId}`);
  if (new Set(services).size !== services.length) context.addIssue({ code: 'custom', path: ['serviceSnapshots'], message: 'service snapshots contain duplicates' });
  if (record.activePackageKey !== null && !packageKeys.includes(record.activePackageKey)) {
    context.addIssue({ code: 'custom', path: ['activePackageKey'], message: 'active package is outside the signed closure' });
  }
  if (record.phase === 'completed' && (record.failure !== null || record.activePackageKey !== null)) {
    context.addIssue({ code: 'custom', message: 'a completed transaction cannot retain failure or active-package state' });
  }
  if (record.phase === 'blocked' && record.failure === null) context.addIssue({ code: 'custom', path: ['failure'], message: 'a blocked transaction requires failure evidence' });
});
export type NativeDpkgTransactionRecord = z.infer<typeof NativeDpkgTransactionRecordSchema>;

/** Owner-bound persistence. Implementations must fence load/save with the current journal claim. */
export interface NativeDpkgTransactionPersistence {
  readonly load: (transactionId: string) => Promise<unknown | undefined>;
  readonly save: (record: NativeDpkgTransactionRecord) => Promise<void>;
}
