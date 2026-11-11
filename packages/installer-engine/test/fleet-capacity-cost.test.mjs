import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFleetCapacityCostForecast } from '../dist/index.js';

const names = [
  'disk-capacity-bytes', 'snapshot-retained-bytes', 'replication-headroom-bytes', 'backup-retained-bytes',
  'egress-cost-usd-micros', 'api-operation-count', 'telemetry-cost-usd-micros',
  'model-cost-usd-micros', 'restore-cost-usd-micros',
];
const input = {
  schemaVersion: 1, forecastId: 'fleet-canary', observedAt: '2026-11-10T18:00:00.000Z', horizonHours: 168,
  evidenceDigest: 'a'.repeat(64), metrics: names.map(metric => ({
    metric, current: 40, projectedIncrease: 10, limit: 100, warningRatio: 0.7, admissionRatio: 0.9, confidence: 'measured',
  })),
};

test('complete measured forecasts admit sustained work below early thresholds', () => {
  const decision = evaluateFleetCapacityCostForecast(input);
  assert.equal(decision.admitted, true);
  assert.deepEqual(decision.blockedWork, []);
  assert.ok(decision.metrics.every(metric => metric.status === 'safe'));
});

test('each capacity or cost threshold gates its dependent sustained work before exhaustion', () => {
  for (const metricName of names) {
    const changed = structuredClone(input);
    const metric = changed.metrics.find(candidate => candidate.metric === metricName);
    metric.current = 80; metric.projectedIncrease = 10;
    const decision = evaluateFleetCapacityCostForecast(changed);
    const result = decision.metrics.find(candidate => candidate.metric === metricName);
    assert.equal(result.status, 'gated', metricName);
    assert.ok(result.utilization < 1, `${metricName} must gate before exhaustion`);
    assert.equal(result.blockedWork.length > 0, true);
    assert.equal(decision.admitted, false);
  }
});

test('unknown confidence fails closed and evidence changes decision identity', () => {
  const unknown = structuredClone(input);
  unknown.metrics[0].confidence = 'unknown';
  const blocked = evaluateFleetCapacityCostForecast(unknown);
  assert.equal(blocked.metrics.find(metric => metric.metric === names[0]).status, 'unverified');
  assert.equal(blocked.admitted, false);
  assert.notEqual(blocked.decisionDigest, evaluateFleetCapacityCostForecast({ ...input, evidenceDigest: 'b'.repeat(64) }).decisionDigest);
});

test('forecasts reject missing, duplicate, contradictory, and overflowing metrics', () => {
  assert.throws(() => evaluateFleetCapacityCostForecast({ ...input, metrics: input.metrics.slice(1) }), /length|metric/i);
  assert.throws(() => evaluateFleetCapacityCostForecast({ ...input, metrics: input.metrics.map((metric, index) => index === 1 ? input.metrics[0] : metric) }), /exactly once/);
  assert.throws(() => evaluateFleetCapacityCostForecast({ ...input, metrics: input.metrics.map((metric, index) => index === 0 ? { ...metric, warningRatio: 0.9 } : metric) }), /precede/);
  const overflow = structuredClone(input); overflow.metrics[0].current = Number.MAX_SAFE_INTEGER; overflow.metrics[0].projectedIncrease = 1;
  assert.throws(() => evaluateFleetCapacityCostForecast(overflow), /overflow/);
});
