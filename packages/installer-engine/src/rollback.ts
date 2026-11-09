import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CompensationRecordSchema } from '@install-doctor/aid-core/installer-contracts';
import { ConfigurationSnapshotSchema, LaunchdServiceStateSchema, ServiceStateSnapshotSchema, SystemdServiceStateSchema, configurationCompensationArtifactDigest } from './config-transaction.js';

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

const PersistedCompensationInputSchema = z.strictObject({
  schemaVersion: VERSION,
  record: CompensationRecordSchema,
  snapshot: ConfigurationSnapshotSchema,
  bytesBase64: z.string().max(11_184_812).nullable(),
  dependencies: z.array(identifier).max(512),
  serviceSnapshot: ServiceStateSnapshotSchema.nullable().default(null),
  appliedDigest: digest.nullable().default(null),
});

export const RollbackTaskSchema = z.strictObject({
  schemaVersion: VERSION,
  taskId: identifier,
  artifactDigest: digest,
  targetPath: z.string().min(1).max(4096),
  dependencies: z.array(identifier).max(512),
  restores: z.array(z.enum(['bytes', 'mode', 'ownership', 'service-state'])).min(1).max(4),
  effect: z.literal('installer-configuration'),
  service: z.strictObject({ serviceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/), manager: z.enum(['systemd', 'launchd', 'windows-scm']) }).nullable(),
  expectedCurrentDigest: digest.nullable(),
});
export type RollbackTask = z.infer<typeof RollbackTaskSchema>;

export const RollbackPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  digest,
  sourceRunId: identifier,
  sourcePlanDigest: digest,
  createdAt: timestamp,
  tasks: z.array(RollbackTaskSchema).max(10_000),
  taskOrder: z.array(identifier).max(10_000),
});
export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;

const rollbackEventBase = {
  schemaVersion: VERSION,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  at: timestamp,
  rollbackRunId: identifier,
  planDigest: digest,
};
export const RollbackEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-run-started') }),
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-plan-approved') }),
  z.strictObject({
    ...rollbackEventBase,
    kind: z.literal('rollback-run-blocked'),
    reason: z.literal('safe-executor-not-configured'),
  }),
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-task-started'), taskId: identifier,
    target: z.strictObject({ existed: z.boolean(), digest: digest.nullable(), mode: z.number().int().nonnegative().nullable(),
      uid: z.number().int().nonnegative().nullable(), gid: z.number().int().nonnegative().nullable(),
      type: z.enum(['regular', 'directory', 'absent']), links: z.number().int().positive().nullable(),
      service: z.union([SystemdServiceStateSchema, LaunchdServiceStateSchema]).nullable().default(null) }) }),
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-task-restored'), taskId: identifier }),
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-task-failed'), taskId: identifier, detail: z.string().min(1).max(1024) }),
  z.strictObject({ ...rollbackEventBase, kind: z.literal('rollback-run-finished'), status: z.enum(['succeeded', 'failed']) }),
]);
export type RollbackEvent = z.infer<typeof RollbackEventSchema>;
type RollbackEventBody<T = RollbackEvent> = T extends RollbackEvent
  ? Omit<T, 'schemaVersion' | 'sequence' | 'at' | 'rollbackRunId' | 'planDigest'>
  : never;

const rollbackReceiptBase = {
  schemaVersion: VERSION,
  rollbackRunId: identifier,
  planDigest: digest,
  sourceRunId: identifier,
  startedAt: timestamp,
  finishedAt: timestamp,
  nextAction: z.string().min(1).max(1024),
};
export const RollbackRunReceiptSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...rollbackReceiptBase, status: z.literal('approved-not-executed'), completed: z.literal(false) }),
  z.strictObject({ ...rollbackReceiptBase, status: z.literal('succeeded'), completed: z.literal(true) }),
  z.strictObject({ ...rollbackReceiptBase, status: z.literal('failed'), completed: z.literal(false) }),
]);
export type RollbackRunReceipt = z.infer<typeof RollbackRunReceiptSchema>;

const RollbackPlanInputSchema = z.strictObject({
  sourceRunId: identifier,
  sourcePlanDigest: digest,
  compensations: z.array(PersistedCompensationInputSchema).max(10_000),
});
const RollbackRunRequestSchema = z.strictObject({
  rollbackRunId: identifier,
  plan: RollbackPlanSchema,
  approvedPlanDigest: digest.nullable(),
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function reverseDependencyOrder(tasks: readonly RollbackTask[]): string[] {
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  if (byId.size !== tasks.length) throw new Error('rollback plan contains duplicate task identifiers');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const dependencyFirst: string[] = [];
  const visit = (task: RollbackTask): void => {
    if (visited.has(task.taskId)) return;
    if (visiting.has(task.taskId)) throw new Error(`rollback dependency cycle includes: ${task.taskId}`);
    visiting.add(task.taskId);
    for (const dependencyId of task.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(task.taskId);
    visited.add(task.taskId);
    dependencyFirst.push(task.taskId);
  };
  for (const task of [...tasks].sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0)) visit(task);
  return dependencyFirst.reverse();
}

function assertRollbackPlanIntegrity(plan: RollbackPlan): void {
  const tasks = [...plan.tasks].sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
  const taskOrder = reverseDependencyOrder(tasks);
  const semantic = {
    schemaVersion: 1 as const,
    sourceRunId: plan.sourceRunId,
    sourcePlanDigest: plan.sourcePlanDigest,
    tasks,
    taskOrder,
  };
  const expectedDigest = sha256(semantic);
  if (plan.digest !== expectedDigest
    || plan.planId !== `rollback-${expectedDigest.slice(0, 24)}`
    || JSON.stringify(plan.tasks) !== JSON.stringify(tasks)
    || JSON.stringify(plan.taskOrder) !== JSON.stringify(taskOrder)) {
    throw new Error('rollback plan integrity check failed');
  }
}

export async function createRollbackPlan(
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): Promise<RollbackPlan> {
  const parsed = RollbackPlanInputSchema.parse(input);
  const known = new Set(parsed.compensations.map(artifact => artifact.record.taskId));
  if (known.size !== parsed.compensations.length) throw new Error('rollback plan contains duplicate compensation records');
  const tasks = parsed.compensations.map(artifact => {
    if (artifact.record.state !== 'available') throw new Error(`rollback compensation is not available: ${artifact.record.taskId}`);
    const bytes = artifact.bytesBase64 === null ? null : Buffer.from(artifact.bytesBase64, 'base64');
    const snapshotIntegrity = 'kind' in artifact.snapshot && artifact.snapshot.kind === 'directory'
      ? bytes === null && artifact.serviceSnapshot === null
      : 'kind' in artifact.snapshot && artifact.snapshot.kind === 'service'
        ? bytes === null && artifact.serviceSnapshot?.manager === 'systemd'
          && artifact.snapshot.targetPath === `systemd:${artifact.serviceSnapshot.serviceId}`
      : artifact.snapshot.existed === (bytes !== null)
        && artifact.snapshot.digest === (bytes === null ? null : createHash('sha256').update(bytes).digest('hex'));
    if (!snapshotIntegrity
      || artifact.record.restores.includes('service-state') !== (artifact.serviceSnapshot !== null)
      || artifact.record.artifactDigest !== configurationCompensationArtifactDigest(artifact.snapshot, bytes, artifact.serviceSnapshot)) {
      throw new Error(`rollback compensation integrity mismatch: ${artifact.record.taskId}`);
    }
    return RollbackTaskSchema.parse({
      schemaVersion: 1,
      taskId: artifact.record.taskId,
      artifactDigest: artifact.record.artifactDigest,
      targetPath: artifact.snapshot.targetPath,
      dependencies: [...new Set(artifact.dependencies.filter(dependency => known.has(dependency)))]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
      restores: [...new Set(artifact.record.restores)]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
      effect: 'installer-configuration',
      service: artifact.serviceSnapshot === null ? null : { serviceId: artifact.serviceSnapshot.serviceId, manager: artifact.serviceSnapshot.manager },
      expectedCurrentDigest: artifact.appliedDigest,
    });
  }).sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
  const taskOrder = reverseDependencyOrder(tasks);
  const semantic = {
    schemaVersion: 1 as const,
    sourceRunId: parsed.sourceRunId,
    sourcePlanDigest: parsed.sourcePlanDigest,
    tasks,
    taskOrder,
  };
  const planDigest = sha256(semantic);
  return RollbackPlanSchema.parse({
    ...semantic,
    planId: `rollback-${planDigest.slice(0, 24)}`,
    digest: planDigest,
    createdAt: now(),
  });
}

export async function prepareRollbackRun(
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): Promise<{ readonly plan: RollbackPlan; readonly events: readonly RollbackEvent[]; readonly receipt: RollbackRunReceipt }> {
  const request = RollbackRunRequestSchema.parse(input);
  assertRollbackPlanIntegrity(request.plan);
  if (request.approvedPlanDigest !== request.plan.digest) {
    throw new Error('rollback requires approval of the exact rollback plan digest');
  }
  const events: RollbackEvent[] = [];
  const emit = (body: RollbackEventBody): void => {
    events.push(RollbackEventSchema.parse({
      schemaVersion: 1,
      sequence: events.length,
      at: now(),
      rollbackRunId: request.rollbackRunId,
      planDigest: request.plan.digest,
      ...body,
    }));
  };
  const startedAt = now();
  emit({ kind: 'rollback-run-started' });
  emit({ kind: 'rollback-plan-approved' });
  emit({ kind: 'rollback-run-blocked', reason: 'safe-executor-not-configured' });
  const receipt = RollbackRunReceiptSchema.parse({
    schemaVersion: 1,
    rollbackRunId: request.rollbackRunId,
    planDigest: request.plan.digest,
    sourceRunId: request.plan.sourceRunId,
    status: 'approved-not-executed',
    completed: false,
    startedAt,
    finishedAt: now(),
    nextAction: 'Configure the fenced rollback executor and re-approve this exact plan before any restoration.',
  });
  return Object.freeze({ plan: request.plan, events: Object.freeze(events), receipt });
}
