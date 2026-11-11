import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PERFORMANCE_CASES = [
  'bootstrap-cold',
  'plan-warm',
  'critical-path',
  'ready-queue',
  'lazy-load-cold',
  'lazy-load-warm',
  'host-resources',
] as const;

export const PERFORMANCE_METRICS = [
  'duration-ms',
  'queue-depth',
  'queue-wait-ms',
  'cpu-percent',
  'memory-bytes',
  'disk-read-bytes',
  'disk-write-bytes',
  'network-bytes',
] as const;

export const PERFORMANCE_SAFETY_INVARIANTS = [
  'bounded-ready-queue',
  'exact-plan-authority',
  'lock-mutual-exclusion',
  'resource-ceilings',
  'rollback-boundaries',
  'secret-nondisclosure',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const finiteNonnegative = z.number().finite().nonnegative();
const metric = z.enum(PERFORMANCE_METRICS);

const requiredMetrics: Readonly<Record<typeof PERFORMANCE_CASES[number], readonly typeof PERFORMANCE_METRICS[number][]>> = {
  'bootstrap-cold': ['duration-ms'],
  'plan-warm': ['duration-ms'],
  'critical-path': ['duration-ms'],
  'ready-queue': ['duration-ms', 'queue-depth', 'queue-wait-ms'],
  'lazy-load-cold': ['duration-ms'],
  'lazy-load-warm': ['duration-ms'],
  'host-resources': ['cpu-percent', 'memory-bytes', 'disk-read-bytes', 'disk-write-bytes', 'network-bytes'],
};

const MetricBudgetSchema = z.strictObject({ metric, maximum: finiteNonnegative });
const MetricObservationSchema = z.strictObject({ metric, value: finiteNonnegative });

function validateMetricValue(
  item: { metric: typeof PERFORMANCE_METRICS[number]; value?: number; maximum?: number },
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const value = item.value ?? item.maximum!;
  if (item.metric === 'cpu-percent' && value > 100) {
    context.addIssue({ code: 'custom', path, message: 'cpu-percent cannot exceed 100' });
  }
  if (['queue-depth', 'memory-bytes', 'disk-read-bytes', 'disk-write-bytes', 'network-bytes'].includes(item.metric)
    && !Number.isSafeInteger(value)) {
    context.addIssue({ code: 'custom', path, message: `${item.metric} must be a safe integer` });
  }
}

function exactCoverage(
  values: readonly { metric: typeof PERFORMANCE_METRICS[number] }[],
  expected: readonly typeof PERFORMANCE_METRICS[number][],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const actual = values.map(item => item.metric);
  if (new Set(actual).size !== actual.length) {
    context.addIssue({ code: 'custom', path, message: 'metrics must be unique' });
  }
  const missing = expected.filter(item => !actual.includes(item));
  const surplus = actual.filter(item => !expected.includes(item));
  if (missing.length > 0 || surplus.length > 0) {
    context.addIssue({ code: 'custom', path, message: `metric coverage mismatch (missing: ${missing.join(',') || 'none'}; surplus: ${surplus.join(',') || 'none'})` });
  }
}

export const PerformanceBudgetPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyId: identifier,
  suiteVersion: z.string().min(1).max(64),
  fixtureDigest: digest,
  cases: z.array(z.strictObject({
    case: z.enum(PERFORMANCE_CASES),
    sampleCount: z.number().int().min(1).max(10_000),
    budgets: z.array(MetricBudgetSchema).min(1).max(PERFORMANCE_METRICS.length),
  })).length(PERFORMANCE_CASES.length),
}).superRefine((policy, context) => {
  const names = policy.cases.map(item => item.case);
  if (new Set(names).size !== PERFORMANCE_CASES.length || PERFORMANCE_CASES.some(item => !names.includes(item))) {
    context.addIssue({ code: 'custom', path: ['cases'], message: 'policy must cover every performance case exactly once' });
  }
  policy.cases.forEach((item, index) => {
    exactCoverage(item.budgets, requiredMetrics[item.case], context, ['cases', index, 'budgets']);
    item.budgets.forEach((budget, budgetIndex) => validateMetricValue(budget, context, ['cases', index, 'budgets', budgetIndex, 'maximum']));
  });
});

const SafetyObservationSchema = z.strictObject({
  invariant: z.enum(PERFORMANCE_SAFETY_INVARIANTS),
  passed: z.boolean(),
  evidenceDigest: digest,
});

export const PerformanceObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: identifier,
  policyDigest: digest,
  fixtureDigest: digest,
  implementationDigest: digest,
  observedAt: timestamp,
  cases: z.array(z.strictObject({
    case: z.enum(PERFORMANCE_CASES),
    samples: z.array(z.array(MetricObservationSchema).min(1).max(PERFORMANCE_METRICS.length)).min(1).max(10_000),
  })).length(PERFORMANCE_CASES.length),
  safety: z.array(SafetyObservationSchema).length(PERFORMANCE_SAFETY_INVARIANTS.length),
}).superRefine((observation, context) => {
  const names = observation.cases.map(item => item.case);
  if (new Set(names).size !== PERFORMANCE_CASES.length || PERFORMANCE_CASES.some(item => !names.includes(item))) {
    context.addIssue({ code: 'custom', path: ['cases'], message: 'observation must cover every performance case exactly once' });
  }
  observation.cases.forEach((item, caseIndex) => item.samples.forEach((sample, sampleIndex) => {
    exactCoverage(sample, requiredMetrics[item.case], context, ['cases', caseIndex, 'samples', sampleIndex]);
    sample.forEach((measurement, metricIndex) => validateMetricValue(measurement, context,
      ['cases', caseIndex, 'samples', sampleIndex, metricIndex, 'value']));
  }));
  const invariants = observation.safety.map(item => item.invariant);
  if (new Set(invariants).size !== PERFORMANCE_SAFETY_INVARIANTS.length
    || PERFORMANCE_SAFETY_INVARIANTS.some(item => !invariants.includes(item))) {
    context.addIssue({ code: 'custom', path: ['safety'], message: 'observation must cover every safety invariant exactly once' });
  }
});

export type PerformanceBudgetPolicy = z.infer<typeof PerformanceBudgetPolicySchema>;
export type PerformanceObservation = z.infer<typeof PerformanceObservationSchema>;

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

export function calculatePerformancePolicyDigest(input: unknown): string {
  return createHash('sha256').update(stable(PerformanceBudgetPolicySchema.parse(input))).digest('hex');
}

export interface PerformanceQualificationResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly policyDigest: string;
  readonly implementationDigest: string;
  readonly admitted: boolean;
  readonly safetyPassed: boolean;
  readonly failures: readonly string[];
  readonly aggregates: readonly { case: typeof PERFORMANCE_CASES[number]; metric: typeof PERFORMANCE_METRICS[number]; maximum: number; budget: number; passed: boolean }[];
  readonly resultDigest: string;
}

/** Evaluates observed evidence. It never grants authority to execute host mutations. */
export function evaluatePerformanceQualification(policyInput: unknown, observationInput: unknown): PerformanceQualificationResult {
  const policy = PerformanceBudgetPolicySchema.parse(policyInput);
  const observation = PerformanceObservationSchema.parse(observationInput);
  const policyDigest = calculatePerformancePolicyDigest(policy);
  if (observation.policyDigest !== policyDigest) throw new Error('performance observation is not bound to the exact policy');
  if (observation.fixtureDigest !== policy.fixtureDigest) throw new Error('performance observation is not bound to the exact fixture');

  const failures: string[] = [];
  const safetyPassed = observation.safety.every(item => item.passed);
  for (const item of observation.safety.filter(item => !item.passed)) failures.push(`safety:${item.invariant}`);
  const aggregates: Array<Omit<PerformanceQualificationResult['aggregates'][number], never>> = [];
  for (const budgetCase of policy.cases) {
    const observedCase = observation.cases.find(item => item.case === budgetCase.case)!;
    if (observedCase.samples.length !== budgetCase.sampleCount) {
      failures.push(`sample-count:${budgetCase.case}:${observedCase.samples.length}/${budgetCase.sampleCount}`);
    }
    for (const budget of budgetCase.budgets) {
      const maximum = Math.max(...observedCase.samples.map(sample => sample.find(item => item.metric === budget.metric)!.value));
      const passed = maximum <= budget.maximum;
      aggregates.push({ case: budgetCase.case, metric: budget.metric, maximum, budget: budget.maximum, passed });
      if (!passed) failures.push(`budget:${budgetCase.case}:${budget.metric}:${maximum}/${budget.maximum}`);
    }
  }
  aggregates.sort((left, right) => `${left.case}:${left.metric}`.localeCompare(`${right.case}:${right.metric}`));
  failures.sort();
  const result = {
    schemaVersion: 1 as const,
    runId: observation.runId,
    policyDigest,
    implementationDigest: observation.implementationDigest,
    admitted: safetyPassed && failures.length === 0,
    safetyPassed,
    failures,
    aggregates,
  };
  return Object.freeze({ ...result, resultDigest: createHash('sha256').update(stable(result)).digest('hex') });
}

export type PerformanceCaseMeasurement = PerformanceObservation['cases'][number];

/** Runs each declared case once through an injected measurer, then performs strict qualification. */
export async function runPerformanceBenchmarkHarness(input: {
  policy: unknown;
  runId: string;
  implementationDigest: string;
  observedAt: string;
  measure: (benchmarkCase: PerformanceBudgetPolicy['cases'][number]) => Promise<PerformanceCaseMeasurement>;
  verifySafety: () => Promise<PerformanceObservation['safety']>;
}): Promise<PerformanceQualificationResult> {
  const policy = PerformanceBudgetPolicySchema.parse(input.policy);
  const cases: PerformanceCaseMeasurement[] = [];
  for (const benchmarkCase of policy.cases) {
    const measured = await input.measure(benchmarkCase);
    if (measured.case !== benchmarkCase.case) throw new Error(`measurer returned ${measured.case} for ${benchmarkCase.case}`);
    cases.push(measured);
  }
  return evaluatePerformanceQualification(policy, {
    schemaVersion: 1,
    runId: input.runId,
    policyDigest: calculatePerformancePolicyDigest(policy),
    fixtureDigest: policy.fixtureDigest,
    implementationDigest: input.implementationDigest,
    observedAt: input.observedAt,
    cases,
    safety: await input.verifySafety(),
  });
}
