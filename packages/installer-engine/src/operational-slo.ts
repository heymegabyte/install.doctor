import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FleetSloIndicatorSchema, FleetSloPolicySchema, FleetSloWindowSchema } from './fleet-error-budget.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const CorrelatedSloEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceId: id,
  indicator: FleetSloIndicatorSchema,
  observedAt: timestamp,
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  runId: id,
  hostId: id,
  outcome: z.enum(['good', 'bad']),
  sourceEvidenceDigest: digest,
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Build one SLO window only from exact, bounded, correlated source evidence. */
export function buildCorrelatedSloWindow(input: {
  policy: unknown;
  windowStartedAt: string;
  windowEndedAt: string;
  evidence: readonly unknown[];
}): z.infer<typeof FleetSloWindowSchema> {
  const policy = FleetSloPolicySchema.parse(input.policy);
  const windowStartedAt = timestamp.parse(input.windowStartedAt);
  const windowEndedAt = timestamp.parse(input.windowEndedAt);
  const started = Date.parse(windowStartedAt); const ended = Date.parse(windowEndedAt);
  if (ended <= started) throw new Error('SLO window end must follow its start');
  if (ended - started !== policy.windowSeconds * 1_000) throw new Error('SLO window duration must match policy');
  const evidence = z.array(CorrelatedSloEvidenceSchema).max(1_000_000).parse(input.evidence);
  if (new Set(evidence.map(item => item.evidenceId)).size !== evidence.length) throw new Error('SLO evidence ids must be unique');
  for (const item of evidence) {
    if (item.indicator !== policy.indicator) throw new Error('SLO evidence indicator does not match policy');
    const observed = Date.parse(item.observedAt);
    if (observed < started || observed >= ended) throw new Error('SLO evidence falls outside the exact window');
  }
  const ordered = [...evidence].sort((left, right) => `${left.observedAt}:${left.evidenceId}`.localeCompare(`${right.observedAt}:${right.evidenceId}`));
  return FleetSloWindowSchema.parse({ schemaVersion: 1, sloId: policy.sloId, windowStartedAt, windowEndedAt,
    goodEvents: ordered.filter(item => item.outcome === 'good').length, totalEvents: ordered.length,
    evidenceDigest: createHash('sha256').update(canonical(ordered)).digest('hex') });
}

