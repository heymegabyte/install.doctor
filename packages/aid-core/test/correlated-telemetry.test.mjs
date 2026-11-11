import assert from 'node:assert/strict';
import test from 'node:test';
import { correlatedTelemetryDigest, validateCorrelatedTelemetryRecord } from '../dist/correlated-telemetry.js';

const base = {
  schemaVersion: 1, source: 'control-plane', signal: 'event', name: 'desktop_tools.run.state',
  observedAt: '2026-11-10T15:00:00.000Z', severity: 'info', traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16), parentSpanId: null, runId: 'run-1', taskId: null, hostId: 'host-1',
  status: 'running', evidenceDigest: null, metric: null,
};

test('all five operational sources share exact cross-signal correlation', () => {
  for (const source of ['control-plane', 'runtime', 'installer-engine', 'privileged-broker', 'reconciliation']) {
    const record = validateCorrelatedTelemetryRecord({ ...base, source });
    assert.equal(record.traceId, base.traceId);
    assert.equal(record.runId, base.runId);
  }
  for (const signal of ['log', 'trace', 'event']) assert.equal(validateCorrelatedTelemetryRecord({ ...base, signal }).signal, signal);
  assert.equal(validateCorrelatedTelemetryRecord({ ...base, signal: 'metric', metric: { unit: 'ms', value: 12.5 } }).signal, 'metric');
});

test('credentials and PII cannot cross the source boundary as messages or attributes', () => {
  for (const attack of [{ message: 'Bearer secret-token' }, { attributes: { email: 'person@example.com' } }, { token: 'secret' }]) {
    assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, ...attack }), /unrecognized|unknown/i);
  }
});

test('metrics are exact and bounded to declared units', () => {
  assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, signal: 'metric' }), /metric payload/);
  assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, metric: { unit: 'ms', value: 1 } }), /metric payload/);
  assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, signal: 'metric', metric: { unit: 'items', value: 1 } }));
});

test('trace structure and stable evidence identity fail closed', async () => {
  assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, parentSpanId: base.spanId }), /parent itself/);
  assert.equal(await correlatedTelemetryDigest(base), await correlatedTelemetryDigest(structuredClone(base)));
  assert.notEqual(await correlatedTelemetryDigest(base), await correlatedTelemetryDigest({ ...base, status: 'succeeded' }));
});
