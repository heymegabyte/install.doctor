import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const traceId = z.string().regex(/^[a-f0-9]{32}$/);
const spanId = z.string().regex(/^[a-f0-9]{16}$/);
const source = z.enum(['control-plane', 'runtime', 'installer-engine', 'privileged-broker', 'reconciliation']);
const status = z.enum(['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled', 'unknown']);
const signal = z.enum(['log', 'metric', 'trace', 'event']);
const metric = z.strictObject({
  unit: z.enum(['1', 'ms', 'By', 's', 'usd_usd']),
  value: z.number().finite(),
}).nullable();

const CorrelationContextSchema = z.strictObject({
  tenantId: id,
  hostId: id,
  profileId: id.nullable(),
  releaseId: id.nullable(),
  runId: id,
  parentRunId: id.nullable(),
  taskId: id.nullable(),
  traceId,
  spanId,
  parentSpanId: spanId.nullable(),
});

export const CorrelatedTelemetryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source,
  signal,
  name: id,
  observedAt: z.string().datetime({ offset: true }).max(64),
  severity: z.enum(['debug', 'info', 'warn', 'error']),
  ...CorrelationContextSchema.shape,
  status,
  evidenceDigest: digest.nullable(),
  metric,
});

export type CorrelatedTelemetryRecord = z.infer<typeof CorrelatedTelemetryRecordSchema>;
export type CorrelatedTelemetrySource = z.infer<typeof source>;
export type CorrelationContext = z.infer<typeof CorrelationContextSchema>;

const secretOrPii = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bBearer\s+\S+|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b|\b(?:password|passwd|token|secret|api[_-]?key|client[_-]?secret)\s*[=:]\s*\S+)/i;

function assertSecretSafe(value: unknown): void {
  if (typeof value === 'string' && secretOrPii.test(value)) throw new Error('telemetry contains credential or PII material');
  if (Array.isArray(value)) value.forEach(assertSecretSafe);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertSecretSafe);
}

export function validateCorrelatedTelemetryRecord(input: unknown): CorrelatedTelemetryRecord {
  assertSecretSafe(input);
  const record = CorrelatedTelemetryRecordSchema.parse(input);
  if ((record.signal === 'metric') !== (record.metric !== null)) throw new Error('metric payload is required only for metric signals');
  if (record.parentSpanId === record.spanId) throw new Error('a span cannot parent itself');
  return Object.freeze(record);
}

export type TelemetryEmission = Readonly<{
  signal: z.infer<typeof signal>;
  name: string;
  observedAt: string;
  severity: 'debug' | 'info' | 'warn' | 'error';
  status: z.infer<typeof status>;
  evidenceDigest: string | null;
  metric: z.infer<typeof metric>;
}>;

/**
 * Creates a source-bound instrument. Callers provide correlation once and cannot
 * replace it per signal, which keeps logs, metrics, traces, and events joined
 * across process boundaries without accepting arbitrary messages or attributes.
 */
export function createCorrelatedTelemetryInstrument(sourceName: CorrelatedTelemetrySource, contextInput: CorrelationContext) {
  const sourceValue = source.parse(sourceName);
  assertSecretSafe(contextInput);
  const context = Object.freeze(CorrelationContextSchema.parse(contextInput));
  if (context.parentSpanId === context.spanId) throw new Error('a span cannot parent itself');
  if (context.parentRunId === context.runId) throw new Error('a run cannot parent itself');

  return Object.freeze({
    emit(input: TelemetryEmission): CorrelatedTelemetryRecord {
      assertSecretSafe(input);
      return validateCorrelatedTelemetryRecord({ schemaVersion: 1, source: sourceValue, ...context, ...input });
    },
  });
}

/** Stable evidence identity without serializing any unclassified source input. */
export async function correlatedTelemetryDigest(input: unknown): Promise<string> {
  const record = validateCorrelatedTelemetryRecord(input);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
