import { createHash } from 'node:crypto';
import { z } from 'zod';

export const FAULT_KINDS = [
  'process-loss', 'reboot', 'enospc', 'dns', 'corrupt-artifact',
  'expired-credential', 'lock-loss', 'clock-skew', 'permission-drift',
  'telemetry-failure',
] as const;

export const FAULT_BOUNDARIES = [
  'preflight', 'before-mutation', 'mutation-possible', 'after-mutation',
  'verification', 'recording', 'advisory-export',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);

export const FaultScenarioSchema = z.strictObject({
  id: identifier,
  kind: z.enum(FAULT_KINDS),
  boundary: z.enum(FAULT_BOUNDARIES),
  occurrence: z.number().int().min(1).max(1_000).default(1),
}).superRefine((scenario, context) => {
  if (scenario.kind === 'telemetry-failure' && scenario.boundary !== 'advisory-export') {
    context.addIssue({ code: 'custom', path: ['boundary'], message: 'telemetry failure is only injectable at the fail-open advisory export boundary' });
  }
  if (scenario.kind === 'corrupt-artifact' && !['preflight', 'before-mutation'].includes(scenario.boundary)) {
    context.addIssue({ code: 'custom', path: ['boundary'], message: 'artifact integrity must be rejected before mutation' });
  }
});

export type FaultScenario = z.infer<typeof FaultScenarioSchema>;
export type FaultOutcomeClass = 'recoverable' | 'uncertain';
export type FaultNextAction =
  | 'retry-preflight' | 'renew-credential' | 'repair-clock' | 'restore-permission'
  | 'replace-artifact' | 'reacquire-lock' | 'resume-from-checkpoint'
  | 'complete-reboot' | 'inspect-postcondition' | 'retry-telemetry';

export interface FaultOutcome {
  readonly scenario: FaultScenario;
  readonly outcome: FaultOutcomeClass;
  readonly status: 'blocked' | 'interrupted' | 'pending-reboot' | 'success-with-telemetry-gap';
  readonly mutationMayHaveOccurred: boolean;
  readonly automaticRetryAllowed: boolean;
  readonly resumeAllowed: boolean;
  readonly nextAction: FaultNextAction;
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
});

export class InjectedFaultError extends Error {
  readonly scenario: FaultScenario;

  constructor(scenario: FaultScenario) {
    super(`deterministic fault injected: ${scenario.kind} at ${scenario.boundary}`);
    this.name = 'InjectedFaultError';
    this.scenario = scenario;
  }
}

/** A one-scenario injector for disposable qualification runs. It never mutates production behavior. */
export function createDeterministicFaultInjector(input: unknown) {
  const scenario = FaultScenarioSchema.parse(input);
  let hits = 0;
  let injected = false;
  return Object.freeze({
    hit(kind: FaultScenario['kind'], boundary: FaultScenario['boundary']): void {
      if (injected || kind !== scenario.kind || boundary !== scenario.boundary) return;
      hits += 1;
      if (hits === scenario.occurrence) {
        injected = true;
        throw new InjectedFaultError(scenario);
      }
    },
    evidence: () => Object.freeze({ scenario, matchingHits: hits, injected }),
  });
}

export function classifyInjectedFault(input: unknown): FaultOutcome {
  const scenario = FaultScenarioSchema.parse(input);
  const mutationMayHaveOccurred = ['mutation-possible', 'after-mutation', 'verification', 'recording'].includes(scenario.boundary);
  if (mutationMayHaveOccurred) {
    return Object.freeze({ scenario, outcome: 'uncertain', status: 'interrupted', mutationMayHaveOccurred: true,
      automaticRetryAllowed: false, resumeAllowed: false, nextAction: 'inspect-postcondition' });
  }
  if (scenario.kind === 'telemetry-failure') {
    return Object.freeze({ scenario, outcome: 'recoverable', status: 'success-with-telemetry-gap', mutationMayHaveOccurred: false,
      automaticRetryAllowed: true, resumeAllowed: false, nextAction: 'retry-telemetry' });
  }
  if (scenario.kind === 'reboot') {
    return Object.freeze({ scenario, outcome: 'recoverable', status: 'pending-reboot', mutationMayHaveOccurred: false,
      automaticRetryAllowed: false, resumeAllowed: true, nextAction: 'complete-reboot' });
  }
  const nextAction: FaultNextAction = scenario.kind === 'expired-credential' ? 'renew-credential'
    : scenario.kind === 'clock-skew' ? 'repair-clock'
    : scenario.kind === 'permission-drift' ? 'restore-permission'
    : scenario.kind === 'corrupt-artifact' ? 'replace-artifact'
    : scenario.kind === 'lock-loss' ? 'reacquire-lock'
    : scenario.kind === 'process-loss' ? 'resume-from-checkpoint'
    : 'retry-preflight';
  return Object.freeze({ scenario, outcome: 'recoverable', status: scenario.kind === 'process-loss' ? 'interrupted' : 'blocked',
    mutationMayHaveOccurred: false, automaticRetryAllowed: scenario.kind === 'dns',
    resumeAllowed: scenario.kind === 'process-loss' || scenario.kind === 'lock-loss', nextAction });
}

export function runDeterministicFaultMatrix(inputs: readonly unknown[]) {
  const scenarios = inputs.map(input => FaultScenarioSchema.parse(input));
  if (new Set(scenarios.map(scenario => scenario.id)).size !== scenarios.length) throw new Error('duplicate fault scenario identifiers');
  const outcomes = scenarios.map(classifyInjectedFault).sort((left, right) => left.scenario.id.localeCompare(right.scenario.id));
  const covered = new Set(outcomes.map(item => item.scenario.kind));
  const missingKinds = FAULT_KINDS.filter(kind => !covered.has(kind));
  const report = { schemaVersion: 1 as const, complete: missingKinds.length === 0, missingKinds, outcomes };
  return Object.freeze({ ...report, digest: createHash('sha256').update(stable(report)).digest('hex') });
}
