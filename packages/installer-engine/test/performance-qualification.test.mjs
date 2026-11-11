import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERFORMANCE_CASES,
  PERFORMANCE_SAFETY_INVARIANTS,
  PerformanceBudgetPolicySchema,
  PerformanceObservationSchema,
  calculatePerformancePolicyDigest,
  evaluatePerformanceQualification,
  runPerformanceBenchmarkHarness,
} from '../dist/performance-qualification.js';

const d = character => character.repeat(64);
const required = {
  'bootstrap-cold': ['duration-ms'],
  'plan-warm': ['duration-ms'],
  'critical-path': ['duration-ms'],
  'ready-queue': ['duration-ms', 'queue-depth', 'queue-wait-ms'],
  'lazy-load-cold': ['duration-ms'],
  'lazy-load-warm': ['duration-ms'],
  'host-resources': ['cpu-percent', 'memory-bytes', 'disk-read-bytes', 'disk-write-bytes', 'network-bytes'],
};
const ceiling = metric => metric === 'cpu-percent' ? 80 : metric === 'memory-bytes' ? 512 * 1024 * 1024 : metric.endsWith('-bytes') ? 64 * 1024 * 1024 : 1_000;
const policy = () => ({
  schemaVersion: 1,
  policyId: 'desktop-tools-v1',
  suiteVersion: '1.0.0',
  fixtureDigest: d('a'),
  cases: PERFORMANCE_CASES.map(name => ({
    case: name,
    sampleCount: 2,
    budgets: required[name].map(metric => ({ metric, maximum: ceiling(metric) })),
  })),
});
const measurements = (name, overrides = {}) => required[name].map(metric => ({
  metric,
  value: overrides[metric] ?? (metric === 'memory-bytes' ? 100_000_000 : metric.endsWith('-bytes') ? 1_000_000 : 10),
}));
const safety = (failed = undefined) => PERFORMANCE_SAFETY_INVARIANTS.map(invariant => ({
  invariant,
  passed: invariant !== failed,
  evidenceDigest: d(invariant === failed ? 'b' : 'c'),
}));
const observation = (budgetPolicy = policy(), overrides = {}) => ({
  schemaVersion: 1,
  runId: 'qualification-1',
  policyDigest: calculatePerformancePolicyDigest(budgetPolicy),
  fixtureDigest: budgetPolicy.fixtureDigest,
  implementationDigest: d('d'),
  observedAt: '2026-11-10T12:00:00.000Z',
  cases: PERFORMANCE_CASES.map(name => ({ case: name, samples: [measurements(name), measurements(name)] })),
  safety: safety(),
  ...overrides,
});

test('versioned contracts require exact case, metric, sample, and invariant coverage', () => {
  assert.deepEqual(PerformanceBudgetPolicySchema.parse(policy()), policy());
  assert.deepEqual(PerformanceObservationSchema.parse(observation()), observation());

  const missingCase = structuredClone(policy());
  missingCase.cases.pop();
  assert.throws(() => PerformanceBudgetPolicySchema.parse(missingCase));
  const duplicateMetric = structuredClone(policy());
  duplicateMetric.cases[0].budgets.push(duplicateMetric.cases[0].budgets[0]);
  assert.throws(() => PerformanceBudgetPolicySchema.parse(duplicateMetric), /unique/);
  const unknownVersion = { ...policy(), schemaVersion: 2 };
  assert.throws(() => PerformanceBudgetPolicySchema.parse(unknownVersion));
  const incompleteSafety = observation();
  incompleteSafety.safety.pop();
  assert.throws(() => PerformanceObservationSchema.parse(incompleteSafety));
});

test('qualifies bounded cold, warm, critical-path, queue, and host-resource evidence', () => {
  const result = evaluatePerformanceQualification(policy(), observation());
  assert.equal(result.admitted, true);
  assert.equal(result.safetyPassed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.aggregates.length, 13);
  assert.match(result.resultDigest, /^[a-f0-9]{64}$/);
});

test('a faster result is rejected when any safety invariant regresses', () => {
  const fast = observation(policy(), {
    cases: PERFORMANCE_CASES.map(name => ({ case: name, samples: [measurements(name, Object.fromEntries(required[name].map(metric => [metric, 0]))), measurements(name, Object.fromEntries(required[name].map(metric => [metric, 0])))] })),
    safety: safety('lock-mutual-exclusion'),
  });
  const result = evaluatePerformanceQualification(policy(), fast);
  assert.equal(result.admitted, false);
  assert.equal(result.safetyPassed, false);
  assert.deepEqual(result.failures, ['safety:lock-mutual-exclusion']);
});

test('rejects resource pressure, individual slow samples, insufficient samples, and stale bindings', () => {
  const highMemory = observation();
  highMemory.cases.find(item => item.case === 'host-resources').samples[1] = measurements('host-resources', { 'memory-bytes': 900_000_000 });
  let result = evaluatePerformanceQualification(policy(), highMemory);
  assert.equal(result.admitted, false);
  assert.match(result.failures.join('\n'), /budget:host-resources:memory-bytes/);

  const tooFew = observation();
  tooFew.cases.find(item => item.case === 'plan-warm').samples.pop();
  result = evaluatePerformanceQualification(policy(), tooFew);
  assert.equal(result.admitted, false);
  assert.match(result.failures.join('\n'), /sample-count:plan-warm/);

  assert.throws(() => evaluatePerformanceQualification(policy(), { ...observation(), policyDigest: d('e') }), /exact policy/);
  assert.throws(() => evaluatePerformanceQualification(policy(), { ...observation(), fixtureDigest: d('e') }), /exact fixture/);
});

test('harness runs every declared case deterministically and fails closed on mismatched output', async () => {
  const seen = [];
  const result = await runPerformanceBenchmarkHarness({
    policy: policy(),
    runId: 'harness-1',
    implementationDigest: d('f'),
    observedAt: '2026-11-10T12:00:00.000Z',
    measure: async benchmarkCase => {
      seen.push(benchmarkCase.case);
      return { case: benchmarkCase.case, samples: [measurements(benchmarkCase.case), measurements(benchmarkCase.case)] };
    },
    verifySafety: async () => safety(),
  });
  assert.deepEqual(seen, PERFORMANCE_CASES);
  assert.equal(result.admitted, true);

  await assert.rejects(runPerformanceBenchmarkHarness({
    policy: policy(), runId: 'bad-harness', implementationDigest: d('f'), observedAt: '2026-11-10T12:00:00.000Z',
    measure: async () => ({ case: 'plan-warm', samples: [measurements('plan-warm'), measurements('plan-warm')] }),
    verifySafety: async () => safety(),
  }), /measurer returned/);
});
