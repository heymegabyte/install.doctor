import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWorkloadUsability, WorkloadUsabilityPolicySchema } from '../dist/workload-usability-guard.js';

const resources = (cpuUtilization, memoryUtilization, ioUtilization, networkUtilization) =>
  ({ cpuUtilization, memoryUtilization, ioUtilization, networkUtilization });
const kinds = ['provisioning', 'verification', 'replication', 'scrub', 'pruning'];
const policy = {
  schemaVersion: 1,
  policyId: 'zen-usability',
  hostCeilings: resources(.8, .85, .75, .8),
  operationBudgets: kinds.map(operation => ({
    operation, maxConcurrency: operation === 'verification' ? 2 : 1,
    projectedUtilization: resources(.1, .05, operation === 'scrub' ? .25 : .1, operation === 'replication' ? .2 : .05),
  })),
  foregroundBudgets: [{ serviceId: 'api', maxP95LatencyMs: 250, maxErrorRate: .01, minHealthyReplicas: 2 }],
};
const observation = {
  schemaVersion: 1, observedAt: '2026-11-10T12:00:00Z', hostUtilization: resources(.4, .5, .3, .2),
  foregroundServices: [{ serviceId: 'api', p95LatencyMs: 100, errorRate: .001, healthyReplicas: 2 }],
};

test('admits all five guarded operation classes only inside declared resource and service budgets', () => {
  for (const operation of kinds) {
    const result = evaluateWorkloadUsability({ schemaVersion: 1, phase: 'admission', operation, activeOperationCount: 0, policy, observation });
    assert.equal(result.action, 'admit', operation);
    assert.deepEqual(result.reasons, []);
  }
});

test('defers before launch and pauses at runtime when foreground usability exceeds its budget', () => {
  const degraded = { ...observation, foregroundServices: [{ serviceId: 'api', p95LatencyMs: 251, errorRate: .02, healthyReplicas: 1 }] };
  const admission = evaluateWorkloadUsability({ schemaVersion: 1, phase: 'admission', operation: 'replication', activeOperationCount: 0, policy, observation: degraded });
  assert.equal(admission.action, 'defer');
  assert.deepEqual(admission.reasons, ['foreground-availability:api', 'foreground-errors:api', 'foreground-latency:api']);
  const runtime = evaluateWorkloadUsability({ schemaVersion: 1, phase: 'runtime', operation: 'scrub', activeOperationCount: 1, policy, observation: degraded });
  assert.equal(runtime.action, 'pause');
});

test('projects operation pressure at admission and enforces per-operation concurrency', () => {
  const busy = { ...observation, hostUtilization: resources(.75, .5, .6, .2) };
  const result = evaluateWorkloadUsability({ schemaVersion: 1, phase: 'admission', operation: 'scrub', activeOperationCount: 1, policy, observation: busy });
  assert.equal(result.action, 'defer');
  assert.ok(result.reasons.includes('operation-concurrency:1/1'));
  assert.ok(result.reasons.some(reason => reason.startsWith('cpuUtilization:')));
  assert.ok(result.reasons.some(reason => reason.startsWith('ioUtilization:')));
});

test('fails closed when a declared foreground service is not observed', () => {
  const result = evaluateWorkloadUsability({
    schemaVersion: 1, phase: 'runtime', operation: 'pruning', activeOperationCount: 0, policy,
    observation: { ...observation, foregroundServices: [] },
  });
  assert.equal(result.action, 'pause');
  assert.deepEqual(result.reasons, ['foreground-unobserved:api']);
});

test('runtime counts the active operation itself and binds decisions to observed evidence', () => {
  const first = evaluateWorkloadUsability({ schemaVersion: 1, phase: 'runtime', operation: 'scrub', activeOperationCount: 1, policy, observation });
  assert.equal(first.action, 'continue');
  const changed = evaluateWorkloadUsability({
    schemaVersion: 1, phase: 'runtime', operation: 'scrub', activeOperationCount: 1, policy,
    observation: { ...observation, hostUtilization: resources(.41, .5, .3, .2) },
  });
  assert.notEqual(changed.decisionDigest, first.decisionDigest);
});

test('rejects incomplete operation coverage, overcommitted envelopes, and unknown fields', () => {
  assert.throws(() => WorkloadUsabilityPolicySchema.parse({ ...policy, operationBudgets: policy.operationBudgets.slice(1) }), /every guarded operation/);
  assert.throws(() => WorkloadUsabilityPolicySchema.parse({
    ...policy, operationBudgets: policy.operationBudgets.map(item => item.operation === 'scrub'
      ? { ...item, projectedUtilization: resources(.81, .05, .1, .05) } : item),
  }), /exceeds host ceiling/);
  assert.throws(() => evaluateWorkloadUsability({
    schemaVersion: 1, phase: 'runtime', operation: 'scrub', activeOperationCount: 0, policy,
    observation: { ...observation, surprise: true },
  }));
});
