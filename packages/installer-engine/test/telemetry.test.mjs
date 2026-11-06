import assert from 'node:assert/strict';
import test from 'node:test';
import { exportInstallerTelemetry } from '../dist/index.js';

const base = { schemaVersion: 1, at: '2026-11-06T00:00:00.000Z', runId: 'run-1' };
const config = {
  schemaVersion: 1, consent: true, endpoint: 'https://logs.example.test/installer', timeoutMs: 100,
  labels: { platform: 'linux', environment: 'container', service: 'install-doctor' },
};
const events = [
  { ...base, sequence: 0, kind: 'run-status', status: 'started' },
  { ...base, sequence: 1, kind: 'output', taskId: 'task-1', stream: 'stderr', line: 'password=do-not-export-this-value' },
  { ...base, sequence: 2, kind: 'task-status', taskId: 'task-1', status: 'verified', attempt: 1 },
];

test('exports only consented bounded metadata and drops command output entirely', async () => {
  let observed;
  const result = await exportInstallerTelemetry(config, events, async input => { observed = input; });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.exportedEvents, 2);
  assert.equal(result.droppedOutputEvents, 1);
  assert.equal(JSON.stringify(observed).includes('do-not-export'), false);
  assert.deepEqual(observed.batch.events.map(event => event.kind), ['run-status', 'task-status']);
  assert.deepEqual(observed.batch.labels, config.labels);
});

test('does not call transport without consent', async () => {
  let called = false;
  const result = await exportInstallerTelemetry({ ...config, consent: false }, events, async () => { called = true; });
  assert.equal(called, false);
  assert.deepEqual(result, { status: 'disabled', exportedEvents: 0, droppedOutputEvents: 1, droppedCapacityEvents: 0 });
});

test('transport failure and timeout are fail-open bounded outcomes', async () => {
  const failed = await exportInstallerTelemetry(config, events, async () => { throw new Error('remote unavailable'); });
  assert.equal(failed.status, 'failed');
  const timed = await exportInstallerTelemetry(config, events, async ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  assert.equal(timed.status, 'timed-out');
});

test('batch capacity truncation is explicit rather than silent', async () => {
  const many = Array.from({ length: 300 }, (_, sequence) => ({ ...base, sequence, kind: 'run-status', status: 'started' }));
  let observed;
  const result = await exportInstallerTelemetry(config, many, async input => { observed = input; });
  assert.equal(result.exportedEvents, 256);
  assert.equal(result.droppedCapacityEvents, 44);
  assert.equal(observed.batch.droppedCapacityEvents, 44);
});

test('rejects insecure endpoints, unbounded labels, and malformed events before transport', async () => {
  let called = false;
  await assert.rejects(exportInstallerTelemetry({ ...config, endpoint: 'http://logs.example.test' }, events, async () => { called = true; }));
  await assert.rejects(exportInstallerTelemetry({ ...config, labels: { ...config.labels, host: 'private-host' } }, events, async () => { called = true; }));
  await assert.rejects(exportInstallerTelemetry(config, [{ ...events[0], secret: 'x' }], async () => { called = true; }));
  assert.equal(called, false);
});
