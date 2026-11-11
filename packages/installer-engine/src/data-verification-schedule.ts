import { z } from 'zod';

const VERSION = z.literal(1);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const checkKind = z.enum(['structural', 'rotating-content', 'full', 'client-decryption']);
const REQUIRED_CHECKS = checkKind.options;

const ScheduledCheckSchema = z.strictObject({
  kind: checkKind,
  intervalSeconds: z.number().int().min(3_600).max(31_536_000),
  freshnessSeconds: z.number().int().min(3_600).max(31_536_000),
  timeoutSeconds: z.number().int().min(60).max(86_400),
  initialDueAt: timestamp,
});

export const DataVerificationPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: identifier,
  workloadId: identifier,
  maxConcurrentChecks: z.number().int().min(1).max(4),
  rotatingCoverage: z.strictObject({
    eligibleContentCount: z.number().int().min(1).max(10_000_000),
    minimumDistinctContent: z.number().int().min(1).max(10_000_000),
    windowSeconds: z.number().int().min(86_400).max(31_536_000),
  }),
  checks: z.array(ScheduledCheckSchema).length(REQUIRED_CHECKS.length),
}).superRefine((value, context) => {
  const kinds = value.checks.map(check => check.kind);
  if (new Set(kinds).size !== kinds.length || REQUIRED_CHECKS.some(kind => !kinds.includes(kind))) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'policy must schedule every verification class exactly once' });
  }
  if (value.rotatingCoverage.minimumDistinctContent > value.rotatingCoverage.eligibleContentCount) {
    context.addIssue({
      code: 'custom', path: ['rotatingCoverage', 'minimumDistinctContent'],
      message: 'minimum rotating coverage cannot exceed eligible content',
    });
  }
  for (const [index, check] of value.checks.entries()) {
    if (check.freshnessSeconds < check.intervalSeconds) {
      context.addIssue({
        code: 'custom', path: ['checks', index, 'freshnessSeconds'],
        message: 'freshness must cover at least one scheduled interval',
      });
    }
    if (check.timeoutSeconds >= check.intervalSeconds) {
      context.addIssue({
        code: 'custom', path: ['checks', index, 'timeoutSeconds'],
        message: 'check timeout must be shorter than its interval',
      });
    }
  }
});
export type DataVerificationPolicy = z.infer<typeof DataVerificationPolicySchema>;

const BaseResultSchema = z.strictObject({
  schemaVersion: VERSION,
  resultId: identifier,
  policyId: identifier,
  workloadId: identifier,
  kind: checkKind,
  scheduledAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  status: z.enum(['passed', 'failed', 'cancelled', 'timed-out']),
  evidenceDigest: digest,
  contentDigests: z.array(digest).max(10_000),
  serverSideChunkCheck: z.boolean(),
  clientDecryption: z.strictObject({
    attemptedArtifacts: z.number().int().min(1).max(10_000),
    decryptedArtifacts: z.number().int().nonnegative().max(10_000),
    recoveryMaterialDigest: digest,
  }).nullable(),
});

export const DataVerificationResultSchema = BaseResultSchema.superRefine((value, context) => {
  const scheduled = Date.parse(value.scheduledAt);
  const started = Date.parse(value.startedAt);
  const completed = Date.parse(value.completedAt);
  if (started < scheduled) context.addIssue({ code: 'custom', path: ['startedAt'], message: 'check cannot start before its scheduled admission' });
  if (completed <= started) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'check completion must follow its start' });
  if (new Set(value.contentDigests).size !== value.contentDigests.length) {
    context.addIssue({ code: 'custom', path: ['contentDigests'], message: 'content coverage digests must be unique within a result' });
  }
  if (value.kind === 'rotating-content' && value.status === 'passed' && value.contentDigests.length === 0) {
    context.addIssue({ code: 'custom', path: ['contentDigests'], message: 'passed rotating check requires sampled content evidence' });
  }
  if (value.kind !== 'rotating-content' && value.contentDigests.length !== 0) {
    context.addIssue({ code: 'custom', path: ['contentDigests'], message: 'content samples are valid only for rotating-content checks' });
  }
  if (value.kind === 'client-decryption') {
    if (value.clientDecryption === null) {
      context.addIssue({ code: 'custom', path: ['clientDecryption'], message: 'client-decryption check requires decryption evidence' });
    } else {
      if (value.clientDecryption.decryptedArtifacts > value.clientDecryption.attemptedArtifacts) {
        context.addIssue({ code: 'custom', path: ['clientDecryption', 'decryptedArtifacts'], message: 'decrypted count cannot exceed attempted count' });
      }
      if (value.status === 'passed' && value.clientDecryption.decryptedArtifacts !== value.clientDecryption.attemptedArtifacts) {
        context.addIssue({ code: 'custom', path: ['clientDecryption', 'decryptedArtifacts'], message: 'passed client-decryption check must decrypt every attempted artifact' });
      }
    }
    if (value.serverSideChunkCheck) {
      context.addIssue({ code: 'custom', path: ['serverSideChunkCheck'], message: 'server-side chunk verification is not client decryption' });
    }
  } else if (value.clientDecryption !== null) {
    context.addIssue({ code: 'custom', path: ['clientDecryption'], message: 'decryption evidence is valid only for client-decryption checks' });
  }
});
export type DataVerificationResult = z.infer<typeof DataVerificationResultSchema>;

export const DueDataVerificationCheckSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: identifier,
  workloadId: identifier,
  kind: checkKind,
  scheduledAt: timestamp,
  deadlineAt: timestamp,
  reason: z.enum(['initial', 'interval-elapsed', 'retry-failure']),
});
export type DueDataVerificationCheck = z.infer<typeof DueDataVerificationCheckSchema>;

export const DataVerificationAssessmentSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: identifier,
  workloadId: identifier,
  assessedAt: timestamp,
  checks: z.array(z.strictObject({
    kind: checkKind,
    state: z.enum(['missing', 'failed', 'stale', 'covered']),
    latestResultId: identifier.nullable(),
    latestCompletedAt: timestamp.nullable(),
  })).length(REQUIRED_CHECKS.length),
  rotatingCoverage: z.strictObject({
    distinctContent: z.number().int().nonnegative(),
    eligibleContent: z.number().int().positive(),
    ratio: z.number().min(0).max(1),
    requiredDistinctContent: z.number().int().positive(),
    windowStartedAt: timestamp,
  }),
  restoreReadiness: z.enum(['ready', 'not-ready']),
  reasons: z.array(z.string().min(1).max(256)).max(16),
});
export type DataVerificationAssessment = z.infer<typeof DataVerificationAssessmentSchema>;

function parseInputs(policyInput: unknown, resultInputs: readonly unknown[]): {
  policy: DataVerificationPolicy;
  results: DataVerificationResult[];
} {
  const policy = DataVerificationPolicySchema.parse(policyInput);
  const results = z.array(DataVerificationResultSchema).max(100_000).parse(resultInputs);
  const ids = results.map(result => result.resultId);
  if (new Set(ids).size !== ids.length) throw new Error('verification result ids must be unique');
  for (const result of results) {
    if (result.policyId !== policy.policyId || result.workloadId !== policy.workloadId) {
      throw new Error('verification result is outside the selected policy and workload');
    }
    const schedule = policy.checks.find(check => check.kind === result.kind)!;
    if (Date.parse(result.scheduledAt) < Date.parse(schedule.initialDueAt)) {
      throw new Error('verification result predates its policy schedule');
    }
    if (Date.parse(result.completedAt) - Date.parse(result.startedAt) > schedule.timeoutSeconds * 1_000) {
      throw new Error('verification result exceeded its bounded timeout');
    }
    if (result.contentDigests.length > policy.rotatingCoverage.eligibleContentCount) {
      throw new Error('verification result claims more content than the eligible coverage set');
    }
  }
  return { policy, results };
}

/**
 * Returns at most one runnable item for each verification class. Missed intervals
 * are coalesced instead of replaying an unbounded backlog after an outage.
 */
export function planDueDataVerificationChecks(input: {
  policy: unknown;
  results: readonly unknown[];
  now: string;
}): DueDataVerificationCheck[] {
  const { policy, results } = parseInputs(input.policy, input.results);
  const now = timestamp.parse(input.now);
  const nowMs = Date.parse(now);
  if (results.some(result => Date.parse(result.completedAt) > nowMs || Date.parse(result.scheduledAt) > nowMs)) {
    throw new Error('future verification evidence cannot control current scheduling');
  }
  const due = policy.checks.flatMap(check => {
    const candidates = results.filter(result => result.kind === check.kind)
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
    const latest = candidates[0];
    const initialMs = Date.parse(check.initialDueAt);
    if (initialMs > nowMs && latest === undefined) return [];
    const dueMs = latest === undefined ? initialMs : Date.parse(latest.completedAt) + check.intervalSeconds * 1_000;
    if (dueMs > nowMs) return [];
    const reason = latest === undefined ? 'initial' : latest.status === 'passed' ? 'interval-elapsed' : 'retry-failure';
    // Admission is "now" for overdue work: an old missed schedule must not make
    // the new execution instantly timed out or cause one job per missed period.
    const scheduledAt = new Date(Math.max(dueMs, nowMs)).toISOString();
    return [DueDataVerificationCheckSchema.parse({
      schemaVersion: 1, policyId: policy.policyId, workloadId: policy.workloadId,
      kind: check.kind, scheduledAt,
      deadlineAt: new Date(Date.parse(scheduledAt) + check.timeoutSeconds * 1_000).toISOString(), reason,
    })];
  });
  return due.sort((left, right) => REQUIRED_CHECKS.indexOf(left.kind) - REQUIRED_CHECKS.indexOf(right.kind))
    .slice(0, policy.maxConcurrentChecks);
}

export function assessDataVerificationCoverage(input: {
  policy: unknown;
  results: readonly unknown[];
  now: string;
}): DataVerificationAssessment {
  const { policy, results } = parseInputs(input.policy, input.results);
  const now = timestamp.parse(input.now);
  const nowMs = Date.parse(now);
  for (const result of results) {
    if (Date.parse(result.completedAt) > nowMs) throw new Error('future verification evidence cannot establish current coverage');
  }

  const checks = REQUIRED_CHECKS.map(kind => {
    const schedule = policy.checks.find(check => check.kind === kind)!;
    const latest = results.filter(result => result.kind === kind)
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))[0];
    const state = latest === undefined ? 'missing'
      : latest.status !== 'passed' ? 'failed'
        : nowMs - Date.parse(latest.completedAt) > schedule.freshnessSeconds * 1_000 ? 'stale' : 'covered';
    return {
      kind, state,
      latestResultId: latest?.resultId ?? null,
      latestCompletedAt: latest?.completedAt ?? null,
    };
  });

  const windowStartedMs = nowMs - policy.rotatingCoverage.windowSeconds * 1_000;
  const distinctContent = new Set(results
    .filter(result => result.kind === 'rotating-content' && result.status === 'passed'
      && Date.parse(result.completedAt) >= windowStartedMs && Date.parse(result.completedAt) <= nowMs)
    .flatMap(result => result.contentDigests)).size;
  const boundedDistinctContent = Math.min(distinctContent, policy.rotatingCoverage.eligibleContentCount);
  const ratio = boundedDistinctContent / policy.rotatingCoverage.eligibleContentCount;
  const reasons = checks.filter(check => check.state !== 'covered')
    .map(check => `${check.kind}:${check.state}`);
  if (boundedDistinctContent < policy.rotatingCoverage.minimumDistinctContent) reasons.push('rotating-content:insufficient-coverage');

  const clientCheck = checks.find(check => check.kind === 'client-decryption')!;
  const latestClientResult = results.filter(result => result.kind === 'client-decryption')
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))[0];
  const clientProvesRecovery = clientCheck.state === 'covered'
    && latestClientResult?.clientDecryption !== null
    && latestClientResult?.clientDecryption !== undefined
    && latestClientResult.clientDecryption.decryptedArtifacts === latestClientResult.clientDecryption.attemptedArtifacts;
  if (!clientProvesRecovery && !reasons.includes(`client-decryption:${clientCheck.state}`)) {
    reasons.push('client-decryption:unproven');
  }

  const restoreReadiness = reasons.length === 0 && clientProvesRecovery ? 'ready' : 'not-ready';
  return DataVerificationAssessmentSchema.parse({
    schemaVersion: 1, policyId: policy.policyId, workloadId: policy.workloadId, assessedAt: now,
    checks, rotatingCoverage: {
      distinctContent: boundedDistinctContent,
      eligibleContent: policy.rotatingCoverage.eligibleContentCount,
      ratio,
      requiredDistinctContent: policy.rotatingCoverage.minimumDistinctContent,
      windowStartedAt: new Date(windowStartedMs).toISOString(),
    },
    restoreReadiness, reasons: [...new Set(reasons)],
  });
}
