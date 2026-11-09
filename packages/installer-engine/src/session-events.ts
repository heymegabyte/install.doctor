import { z } from 'zod';
import { InstallerEventSchema } from './contracts.js';
import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const boundedText = z.string().max(16_384).refine(value => !value.includes('\0'), 'text cannot contain NUL');
const producer = z.strictObject({
  kind: z.enum(['supervisor', 'engine', 'agent']),
  id: identifier,
  parentId: identifier.nullable(),
});
const base = {
  schemaVersion: VERSION,
  sequence,
  at: timestamp,
  sessionId: identifier,
  runId: identifier,
  authorizationId: identifier,
  producer,
};

export const SessionTerminalStatusSchema = z.enum([
  'verified-success', 'failure', 'denial', 'cancellation', 'offline-limitation',
  'blocked-prerequisite', 'pending-reboot', 'incomplete-evidence',
]);
export type SessionTerminalStatus = z.infer<typeof SessionTerminalStatusSchema>;

export const ProvisioningSessionEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('session-status'), status: z.literal('started') }),
  z.strictObject({
    ...base, kind: z.literal('child-agent'), childSessionId: identifier, parentSessionId: identifier,
    taskId: identifier, status: z.enum(['started', 'succeeded', 'failed', 'cancelled']), resultDigest: digest.nullable(),
  }),
  z.strictObject({
    ...base, kind: z.literal('approval'), approvalId: identifier, planDigest: digest,
    status: z.enum(['requested', 'approved', 'denied', 'expired']), actorId: identifier.nullable(),
  }),
  z.strictObject({
    ...base, kind: z.literal('plan'), planDigest: digest, profileRevision: identifier, diffDigest: digest,
  }),
  z.strictObject({
    ...base, kind: z.literal('diff'), planDigest: digest, diffDigest: digest,
    additions: z.number().int().nonnegative().max(1_000_000),
    changes: z.number().int().nonnegative().max(1_000_000),
    removals: z.number().int().nonnegative().max(1_000_000),
  }),
  z.strictObject({ ...base, kind: z.literal('engine-event'), event: InstallerEventSchema }),
  z.strictObject({
    ...base, kind: z.literal('cost'), provider: identifier, model: identifier,
    inputTokens: z.number().int().nonnegative().max(1_000_000_000),
    outputTokens: z.number().int().nonnegative().max(1_000_000_000),
    costMicrousd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    ...base, kind: z.literal('output'), sourceId: identifier, sourceSequence: sequence,
    stream: z.enum(['stdout', 'stderr', 'status']), text: boundedText,
  }),
  z.strictObject({
    ...base, kind: z.literal('output-gap'), sourceId: identifier, fromSourceSequence: sequence,
    throughSourceSequence: sequence, reason: z.enum(['backpressure', 'capacity', 'transport', 'recording-failure']),
  }).superRefine((event, context) => {
    if (event.throughSourceSequence < event.fromSourceSequence) {
      context.addIssue({ code: 'custom', path: ['throughSourceSequence'], message: 'output gap cannot end before it starts' });
    }
    if (event.throughSourceSequence - event.fromSourceSequence + 1 > 1_000_000) {
      context.addIssue({ code: 'custom', path: ['throughSourceSequence'], message: 'output gap exceeds the bounded range' });
    }
  }),
  z.strictObject({
    ...base, kind: z.literal('verification'), planDigest: digest,
    status: z.enum(['started', 'passed', 'failed', 'incomplete']), evidenceDigest: digest.nullable(),
  }),
  z.strictObject({
    ...base, kind: z.literal('cancellation'), requestedBy: identifier,
    status: z.enum(['requested', 'acknowledged', 'completed']), reason: boundedText,
  }),
  z.strictObject({
    ...base, kind: z.literal('terminal'), status: SessionTerminalStatusSchema,
    planDigest: digest.nullable(), evidenceDigest: digest.nullable(), nextAction: boundedText.nullable(),
  }),
]);
export type ProvisioningSessionEvent = z.infer<typeof ProvisioningSessionEventSchema>;

export interface SessionEventJournalIdentity {
  readonly sessionId: string;
  readonly runId: string;
  readonly authorizationId: string;
}

/**
 * A protected, append-only NDJSON boundary shared by the supervisor and its
 * private MCP child. The mkdir lock serializes distinct processes; every line
 * is schema checked, correlated, sequenced, flushed, and terminal streams are
 * reduced before they become durable.
 */
export function createProvisioningSessionEventJournal(path: string, identityInput: SessionEventJournalIdentity) {
  const identity = z.strictObject({ sessionId: identifier, runId: identifier, authorizationId: identifier }).parse(identityInput);
  const lockPath = `${path}.lock`;
  const read = async (): Promise<ProvisioningSessionEvent[]> => {
    const bytes = await readFile(path, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
    if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw new Error('session event journal exceeds its bound');
    if (bytes && !bytes.endsWith('\n')) throw new Error('session event journal has a torn final record');
    return bytes.split('\n').filter(Boolean).map(line => ProvisioningSessionEventSchema.parse(JSON.parse(line)));
  };
  const acquire = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try { await mkdir(lockPath, { mode: 0o700 }); return; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    throw new Error('session event journal lock timed out');
  };
  return Object.freeze({
    path,
    async events() { return Object.freeze(await read()); },
    async append(eventInput: Readonly<Record<string, unknown>>) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await acquire();
      try {
        const events = await read();
        if (events.some(event => event.kind === 'terminal')) throw new Error('session event journal is terminal');
        const event = ProvisioningSessionEventSchema.parse({ schemaVersion: 1, sequence: events.length, ...identity, ...eventInput });
        if (events.length === 0 && (event.kind !== 'session-status' || event.status !== 'started')) {
          throw new Error('session event journal must start with supervisor evidence');
        }
        if (events.length > 0 && event.kind === 'session-status') throw new Error('session event journal already started');
        if (event.kind === 'terminal') reduceProvisioningSessionEvents([...events, event]);
        const handle = await open(path, 'a', 0o600);
        try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); } finally { await handle.close(); }
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0) {
          throw new Error('session event journal is not a protected regular file');
        }
        return event;
      } finally { await rm(lockPath, { recursive: true, force: true }); }
    },
  });
}

export interface ProvisioningSessionSummary {
  readonly sessionId: string;
  readonly runId: string;
  readonly authorizationId: string;
  readonly terminalStatus: SessionTerminalStatus;
  readonly planDigest: string | null;
  readonly childStatuses: Readonly<Record<string, 'running' | 'succeeded' | 'failed' | 'cancelled'>>;
  readonly approvalStatuses: Readonly<Record<string, 'requested' | 'approved' | 'denied' | 'expired'>>;
  readonly outputGapCount: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostMicrousd: number;
  readonly verificationStatus: 'not-started' | 'started' | 'passed' | 'failed' | 'incomplete';
}

function safeSum(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label} exceeds the safe aggregate bound`);
  return sum;
}

/** Validates one complete, globally ordered session stream without mutating it. */
export function reduceProvisioningSessionEvents(eventsInput: readonly unknown[]): ProvisioningSessionSummary {
  if (eventsInput.length < 2 || eventsInput.length > 1_000_000) throw new Error('session event stream must contain 2..1000000 events');
  const events = eventsInput.map(event => ProvisioningSessionEventSchema.parse(event));
  const first = events[0];
  if (!first || first.kind !== 'session-status' || first.status !== 'started') throw new Error('session event stream must start with session-status started');
  if (first.producer.kind !== 'supervisor' || first.producer.parentId !== null) {
    throw new Error('session event stream must be rooted by a supervisor producer');
  }
  const identity = { sessionId: first.sessionId, runId: first.runId, authorizationId: first.authorizationId };
  const plans = new Map<string, string>();
  const children = new Map<string, 'running' | 'succeeded' | 'failed' | 'cancelled'>();
  const approvals = new Map<string, 'requested' | 'approved' | 'denied' | 'expired'>();
  const outputSequences = new Map<string, number>();
  let engineSequence = 0;
  let engineProducerId: string | null = null;
  let outputGapCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostMicrousd = 0;
  let verificationStatus: ProvisioningSessionSummary['verificationStatus'] = 'not-started';
  let verificationPlanDigest: string | null = null;
  let verificationEvidenceDigest: string | null = null;
  let terminal: Extract<ProvisioningSessionEvent, { kind: 'terminal' }> | null = null;
  let cancellationSeen = false;
  let denialSeen = false;

  events.forEach((event, index) => {
    if (event.sequence !== index) throw new Error(`session event sequence gap at ${index}`);
    if (event.sessionId !== identity.sessionId || event.runId !== identity.runId || event.authorizationId !== identity.authorizationId) {
      throw new Error(`session correlation identity changed at sequence ${index}`);
    }
    if (terminal) throw new Error('session event follows the terminal event');
    if (index > 0 && event.kind === 'session-status') throw new Error('session started more than once');
    if (event.kind === 'plan') {
      if (plans.has(event.planDigest)) throw new Error(`duplicate session plan: ${event.planDigest}`);
      plans.set(event.planDigest, event.diffDigest);
    } else if (event.kind === 'diff') {
      if (plans.get(event.planDigest) !== event.diffDigest) throw new Error('diff is not bound to a session plan');
    } else if (event.kind === 'approval') {
      if (!plans.has(event.planDigest)) throw new Error('approval is not bound to a session plan');
      const previous = approvals.get(event.approvalId);
      if (event.status === 'requested') {
        if (previous) throw new Error(`approval requested more than once: ${event.approvalId}`);
        if (event.actorId !== null) throw new Error('requested approval cannot already name an actor');
      } else {
        if (previous !== 'requested') throw new Error(`approval decision lacks its request: ${event.approvalId}`);
        if (event.status === 'approved' && event.actorId === null) throw new Error('approved decision requires an actor');
        if (event.status === 'denied') denialSeen = true;
      }
      approvals.set(event.approvalId, event.status);
    } else if (event.kind === 'child-agent') {
      if (event.parentSessionId !== identity.sessionId || event.childSessionId === identity.sessionId) throw new Error('child agent has invalid parent correlation');
      if (event.producer.kind !== 'agent' || event.producer.id !== event.childSessionId || event.producer.parentId !== identity.sessionId) {
        throw new Error('child agent producer identity is not attributable');
      }
      const previous = children.get(event.childSessionId);
      if (event.status === 'started') {
        if (previous) throw new Error(`child agent started more than once: ${event.childSessionId}`);
        if (event.resultDigest !== null) throw new Error('running child agent cannot have a result digest');
        children.set(event.childSessionId, 'running');
      } else {
        if (previous !== 'running') throw new Error(`child agent terminal status lacks its start: ${event.childSessionId}`);
        if (event.status === 'succeeded' && event.resultDigest === null) throw new Error('successful child agent requires a result digest');
        children.set(event.childSessionId, event.status);
      }
    } else if (event.kind === 'engine-event') {
      if (event.producer.kind !== 'engine' || event.producer.parentId !== identity.sessionId || event.event.runId !== identity.runId) {
        throw new Error('embedded engine event is not attributable to this run');
      }
      engineProducerId ??= event.producer.id;
      if (event.producer.id !== engineProducerId) throw new Error('embedded engine producer identity changed');
      if (event.event.sequence !== engineSequence) throw new Error(`embedded engine event sequence gap at ${engineSequence}`);
      engineSequence += 1;
    } else if (event.kind === 'output') {
      if (event.producer.id !== event.sourceId) throw new Error('parallel output producer does not match its source');
      if (event.producer.kind === 'agent' && children.get(event.sourceId) !== 'running') {
        throw new Error('agent output is not attributable to a running child');
      }
      const expected = outputSequences.get(event.sourceId) ?? 0;
      if (event.sourceSequence !== expected) throw new Error(`output sequence gap for ${event.sourceId} at ${expected}`);
      outputSequences.set(event.sourceId, expected + 1);
    } else if (event.kind === 'output-gap') {
      if (event.producer.id !== event.sourceId) throw new Error('output gap producer does not match its source');
      const expected = outputSequences.get(event.sourceId) ?? 0;
      if (event.fromSourceSequence !== expected) throw new Error(`output gap is not contiguous for ${event.sourceId} at ${expected}`);
      outputGapCount = safeSum(outputGapCount, event.throughSourceSequence - event.fromSourceSequence + 1, 'output gap count');
      outputSequences.set(event.sourceId, event.throughSourceSequence + 1);
    } else if (event.kind === 'cost') {
      totalInputTokens = safeSum(totalInputTokens, event.inputTokens, 'input token total');
      totalOutputTokens = safeSum(totalOutputTokens, event.outputTokens, 'output token total');
      totalCostMicrousd = safeSum(totalCostMicrousd, event.costMicrousd, 'cost total');
    } else if (event.kind === 'verification') {
      if (!plans.has(event.planDigest)) throw new Error('verification is not bound to a session plan');
      if (event.status === 'started') {
        if (verificationStatus !== 'not-started') throw new Error('verification started more than once');
        if (event.evidenceDigest !== null) throw new Error('verification start cannot contain terminal evidence');
      } else {
        if (verificationStatus !== 'started' || verificationPlanDigest !== event.planDigest) throw new Error('verification result lacks its matching start');
        if (event.status === 'passed' && event.evidenceDigest === null) throw new Error('passed verification requires evidence');
      }
      verificationStatus = event.status;
      verificationPlanDigest = event.planDigest;
      verificationEvidenceDigest = event.evidenceDigest;
    } else if (event.kind === 'cancellation') {
      cancellationSeen = true;
    } else if (event.kind === 'terminal') {
      terminal = event;
    }
  });

  if (!terminal) throw new Error('session event stream requires exactly one terminal event');
  // Array iteration callbacks are synchronous here, but TypeScript does not
  // carry their assignments into control-flow narrowing.
  const terminalEvent = terminal as Extract<ProvisioningSessionEvent, { kind: 'terminal' }>;
  const finalVerificationStatus = verificationStatus as ProvisioningSessionSummary['verificationStatus'];
  if ([...children.values()].some(status => status === 'running')) throw new Error('session terminated with a running child agent');
  if ([...approvals.values()].some(status => status === 'requested')) throw new Error('session terminated with an undecided approval');
  if (terminalEvent.planDigest !== null && !plans.has(terminalEvent.planDigest)) throw new Error('terminal status is not bound to a session plan');
  if (terminalEvent.status === 'verified-success') {
    if (finalVerificationStatus !== 'passed' || terminalEvent.planDigest !== verificationPlanDigest
      || terminalEvent.evidenceDigest === null || terminalEvent.evidenceDigest !== verificationEvidenceDigest || outputGapCount !== 0) {
      throw new Error('verified success requires matching passed verification and complete evidence');
    }
  }
  if (terminalEvent.status === 'cancellation' && !cancellationSeen) throw new Error('cancellation terminal status requires cancellation evidence');
  if (terminalEvent.status === 'denial' && !denialSeen) throw new Error('denial terminal status requires denied approval evidence');
  if (outputGapCount > 0 && terminalEvent.status === 'verified-success') throw new Error('output gaps require an incomplete evidence outcome');
  return Object.freeze({
    ...identity,
    terminalStatus: terminalEvent.status,
    planDigest: terminalEvent.planDigest,
    childStatuses: Object.freeze(Object.fromEntries([...children.entries()].sort())),
    approvalStatuses: Object.freeze(Object.fromEntries([...approvals.entries()].sort())),
    outputGapCount,
    totalInputTokens,
    totalOutputTokens,
    totalCostMicrousd,
    verificationStatus: finalVerificationStatus,
  });
}
