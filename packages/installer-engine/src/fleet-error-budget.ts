import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

export const FleetSloPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  sloId: id,
  indicator: z.enum(['reconciliation-success', 'verification-freshness', 'return-heartbeat', 'restore-success']),
  objective: z.number().min(0.5).max(1),
  windowSeconds: z.number().int().min(60).max(31_536_000),
  minimumEvents: z.number().int().min(1).max(1_000_000),
  recoveryWindows: z.number().int().min(1).max(100),
  dependentCohorts: z.array(id).min(1).max(512).refine(values => new Set(values).size === values.length, 'dependent cohorts must be unique'),
});
export type FleetSloPolicy = z.infer<typeof FleetSloPolicySchema>;

export const FleetSloWindowSchema = z.strictObject({
  schemaVersion: VERSION,
  sloId: id,
  windowStartedAt: timestamp,
  windowEndedAt: timestamp,
  goodEvents: z.number().int().nonnegative().max(1_000_000),
  totalEvents: z.number().int().nonnegative().max(1_000_000),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((value, context) => {
  if (value.goodEvents > value.totalEvents) context.addIssue({ code: 'custom', path: ['goodEvents'], message: 'good events cannot exceed total events' });
  if (Date.parse(value.windowEndedAt) <= Date.parse(value.windowStartedAt)) {
    context.addIssue({ code: 'custom', path: ['windowEndedAt'], message: 'window end must follow its start' });
  }
});
export type FleetSloWindow = z.infer<typeof FleetSloWindowSchema>;

export const FleetErrorBudgetStateSchema = z.strictObject({
  schemaVersion: VERSION,
  sloId: id,
  status: z.enum(['healthy', 'exhausted', 'recovering']),
  consecutiveHealthyWindows: z.number().int().nonnegative().max(100),
  lastWindowEndedAt: timestamp.nullable(),
  lastEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  rollout: z.enum(['proceed', 'pause']),
  reason: z.enum(['objective-met', 'objective-missed', 'insufficient-evidence', 'measured-recovery']),
});
export type FleetErrorBudgetState = z.infer<typeof FleetErrorBudgetStateSchema>;

export function evaluateFleetErrorBudget(input: {
  policy: unknown;
  previous: unknown | null;
  window: unknown;
}): FleetErrorBudgetState {
  const policy = FleetSloPolicySchema.parse(input.policy);
  const window = FleetSloWindowSchema.parse(input.window);
  if (window.sloId !== policy.sloId) throw new Error('SLO window does not match policy');
  const previous = input.previous === null ? null : FleetErrorBudgetStateSchema.parse(input.previous);
  if (previous && previous.sloId !== policy.sloId) throw new Error('prior error-budget state does not match policy');
  if (previous?.lastWindowEndedAt && Date.parse(window.windowEndedAt) <= Date.parse(previous.lastWindowEndedAt)) {
    throw new Error('SLO windows must advance monotonically');
  }
  const observed = window.totalEvents >= policy.minimumEvents;
  const achieved = observed && window.goodEvents / window.totalEvents >= policy.objective;
  const wasPaused = previous?.rollout === 'pause';
  let status: FleetErrorBudgetState['status'];
  let rollout: FleetErrorBudgetState['rollout'];
  let reason: FleetErrorBudgetState['reason'];
  let consecutiveHealthyWindows = 0;
  if (!observed) {
    status = wasPaused ? (previous?.status === 'exhausted' ? 'exhausted' : 'recovering') : 'healthy';
    rollout = wasPaused ? 'pause' : 'proceed';
    reason = 'insufficient-evidence';
    consecutiveHealthyWindows = 0;
  } else if (!achieved) {
    status = 'exhausted'; rollout = 'pause'; reason = 'objective-missed';
  } else if (wasPaused) {
    consecutiveHealthyWindows = (previous?.consecutiveHealthyWindows ?? 0) + 1;
    if (consecutiveHealthyWindows >= policy.recoveryWindows) {
      status = 'healthy'; rollout = 'proceed'; reason = 'measured-recovery';
    } else {
      status = 'recovering'; rollout = 'pause'; reason = 'measured-recovery';
    }
  } else {
    status = 'healthy'; rollout = 'proceed'; reason = 'objective-met';
    consecutiveHealthyWindows = Math.min(1, policy.recoveryWindows);
  }
  return FleetErrorBudgetStateSchema.parse({
    schemaVersion: 1, sloId: policy.sloId, status, consecutiveHealthyWindows,
    lastWindowEndedAt: window.windowEndedAt, lastEvidenceDigest: window.evidenceDigest, rollout, reason,
  });
}

export function fleetRolloutAdmission(input: {
  policies: readonly unknown[];
  states: readonly unknown[];
  cohortId: string;
}): { admitted: boolean; blockingSloIds: string[] } {
  const policies = z.array(FleetSloPolicySchema).max(10_000).parse(input.policies);
  const states = z.array(FleetErrorBudgetStateSchema).max(10_000).parse(input.states);
  const cohortId = id.parse(input.cohortId);
  const bySlo = new Map(states.map(state => [state.sloId, state]));
  if (bySlo.size !== states.length) throw new Error('duplicate fleet error-budget states');
  const blockingSloIds = policies
    .filter(policy => policy.dependentCohorts.includes(cohortId))
    .filter(policy => bySlo.get(policy.sloId)?.rollout !== 'proceed')
    .map(policy => policy.sloId)
    .sort();
  return Object.freeze({ admitted: blockingSloIds.length === 0, blockingSloIds });
}
