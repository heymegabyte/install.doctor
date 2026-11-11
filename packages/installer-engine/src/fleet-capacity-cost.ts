import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const FleetForecastMetricSchema = z.enum([
  'disk-capacity-bytes',
  'snapshot-retained-bytes',
  'replication-headroom-bytes',
  'backup-retained-bytes',
  'egress-cost-usd-micros',
  'api-operation-count',
  'telemetry-cost-usd-micros',
  'model-cost-usd-micros',
  'restore-cost-usd-micros',
]);
const REQUIRED_METRICS = FleetForecastMetricSchema.options;
const work = z.enum([
  'storage-growth', 'snapshot-create', 'replication', 'backup', 'egress',
  'api-automation', 'telemetry-export', 'model-inference', 'restore-drill',
]);

export const FleetForecastInputSchema = z.strictObject({
  schemaVersion: VERSION,
  forecastId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  observedAt: timestamp,
  horizonHours: z.number().int().min(1).max(8_760),
  evidenceDigest: digest,
  metrics: z.array(z.strictObject({
    metric: FleetForecastMetricSchema,
    current: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    projectedIncrease: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    warningRatio: z.number().min(0.25).max(0.95),
    admissionRatio: z.number().min(0.5).max(0.99),
    confidence: z.enum(['measured', 'estimated', 'unknown']),
  })).length(REQUIRED_METRICS.length),
}).superRefine((value, context) => {
  const metrics = value.metrics.map(item => item.metric);
  if (new Set(metrics).size !== metrics.length || REQUIRED_METRICS.some(metric => !metrics.includes(metric))) {
    context.addIssue({ code: 'custom', path: ['metrics'], message: 'forecast must contain every required metric exactly once' });
  }
  for (const [index, metric] of value.metrics.entries()) {
    if (metric.warningRatio >= metric.admissionRatio) {
      context.addIssue({ code: 'custom', path: ['metrics', index, 'warningRatio'], message: 'warning threshold must precede admission threshold' });
    }
  }
});

export const FleetForecastDecisionSchema = z.strictObject({
  schemaVersion: VERSION,
  forecastId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  decisionDigest: digest,
  observedAt: timestamp,
  horizonHours: z.number().int().min(1).max(8_760),
  metrics: z.array(z.strictObject({
    metric: FleetForecastMetricSchema,
    projected: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    utilization: z.number().nonnegative(),
    status: z.enum(['safe', 'warning', 'gated', 'unverified']),
    blockedWork: z.array(work).max(9),
  })).length(REQUIRED_METRICS.length),
  admitted: z.boolean(),
  blockedWork: z.array(work).max(9),
});
export type FleetForecastDecision = z.infer<typeof FleetForecastDecisionSchema>;

const WORK_BY_METRIC: Record<z.infer<typeof FleetForecastMetricSchema>, z.infer<typeof work>[]> = {
  'disk-capacity-bytes': ['storage-growth', 'snapshot-create', 'replication', 'backup', 'restore-drill'],
  'snapshot-retained-bytes': ['snapshot-create'],
  'replication-headroom-bytes': ['replication'],
  'backup-retained-bytes': ['backup'],
  'egress-cost-usd-micros': ['egress', 'replication', 'backup', 'restore-drill'],
  'api-operation-count': ['api-automation'],
  'telemetry-cost-usd-micros': ['telemetry-export'],
  'model-cost-usd-micros': ['model-inference'],
  'restore-cost-usd-micros': ['restore-drill'],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function evaluateFleetCapacityCostForecast(input: unknown): FleetForecastDecision {
  const parsed = FleetForecastInputSchema.parse(input);
  const metrics = [...parsed.metrics].sort((left, right) => left.metric.localeCompare(right.metric)).map(metric => {
    const projected = metric.current + metric.projectedIncrease;
    if (!Number.isSafeInteger(projected)) throw new Error(`forecast overflow for ${metric.metric}`);
    const utilization = projected / metric.limit;
    const status = metric.confidence === 'unknown' ? 'unverified'
      : utilization >= metric.admissionRatio ? 'gated'
        : utilization >= metric.warningRatio ? 'warning' : 'safe';
    return {
      metric: metric.metric, projected, limit: metric.limit, utilization, status,
      blockedWork: status === 'gated' || status === 'unverified' ? WORK_BY_METRIC[metric.metric] : [],
    };
  });
  const blockedWork = [...new Set(metrics.flatMap(metric => metric.blockedWork))].sort();
  const unsigned = {
    schemaVersion: 1 as const, forecastId: parsed.forecastId, observedAt: parsed.observedAt,
    horizonHours: parsed.horizonHours, metrics, admitted: blockedWork.length === 0, blockedWork,
  };
  return FleetForecastDecisionSchema.parse({
    ...unsigned, decisionDigest: createHash('sha256').update(canonical({ ...unsigned, evidenceDigest: parsed.evidenceDigest })).digest('hex'),
  });
}
