import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,255}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const SourceIdentitySchema = z.strictObject({
  hostId: id,
  sourceId: id,
  canonicalPath: z.string().startsWith('/').max(4_096),
  filesystemId: id,
  mountId: id,
});

const BasePathSchema = z.strictObject({
  pathId: id,
  existing: z.literal(true),
  sourceId: id,
  required: z.boolean(),
});

const PbsPathSchema = BasePathSchema.extend({
  kind: z.literal('pbs'),
  repositoryId: id,
  datastore: id,
  namespace: id,
  clientEncryptionRequired: z.literal(true),
});

const ResticPathSchema = BasePathSchema.extend({
  kind: z.literal('restic'),
  repositoryId: id,
  destinationFailureDomain: id,
  repositoryEncryptionRequired: z.literal(true),
});

const RclonePathSchema = BasePathSchema.extend({
  kind: z.literal('rclone'),
  remoteId: id,
  upstreamPathId: id,
  transportOnly: z.literal(true),
  deleteEnabled: z.literal(false),
});

const DatabaseNativePathSchema = BasePathSchema.extend({
  kind: z.literal('database-native'),
  engine: z.enum(['postgresql', 'mysql', 'mariadb', 'sqlite']),
  consistencyMode: z.enum(['transactional-dump', 'online-backup', 'bounded-quiesce']),
  downstreamPathId: id,
  outputMode: z.enum(['stdout', 'protected-temporary-file']),
  persistentPlaintext: z.literal(false),
});

const BackupPathSchema = z.discriminatedUnion('kind', [PbsPathSchema, ResticPathSchema, RclonePathSchema, DatabaseNativePathSchema]);

export const WorkloadBackupPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  workloadId: id,
  workloadKind: z.enum(['files', 'database', 'vm', 'container']),
  source: SourceIdentitySchema,
  allowEmptySource: z.boolean(),
  paths: z.array(BackupPathSchema).min(1).max(100),
}).superRefine((value, context) => {
  const pathIds = value.paths.map(path => path.pathId);
  if (new Set(pathIds).size !== pathIds.length) context.addIssue({ code: 'custom', path: ['paths'], message: 'backup path ids must be unique' });
  const byId = new Map(value.paths.map(path => [path.pathId, path]));
  for (const [index, path] of value.paths.entries()) {
    if (path.sourceId !== value.source.sourceId) context.addIssue({ code: 'custom', path: ['paths', index, 'sourceId'], message: 'backup path must bind the exact policy source' });
    if (path.kind === 'rclone') {
      const upstream = byId.get(path.upstreamPathId);
      if (!upstream || (upstream.kind !== 'pbs' && upstream.kind !== 'restic')) context.addIssue({ code: 'custom', path: ['paths', index, 'upstreamPathId'], message: 'rclone must transport an existing PBS or restic protection path' });
    }
    if (path.kind === 'database-native') {
      const downstream = byId.get(path.downstreamPathId);
      if (!downstream || (downstream.kind !== 'pbs' && downstream.kind !== 'restic')) context.addIssue({ code: 'custom', path: ['paths', index, 'downstreamPathId'], message: 'database-native output requires an existing encrypted PBS or restic path' });
    }
  }
  if (value.workloadKind === 'database' && !value.paths.some(path => path.kind === 'database-native' && path.required)) context.addIssue({ code: 'custom', path: ['paths'], message: 'database workloads require a native consistency path' });
  if (value.workloadKind !== 'database' && value.paths.some(path => path.kind === 'database-native')) context.addIssue({ code: 'custom', path: ['paths'], message: 'database-native paths are valid only for database workloads' });
  if (value.workloadKind === 'files' && !value.paths.some(path => path.kind === 'restic')) context.addIssue({ code: 'custom', path: ['paths'], message: 'file workloads require a file-level restic protection path' });
  if ((value.workloadKind === 'vm' || value.workloadKind === 'container') && !value.paths.some(path => path.kind === 'pbs')) context.addIssue({ code: 'custom', path: ['paths'], message: 'VM and container workloads require a PBS protection path' });
});

const PathObservationSchema = z.strictObject({
  pathId: id,
  kind: z.enum(['pbs', 'restic', 'rclone', 'database-native']),
  detected: z.boolean(),
  functioning: z.boolean(),
  sourceIdentityDigest: digest,
  encryption: z.enum(['pbs-client', 'restic-repository', 'rclone-crypt', 'encrypted-upstream', 'protected-transient', 'none', 'server-only', 'unknown']),
  lastSuccessAt: timestamp.nullable(),
});

export const WorkloadBackupObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  observationId: id,
  observedAt: timestamp,
  evidenceDigest: digest,
  readOnly: z.literal(true),
  source: SourceIdentitySchema.extend({
    present: z.boolean(),
    mounted: z.boolean(),
    readable: z.boolean(),
    entryCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentBytes: bytes,
    readError: z.string().min(1).max(1_024).nullable(),
  }),
  paths: z.array(PathObservationSchema).max(100),
}).superRefine((value, context) => {
  const ids = value.paths.map(path => path.pathId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['paths'], message: 'observed backup path ids must be unique' });
  if (value.source.readable && value.source.readError !== null) context.addIssue({ code: 'custom', path: ['source', 'readError'], message: 'readable source cannot include a read error' });
  if (!value.source.readable && value.source.readError === null) context.addIssue({ code: 'custom', path: ['source', 'readError'], message: 'unreadable source requires bounded error evidence' });
  for (const [index, path] of value.paths.entries()) if (!path.detected && path.functioning) context.addIssue({ code: 'custom', path: ['paths', index, 'functioning'], message: 'an undetected path cannot be functioning' });
});

const findingCode = z.enum([
  'source-identity-mismatch', 'source-missing', 'source-unmounted', 'source-unreadable', 'source-unexpectedly-empty',
  'path-missing', 'path-kind-mismatch', 'path-source-mismatch', 'path-not-functioning', 'encryption-unverified',
  'existing-protection-preserved', 'database-consistency-admitted', 'transport-only',
]);

export const WorkloadBackupAdmissionPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  workloadId: id,
  observationId: id,
  planDigest: digest,
  mode: z.literal('read-only'),
  status: z.enum(['ready', 'blocked']),
  replaceFunctioningProtection: z.literal(false),
  findings: z.array(z.strictObject({ severity: z.enum(['info', 'blocked']), code: findingCode, subject: id, detail: z.string().min(1).max(1_024) })).max(1_000),
  paths: z.array(z.strictObject({
    pathId: id,
    kind: z.enum(['pbs', 'restic', 'rclone', 'database-native']),
    disposition: z.enum(['preserve-and-use', 'blocked']),
    mutating: z.literal(false),
    successRequiresEvidence: z.literal(true),
  })).min(1).max(100),
});

export type WorkloadBackupAdmissionPlan = z.infer<typeof WorkloadBackupAdmissionPlanSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function workloadBackupSourceIdentityDigest(input: unknown): string {
  return createHash('sha256').update(canonical(SourceIdentitySchema.parse(input))).digest('hex');
}

function identitiesMatch(expected: z.infer<typeof SourceIdentitySchema>, observed: z.infer<typeof SourceIdentitySchema>): boolean {
  return canonical(expected) === canonical(observed);
}

function encryptionAdmitted(path: z.infer<typeof BackupPathSchema>, observed: z.infer<typeof PathObservationSchema>): boolean {
  if (path.kind === 'pbs') return observed.encryption === 'pbs-client';
  if (path.kind === 'restic') return observed.encryption === 'restic-repository';
  if (path.kind === 'rclone') return observed.encryption === 'rclone-crypt' || observed.encryption === 'encrypted-upstream';
  return observed.encryption === 'protected-transient';
}

export function discoverWorkloadBackupState(input: unknown): z.infer<typeof WorkloadBackupObservationSchema> {
  return WorkloadBackupObservationSchema.parse(input);
}

export function planWorkloadBackupAdmission(policyInput: unknown, observationInput: unknown): WorkloadBackupAdmissionPlan {
  const policy = WorkloadBackupPolicySchema.parse(policyInput);
  const observation = discoverWorkloadBackupState(observationInput);
  const findings: z.infer<typeof WorkloadBackupAdmissionPlanSchema>['findings'] = [];
  const observedIdentity = { hostId: observation.source.hostId, sourceId: observation.source.sourceId, canonicalPath: observation.source.canonicalPath, filesystemId: observation.source.filesystemId, mountId: observation.source.mountId };
  if (!identitiesMatch(policy.source, observedIdentity)) findings.push({ severity: 'blocked', code: 'source-identity-mismatch', subject: policy.source.sourceId, detail: 'host, canonical path, filesystem, mount, or source identity differs from policy' });
  if (!observation.source.present) findings.push({ severity: 'blocked', code: 'source-missing', subject: policy.source.sourceId, detail: 'authoritative source is absent' });
  if (!observation.source.mounted) findings.push({ severity: 'blocked', code: 'source-unmounted', subject: policy.source.sourceId, detail: 'expected source mount is not mounted' });
  if (!observation.source.readable) findings.push({ severity: 'blocked', code: 'source-unreadable', subject: policy.source.sourceId, detail: `source read failed: ${observation.source.readError ?? 'missing read-error evidence'}` });
  if (!policy.allowEmptySource && observation.source.entryCount === 0 && observation.source.contentBytes === 0) findings.push({ severity: 'blocked', code: 'source-unexpectedly-empty', subject: policy.source.sourceId, detail: 'empty source is not admitted by policy' });

  const expectedSourceDigest = workloadBackupSourceIdentityDigest(policy.source);
  const observedPaths = new Map(observation.paths.map(path => [path.pathId, path]));
  const paths: z.infer<typeof WorkloadBackupAdmissionPlanSchema>['paths'] = [];
  for (const path of policy.paths) {
    const observed = observedPaths.get(path.pathId);
    const before = findings.length;
    if (!observed?.detected) findings.push({ severity: 'blocked', code: 'path-missing', subject: path.pathId, detail: 'declared existing protection path was not detected; no replacement is selected automatically' });
    else {
      if (observed.kind !== path.kind) findings.push({ severity: 'blocked', code: 'path-kind-mismatch', subject: path.pathId, detail: `expected ${path.kind}, observed ${observed.kind}` });
      if (observed.sourceIdentityDigest !== expectedSourceDigest) findings.push({ severity: 'blocked', code: 'path-source-mismatch', subject: path.pathId, detail: 'protection path evidence is not bound to the exact source identity' });
      if (!observed.functioning) findings.push({ severity: 'blocked', code: 'path-not-functioning', subject: path.pathId, detail: 'existing protection path is not currently functioning; replacement requires separate approval' });
      if (!encryptionAdmitted(path, observed)) findings.push({ severity: 'blocked', code: 'encryption-unverified', subject: path.pathId, detail: `${path.kind} encryption is absent, server-only where client protection is required, or unverified` });
    }
    if (path.kind === 'rclone') findings.push({ severity: 'info', code: 'transport-only', subject: path.pathId, detail: 'rclone transports already encrypted protection and cannot satisfy backup coverage by itself' });
    else if (path.kind === 'database-native') findings.push({ severity: 'info', code: 'database-consistency-admitted', subject: path.pathId, detail: 'database-native consistency output is streamed or staged only in protected transient storage' });
    else findings.push({ severity: 'info', code: 'existing-protection-preserved', subject: path.pathId, detail: 'detected existing protection remains the selected path and is not replaced' });
    const blocked = findings.slice(before).some(finding => finding.severity === 'blocked');
    paths.push({ pathId: path.pathId, kind: path.kind, disposition: blocked ? 'blocked' : 'preserve-and-use', mutating: false, successRequiresEvidence: true });
  }
  findings.sort((left, right) => `${left.code}:${left.subject}:${left.detail}`.localeCompare(`${right.code}:${right.subject}:${right.detail}`));
  paths.sort((left, right) => left.pathId.localeCompare(right.pathId));
  const status = findings.some(finding => finding.severity === 'blocked') ? 'blocked' as const : 'ready' as const;
  const unsigned = { schemaVersion: 1 as const, policyId: policy.policyId, workloadId: policy.workloadId, observationId: observation.observationId, mode: 'read-only' as const, status, replaceFunctioningProtection: false as const, findings, paths };
  return WorkloadBackupAdmissionPlanSchema.parse({ ...unsigned, planDigest: createHash('sha256').update(canonical({ ...unsigned, evidenceDigest: observation.evidenceDigest })).digest('hex') });
}

export const WorkloadBackupRunEvidenceSchema = z.strictObject({
  schemaVersion: VERSION,
  planDigest: digest,
  sourceIdentityDigest: digest,
  paths: z.array(z.strictObject({
    pathId: id,
    exitCode: z.number().int().min(0).max(255),
    sourceReadVerified: z.boolean(),
    encryptionVerified: z.boolean(),
    destinationCommitted: z.boolean(),
    producedBytes: bytes,
  })).max(100),
}).superRefine((value, context) => {
  const pathIds = value.paths.map(path => path.pathId);
  if (new Set(pathIds).size !== pathIds.length) context.addIssue({ code: 'custom', path: ['paths'], message: 'run evidence path ids must be unique' });
});

export function verifyWorkloadBackupRun(planInput: unknown, policyInput: unknown, evidenceInput: unknown): { status: 'verified' | 'failed'; reasons: string[] } {
  const plan = WorkloadBackupAdmissionPlanSchema.parse(planInput);
  const policy = WorkloadBackupPolicySchema.parse(policyInput);
  const evidence = WorkloadBackupRunEvidenceSchema.parse(evidenceInput);
  const reasons: string[] = [];
  if (plan.policyId !== policy.policyId || plan.workloadId !== policy.workloadId) reasons.push('admission plan is not bound to this policy and workload');
  const plannedPathIds = plan.paths.map(path => path.pathId).sort();
  const policyPathIds = policy.paths.map(path => path.pathId).sort();
  if (canonical(plannedPathIds) !== canonical(policyPathIds)) reasons.push('admission plan path closure differs from policy');
  if (plan.status !== 'ready') reasons.push('admission plan was blocked');
  if (evidence.planDigest !== plan.planDigest) reasons.push('run evidence is not bound to the admitted plan');
  if (evidence.sourceIdentityDigest !== workloadBackupSourceIdentityDigest(policy.source)) reasons.push('run evidence is not bound to the exact source identity');
  const outcomes = new Map(evidence.paths.map(path => [path.pathId, path]));
  for (const outcome of evidence.paths) if (!policyPathIds.includes(outcome.pathId)) reasons.push(`run evidence contains undeclared path ${outcome.pathId}`);
  for (const path of policy.paths.filter(candidate => candidate.required)) {
    const outcome = outcomes.get(path.pathId);
    if (!outcome) { reasons.push(`required path ${path.pathId} has no run evidence`); continue; }
    if (outcome.exitCode !== 0) reasons.push(`required path ${path.pathId} exited nonzero`);
    if (!outcome.sourceReadVerified) reasons.push(`required path ${path.pathId} did not verify source reads`);
    if (!outcome.encryptionVerified) reasons.push(`required path ${path.pathId} did not verify encryption`);
    if (!outcome.destinationCommitted) reasons.push(`required path ${path.pathId} did not verify destination commit`);
    if (!policy.allowEmptySource && outcome.producedBytes === 0) reasons.push(`required path ${path.pathId} produced no protected data`);
  }
  return { status: reasons.length === 0 ? 'verified' : 'failed', reasons: [...new Set(reasons)].sort() };
}
