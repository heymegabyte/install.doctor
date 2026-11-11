import { createHash } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

const ActiveUserSchema = z.strictObject({
  sessionId: identifier,
  userId: identifier,
  interactive: z.boolean(),
  approvedToInterrupt: z.boolean(),
});

const ActiveWorkloadSchema = z.strictObject({
  workloadId: identifier,
  state: z.enum(['running', 'stopped']),
  restartSafe: z.boolean(),
  checkpointed: z.boolean(),
});

export const PlannedRebootRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  runId: identifier,
  planDigest: digest,
  preBootId: z.string().min(1).max(256),
  requestedAt: timestamp,
  recoveryTimeoutMs: z.number().int().min(10_000).max(86_400_000),
  maintenanceWindowOpen: z.boolean(),
  activeUsers: z.array(ActiveUserSchema).max(1_000),
  activeWorkloads: z.array(ActiveWorkloadSchema).max(10_000),
}).superRefine((request, context) => {
  for (const [field, values] of [['activeUsers', request.activeUsers.map(item => item.sessionId)], ['activeWorkloads', request.activeWorkloads.map(item => item.workloadId)]] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [field], message: `duplicate ${field} identifiers` });
  }
});

const ContinuationBodySchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  runId: identifier,
  planDigest: digest,
  preBootId: z.string().min(1).max(256),
  requestedAt: timestamp,
  recoveryDeadline: timestamp,
});

export const RebootContinuationSchema = ContinuationBodySchema.extend({ continuationId: digest }).superRefine((record, context) => {
  const { continuationId: _continuationId, ...body } = record;
  if (continuationDigest(body) !== record.continuationId) context.addIssue({ code: 'custom', path: ['continuationId'], message: 'continuation identity does not match its durable reboot state' });
});

export const RebootReturnHeartbeatSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  runId: identifier,
  planDigest: digest,
  continuationId: digest,
  postBootId: z.string().min(1).max(256),
  heartbeatAt: timestamp,
});

type ContinuationBody = z.infer<typeof ContinuationBodySchema>;
export type RebootContinuation = z.infer<typeof RebootContinuationSchema>;

function continuationDigest(body: ContinuationBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function coordinatePlannedReboot(input: unknown) {
  const request = PlannedRebootRequestSchema.parse(input);
  const blockers = [
    ...(!request.maintenanceWindowOpen ? [{ kind: 'maintenance-window' as const, id: request.hostId }] : []),
    ...request.activeUsers.filter(user => user.interactive && !user.approvedToInterrupt)
      .map(user => ({ kind: 'active-user' as const, id: user.sessionId })),
    ...request.activeWorkloads.filter(workload => workload.state === 'running' && (!workload.restartSafe || !workload.checkpointed))
      .map(workload => ({ kind: 'active-workload' as const, id: workload.workloadId })),
  ].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  if (blockers.length > 0) return Object.freeze({ status: 'blocked' as const, blockers });
  const body = ContinuationBodySchema.parse({
    schemaVersion: 1, hostId: request.hostId, runId: request.runId, planDigest: request.planDigest,
    preBootId: request.preBootId, requestedAt: request.requestedAt,
    recoveryDeadline: new Date(Date.parse(request.requestedAt) + request.recoveryTimeoutMs).toISOString(),
  });
  const continuation = RebootContinuationSchema.parse({ ...body, continuationId: continuationDigest(body) });
  return Object.freeze({ status: 'ready' as const, blockers: [], continuation });
}

export function inspectRebootReturn(continuationInput: unknown, heartbeatInput: unknown | null, nowInput: string) {
  const continuation = RebootContinuationSchema.parse(continuationInput);
  const now = timestamp.parse(nowInput);
  const timedOut = Date.parse(now) >= Date.parse(continuation.recoveryDeadline);
  if (heartbeatInput === null) return Object.freeze({
    status: timedOut ? 'recovery-timeout' as const : 'awaiting-return' as const,
    canResume: false, reason: 'return-heartbeat-missing' as const,
  });
  const heartbeat = RebootReturnHeartbeatSchema.parse(heartbeatInput);
  const identityMatches = heartbeat.hostId === continuation.hostId
    && heartbeat.runId === continuation.runId
    && heartbeat.planDigest === continuation.planDigest
    && heartbeat.continuationId === continuation.continuationId;
  if (!identityMatches) return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'continuation-identity-mismatch' as const });
  if (heartbeat.postBootId === continuation.preBootId) return Object.freeze({ status: 'awaiting-return' as const, canResume: false, reason: 'boot-identity-unchanged' as const });
  const heartbeatTime = Date.parse(heartbeat.heartbeatAt);
  if (heartbeatTime <= Date.parse(continuation.requestedAt) || heartbeatTime > Date.parse(now)) {
    return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'heartbeat-time-invalid' as const });
  }
  if (timedOut || heartbeatTime >= Date.parse(continuation.recoveryDeadline)) {
    return Object.freeze({ status: 'recovery-timeout' as const, canResume: false, reason: 'return-heartbeat-late' as const });
  }
  return Object.freeze({ status: 'ready-to-resume' as const, canResume: true, reason: 'post-boot-identity-verified' as const,
    postBootId: heartbeat.postBootId, heartbeatAt: heartbeat.heartbeatAt });
}
