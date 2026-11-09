import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
const timestamp = z.string().datetime({ offset: true });

export const PrivilegedOperationPhaseSchema = z.enum(['check', 'apply', 'verify']);

export const PrivilegedBrokerGrantSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grantId: identifier,
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  approvedPlanDigest: digest,
  enrolledUid: z.number().int().nonnegative(),
  brokerExecutableDigest: digest,
  runtimeDigest: digest,
  workerDigest: digest,
  operations: z.array(z.strictObject({
    taskId: identifier,
    operationId: identifier,
    phase: PrivilegedOperationPhaseSchema,
  })).min(1).max(256).refine(values => new Set(values.map(value => value.operationId)).size === values.length, 'duplicate operation identifiers'),
  descriptorDigest: digest,
  closureDigest: digest,
  consentDigest: digest,
  issuedAt: timestamp,
  expiresAt: timestamp,
}).superRefine((value, context) => {
  if (value.planDigest !== value.approvedPlanDigest) {
    context.addIssue({ code: 'custom', message: 'grant is not bound to the exact approved plan digest' });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: 'custom', message: 'grant expiry must follow issuance' });
  }
  if (Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 30 * 60 * 1_000) {
    context.addIssue({ code: 'custom', message: 'grant validity cannot exceed thirty minutes' });
  }
});

export const PrivilegedBrokerApprovalEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvalId: identifier,
  method: z.enum(['trusted-local', 'signed-device']),
  grantId: identifier,
  grantDigest: digest,
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  enrolledUid: z.number().int().nonnegative(),
  brokerExecutableDigest: digest,
  runtimeDigest: digest,
  workerDigest: digest,
  descriptorDigest: digest,
  closureDigest: digest,
  consentDigest: digest,
  evidenceDigest: digest,
  approvedAt: timestamp,
});

export const PrivilegedBrokerRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  grantId: identifier,
  grantDigest: digest,
  taskId: identifier,
  operationId: identifier,
  phase: PrivilegedOperationPhaseSchema,
  consentDigest: digest,
  descriptorDigest: digest,
  closureDigest: digest,
  payload: z.strictObject({
    sha256: digest,
    sizeBytes: z.number().int().positive().max(1_073_741_824),
    requiredSeals: z.tuple([z.literal('seal'), z.literal('shrink'), z.literal('grow'), z.literal('write')]),
  }),
  nonce,
  requestedAt: timestamp,
});

export const PrivilegedBrokerReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestDigest: digest,
  grantDigest: digest,
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  grantId: identifier,
  taskId: identifier,
  operationId: identifier,
  phase: PrivilegedOperationPhaseSchema,
  nonce,
  status: z.enum(['verified', 'applied', 'needed', 'inapplicable', 'pending', 'failed']),
  fenceDigest: digest,
  payloadSha256: digest,
  completedAt: timestamp,
});

export type PrivilegedBrokerGrant = z.infer<typeof PrivilegedBrokerGrantSchema>;
export type PrivilegedBrokerApprovalEvidence = z.infer<typeof PrivilegedBrokerApprovalEvidenceSchema>;
export type PrivilegedBrokerRequest = z.infer<typeof PrivilegedBrokerRequestSchema>;
export type PrivilegedBrokerReceipt = z.infer<typeof PrivilegedBrokerReceiptSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function privilegedBrokerDigest(value: unknown): string {
  return createHash('sha256').update('desktop-tools:privileged-broker:v1\0')
    .update(JSON.stringify(canonical(value))).digest('hex');
}

function equalDigest(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'));
}

export function validatePrivilegedBrokerRequest(input: {
  readonly request: unknown;
  readonly grant: unknown;
  readonly peerUid: number;
  readonly now: Date;
  readonly consumeNonce: (nonce: string) => boolean;
}): { readonly request: PrivilegedBrokerRequest; readonly grant: PrivilegedBrokerGrant; readonly requestDigest: string; readonly grantDigest: string } {
  const request = PrivilegedBrokerRequestSchema.parse(input.request);
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  const grantDigest = privilegedBrokerDigest(grant);
  if (!equalDigest(request.grantDigest, grantDigest)) throw new Error('broker request grant digest mismatch');
  if (input.peerUid !== grant.enrolledUid) throw new Error('broker peer uid is not the enrolled uid');
  if (input.now.getTime() < Date.parse(grant.issuedAt) || input.now.getTime() >= Date.parse(grant.expiresAt)) {
    throw new Error('broker grant is outside its validity window');
  }
  const requestedAt = Date.parse(request.requestedAt);
  if (requestedAt < Date.parse(grant.issuedAt) || requestedAt >= Date.parse(grant.expiresAt)
    || requestedAt > input.now.getTime() + 30_000) {
    throw new Error('broker request time is outside its grant or clock-skew boundary');
  }
  const bindings = ['hostId', 'releaseId', 'runId', 'planDigest', 'grantId', 'consentDigest', 'descriptorDigest', 'closureDigest'] as const;
  for (const key of bindings) {
    if (!equalDigestOrText(request[key], grant[key])) throw new Error(`broker request ${key} differs from grant`);
  }
  if (!grant.operations.some(operation => operation.taskId === request.taskId
    && operation.operationId === request.operationId && operation.phase === request.phase)) {
    throw new Error('broker task, operation, or phase is outside the exact grant');
  }
  if (!input.consumeNonce(request.nonce)) throw new Error('broker nonce was already consumed');
  return Object.freeze({ request, grant, requestDigest: privilegedBrokerDigest(request), grantDigest });
}

function equalDigestOrText(left: string, right: string): boolean {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) ? equalDigest(left, right) : left === right;
}

export function createPrivilegedBrokerReceipt(input: {
  readonly request: PrivilegedBrokerRequest;
  readonly grantDigest: string;
  readonly status: PrivilegedBrokerReceipt['status'];
  readonly fenceDigest: string;
  readonly completedAt: string;
}): PrivilegedBrokerReceipt {
  return PrivilegedBrokerReceiptSchema.parse({
    schemaVersion: 1,
    requestDigest: privilegedBrokerDigest(input.request),
    grantDigest: input.grantDigest,
    hostId: input.request.hostId,
    releaseId: input.request.releaseId,
    runId: input.request.runId,
    planDigest: input.request.planDigest,
    grantId: input.request.grantId,
    taskId: input.request.taskId,
    operationId: input.request.operationId,
    phase: input.request.phase,
    nonce: input.request.nonce,
    status: input.status,
    fenceDigest: input.fenceDigest,
    payloadSha256: input.request.payload.sha256,
    completedAt: input.completedAt,
  });
}
