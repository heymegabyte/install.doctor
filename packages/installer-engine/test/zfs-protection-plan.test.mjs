import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverZfsProtection, planZfsProtection, statusZfsProtection } from '../dist/index.js';

const policy = {
  schemaVersion: 1, policyId: 'lab-policy', pool: 'labpool',
  datasets: [
    { dataset: 'labpool/data', snapshotOwner: 'sanoid', managed: true, retention: { hourly: 24, daily: 14, monthly: 6 } },
    { dataset: 'labpool/vm', snapshotOwner: 'proxmox-autosnap', managed: true, retention: { hourly: 0, daily: 7, monthly: 2 } },
  ],
  schedules: [
    { scheduleId: 'sanoid-data', operation: 'snapshot', owner: 'sanoid', intervalMinutes: 1440, offsetMinute: 5, durationMinutes: 5 },
    { scheduleId: 'weekly-scrub', operation: 'scrub', owner: 'external', intervalMinutes: 10080, offsetMinute: 360, durationMinutes: 180 },
  ],
  exclusions: [{ kind: 'dataset', pattern: 'labpool/cache', reason: 'reproducible cache' }, { kind: 'file-backup', pattern: '**/.cache/**', reason: 'file backup only' }],
  capacity: { warningRatio: 0.75, admissionRatio: 0.9, reserveBytes: 100, projectedSnapshotBytes: 100 },
};
const observation = {
  schemaVersion: 1, observationId: 'lab-observation', observedAt: '2026-11-10T19:00:00.000Z', evidenceDigest: 'a'.repeat(64), readOnly: true, disposable: true,
  pool: { name: 'labpool', guid: '123456789', sizeBytes: 1_000, allocatedBytes: 300, health: 'ONLINE' },
  datasets: [{ name: 'labpool/data', mounted: true, encryption: 'native' }, { name: 'labpool/vm', mounted: true, encryption: 'inherited' }, { name: 'labpool/cache', mounted: true, encryption: 'off' }],
  schedules: [],
  snapshots: [{ name: 'labpool/data@sanoid_2026-11-10', owner: 'sanoid', createdAt: '2026-11-10T18:00:00.000Z', dependencies: [{ snapshot: 'labpool/data@sanoid_2026-11-10', kinds: ['hold', 'replication-anchor'] }] }],
};

test('disposable-pool discovery and planning are explicitly read-only and deterministic', () => {
  const discovered = discoverZfsProtection(observation);
  assert.equal(discovered.readOnly, true);
  const first = planZfsProtection(policy, discovered);
  const second = planZfsProtection(structuredClone(policy), structuredClone(observation));
  assert.equal(first.status, 'ready');
  assert.equal(first.mode, 'read-only');
  assert.equal(first.disposable, true);
  assert.ok(first.operations.length > 0);
  assert.ok(first.operations.every(item => item.mutating === false));
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(statusZfsProtection(first).status, 'ready');
});

test('retention dependencies are preserved and never become prune operations', () => {
  const plan = planZfsProtection(policy, observation);
  assert.ok(plan.findings.some(item => item.code === 'retention-dependency' && /hold/.test(item.detail)));
  assert.ok(plan.operations.some(item => item.kind === 'preserve-snapshot' && item.subject.includes('@')));
  assert.equal(plan.operations.some(item => item.kind.includes('prune')), false);
});

test('ownership and schedule collisions fail closed while unrelated intent remains visible', () => {
  const conflicting = structuredClone(observation);
  conflicting.snapshots.push({ name: 'labpool/data@vzdump_1', owner: 'proxmox-autosnap', createdAt: '2026-11-10T17:00:00.000Z', dependencies: [] });
  conflicting.schedules.push({ scheduleId: 'legacy-snapshots', operation: 'snapshot', owner: 'external', intervalMinutes: 60, offsetMinute: 7, durationMinutes: 10 });
  const plan = planZfsProtection(policy, conflicting);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.findings.some(item => item.code === 'ownership-conflict'));
  assert.ok(plan.findings.some(item => item.code === 'schedule-collision'));
  assert.ok(plan.operations.some(item => item.subject === 'weekly-scrub'));
});

test('capacity gates before exhaustion and unhealthy or missing sources cannot report ready', () => {
  const constrained = structuredClone(observation);
  constrained.pool.allocatedBytes = 850;
  constrained.pool.health = 'DEGRADED';
  constrained.datasets = constrained.datasets.filter(item => item.name !== 'labpool/vm');
  const plan = planZfsProtection(policy, constrained);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.findings.some(item => item.code === 'capacity-blocked'));
  assert.ok(plan.findings.some(item => item.code === 'pool-unhealthy'));
  assert.ok(plan.findings.some(item => item.code === 'dataset-missing'));
});

test('strict policy validation rejects globbed ZFS exclusions, unmanaged ownership, collisions, and pool mismatch', () => {
  assert.throws(() => planZfsProtection({ ...policy, exclusions: [{ kind: 'dataset', pattern: 'labpool/*', reason: 'invalid boundary' }] }, observation), /exact dataset boundaries/);
  const manual = structuredClone(policy); manual.datasets[0].snapshotOwner = 'manual';
  assert.throws(() => planZfsProtection(manual, observation), /automated owner/);
  const duplicate = structuredClone(policy); duplicate.datasets.push(duplicate.datasets[0]);
  assert.throws(() => planZfsProtection(duplicate, observation), /unique/);
  assert.throws(() => planZfsProtection({ ...policy, pool: 'production' }, observation), /does not match/);
  assert.throws(() => discoverZfsProtection({ ...observation, readOnly: false }), /readOnly/);
  const badDependency = structuredClone(observation); badDependency.snapshots[0].dependencies[0].snapshot = 'labpool/data@other';
  assert.throws(() => discoverZfsProtection(badDependency), /containing snapshot/);
});
