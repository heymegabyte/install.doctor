import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinatePlannedReboot, inspectRebootReturn, RebootContinuationSchema } from '../dist/index.js';

const planDigest = 'a'.repeat(64);
const base = {
  schemaVersion: 1, hostId: 'host-one', runId: 'run-one', planDigest, preBootId: 'boot-before',
  requestedAt: '2026-11-10T12:00:00.000Z', recoveryTimeoutMs: 300_000, maintenanceWindowOpen: true,
  activeUsers: [], activeWorkloads: [],
};

test('active users, unsafe workloads, and a closed window block reboot deterministically', () => {
  const result = coordinatePlannedReboot({ ...base, maintenanceWindowOpen: false,
    activeUsers: [
      { sessionId: 'approved', userId: 'user-a', interactive: true, approvedToInterrupt: true },
      { sessionId: 'unattended', userId: 'user-b', interactive: false, approvedToInterrupt: false },
      { sessionId: 'blocking', userId: 'user-c', interactive: true, approvedToInterrupt: false },
    ],
    activeWorkloads: [
      { workloadId: 'safe', state: 'running', restartSafe: true, checkpointed: true },
      { workloadId: 'not-checkpointed', state: 'running', restartSafe: true, checkpointed: false },
      { workloadId: 'not-restart-safe', state: 'running', restartSafe: false, checkpointed: true },
    ],
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, [
    { kind: 'active-user', id: 'blocking' },
    { kind: 'active-workload', id: 'not-checkpointed' },
    { kind: 'active-workload', id: 'not-restart-safe' },
    { kind: 'maintenance-window', id: 'host-one' },
  ]);
  assert.equal('continuation' in result, false);
});

test('durable continuation binds host, run, plan, pre-boot identity, and timeout', () => {
  const first = coordinatePlannedReboot(base);
  const second = coordinatePlannedReboot(structuredClone(base));
  assert.equal(first.status, 'ready');
  assert.deepEqual(first, second);
  assert.equal(first.continuation.recoveryDeadline, '2026-11-10T12:05:00.000Z');
  assert.deepEqual(RebootContinuationSchema.parse(JSON.parse(JSON.stringify(first.continuation))), first.continuation);
  assert.throws(() => RebootContinuationSchema.parse({ ...first.continuation, hostId: 'other-host' }), /continuation identity/);
});

test('only an exact, timely heartbeat from a new boot permits restart-safe continuation', () => {
  const { continuation } = coordinatePlannedReboot(base);
  const heartbeat = { schemaVersion: 1, hostId: base.hostId, runId: base.runId, planDigest,
    continuationId: continuation.continuationId, postBootId: 'boot-after', heartbeatAt: '2026-11-10T12:01:00.000Z' };
  assert.deepEqual(inspectRebootReturn(continuation, heartbeat, '2026-11-10T12:01:01.000Z'), {
    status: 'ready-to-resume', canResume: true, reason: 'post-boot-identity-verified',
    postBootId: 'boot-after', heartbeatAt: heartbeat.heartbeatAt,
  });
  assert.deepEqual(inspectRebootReturn(continuation, { ...heartbeat, postBootId: base.preBootId }, '2026-11-10T12:01:01.000Z'),
    { status: 'awaiting-return', canResume: false, reason: 'boot-identity-unchanged' });
  assert.deepEqual(inspectRebootReturn(continuation, { ...heartbeat, runId: 'other-run' }, '2026-11-10T12:01:01.000Z'),
    { status: 'identity-mismatch', canResume: false, reason: 'continuation-identity-mismatch' });
});

test('missing or late return heartbeat never becomes success', () => {
  const { continuation } = coordinatePlannedReboot(base);
  assert.deepEqual(inspectRebootReturn(continuation, null, '2026-11-10T12:04:59.000Z'),
    { status: 'awaiting-return', canResume: false, reason: 'return-heartbeat-missing' });
  assert.deepEqual(inspectRebootReturn(continuation, null, '2026-11-10T12:05:01.000Z'),
    { status: 'recovery-timeout', canResume: false, reason: 'return-heartbeat-missing' });
  const late = { schemaVersion: 1, hostId: base.hostId, runId: base.runId, planDigest,
    continuationId: continuation.continuationId, postBootId: 'boot-after', heartbeatAt: '2026-11-10T12:05:01.000Z' };
  assert.deepEqual(inspectRebootReturn(continuation, late, '2026-11-10T12:05:02.000Z'),
    { status: 'recovery-timeout', canResume: false, reason: 'return-heartbeat-late' });
});

test('strict schemas reject ambiguous reboot authority', () => {
  assert.throws(() => coordinatePlannedReboot({ ...base, activeUsers: [], unexpected: true }), /unrecognized|unknown/i);
  assert.throws(() => coordinatePlannedReboot({ ...base, activeUsers: [
    { sessionId: 'same', userId: 'one', interactive: true, approvedToInterrupt: true },
    { sessionId: 'same', userId: 'two', interactive: true, approvedToInterrupt: true },
  ] }), /duplicate/);
});
