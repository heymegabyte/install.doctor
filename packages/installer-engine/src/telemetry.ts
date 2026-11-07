import { z } from 'zod';
import { InstallerEventSchema } from './contracts.js';
import type { InstallerEvent } from './contracts.js';

const boundedLabel = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(64);
const eventId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(128);
const telemetryEndpoint = z.string().url()
  .refine(value => value.startsWith('https://'), 'telemetry endpoint must use HTTPS')
  .refine(value => {
    const endpoint = new URL(value);
    return endpoint.username === '' && endpoint.password === '' && endpoint.search === '' && endpoint.hash === '';
  }, 'telemetry endpoint cannot contain credentials, query parameters, or fragments');
export const TelemetryExportConfigSchema = z.object({
  schemaVersion: z.literal(1),
  consent: z.boolean(),
  endpoint: telemetryEndpoint,
  timeoutMs: z.number().int().min(100).max(5_000),
  labels: z.object({
    platform: z.enum(['linux', 'darwin', 'win32']),
    environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']),
    service: boundedLabel,
  }).strict(),
}).strict();

const RemoteEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run-status'), sequence: z.number().int().nonnegative(), at: z.string().datetime({ offset: true }), runId: eventId, status: z.enum(['started', 'redirected', 'rejected', 'success', 'failed', 'cancelled']) }).strict(),
  z.object({ kind: z.literal('phase-status'), sequence: z.number().int().nonnegative(), at: z.string().datetime({ offset: true }), runId: eventId, phase: z.enum(['discover', 'validate', 'plan', 'approve', 'apply', 'verify', 'record']), status: z.enum(['started', 'succeeded', 'failed', 'skipped']) }).strict(),
  z.object({ kind: z.literal('task-status'), sequence: z.number().int().nonnegative(), at: z.string().datetime({ offset: true }), runId: eventId, taskId: eventId, status: z.enum(['queued', 'running', 'retrying', 'verified', 'inapplicable', 'pending', 'pending-reboot', 'interrupted', 'blocked', 'failed']), attempt: z.number().int().min(0).max(10) }).strict(),
  z.object({ kind: z.literal('lock'), sequence: z.number().int().nonnegative(), at: z.string().datetime({ offset: true }), runId: eventId, taskId: eventId, domain: eventId, state: z.enum(['waiting', 'acquired', 'released']) }).strict(),
]);

export const TelemetryBatchSchema = z.object({
  schemaVersion: z.literal(1),
  labels: TelemetryExportConfigSchema.shape.labels,
  events: z.array(RemoteEventSchema).max(256),
  droppedOutputEvents: z.number().int().nonnegative(),
  droppedCapacityEvents: z.number().int().nonnegative(),
}).strict();
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;

export type TelemetryExportResult = Readonly<{
  status: 'disabled' | 'succeeded' | 'failed' | 'timed-out';
  exportedEvents: number;
  droppedOutputEvents: number;
  droppedCapacityEvents: number;
}>;

export type TelemetryTransport = (input: Readonly<{
  endpoint: string;
  batch: TelemetryBatch;
  signal: AbortSignal;
}>) => Promise<void>;

export async function exportInstallerTelemetry(
  rawConfig: unknown,
  rawEvents: readonly InstallerEvent[],
  transport: TelemetryTransport,
): Promise<TelemetryExportResult> {
  const config = TelemetryExportConfigSchema.parse(rawConfig);
  const events = rawEvents.map(event => InstallerEventSchema.parse(event));
  const droppedOutputEvents = events.filter(event => event.kind === 'output').length;
  const metadataEvents = events.filter((event): event is Exclude<InstallerEvent, { kind: 'output' }> => event.kind !== 'output');
  const droppedCapacityEvents = Math.max(0, metadataEvents.length - 256);
  const safeEvents = metadataEvents.slice(0, 256)
    .map(({ schemaVersion: _schemaVersion, ...event }) => event);
  if (!config.consent) return Object.freeze({ status: 'disabled', exportedEvents: 0, droppedOutputEvents, droppedCapacityEvents });
  const batch = TelemetryBatchSchema.parse({ schemaVersion: 1, labels: config.labels, events: safeEvents, droppedOutputEvents, droppedCapacityEvents });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('telemetry timeout')), config.timeoutMs);
  timer.unref?.();
  try {
    await Promise.race([
      transport({ endpoint: config.endpoint, batch, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
    ]);
    return Object.freeze({ status: 'succeeded', exportedEvents: batch.events.length, droppedOutputEvents, droppedCapacityEvents });
  } catch {
    return Object.freeze({ status: controller.signal.aborted ? 'timed-out' : 'failed', exportedEvents: 0, droppedOutputEvents, droppedCapacityEvents });
  } finally {
    clearTimeout(timer);
  }
}
