import assert from 'node:assert/strict'; import test from 'node:test';
import { buildCorrelatedSloWindow, evaluateFleetErrorBudget, fleetRolloutAdmission } from '../dist/index.js';
const indicators = ['bootstrap-success','enrollment-success','planning-success','execution-success','verification-freshness','reconciliation-success','secret-delivery-success','telemetry-delivery-success','restore-success','return-heartbeat'];
const policy = indicator => ({ schemaVersion: 1, sloId: `slo.${indicator}`, indicator, objective: 0.99, windowSeconds: 3600, minimumEvents: 2, recoveryWindows: 2, dependentCohorts: ['canary'] });
const evidence = (indicator, n, outcome = 'good') => ({ schemaVersion: 1, evidenceId: `e-${indicator}-${n}`, indicator, observedAt: `2026-11-10T12:${String(n).padStart(2,'0')}:00.000Z`, traceId: String(n % 10).repeat(32), runId: `run-${n}`, hostId: 'host-1', outcome, sourceEvidenceDigest: String((n + 1) % 10).repeat(64) });
test('every operational SLI compiles from correlated evidence', () => {
  for (const indicator of indicators) {
    const window = buildCorrelatedSloWindow({ policy: policy(indicator), windowStartedAt: '2026-11-10T12:00:00.000Z', windowEndedAt: '2026-11-10T13:00:00.000Z', evidence: [evidence(indicator, 1), evidence(indicator, 2)] });
    assert.equal(window.goodEvents, 2); assert.equal(window.totalEvents, 2);
  }
});
test('measured correlated failures consume the applicable rollout budget', () => {
  const p = policy('execution-success');
  const window = buildCorrelatedSloWindow({ policy: p, windowStartedAt: '2026-11-10T12:00:00.000Z', windowEndedAt: '2026-11-10T13:00:00.000Z', evidence: [evidence(p.indicator, 1), evidence(p.indicator, 2, 'bad')] });
  const state = evaluateFleetErrorBudget({ policy: p, previous: null, window });
  assert.equal(state.rollout, 'pause'); assert.deepEqual(fleetRolloutAdmission({ policies: [p], states: [state], cohortId: 'canary' }), { admitted: false, blockingSloIds: [p.sloId] });
});
test('uncorrelated, duplicated, wrong-indicator, and out-of-window evidence fails closed', () => {
  const p = policy('bootstrap-success'); const one = evidence(p.indicator, 1);
  const base = { policy: p, windowStartedAt: '2026-11-10T12:00:00.000Z', windowEndedAt: '2026-11-10T13:00:00.000Z' };
  assert.throws(() => buildCorrelatedSloWindow({ ...base, evidence: [one, one] }), /unique/);
  assert.throws(() => buildCorrelatedSloWindow({ ...base, evidence: [{ ...one, indicator: 'restore-success' }] }), /does not match/);
  assert.throws(() => buildCorrelatedSloWindow({ ...base, evidence: [{ ...one, observedAt: '2026-11-10T13:00:00.000Z' }] }), /outside/);
  assert.throws(() => buildCorrelatedSloWindow({ ...base, windowEndedAt: '2026-11-10T12:59:00.000Z', evidence: [] }), /duration/);
});
