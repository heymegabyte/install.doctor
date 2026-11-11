import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@#+-]{0,255}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprint = z.string().regex(/^SHA256:[A-Za-z0-9+/]{20,86}={0,2}$/);
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const EndpointSchema = z.strictObject({
  hostId: id,
  hostKeyFingerprint: fingerprint,
  pool: id,
  poolGuid: id,
  dataset: id,
  datasetGuid: id,
});

const IdentitySchema = z.strictObject({
  identityId: id,
  principal: id,
  sourceDataset: id,
  destinationDataset: id,
  allowedOperations: z.array(z.enum(['zfs-list', 'zfs-hold', 'zfs-release', 'zfs-send', 'zfs-receive', 'zfs-bookmark'])).min(1).max(6),
  interactiveShell: z.boolean(),
  administrativeAccess: z.boolean(),
  delegatedDatasetOnly: z.boolean(),
});

const SnapshotSchema = z.strictObject({
  name: id,
  guid: id,
  createdTxg: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const BookmarkSchema = z.strictObject({ name: id, guid: id });

export const SyncoidPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  source: EndpointSchema,
  destination: EndpointSchema,
  expectedIdentity: IdentitySchema,
  encryptionMode: z.enum(['raw', 'plain']),
  resumable: z.literal(true),
  preserveBookmarks: z.literal(true),
  preserveHolds: z.literal(true),
  bandwidthLimitBytesPerSecond: z.number().int().positive().max(100_000_000_000),
  retry: z.strictObject({ maxAttempts: z.number().int().min(1).max(10), initialDelaySeconds: z.number().int().min(1).max(3_600), maxDelaySeconds: z.number().int().min(1).max(86_400) }),
  capacity: z.strictObject({ reserveBytes: bytes, admissionRatio: z.number().min(0.5).max(0.95), estimatedTransferBytes: bytes }),
}).superRefine((value, context) => {
  if (value.source.hostId === value.destination.hostId) context.addIssue({ code: 'custom', path: ['destination', 'hostId'], message: 'replication destination must be outside the source host failure domain' });
  if (value.source.dataset === value.destination.dataset && value.source.poolGuid === value.destination.poolGuid) context.addIssue({ code: 'custom', path: ['destination', 'dataset'], message: 'source and destination must be distinct dataset identities' });
  if (value.expectedIdentity.sourceDataset !== value.source.dataset || value.expectedIdentity.destinationDataset !== value.destination.dataset) context.addIssue({ code: 'custom', path: ['expectedIdentity'], message: 'restricted identity must bind the exact source and destination datasets' });
  if (!value.expectedIdentity.allowedOperations.includes('zfs-send') || !value.expectedIdentity.allowedOperations.includes('zfs-receive')) context.addIssue({ code: 'custom', path: ['expectedIdentity', 'allowedOperations'], message: 'restricted identity requires send and receive operations' });
  if (value.expectedIdentity.interactiveShell || value.expectedIdentity.administrativeAccess || !value.expectedIdentity.delegatedDatasetOnly) context.addIssue({ code: 'custom', path: ['expectedIdentity'], message: 'policy identity must deny shell and administration and be delegated only to the dataset pair' });
  if (new Set(value.expectedIdentity.allowedOperations).size !== value.expectedIdentity.allowedOperations.length) context.addIssue({ code: 'custom', path: ['expectedIdentity', 'allowedOperations'], message: 'allowed operations must be unique' });
  if (value.retry.initialDelaySeconds > value.retry.maxDelaySeconds) context.addIssue({ code: 'custom', path: ['retry'], message: 'initial retry delay must not exceed maximum delay' });
});

export const SyncoidObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  observationId: id,
  evidenceDigest: digest,
  readOnly: z.literal(true),
  source: EndpointSchema.extend({ mounted: z.boolean(), encryption: z.enum(['native', 'off']), keyLoaded: z.boolean(), historyMode: z.enum(['raw', 'plain', 'empty']) }),
  destination: EndpointSchema.extend({ mounted: z.boolean(), readOnly: z.boolean(), encryption: z.enum(['native', 'off']), keyLoaded: z.boolean(), historyMode: z.enum(['raw', 'plain', 'empty']), sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), allocatedBytes: bytes }),
  effectiveIdentity: IdentitySchema,
  sourceSnapshots: z.array(SnapshotSchema).max(100_000),
  destinationSnapshots: z.array(SnapshotSchema).max(100_000),
  sourceBookmarks: z.array(BookmarkSchema).max(100_000),
  destinationBookmarks: z.array(BookmarkSchema).max(100_000),
  holds: z.array(z.strictObject({ snapshotGuid: id, tags: z.array(id).min(1).max(100) })).max(100_000),
  resumeToken: z.nullable(z.strictObject({ tokenDigest: digest, sourceDatasetGuid: id, destinationDatasetGuid: id, baseGuid: id, targetGuid: id })),
}).superRefine((value, context) => {
  for (const field of ['sourceSnapshots', 'destinationSnapshots'] as const) {
    const items = value[field];
    if (new Set(items.map(item => item.guid)).size !== items.length) context.addIssue({ code: 'custom', path: [field], message: 'snapshot GUIDs must be unique' });
    if (new Set(items.map(item => item.name)).size !== items.length) context.addIssue({ code: 'custom', path: [field], message: 'snapshot names must be unique' });
  }
  for (const field of ['sourceBookmarks', 'destinationBookmarks'] as const) {
    const items = value[field];
    if (new Set(items.map(item => item.name)).size !== items.length) context.addIssue({ code: 'custom', path: [field], message: 'bookmark names must be unique' });
  }
  const knownGuids = new Set([...value.sourceSnapshots, ...value.destinationSnapshots].map(item => item.guid));
  for (const [index, hold] of value.holds.entries()) if (!knownGuids.has(hold.snapshotGuid)) context.addIssue({ code: 'custom', path: ['holds', index, 'snapshotGuid'], message: 'hold must reference an observed snapshot GUID' });
  if (value.destination.allocatedBytes > value.destination.sizeBytes) context.addIssue({ code: 'custom', path: ['destination', 'allocatedBytes'], message: 'allocated bytes exceed destination size' });
});

const FindingSchema = z.strictObject({
  severity: z.enum(['info', 'warning', 'blocked']),
  code: z.enum(['endpoint-mismatch', 'identity-mismatch', 'identity-overprivileged', 'source-unavailable', 'destination-mounted', 'capacity-blocked', 'encryption-mismatch', 'history-mode-mismatch', 'resume-invalid', 'resume-ready', 'common-anchor', 'common-anchor-missing', 'destination-diverged', 'dependency-preserved']),
  subject: id,
  detail: z.string().min(1).max(1_024),
});

export const SyncoidAdmissionPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  observationId: id,
  planDigest: digest,
  mode: z.literal('read-only'),
  status: z.enum(['ready', 'warning', 'blocked']),
  commonAnchorGuid: id.nullable(),
  findings: z.array(FindingSchema).max(100_000),
  transfer: z.strictObject({
    sourceDataset: id,
    destinationDataset: id,
    identityId: id,
    raw: z.boolean(),
    resumeTokenDigest: digest.nullable(),
    bandwidthLimitBytesPerSecond: z.number().int().positive(),
    retry: z.strictObject({ maxAttempts: z.number().int().min(1).max(10), initialDelaySeconds: z.number().int().positive(), maxDelaySeconds: z.number().int().positive() }),
    destructiveRollback: z.literal(false),
    destructiveTargetDeletion: z.literal(false),
    preserveBookmarks: z.literal(true),
    preserveHolds: z.literal(true),
  }),
});
export type SyncoidAdmissionPlan = z.infer<typeof SyncoidAdmissionPlanSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sameEndpoint(expected: z.infer<typeof EndpointSchema>, observed: z.infer<typeof EndpointSchema>): boolean {
  return Object.entries(expected).every(([key, value]) => observed[key as keyof typeof observed] === value);
}

export function discoverSyncoidState(input: unknown): z.infer<typeof SyncoidObservationSchema> {
  return SyncoidObservationSchema.parse(input);
}

export function planSyncoidAdmission(policyInput: unknown, observationInput: unknown): SyncoidAdmissionPlan {
  const policy = SyncoidPolicySchema.parse(policyInput);
  const observed = discoverSyncoidState(observationInput);
  const findings: z.infer<typeof FindingSchema>[] = [];
  if (!sameEndpoint(policy.source, observed.source)) findings.push({ severity: 'blocked', code: 'endpoint-mismatch', subject: policy.source.dataset, detail: 'source host, host key, pool GUID, dataset, or dataset GUID differs from policy' });
  if (!sameEndpoint(policy.destination, observed.destination)) findings.push({ severity: 'blocked', code: 'endpoint-mismatch', subject: policy.destination.dataset, detail: 'destination host, host key, pool GUID, dataset, or dataset GUID differs from policy' });
  if (canonical(policy.expectedIdentity) !== canonical(observed.effectiveIdentity)) findings.push({ severity: 'blocked', code: 'identity-mismatch', subject: policy.expectedIdentity.identityId, detail: 'effective replication identity does not exactly match the destination-bound policy' });
  if (observed.effectiveIdentity.interactiveShell || observed.effectiveIdentity.administrativeAccess || !observed.effectiveIdentity.delegatedDatasetOnly) findings.push({ severity: 'blocked', code: 'identity-overprivileged', subject: observed.effectiveIdentity.identityId, detail: 'replication identity has shell, administration, or non-dataset authority' });
  if (observed.sourceSnapshots.length === 0 && observed.sourceBookmarks.length === 0) findings.push({ severity: 'blocked', code: 'source-unavailable', subject: observed.source.dataset, detail: 'source has no observed snapshot or bookmark recovery point to replicate' });
  if (observed.destination.mounted || !observed.destination.readOnly) findings.push({ severity: 'blocked', code: 'destination-mounted', subject: observed.destination.dataset, detail: 'replica must remain unmounted and read-only outside replication' });

  const projected = observed.destination.allocatedBytes + policy.capacity.estimatedTransferBytes;
  if (!Number.isSafeInteger(projected) || projected + policy.capacity.reserveBytes > observed.destination.sizeBytes || projected / observed.destination.sizeBytes >= policy.capacity.admissionRatio) findings.push({ severity: 'blocked', code: 'capacity-blocked', subject: observed.destination.dataset, detail: 'estimated transfer breaches destination admission threshold or protected reserve' });
  if (policy.encryptionMode === 'raw') {
    if (observed.source.encryption !== 'native') findings.push({ severity: 'blocked', code: 'encryption-mismatch', subject: observed.source.dataset, detail: 'raw replication requires a natively encrypted source' });
    if (observed.destination.encryption !== 'native') findings.push({ severity: 'blocked', code: 'encryption-mismatch', subject: observed.destination.dataset, detail: 'raw replication destination must preserve native encrypted history' });
    if (observed.destination.keyLoaded) findings.push({ severity: 'warning', code: 'encryption-mismatch', subject: observed.destination.dataset, detail: 'raw replica destination does not require a loaded decryption key' });
    if (observed.source.historyMode === 'plain' || observed.destination.historyMode === 'plain') findings.push({ severity: 'blocked', code: 'history-mode-mismatch', subject: observed.destination.dataset, detail: 'raw and non-raw replication histories must never be mixed' });
  } else if (observed.source.historyMode === 'raw' || observed.destination.historyMode === 'raw') findings.push({ severity: 'blocked', code: 'history-mode-mismatch', subject: observed.destination.dataset, detail: 'plain replication cannot continue a raw encrypted history' });

  const sourceGuids = new Set([...observed.sourceSnapshots, ...observed.sourceBookmarks].map(item => item.guid));
  const destinationGuids = new Set([...observed.destinationSnapshots, ...observed.destinationBookmarks].map(item => item.guid));
  const anchors = [...sourceGuids].filter(guid => destinationGuids.has(guid));
  const sourceOrder = new Map(observed.sourceSnapshots.map(item => [item.guid, item.createdTxg]));
  anchors.sort((left, right) => (sourceOrder.get(right) ?? -1) - (sourceOrder.get(left) ?? -1) || left.localeCompare(right));
  const commonAnchorGuid = anchors[0] ?? null;
  if (commonAnchorGuid) findings.push({ severity: 'info', code: 'common-anchor', subject: commonAnchorGuid, detail: 'latest common snapshot or bookmark anchors incremental replication' });
  else if (observed.destinationSnapshots.length > 0 || observed.destinationBookmarks.length > 0) findings.push({ severity: 'blocked', code: 'common-anchor-missing', subject: observed.destination.dataset, detail: 'populated destination has no common snapshot or bookmark; explicit reseed review is required' });

  if (commonAnchorGuid) {
    const anchorTxg = sourceOrder.get(commonAnchorGuid);
    const destinationOnly = observed.destinationSnapshots.filter(snapshot => !sourceGuids.has(snapshot.guid) && (anchorTxg === undefined || snapshot.createdTxg > anchorTxg));
    if (destinationOnly.length > 0) findings.push({ severity: 'blocked', code: 'destination-diverged', subject: observed.destination.dataset, detail: `${destinationOnly.length} destination-only snapshot(s) follow the common anchor; automatic rollback and deletion are forbidden` });
  }
  for (const hold of observed.holds) findings.push({ severity: 'info', code: 'dependency-preserved', subject: hold.snapshotGuid, detail: `preserve hold tags: ${[...new Set(hold.tags)].sort().join(', ')}` });
  for (const bookmark of observed.destinationBookmarks) findings.push({ severity: 'info', code: 'dependency-preserved', subject: bookmark.name, detail: 'preserve destination bookmark as replication history' });

  let resumeTokenDigest: string | null = null;
  if (observed.resumeToken) {
    const token = observed.resumeToken;
    if (token.sourceDatasetGuid !== policy.source.datasetGuid || token.destinationDatasetGuid !== policy.destination.datasetGuid || !sourceGuids.has(token.baseGuid) || !destinationGuids.has(token.baseGuid) || !sourceGuids.has(token.targetGuid)) findings.push({ severity: 'blocked', code: 'resume-invalid', subject: policy.destination.dataset, detail: 'resume token is not bound to this dataset pair, a common base, and its source target history' });
    else {
      resumeTokenDigest = token.tokenDigest;
      findings.push({ severity: 'info', code: 'resume-ready', subject: policy.destination.dataset, detail: 'validated resumable receive token is preferred over starting another transfer' });
    }
  }

  findings.sort((left, right) => `${left.code}:${left.subject}:${left.detail}`.localeCompare(`${right.code}:${right.subject}:${right.detail}`));
  const status = findings.some(item => item.severity === 'blocked') ? 'blocked' : findings.some(item => item.severity === 'warning') ? 'warning' : 'ready';
  const transfer = { sourceDataset: policy.source.dataset, destinationDataset: policy.destination.dataset, identityId: policy.expectedIdentity.identityId, raw: policy.encryptionMode === 'raw', resumeTokenDigest, bandwidthLimitBytesPerSecond: policy.bandwidthLimitBytesPerSecond, retry: policy.retry, destructiveRollback: false as const, destructiveTargetDeletion: false as const, preserveBookmarks: true as const, preserveHolds: true as const };
  const unsigned = { schemaVersion: 1 as const, policyId: policy.policyId, observationId: observed.observationId, mode: 'read-only' as const, status, commonAnchorGuid, findings, transfer };
  return SyncoidAdmissionPlanSchema.parse({ ...unsigned, planDigest: createHash('sha256').update(canonical({ ...unsigned, evidenceDigest: observed.evidenceDigest })).digest('hex') });
}
