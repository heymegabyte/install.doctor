import assert from 'node:assert/strict';
import test from 'node:test';
import { planMobileHostCatchUp } from '../dist/index.js';

const evaluatedAt = '2026-11-10T12:00:00.000Z';
const policy = {
  maxItems: 3, maxWorkUnits: 8, maxUnmeteredNetworkBytes: 1_000,
  maxMeteredNetworkBytes: 100, minimumBatteryLevel: 0.35,
  allowCriticalOnLowBattery: true, allowCriticalMeteredAvoidanceOverride: true,
};
const condition = { powerSource: 'ac', batteryLevel: null, connectivity: 'online', meteredNetwork: false };
const work = (id, changes = {}) => ({
  id, coalesceKey: id, dueAt: '2026-11-10T10:00:00.000Z', expiresAt: null,
  priority: 'normal', powerPolicy: 'any', connectivity: 'none', meteredPolicy: 'allow',
  workUnits: 1, networkBytes: 0, ...changes,
});

test('coalesces an unbounded missed stream and admits only the bounded prioritized catch-up', () => {
  const repeated = Array.from({ length: 500 }, (_, index) => work(`health-${String(index).padStart(3, '0')}`, {
    coalesceKey: 'health', dueAt: new Date(Date.parse('2026-11-01T00:00:00.000Z') + index * 60_000).toISOString(),
  }));
  const input = {
    evaluatedAt, condition, policy,
    missedWork: [
      ...repeated,
      work('security', { priority: 'critical', dueAt: '2026-11-10T11:00:00.000Z', workUnits: 2 }),
      work('backup', { priority: 'high', workUnits: 5 }),
      work('inventory'),
      work('cleanup', { priority: 'low' }),
    ],
  };
  const first = planMobileHostCatchUp(input);
  const second = planMobileHostCatchUp(structuredClone(input));
  assert.equal(first.decisionDigest, second.decisionDigest);
  const stricter = planMobileHostCatchUp({ ...input, policy: { ...policy, maxItems: 2 } });
  assert.notEqual(first.decisionDigest, stricter.decisionDigest, 'decision evidence must bind its exact scheduling policy');
  assert.equal(first.inputItems, 504);
  assert.equal(first.coalescedItems, 499);
  assert.deepEqual(first.scheduled.map(item => item.id), ['security', 'backup', 'health-499']);
  assert.equal(first.scheduled.length, policy.maxItems);
  assert.equal(first.totals.workUnits, policy.maxWorkUnits);
  assert.equal(first.deferred.find(item => item.work.id === 'inventory').reason, 'item-budget');
  assert.equal(first.deferred.find(item => item.work.id === 'cleanup').reason, 'item-budget');
});

test('battery, offline, and metered policies defer unsafe work but admit bounded critical recovery', () => {
  const decision = planMobileHostCatchUp({
    evaluatedAt,
    condition: { powerSource: 'battery', batteryLevel: 0.2, connectivity: 'online', meteredNetwork: true },
    policy,
    missedWork: [
      work('critical-local', { priority: 'critical' }),
      work('critical-network', { priority: 'critical', connectivity: 'online', meteredPolicy: 'avoid', networkBytes: 60 }),
      work('metered-denied', { priority: 'critical', connectivity: 'online', meteredPolicy: 'deny', networkBytes: 1 }),
      work('ordinary-local'),
      work('requires-ac', { priority: 'critical', powerPolicy: 'ac-required' }),
      work('network-budget', { priority: 'critical', connectivity: 'online', meteredPolicy: 'allow', networkBytes: 60 }),
    ],
  });
  assert.deepEqual(decision.scheduled.map(item => item.id), ['critical-local', 'critical-network']);
  assert.equal(decision.deferred.find(item => item.work.id === 'metered-denied').reason, 'metered-denied');
  assert.equal(decision.deferred.find(item => item.work.id === 'ordinary-local').reason, 'battery-low');
  assert.equal(decision.deferred.find(item => item.work.id === 'requires-ac').reason, 'ac-required');
  assert.equal(decision.deferred.find(item => item.work.id === 'network-budget').reason, 'network-budget');

  const offline = planMobileHostCatchUp({
    evaluatedAt, condition: { powerSource: 'ac', batteryLevel: null, connectivity: 'offline', meteredNetwork: false },
    policy, missedWork: [work('local'), work('remote', { connectivity: 'online', meteredPolicy: 'allow', networkBytes: 1 })],
  });
  assert.deepEqual(offline.scheduled.map(item => item.id), ['local']);
  assert.equal(offline.deferred[0].reason, 'offline');
});

test('strict policy rejects contradictory observations, invalid work, duplicates, and unknown fields', () => {
  const valid = { evaluatedAt, condition, policy, missedWork: [work('one')] };
  assert.throws(() => planMobileHostCatchUp({ ...valid, unexpected: true }), /unrecognized|unknown/i);
  assert.throws(() => planMobileHostCatchUp({ ...valid, condition: { ...condition, connectivity: 'offline', meteredNetwork: true } }), /offline connection/);
  assert.throws(() => planMobileHostCatchUp({ ...valid, missedWork: [work('one'), work('one')] }), /duplicate/);
  assert.throws(() => planMobileHostCatchUp({ ...valid, missedWork: [work('network', { connectivity: 'none', networkBytes: 1 })] }), /network bytes/);
});
