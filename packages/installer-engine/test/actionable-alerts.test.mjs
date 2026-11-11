import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionableAlertFingerprint,
  applyActionableAlertSignal,
  clearActionableAlert,
  detectMissingHeartbeat,
} from '../dist/actionable-alerts.js';

const digest = value => value.repeat(64).slice(0, 64);
const subject = { kind: 'device', id: 'nvme0n1', displayName: 'NVMe system disk' };
const evidence = (observedAt, summary = 'simulated media error') => ({
  observedAt, source: 'hardware-health', summary, correlationId: 'fault-run-1', contentDigest: digest('a'),
});
const fault = at => ({
  schemaVersion: 1, hostId: 'zen', subject, condition: 'nvme-critical-warning', severity: 'critical',
  recoveryImpact: 'recovery-point-at-risk', impactSummary: 'local recovery points may become unavailable',
  runbook: 'docs/runbooks/nvme-recovery.md#triage', evidence: evidence(at),
});

test('simulated fault opens one actionable alert and repeated evidence deduplicates it', () => {
  const opened = applyActionableAlertSignal(undefined, fault('2026-11-10T10:00:00Z'));
  const repeated = applyActionableAlertSignal(opened, {
    ...fault('2026-11-10T10:01:00Z'),
    evidence: evidence('2026-11-10T10:01:00Z', 'simulated media error still active'),
  });
  assert.equal(repeated.alertId, opened.alertId);
  assert.equal(repeated.fingerprint, opened.fingerprint);
  assert.equal(repeated.occurrences, 2);
  assert.equal(repeated.evidence.length, 2);
  assert.deepEqual(
    { host: repeated.hostId, device: repeated.subject.id, impact: repeated.recoveryImpact, runbook: repeated.runbook },
    { host: 'zen', device: 'nvme0n1', impact: 'recovery-point-at-risk', runbook: 'docs/runbooks/nvme-recovery.md#triage' },
  );
});

test('matching recovery evidence clears the simulated fault and a later fault opens a new incident', () => {
  const opened = applyActionableAlertSignal(undefined, fault('2026-11-10T10:00:00Z'));
  const resolved = clearActionableAlert(opened, {
    schemaVersion: 1, fingerprint: opened.fingerprint, recoveredAt: '2026-11-10T10:05:00Z',
    evidence: evidence('2026-11-10T10:05:00Z', 'device self-test and recovery verification passed'),
  });
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.resolutionEvidence.summary, 'device self-test and recovery verification passed');
  const reopened = applyActionableAlertSignal(resolved, fault('2026-11-10T11:00:00Z'));
  assert.equal(reopened.state, 'firing');
  assert.notEqual(reopened.alertId, opened.alertId);
  assert.equal(reopened.occurrences, 1);
});

test('recovery cannot clear a different incident or rely on stale evidence', () => {
  const opened = applyActionableAlertSignal(undefined, fault('2026-11-10T10:00:00Z'));
  assert.throws(() => clearActionableAlert(opened, {
    schemaVersion: 1, fingerprint: digest('b'), recoveredAt: '2026-11-10T10:05:00Z',
    evidence: evidence('2026-11-10T10:05:00Z', 'unrelated recovery'),
  }), /does not match/);
  assert.throws(() => clearActionableAlert(opened, {
    schemaVersion: 1, fingerprint: opened.fingerprint, recoveredAt: '2026-11-10T09:59:00Z',
    evidence: evidence('2026-11-10T09:59:00Z', 'stale health result'),
  }), /predates/);
});

test('missing heartbeat is emitted only beyond the bounded freshness threshold', () => {
  const policy = {
    schemaVersion: 1, source: 'alloy-delivery', intervalSeconds: 30, missedIntervalsBeforeAlert: 3,
    severity: 'critical', recoveryImpact: 'degraded', runbook: 'https://desktop.tools/runbooks/alloy-heartbeat',
  };
  const base = {
    schemaVersion: 1, hostId: 'zen', subject: { kind: 'host', id: 'zen', displayName: 'Zen' },
    lastHeartbeatAt: '2026-11-10T10:00:00Z', contentDigest: digest('c'), correlationId: 'delivery-check-1',
  };
  assert.equal(detectMissingHeartbeat(policy, { ...base, evaluatedAt: '2026-11-10T10:01:29Z' }), undefined);
  const signal = detectMissingHeartbeat(policy, { ...base, evaluatedAt: '2026-11-10T10:01:30Z' });
  assert.equal(signal.condition, 'missing-heartbeat.alloy-delivery');
  assert.equal(signal.hostId, 'zen');
  assert.match(signal.impactSummary, /90s old/);
});

test('deduplication rejects cross-condition state and alert schemas reject missing action context', () => {
  const opened = applyActionableAlertSignal(undefined, fault('2026-11-10T10:00:00Z'));
  assert.throws(() => applyActionableAlertSignal(opened, {
    ...fault('2026-11-10T10:01:00Z'), condition: 'nvme-temperature-critical',
  }), /different alert fingerprint/);
  assert.throws(() => applyActionableAlertSignal(opened, fault('2026-11-10T09:59:00Z')), /older/);
  assert.throws(() => applyActionableAlertSignal(undefined, {
    ...fault('2026-11-10T10:00:00Z'), runbook: '',
  }));
  assert.equal(opened.fingerprint, actionableAlertFingerprint(fault('2026-11-10T10:00:00Z')));
});
