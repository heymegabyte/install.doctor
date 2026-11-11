import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const timestamp = z.iso.datetime({ offset: true });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = z.string().min(1).max(512);

export const AlertSubjectSchema = z.strictObject({
  kind: z.enum(['host', 'workload', 'device']),
  id,
  displayName: z.string().min(1).max(128),
});

export const AlertEvidenceSchema = z.strictObject({
  observedAt: timestamp,
  source: id,
  summary: boundedText,
  correlationId: id.optional(),
  contentDigest: digest,
});

export const ActionableAlertSignalSchema = z.strictObject({
  schemaVersion: VERSION,
  hostId: id,
  subject: AlertSubjectSchema,
  condition: id,
  severity: z.enum(['warning', 'critical']),
  recoveryImpact: z.enum(['none', 'degraded', 'recovery-point-at-risk', 'recovery-blocked']),
  impactSummary: boundedText,
  runbook: z.string().min(1).max(512).refine(
    value => value.startsWith('https://') || /^docs\/[a-zA-Z0-9._/-]+\.md(?:#[a-zA-Z0-9._-]+)?$/.test(value),
    'runbook must be an HTTPS URL or a repository docs/*.md reference',
  ),
  evidence: AlertEvidenceSchema,
});
export type ActionableAlertSignal = z.infer<typeof ActionableAlertSignalSchema>;

export const ActionableAlertSchema = z.strictObject({
  schemaVersion: VERSION,
  alertId: z.string().regex(/^alert-[a-f0-9]{24}$/),
  fingerprint: digest,
  state: z.enum(['firing', 'resolved']),
  hostId: id,
  subject: AlertSubjectSchema,
  condition: id,
  severity: z.enum(['warning', 'critical']),
  recoveryImpact: z.enum(['none', 'degraded', 'recovery-point-at-risk', 'recovery-blocked']),
  impactSummary: boundedText,
  runbook: z.string().min(1).max(512),
  openedAt: timestamp,
  updatedAt: timestamp,
  resolvedAt: timestamp.optional(),
  occurrences: z.number().int().min(1),
  evidence: z.array(AlertEvidenceSchema).min(1).max(20),
  resolutionEvidence: AlertEvidenceSchema.optional(),
}).superRefine((alert, context) => {
  if (alert.state === 'resolved' && (!alert.resolvedAt || !alert.resolutionEvidence)) {
    context.addIssue({ code: 'custom', message: 'resolved alert requires timestamp and resolution evidence' });
  }
  if (alert.state === 'firing' && (alert.resolvedAt || alert.resolutionEvidence)) {
    context.addIssue({ code: 'custom', message: 'firing alert cannot include resolution fields' });
  }
  if (Date.parse(alert.updatedAt) < Date.parse(alert.openedAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'alert update precedes opening' });
  }
  if (alert.resolvedAt && Date.parse(alert.resolvedAt) < Date.parse(alert.openedAt)) {
    context.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'alert resolution precedes opening' });
  }
});
export type ActionableAlert = z.infer<typeof ActionableAlertSchema>;

export const AlertRecoverySignalSchema = z.strictObject({
  schemaVersion: VERSION,
  fingerprint: digest,
  recoveredAt: timestamp,
  evidence: AlertEvidenceSchema,
});

export const HeartbeatPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  source: id,
  intervalSeconds: z.number().int().min(5).max(86_400),
  missedIntervalsBeforeAlert: z.number().int().min(1).max(100),
  severity: z.enum(['warning', 'critical']).default('critical'),
  recoveryImpact: z.enum(['degraded', 'recovery-point-at-risk', 'recovery-blocked']),
  runbook: z.string().min(1).max(512),
});

export const HeartbeatObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  hostId: id,
  subject: AlertSubjectSchema,
  lastHeartbeatAt: timestamp,
  evaluatedAt: timestamp,
  contentDigest: digest,
  correlationId: id.optional(),
});

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
});
const sha256 = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const severityRank = { warning: 0, critical: 1 } as const;
const impactRank = { none: 0, degraded: 1, 'recovery-point-at-risk': 2, 'recovery-blocked': 3 } as const;

export function actionableAlertFingerprint(input: Pick<ActionableAlertSignal, 'hostId' | 'subject' | 'condition'>): string {
  return sha256({ hostId: input.hostId, subjectKind: input.subject.kind, subjectId: input.subject.id, condition: input.condition });
}

/** Opens or deduplicates a firing alert. A resolved alert starts a new incident. */
export function applyActionableAlertSignal(previousInput: unknown | undefined, signalInput: unknown): ActionableAlert {
  const signal = ActionableAlertSignalSchema.parse(signalInput);
  const previous = previousInput === undefined ? undefined : ActionableAlertSchema.parse(previousInput);
  const fingerprint = actionableAlertFingerprint(signal);
  if (previous && previous.fingerprint !== fingerprint) throw new Error('cannot deduplicate a signal into a different alert fingerprint');
  const continuing = previous?.state === 'firing';
  if (continuing && Date.parse(signal.evidence.observedAt) < Date.parse(previous.updatedAt)) {
    throw new Error('alert evidence is older than the current incident state');
  }
  const openedAt = continuing ? previous.openedAt : signal.evidence.observedAt;
  const evidence = continuing
    ? [...previous.evidence, signal.evidence].slice(-20)
    : [signal.evidence];
  return ActionableAlertSchema.parse({
    schemaVersion: 1,
    alertId: continuing ? previous.alertId : `alert-${sha256({ fingerprint, openedAt }).slice(0, 24)}`,
    fingerprint,
    state: 'firing',
    hostId: signal.hostId,
    subject: signal.subject,
    condition: signal.condition,
    severity: continuing && severityRank[previous.severity] > severityRank[signal.severity] ? previous.severity : signal.severity,
    recoveryImpact: continuing && impactRank[previous.recoveryImpact] > impactRank[signal.recoveryImpact]
      ? previous.recoveryImpact : signal.recoveryImpact,
    impactSummary: signal.impactSummary,
    runbook: signal.runbook,
    openedAt,
    updatedAt: signal.evidence.observedAt,
    occurrences: continuing ? previous.occurrences + 1 : 1,
    evidence,
  });
}

/** Clears only the exact firing incident, with recovery evidence observed after it opened. */
export function clearActionableAlert(alertInput: unknown, recoveryInput: unknown): ActionableAlert {
  const alert = ActionableAlertSchema.parse(alertInput);
  const recovery = AlertRecoverySignalSchema.parse(recoveryInput);
  if (alert.state !== 'firing') throw new Error('only a firing alert can be cleared');
  if (recovery.fingerprint !== alert.fingerprint) throw new Error('recovery fingerprint does not match alert');
  if (Date.parse(recovery.recoveredAt) < Date.parse(alert.openedAt)
    || Date.parse(recovery.evidence.observedAt) < Date.parse(alert.openedAt)) {
    throw new Error('recovery evidence predates the alert');
  }
  if (Date.parse(recovery.recoveredAt) < Date.parse(alert.updatedAt)) throw new Error('recovery predates the latest fault evidence');
  if (Date.parse(recovery.evidence.observedAt) > Date.parse(recovery.recoveredAt)) {
    throw new Error('recovery evidence is newer than the recovery decision');
  }
  return ActionableAlertSchema.parse({
    ...alert,
    state: 'resolved',
    updatedAt: recovery.recoveredAt,
    resolvedAt: recovery.recoveredAt,
    resolutionEvidence: recovery.evidence,
  });
}

/** Returns a deterministic missing-heartbeat alert signal, or undefined while the heartbeat is fresh. */
export function detectMissingHeartbeat(policyInput: unknown, observationInput: unknown): ActionableAlertSignal | undefined {
  const policy = HeartbeatPolicySchema.parse(policyInput);
  const observation = HeartbeatObservationSchema.parse(observationInput);
  const elapsedMs = Date.parse(observation.evaluatedAt) - Date.parse(observation.lastHeartbeatAt);
  if (elapsedMs < 0) throw new Error('heartbeat timestamp is in the future');
  const thresholdSeconds = policy.intervalSeconds * policy.missedIntervalsBeforeAlert;
  if (elapsedMs < thresholdSeconds * 1_000) return undefined;
  return ActionableAlertSignalSchema.parse({
    schemaVersion: 1,
    hostId: observation.hostId,
    subject: observation.subject,
    condition: `missing-heartbeat.${policy.source}`,
    severity: policy.severity,
    recoveryImpact: policy.recoveryImpact,
    impactSummary: `${policy.source} heartbeat is ${Math.floor(elapsedMs / 1_000)}s old; freshness limit is ${thresholdSeconds}s`,
    runbook: policy.runbook,
    evidence: {
      observedAt: observation.evaluatedAt,
      source: policy.source,
      summary: `last heartbeat at ${observation.lastHeartbeatAt}`,
      correlationId: observation.correlationId,
      contentDigest: observation.contentDigest,
    },
  });
}
