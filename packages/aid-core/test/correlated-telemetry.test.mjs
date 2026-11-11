import assert from 'node:assert/strict';
import test from 'node:test';
import { correlatedTelemetryDigest, createCorrelatedTelemetryInstrument, validateCorrelatedTelemetryRecord } from '../dist/correlated-telemetry.js';

const base = {
  schemaVersion: 1, source: 'control-plane', signal: 'event', name: 'desktop_tools.run.state',
  observedAt: '2026-11-10T15:00:00.000Z', severity: 'info', traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16), parentSpanId: null, tenantId: 'tenant-1', hostId: 'host-1',
  profileId: 'profile-1', releaseId: 'release-1', runId: 'run-1', parentRunId: null, taskId: null,
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

test('each operational source emits correlated logs metrics traces and events through one boundary', () => {
  const { source: _source, signal: _signal, name: _name, observedAt: _observedAt, severity: _severity,
    status: _status, evidenceDigest: _evidenceDigest, metric: _metric, schemaVersion: _schemaVersion, ...context } = base;
  for (const source of ['control-plane', 'runtime', 'installer-engine', 'privileged-broker', 'reconciliation']) {
    const instrument = createCorrelatedTelemetryInstrument(source, context);
    const common = { observedAt: base.observedAt, severity: 'info', status: 'running', evidenceDigest: null };
    const records = [
      instrument.emit({ ...common, signal: 'log', name: 'desktop_tools.run.log', metric: null }),
      instrument.emit({ ...common, signal: 'metric', name: 'desktop_tools.run.duration', metric: { unit: 'ms', value: 4 } }),
      instrument.emit({ ...common, signal: 'trace', name: 'desktop_tools.run.span', metric: null }),
      instrument.emit({ ...common, signal: 'event', name: 'desktop_tools.run.state', metric: null }),
    ];
    assert.deepEqual(records.map(record => record.signal), ['log', 'metric', 'trace', 'event']);
    assert.ok(records.every(record => record.source === source && record.tenantId === context.tenantId && record.traceId === context.traceId));
  }
});

test('credentials and PII cannot cross the source boundary as messages or attributes', () => {
  for (const attack of [{ message: 'Bearer secret-token' }, { attributes: { email: 'person@example.com' } }, { token: 'secret' }]) {
    assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, ...attack }), /unrecognized|unknown|credential or PII/i);
  }
  for (const attack of [
    { runId: 'person@example.com' },
    { runId: 'token=super-sensitive-value' },
    { runId: `ghp_${'a'.repeat(32)}` },
    { hostId: 'Bearer abcdefghijklmnop' },
  ]) assert.throws(() => validateCorrelatedTelemetryRecord({ ...base, ...attack }), /credential or PII/);
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
