import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperationsDashboards, OperationsDashboardObservationSchema } from '../dist/operations-dashboards.js';

const now = '2026-11-10T12:00:00.000Z';
const observation = (domain, changes = {}) => ({ schemaVersion: 1, tenantId: 'tenant-1', hostId: 'host-1', domain,
  observedAt: '2026-11-10T11:00:00.000Z', expiresAt: '2026-11-10T13:00:00.000Z', state: 'verified',
  evidenceDigest: 'a'.repeat(64), value: 1, unit: '1', reason: 'fixture-verified', ...changes });

test('three dashboards cover every required operational domain exactly once', () => {
  const bundle = buildOperationsDashboards({ schemaVersion: 1, tenantId: 'tenant-1', now, observations: [] });
  assert.equal(bundle.dashboards.length, 3);
  const panels = bundle.dashboards.flatMap(item => item.panels);
  assert.equal(panels.length, 12);
  assert.equal(new Set(panels.map(item => item.domain)).size, 12);
  assert.ok(panels.every(item => JSON.stringify(item.states) === JSON.stringify(['unknown', 'stale', 'running', 'failed', 'verified'])));
  assert.ok(panels.every(item => item.records[0].state === 'unknown'));
});

test('unknown stale running failed and verified are rendered as distinct states', () => {
  const observations = [observation('release-adoption', { hostId: 'unknown', state: 'unknown', evidenceDigest: null }),
    observation('release-adoption', { hostId: 'stale', expiresAt: '2026-11-10T11:30:00.000Z' }),
    observation('release-adoption', { hostId: 'running', state: 'running', evidenceDigest: null }),
    observation('release-adoption', { hostId: 'failed', state: 'failed', evidenceDigest: null }),
    observation('release-adoption', { hostId: 'verified' })];
  const panel = buildOperationsDashboards({ schemaVersion: 1, tenantId: 'tenant-1', now, observations }).dashboards[0].panels[0];
  assert.deepEqual([...new Set(panel.records.map(item => item.state))].sort(), ['failed', 'running', 'stale', 'unknown', 'verified']);
});

test('latest evidence wins per host and expiry downgrades verified to stale', () => {
  const panel = buildOperationsDashboards({ schemaVersion: 1, tenantId: 'tenant-1', now,
    observations: [observation('pool-health', { observedAt: '2026-11-10T10:00:00.000Z', state: 'failed', evidenceDigest: null }),
      observation('pool-health', { observedAt: '2026-11-10T11:00:00.000Z', expiresAt: '2026-11-10T11:30:00.000Z' })] })
    .dashboards[1].panels.find(item => item.domain === 'pool-health');
  assert.equal(panel.records.length, 1); assert.equal(panel.records[0].state, 'stale');
});

test('tenant boundaries, verification evidence, and value units fail closed', () => {
  assert.throws(() => buildOperationsDashboards({ schemaVersion: 1, tenantId: 'tenant-1', now, observations: [observation('capacity', { tenantId: 'tenant-2' })] }), /cross-tenant/);
  assert.throws(() => OperationsDashboardObservationSchema.parse(observation('capacity', { evidenceDigest: null })), /requires evidence/);
  assert.throws(() => OperationsDashboardObservationSchema.parse(observation('capacity', { unit: null })), /present together/);
});
