import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,255}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const owner = z.enum(['sanoid', 'proxmox-autosnap', 'manual', 'external']);
const operation = z.enum(['snapshot', 'prune', 'scrub']);

const ScheduleSchema = z.strictObject({
  scheduleId: id,
  operation,
  owner,
  intervalMinutes: z.number().int().min(15).max(525_600),
  offsetMinute: z.number().int().nonnegative().max(525_599),
  durationMinutes: z.number().int().positive().max(10_080),
}).superRefine((value, context) => {
  if (value.offsetMinute >= value.intervalMinutes) {
    context.addIssue({ code: 'custom', path: ['offsetMinute'], message: 'offset must be smaller than interval' });
  }
  if (value.durationMinutes >= value.intervalMinutes) {
    context.addIssue({ code: 'custom', path: ['durationMinutes'], message: 'duration must be smaller than interval' });
  }
});

const DependencySchema = z.strictObject({
  snapshot: id,
  kinds: z.array(z.enum(['hold', 'clone', 'resume-token', 'replication-anchor', 'bookmark'])).min(1).max(5),
});

export const ZfsProtectionPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  pool: id,
  datasets: z.array(z.strictObject({
    dataset: id,
    snapshotOwner: z.enum(['sanoid', 'proxmox-autosnap', 'manual']),
    managed: z.boolean(),
    retention: z.strictObject({ hourly: z.number().int().nonnegative().max(168), daily: z.number().int().nonnegative().max(366), monthly: z.number().int().nonnegative().max(120) }),
  })).min(1).max(10_000),
  schedules: z.array(ScheduleSchema).min(1).max(1_000),
  exclusions: z.array(z.strictObject({
    kind: z.enum(['dataset', 'file-backup']),
    pattern: z.string().min(1).max(512),
    reason: z.string().min(1).max(512),
  })).max(10_000),
  capacity: z.strictObject({
    warningRatio: z.number().min(0.5).max(0.9),
    admissionRatio: z.number().min(0.6).max(0.95),
    reserveBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    projectedSnapshotBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
}).superRefine((value, context) => {
  const datasets = value.datasets.map(item => item.dataset);
  if (new Set(datasets).size !== datasets.length) context.addIssue({ code: 'custom', path: ['datasets'], message: 'datasets must be unique' });
  const schedules = value.schedules.map(item => item.scheduleId);
  if (new Set(schedules).size !== schedules.length) context.addIssue({ code: 'custom', path: ['schedules'], message: 'schedule ids must be unique' });
  for (const [index, schedule] of value.schedules.entries()) {
    if (schedule.operation === 'scrub' && schedule.owner !== 'external') context.addIssue({ code: 'custom', path: ['schedules', index, 'owner'], message: 'scrub scheduling requires the external system scheduler owner' });
    if (schedule.operation !== 'scrub' && schedule.owner !== 'sanoid' && schedule.owner !== 'proxmox-autosnap') context.addIssue({ code: 'custom', path: ['schedules', index, 'owner'], message: 'snapshot and prune schedules require a policy automation owner' });
  }
  if (value.capacity.warningRatio >= value.capacity.admissionRatio) {
    context.addIssue({ code: 'custom', path: ['capacity', 'warningRatio'], message: 'warning threshold must precede admission threshold' });
  }
  for (const [index, exclusion] of value.exclusions.entries()) {
    if (exclusion.kind === 'dataset' && /[*?\[]/.test(exclusion.pattern)) {
      context.addIssue({ code: 'custom', path: ['exclusions', index, 'pattern'], message: 'ZFS snapshot exclusions require exact dataset boundaries, not file globs' });
    }
  }
  for (const [index, dataset] of value.datasets.entries()) {
    if (dataset.managed && dataset.snapshotOwner === 'manual') {
      context.addIssue({ code: 'custom', path: ['datasets', index, 'snapshotOwner'], message: 'managed datasets require an automated owner' });
    }
  }
});

export const ZfsProtectionObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  observationId: id,
  observedAt: timestamp,
  evidenceDigest: digest,
  readOnly: z.literal(true),
  disposable: z.boolean(),
  pool: z.strictObject({ name: id, guid: id, sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), allocatedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), health: z.enum(['ONLINE', 'DEGRADED', 'FAULTED', 'UNAVAIL', 'UNKNOWN']) }),
  datasets: z.array(z.strictObject({ name: id, mounted: z.boolean(), encryption: z.enum(['native', 'inherited', 'off', 'unknown']) })).max(10_000),
  schedules: z.array(ScheduleSchema).max(1_000),
  snapshots: z.array(z.strictObject({ name: id, owner, createdAt: timestamp, dependencies: z.array(DependencySchema).max(5) })).max(100_000),
}).superRefine((value, context) => {
  if (value.pool.allocatedBytes > value.pool.sizeBytes) context.addIssue({ code: 'custom', path: ['pool', 'allocatedBytes'], message: 'allocated bytes exceed pool size' });
  const datasets = value.datasets.map(item => item.name);
  if (new Set(datasets).size !== datasets.length) context.addIssue({ code: 'custom', path: ['datasets'], message: 'observed datasets must be unique' });
  const snapshots = value.snapshots.map(item => item.name);
  if (new Set(snapshots).size !== snapshots.length) context.addIssue({ code: 'custom', path: ['snapshots'], message: 'observed snapshots must be unique' });
  for (const [snapshotIndex, snapshot] of value.snapshots.entries()) for (const [dependencyIndex, dependency] of snapshot.dependencies.entries()) {
    if (dependency.snapshot !== snapshot.name) context.addIssue({ code: 'custom', path: ['snapshots', snapshotIndex, 'dependencies', dependencyIndex, 'snapshot'], message: 'dependency must identify its containing snapshot' });
    if (new Set(dependency.kinds).size !== dependency.kinds.length) context.addIssue({ code: 'custom', path: ['snapshots', snapshotIndex, 'dependencies', dependencyIndex, 'kinds'], message: 'dependency kinds must be unique' });
  }
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function overlaps(left: z.infer<typeof ScheduleSchema>, right: z.infer<typeof ScheduleSchema>): boolean {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const period = gcd(left.intervalMinutes, right.intervalMinutes);
  const modulo = (value: number): number => ((value % period) + period) % period;
  return modulo(right.offsetMinute - left.offsetMinute) < left.durationMinutes
    || modulo(left.offsetMinute - right.offsetMinute) < right.durationMinutes;
}

export const ZfsProtectionPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  observationId: id,
  planDigest: digest,
  mode: z.literal('read-only'),
  disposable: z.boolean(),
  status: z.enum(['ready', 'warning', 'blocked']),
  findings: z.array(z.strictObject({ severity: z.enum(['info', 'warning', 'blocked']), code: z.enum(['pool-unhealthy', 'dataset-missing', 'ownership-conflict', 'schedule-collision', 'retention-dependency', 'capacity-warning', 'capacity-blocked', 'exclusion-applied']), subject: id, detail: z.string().min(1).max(1_024) })).max(100_000),
  operations: z.array(z.strictObject({ kind: z.enum(['configure-sanoid', 'configure-autosnap', 'schedule-scrub', 'preserve-snapshot', 'exclude-dataset']), subject: id, owner: owner.optional(), mutating: z.literal(false), rationale: z.string().min(1).max(1_024) })).max(100_000),
  projected: z.strictObject({ allocatedBytes: z.number().int().nonnegative(), projectedSnapshotBytes: z.number().int().nonnegative(), reserveBytes: z.number().int().nonnegative(), utilizationRatio: z.number().nonnegative(), headroomBytes: z.number().int() }),
});
export type ZfsProtectionPlan = z.infer<typeof ZfsProtectionPlanSchema>;

export function discoverZfsProtection(input: unknown): z.infer<typeof ZfsProtectionObservationSchema> {
  return ZfsProtectionObservationSchema.parse(input);
}

export function planZfsProtection(policyInput: unknown, observationInput: unknown): ZfsProtectionPlan {
  const policy = ZfsProtectionPolicySchema.parse(policyInput);
  const observed = discoverZfsProtection(observationInput);
  if (policy.pool !== observed.pool.name) throw new Error(`policy pool ${policy.pool} does not match observed pool ${observed.pool.name}`);
  const findings: z.infer<typeof ZfsProtectionPlanSchema>['findings'] = [];
  const operations: z.infer<typeof ZfsProtectionPlanSchema>['operations'] = [];
  if (observed.pool.health !== 'ONLINE') findings.push({ severity: 'blocked', code: 'pool-unhealthy', subject: observed.pool.name, detail: `pool health is ${observed.pool.health}; policy changes are not admissible` });
  const observedDatasets = new Set(observed.datasets.map(item => item.name));
  const excluded = new Set(policy.exclusions.filter(item => item.kind === 'dataset').map(item => item.pattern));
  for (const exclusion of excluded) {
    findings.push({ severity: 'info', code: 'exclusion-applied', subject: exclusion, detail: 'exact dataset boundary is excluded by documented policy' });
    operations.push({ kind: 'exclude-dataset', subject: exclusion, mutating: false, rationale: 'report exclusion without relocating or mutating data' });
  }
  for (const dataset of policy.datasets) {
    if (excluded.has(dataset.dataset)) continue;
    if (!observedDatasets.has(dataset.dataset)) findings.push({ severity: 'blocked', code: 'dataset-missing', subject: dataset.dataset, detail: 'desired dataset was absent from read-only discovery' });
    if (dataset.managed) operations.push({ kind: dataset.snapshotOwner === 'sanoid' ? 'configure-sanoid' : 'configure-autosnap', subject: dataset.dataset, owner: dataset.snapshotOwner, mutating: false, rationale: 'describe the single policy owner; application requires a separately approved mutation' });
    const observedOwners = new Set(observed.snapshots.filter(snapshot => snapshot.name.startsWith(`${dataset.dataset}@`)).map(snapshot => snapshot.owner).filter(candidate => candidate === 'sanoid' || candidate === 'proxmox-autosnap'));
    if (dataset.managed && [...observedOwners].some(candidate => candidate !== dataset.snapshotOwner)) findings.push({ severity: 'blocked', code: 'ownership-conflict', subject: dataset.dataset, detail: `observed competing snapshot ownership: ${[...observedOwners].sort().join(', ')}` });
  }
  for (const desired of policy.schedules) {
    operations.push({ kind: desired.operation === 'scrub' ? 'schedule-scrub' : desired.owner === 'sanoid' ? 'configure-sanoid' : 'configure-autosnap', subject: desired.scheduleId, owner: desired.owner, mutating: false, rationale: 'render schedule intent without installing or invoking it' });
    for (const existing of observed.schedules) {
      const sameIdentityMismatch = existing.scheduleId === desired.scheduleId && canonical(existing) !== canonical(desired);
      if (sameIdentityMismatch || (existing.scheduleId !== desired.scheduleId && overlaps(desired, existing))) findings.push({ severity: 'blocked', code: 'schedule-collision', subject: desired.scheduleId, detail: `${sameIdentityMismatch ? 'conflicts with' : 'overlaps'} observed ${existing.operation} schedule ${existing.scheduleId} owned by ${existing.owner}` });
    }
  }
  for (let index = 0; index < policy.schedules.length; index += 1) for (let candidate = index + 1; candidate < policy.schedules.length; candidate += 1) {
    const left = policy.schedules[index]!;
    const right = policy.schedules[candidate]!;
    if (overlaps(left, right)) findings.push({ severity: 'blocked', code: 'schedule-collision', subject: left.scheduleId, detail: `desired schedule overlaps ${right.scheduleId}; one scheduler per operation window is required` });
  }
  for (const snapshot of observed.snapshots) for (const dependency of snapshot.dependencies) {
    findings.push({ severity: 'info', code: 'retention-dependency', subject: snapshot.name, detail: `preserve because of ${[...new Set(dependency.kinds)].sort().join(', ')}` });
    operations.push({ kind: 'preserve-snapshot', subject: snapshot.name, owner: snapshot.owner, mutating: false, rationale: `retention dependency: ${[...new Set(dependency.kinds)].sort().join(', ')}` });
  }
  const projectedUsed = observed.pool.allocatedBytes + policy.capacity.projectedSnapshotBytes;
  if (!Number.isSafeInteger(projectedUsed)) throw new Error('projected pool allocation overflow');
  const utilizationRatio = projectedUsed / observed.pool.sizeBytes;
  const headroomBytes = observed.pool.sizeBytes - projectedUsed - policy.capacity.reserveBytes;
  if (utilizationRatio >= policy.capacity.admissionRatio || headroomBytes < 0) findings.push({ severity: 'blocked', code: 'capacity-blocked', subject: observed.pool.name, detail: 'projected snapshots breach admission threshold or protected reserve' });
  else if (utilizationRatio >= policy.capacity.warningRatio) findings.push({ severity: 'warning', code: 'capacity-warning', subject: observed.pool.name, detail: 'projected snapshots breach warning threshold' });
  findings.sort((a, b) => `${a.code}:${a.subject}:${a.detail}`.localeCompare(`${b.code}:${b.subject}:${b.detail}`));
  operations.sort((a, b) => `${a.kind}:${a.subject}:${a.rationale}`.localeCompare(`${b.kind}:${b.subject}:${b.rationale}`));
  const status = findings.some(item => item.severity === 'blocked') ? 'blocked' : findings.some(item => item.severity === 'warning') ? 'warning' : 'ready';
  const unsigned = { schemaVersion: 1 as const, policyId: policy.policyId, observationId: observed.observationId, mode: 'read-only' as const, disposable: observed.disposable, status, findings, operations, projected: { allocatedBytes: observed.pool.allocatedBytes, projectedSnapshotBytes: policy.capacity.projectedSnapshotBytes, reserveBytes: policy.capacity.reserveBytes, utilizationRatio, headroomBytes } };
  return ZfsProtectionPlanSchema.parse({ ...unsigned, planDigest: createHash('sha256').update(canonical({ ...unsigned, evidenceDigest: observed.evidenceDigest })).digest('hex') });
}

export function statusZfsProtection(planInput: unknown): Pick<ZfsProtectionPlan, 'policyId' | 'observationId' | 'planDigest' | 'mode' | 'disposable' | 'status' | 'findings'> {
  const plan = ZfsProtectionPlanSchema.parse(planInput);
  return { policyId: plan.policyId, observationId: plan.observationId, planDigest: plan.planDigest, mode: plan.mode, disposable: plan.disposable, status: plan.status, findings: plan.findings };
}
