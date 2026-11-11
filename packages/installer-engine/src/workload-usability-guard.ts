import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const ratio = z.number().min(0).max(1);
const operation = z.enum(['provisioning', 'verification', 'replication', 'scrub', 'pruning']);

const ResourceEnvelopeSchema = z.strictObject({
  cpuUtilization: ratio,
  memoryUtilization: ratio,
  ioUtilization: ratio,
  networkUtilization: ratio,
});

const ForegroundBudgetSchema = z.strictObject({
  serviceId: id,
  maxP95LatencyMs: z.number().int().positive().max(3_600_000),
  maxErrorRate: ratio,
  minHealthyReplicas: z.number().int().nonnegative().max(10_000),
});

export const WorkloadUsabilityPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  hostCeilings: ResourceEnvelopeSchema,
  operationBudgets: z.array(z.strictObject({
    operation,
    maxConcurrency: z.number().int().min(1).max(64),
    projectedUtilization: ResourceEnvelopeSchema,
  })).length(operation.options.length),
  foregroundBudgets: z.array(ForegroundBudgetSchema).max(256),
}).superRefine((value, context) => {
  const kinds = value.operationBudgets.map(item => item.operation);
  if (new Set(kinds).size !== kinds.length || operation.options.some(kind => !kinds.includes(kind))) {
    context.addIssue({ code: 'custom', path: ['operationBudgets'], message: 'every guarded operation must have exactly one budget' });
  }
  for (const [index, budget] of value.operationBudgets.entries()) {
    for (const resource of Object.keys(value.hostCeilings) as (keyof typeof value.hostCeilings)[]) {
      if (budget.projectedUtilization[resource] > value.hostCeilings[resource]) {
        context.addIssue({ code: 'custom', path: ['operationBudgets', index, 'projectedUtilization', resource], message: 'operation budget exceeds host ceiling' });
      }
    }
  }
  const services = value.foregroundBudgets.map(item => item.serviceId);
  if (new Set(services).size !== services.length) {
    context.addIssue({ code: 'custom', path: ['foregroundBudgets'], message: 'foreground service budgets must be unique' });
  }
});

export const WorkloadUsabilityObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  observedAt: z.string().datetime({ offset: true }).max(64),
  hostUtilization: ResourceEnvelopeSchema,
  foregroundServices: z.array(z.strictObject({
    serviceId: id,
    p95LatencyMs: z.number().int().nonnegative().max(3_600_000),
    errorRate: ratio,
    healthyReplicas: z.number().int().nonnegative().max(10_000),
  })).max(256),
});

export const WorkloadUsabilityRequestSchema = z.strictObject({
  schemaVersion: VERSION,
  phase: z.enum(['admission', 'runtime']),
  operation,
  activeOperationCount: z.number().int().nonnegative().max(64),
  policy: WorkloadUsabilityPolicySchema,
  observation: WorkloadUsabilityObservationSchema,
});

export const WorkloadUsabilityDecisionSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: id,
  operation,
  phase: z.enum(['admission', 'runtime']),
  action: z.enum(['admit', 'defer', 'continue', 'pause']),
  reasons: z.array(z.string().min(1).max(256)).max(512),
  decisionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type WorkloadUsabilityDecision = z.infer<typeof WorkloadUsabilityDecisionSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Pure, fail-closed admission/runtime guard. Call again while expensive work is active. */
export function evaluateWorkloadUsability(input: unknown): WorkloadUsabilityDecision {
  const request = WorkloadUsabilityRequestSchema.parse(input);
  const budget = request.policy.operationBudgets.find(item => item.operation === request.operation)!;
  const reasons: string[] = [];
  const concurrencyExceeded = request.phase === 'admission'
    ? request.activeOperationCount >= budget.maxConcurrency
    : request.activeOperationCount > budget.maxConcurrency;
  if (concurrencyExceeded) reasons.push(`operation-concurrency:${request.activeOperationCount}/${budget.maxConcurrency}`);

  for (const resource of Object.keys(request.policy.hostCeilings) as (keyof typeof request.policy.hostCeilings)[]) {
    const observed = request.observation.hostUtilization[resource];
    const projected = request.phase === 'admission' ? observed + budget.projectedUtilization[resource] : observed;
    if (projected > request.policy.hostCeilings[resource]) {
      reasons.push(`${resource}:${projected.toFixed(4)}>${request.policy.hostCeilings[resource].toFixed(4)}`);
    }
  }

  const observedServices = new Map(request.observation.foregroundServices.map(service => [service.serviceId, service]));
  for (const declared of request.policy.foregroundBudgets) {
    const observed = observedServices.get(declared.serviceId);
    if (!observed) {
      reasons.push(`foreground-unobserved:${declared.serviceId}`);
      continue;
    }
    if (observed.p95LatencyMs > declared.maxP95LatencyMs) reasons.push(`foreground-latency:${declared.serviceId}`);
    if (observed.errorRate > declared.maxErrorRate) reasons.push(`foreground-errors:${declared.serviceId}`);
    if (observed.healthyReplicas < declared.minHealthyReplicas) reasons.push(`foreground-availability:${declared.serviceId}`);
  }

  const action = request.phase === 'admission'
    ? (reasons.length === 0 ? 'admit' : 'defer')
    : (reasons.length === 0 ? 'continue' : 'pause');
  const unsigned = {
    schemaVersion: 1 as const, policyId: request.policy.policyId, operation: request.operation,
    phase: request.phase, action, reasons: reasons.sort(),
  };
  return WorkloadUsabilityDecisionSchema.parse({
    ...unsigned,
    decisionDigest: createHash('sha256').update(canonical({ ...unsigned, observation: request.observation })).digest('hex'),
  });
}
