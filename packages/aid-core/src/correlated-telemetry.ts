import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const traceId = z.string().regex(/^[a-f0-9]{32}$/);
const spanId = z.string().regex(/^[a-f0-9]{16}$/);

export const CorrelatedTelemetryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.enum(['control-plane', 'runtime', 'installer-engine', 'privileged-broker', 'reconciliation']),
  signal: z.enum(['log', 'metric', 'trace', 'event']),
  name: id,
  observedAt: z.string().datetime({ offset: true }).max(64),
  severity: z.enum(['debug', 'info', 'warn', 'error']),
  traceId,
  spanId,
  parentSpanId: spanId.nullable(),
  runId: id,
  taskId: id.nullable(),
  hostId: id,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled', 'unknown']),
  evidenceDigest: digest.nullable(),
  metric: z.strictObject({
    unit: z.enum(['1', 'ms', 'By', 's', 'usd_usd']),
    value: z.number().finite(),
  }).nullable(),
});

export type CorrelatedTelemetryRecord = z.infer<typeof CorrelatedTelemetryRecordSchema>;

export function validateCorrelatedTelemetryRecord(input: unknown): CorrelatedTelemetryRecord {
  const record = CorrelatedTelemetryRecordSchema.parse(input);
  if ((record.signal === 'metric') !== (record.metric !== null)) throw new Error('metric payload is required only for metric signals');
  if (record.parentSpanId === record.spanId) throw new Error('a span cannot parent itself');
  return Object.freeze(record);
}

/** Stable evidence identity without serializing any unclassified source input. */
export async function correlatedTelemetryDigest(input: unknown): Promise<string> {
  const record = validateCorrelatedTelemetryRecord(input);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
