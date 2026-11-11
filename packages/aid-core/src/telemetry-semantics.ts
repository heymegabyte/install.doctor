import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const strict = z.strictObject;
const outcome = z.enum(['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled', 'unknown']);
const base = { schemaVersion: z.literal(1), observedAt: timestamp, severity: z.enum(['debug', 'info', 'warn', 'error']) };
const run = { 'desktop_tools.run.id': id };
const task = { ...run, 'desktop_tools.task.id': id };
const boundedIds = z.array(id).max(64).refine(values => new Set(values).size === values.length, 'identifiers must be unique');

/** OTel resource attributes are a fixed bounded set; high-cardinality IDs remain event fields. */
export const DesktopToolsTelemetryResourceSchema = strict({
  'service.name': z.enum(['desktop-tools', 'desktop-tools-installer', 'desktop-tools-agent', 'desktop-tools-backup']),
  'service.version': z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
  'deployment.environment.name': z.enum(['development', 'production', 'recovery', 'test']),
  'host.id': id, 'host.arch': z.enum(['x86_64', 'arm64']), 'os.type': z.enum(['linux', 'darwin', 'windows']),
});

export const DesktopToolsSemanticEventSchema = z.discriminatedUnion('name', [
  strict({ ...base, name: z.literal('desktop_tools.host.observed'), attributes: strict({ 'host.facts.digest': digest, 'host.capability.count': z.number().int().min(0).max(4096), 'desktop_tools.status': outcome }) }),
  strict({ ...base, name: z.literal('desktop_tools.profile.resolved'), attributes: strict({ 'desktop_tools.profile.id': id, 'desktop_tools.profile.revision': id, 'desktop_tools.profile.digest': digest, 'desktop_tools.status': outcome }) }),
  strict({ ...base, name: z.literal('desktop_tools.release.evaluated'), attributes: strict({ 'desktop_tools.release.id': id, 'desktop_tools.release.manifest.digest': digest, 'desktop_tools.release.channel': id, 'desktop_tools.release.decision': z.enum(['admitted', 'rejected', 'revoked', 'expired']) }) }),
  strict({ ...base, name: z.literal('desktop_tools.run.state'), attributes: strict({ ...run, 'desktop_tools.run.plan.digest': digest, 'desktop_tools.status': outcome }) }),
  strict({ ...base, name: z.literal('desktop_tools.agent.state'), attributes: strict({ ...run, 'desktop_tools.agent.id': id, 'desktop_tools.agent.role': id, 'desktop_tools.agent.parent.id': id.nullable(), 'desktop_tools.status': outcome }) }),
  strict({ ...base, name: z.literal('desktop_tools.task.state'), attributes: strict({ ...task, 'desktop_tools.task.attempt': z.number().int().min(0).max(100), 'desktop_tools.status': outcome }) }),
  strict({ ...base, name: z.literal('desktop_tools.lock.state'), attributes: strict({ ...task, 'desktop_tools.lock.domain': id, 'desktop_tools.lock.state': z.enum(['waiting', 'acquired', 'released', 'lost']) }) }),
  strict({ ...base, name: z.literal('desktop_tools.approval.state'), attributes: strict({ ...run, 'desktop_tools.approval.id': id, 'desktop_tools.approval.scope.digest': digest, 'desktop_tools.approval.state': z.enum(['requested', 'approved', 'denied', 'expired', 'consumed']) }) }),
  strict({ ...base, name: z.literal('desktop_tools.effect.state'), attributes: strict({ ...task, 'desktop_tools.effect.id': id, 'desktop_tools.effect.class': z.enum(['configuration', 'package', 'service', 'network', 'storage', 'external']), 'desktop_tools.status': outcome, 'desktop_tools.effect.evidence.digest': digest.nullable() }) }),
  strict({ ...base, name: z.literal('desktop_tools.cost.recorded'), attributes: strict({ ...run, 'desktop_tools.agent.id': id.nullable(), 'desktop_tools.cost.provider': id, 'desktop_tools.cost.input.tokens': z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), 'desktop_tools.cost.output.tokens': z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), 'desktop_tools.cost.usd.micros': z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }) }),
  strict({ ...base, name: z.literal('desktop_tools.verification.state'), attributes: strict({ ...run, 'desktop_tools.verification.id': id, 'desktop_tools.verification.evidence.digest': digest.nullable(), 'desktop_tools.status': outcome, 'desktop_tools.verification.gaps': boundedIds }) }),
  strict({ ...base, name: z.literal('desktop_tools.backup.state'), attributes: strict({ 'desktop_tools.backup.id': id, 'desktop_tools.backup.workload.id': id, 'desktop_tools.backup.kind': z.enum(['snapshot', 'replication', 'file-backup', 'database-dump', 'vm-backup']), 'desktop_tools.status': outcome, 'desktop_tools.backup.recovery_point.digest': digest.nullable() }) }),
  strict({ ...base, name: z.literal('desktop_tools.recovery.state'), attributes: strict({ 'desktop_tools.recovery.id': id, 'desktop_tools.recovery.workload.id': id, 'desktop_tools.recovery.kind': z.enum(['file', 'database', 'service', 'vm', 'host', 'key']), 'desktop_tools.status': outcome, 'desktop_tools.recovery.evidence.digest': digest.nullable() }) }),
]);

export const DesktopToolsTelemetryBatchSchema = strict({
  schemaVersion: z.literal(1), resource: DesktopToolsTelemetryResourceSchema,
  scope: strict({ name: z.literal('desktop.tools'), version: z.string().min(1).max(64) }),
  events: z.array(DesktopToolsSemanticEventSchema).min(1).max(512), droppedEvents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type DesktopToolsTelemetryResource = z.infer<typeof DesktopToolsTelemetryResourceSchema>;
export type DesktopToolsSemanticEvent = z.infer<typeof DesktopToolsSemanticEventSchema>;
export type DesktopToolsTelemetryBatch = z.infer<typeof DesktopToolsTelemetryBatchSchema>;
