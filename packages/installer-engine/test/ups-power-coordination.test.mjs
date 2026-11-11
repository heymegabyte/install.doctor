import assert from 'node:assert/strict';
import test from 'node:test';
import { planUpsCancellationRecovery, planUpsDependencyShutdown } from '../dist/ups-power-coordination.js';

const identity = 'a'.repeat(64);
const request = (overrides = {}) => ({
  schemaVersion: 1,
  requestId: 'ups-drill-1',
  requestedAt: '2026-11-10T15:00:00.000Z',
  hostId: 'zen',
  upsDeviceId: 'ups-rack-a',
  upsIdentitySha256: identity,
  requestedMode: 'simulation',
  trigger: 'operator-test',
  hardware: {
    hostId: 'zen', deviceId: 'ups-rack-a', identitySha256: identity,
    driver: 'nut', state: 'online', detectedAt: '2026-11-10T14:59:00.000Z',
  },
  dependencies: [
    { id: 'network', kind: 'network', dependsOn: ['ups-monitor'], shutdownSupported: true, recoverySupported: true },
    { id: 'database', kind: 'service', dependsOn: ['storage'], shutdownSupported: true, recoverySupported: true },
    { id: 'storage', kind: 'storage', dependsOn: ['network'], shutdownSupported: true, recoverySupported: true },
    { id: 'app', kind: 'workload', dependsOn: ['database'], shutdownSupported: true, recoverySupported: true },
    { id: 'ups-monitor', kind: 'ups-controller', dependsOn: [], shutdownSupported: true, recoverySupported: true },
  ],
  liveAuthority: null,
  ...overrides,
});

const now = '2026-11-10T15:01:00.000Z';

test('simulation deterministically shuts dependents first and recovers dependencies first', () => {
  const plan = planUpsDependencyShutdown(request(), now);
  assert.equal(plan.mode, 'simulation');
  assert.deepEqual(plan.shutdownOrder, ['app', 'database', 'storage', 'network', 'ups-monitor']);
  assert.deepEqual(plan.recoveryOrder, ['ups-monitor', 'network', 'storage', 'database', 'app']);
  assert.equal(plan.planDigest.length, 64);
});

test('rejects missing, unsupported, mismatched, stale-state, and unsafe hardware paths', () => {
  assert.throws(() => planUpsDependencyShutdown(request({ hardware: null }), now), /No supported UPS/);
  assert.throws(() => planUpsDependencyShutdown(request({ hardware: { ...request().hardware, identitySha256: 'b'.repeat(64) } }), now), /identity does not match/);
  assert.throws(() => planUpsDependencyShutdown(request({ hardware: { ...request().hardware, state: 'offline' } }), now), /not usable/);
  assert.throws(() => planUpsDependencyShutdown(request({ hardware: { ...request().hardware, detectedAt: '2026-11-10T14:00:00.000Z' } }), now), /evidence is stale/);
  const unsafe = request();
  unsafe.dependencies[0].recoverySupported = false;
  assert.throws(() => planUpsDependencyShutdown(unsafe, now), /lacks safe shutdown or recovery/);
  const cycle = request();
  cycle.dependencies[4].dependsOn = ['app'];
  assert.throws(() => planUpsDependencyShutdown(cycle, now), /root UPS controller|contains a cycle/);
  const unprotected = request();
  unprotected.dependencies.push({ id: 'orphan', kind: 'service', dependsOn: [], shutdownSupported: true, recoverySupported: true });
  assert.throws(() => planUpsDependencyShutdown(unprotected, now), /not protected by the UPS controller/);
});

test('live execution fails closed without exact unexpired disruptive maintenance authority', () => {
  assert.throws(() => planUpsDependencyShutdown(request({ requestedMode: 'live' }), now), /requires explicit disruptive maintenance authority/);
  const simulation = planUpsDependencyShutdown(request(), now);
  const authority = {
    authorityId: 'window-approval-1', disruptiveMaintenanceAuthorized: true,
    maintenanceWindowId: 'mw-2026-11-10', hostId: 'zen', upsDeviceId: 'ups-rack-a',
    upsIdentitySha256: identity, planDigest: simulation.planDigest,
    notBefore: '2026-11-10T15:00:00.000Z', expiresAt: '2026-11-10T16:00:00.000Z',
  };
  const live = planUpsDependencyShutdown(request({ requestedMode: 'live', liveAuthority: authority }), now);
  assert.equal(live.mode, 'authorized-live');
  assert.throws(() => planUpsDependencyShutdown(request({ requestedMode: 'live', liveAuthority: { ...authority, upsDeviceId: 'other-ups' } }), now), /not bound/);
  assert.throws(() => planUpsDependencyShutdown(request({ requestedMode: 'live', liveAuthority: { ...authority, expiresAt: now } }), now), /outside its maintenance window/);
  assert.throws(() => planUpsDependencyShutdown(request({ liveAuthority: authority }), now), /must not carry live disruptive authority/);
});

test('safe cancellation recovers only completed shutdowns in dependency order', () => {
  const plan = planUpsDependencyShutdown(request(), now);
  assert.deepEqual(planUpsCancellationRecovery(plan, {
    schemaVersion: 1, planDigest: plan.planDigest,
    completedShutdowns: ['app', 'database', 'storage'], activeNodeId: null,
  }), {
    status: 'recovery-required', reason: 'recover-completed-shutdowns',
    recoveryOrder: ['storage', 'database', 'app'],
  });
  assert.deepEqual(planUpsCancellationRecovery(plan, {
    schemaVersion: 1, planDigest: plan.planDigest, completedShutdowns: [], activeNodeId: null,
  }).status, 'cancelled-clean');
});

test('cancellation rejects forged progress and never guesses through an in-flight effect', () => {
  const plan = planUpsDependencyShutdown(request(), now);
  assert.throws(() => planUpsCancellationRecovery(plan, {
    schemaVersion: 1, planDigest: plan.planDigest, completedShutdowns: ['database'], activeNodeId: null,
  }), /not an exact plan prefix/);
  assert.throws(() => planUpsCancellationRecovery(plan, {
    schemaVersion: 1, planDigest: 'b'.repeat(64), completedShutdowns: [], activeNodeId: null,
  }), /does not match/);
  assert.throws(() => planUpsCancellationRecovery({ ...plan, hostId: 'other-host' }, {
    schemaVersion: 1, planDigest: plan.planDigest, completedShutdowns: [], activeNodeId: null,
  }), /digest does not match/);
  assert.deepEqual(planUpsCancellationRecovery(plan, {
    schemaVersion: 1, planDigest: plan.planDigest, completedShutdowns: ['app'], activeNodeId: 'database',
  }), { status: 'inspection-required', reason: 'shutdown-effect-in-flight', recoveryOrder: [] });
});
