import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFleetErrorBudget, fleetRolloutAdmission } from '../dist/index.js';

const policy = {
  schemaVersion: 1, sloId: 'fleet.reconciliation', indicator: 'reconciliation-success', objective: 0.99,
  windowSeconds: 3600, minimumEvents: 100, recoveryWindows: 2, dependentCohorts: ['canary', 'stable'],
};
const window = (hour, goodEvents, totalEvents = 100) => ({
  schemaVersion: 1, sloId: policy.sloId,
  windowStartedAt: `2026-11-10T${String(hour).padStart(2, '0')}:00:00.000Z`,
  windowEndedAt: `2026-11-10T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  goodEvents, totalEvents, evidenceDigest: String(hour).repeat(64).slice(0, 64),
});

test('an exhausted budget pauses every dependent rollout cohort', () => {
  const exhausted = evaluateFleetErrorBudget({ policy, previous: null, window: window(1, 98) });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.rollout, 'pause');
  assert.deepEqual(fleetRolloutAdmission({ policies: [policy], states: [exhausted], cohortId: 'canary' }), {
    admitted: false, blockingSloIds: ['fleet.reconciliation'],
  });
});

test('insufficient evidence cannot clear exhaustion and measured recovery requires every configured window', () => {
  const exhausted = evaluateFleetErrorBudget({ policy, previous: null, window: window(1, 90) });
  const unknown = evaluateFleetErrorBudget({ policy, previous: exhausted, window: window(2, 10, 10) });
  assert.equal(unknown.status, 'exhausted');
  assert.equal(unknown.rollout, 'pause');
  const firstHealthy = evaluateFleetErrorBudget({ policy, previous: unknown, window: window(3, 100) });
  assert.equal(firstHealthy.status, 'recovering');
  assert.equal(firstHealthy.rollout, 'pause');
  const recovered = evaluateFleetErrorBudget({ policy, previous: firstHealthy, window: window(4, 99) });
  assert.equal(recovered.status, 'healthy');
  assert.equal(recovered.rollout, 'proceed');
  assert.equal(recovered.reason, 'measured-recovery');
});

test('missing state fails closed for affected cohorts and unrelated cohorts remain independent', () => {
  assert.deepEqual(fleetRolloutAdmission({ policies: [policy], states: [], cohortId: 'stable' }), {
    admitted: false, blockingSloIds: ['fleet.reconciliation'],
  });
  assert.deepEqual(fleetRolloutAdmission({ policies: [policy], states: [], cohortId: 'experimental' }), {
    admitted: true, blockingSloIds: [],
  });
});

test('window evidence must advance and remain bound to the exact policy', () => {
  const healthy = evaluateFleetErrorBudget({ policy, previous: null, window: window(1, 100) });
  assert.throws(() => evaluateFleetErrorBudget({ policy, previous: healthy, window: window(1, 100) }), /advance monotonically/);
  assert.throws(() => evaluateFleetErrorBudget({ policy, previous: null, window: { ...window(2, 100), sloId: 'other' } }), /does not match/);
});
