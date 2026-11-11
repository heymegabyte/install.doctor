import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DataVerificationPolicySchema,
  DataVerificationResultSchema,
  assessDataVerificationCoverage,
  planDueDataVerificationChecks,
} from '../dist/data-verification-schedule.js';

const d = value => value.repeat(64);
const kinds = ['structural', 'rotating-content', 'full', 'client-decryption'];
const policy = () => ({
  schemaVersion: 1,
  policyId: 'critical-data',
  workloadId: 'postgres-primary',
  maxConcurrentChecks: 4,
  rotatingCoverage: { eligibleContentCount: 4, minimumDistinctContent: 3, windowSeconds: 604_800 },
  checks: kinds.map((kind, index) => ({
    kind, intervalSeconds: 86_400 * (index + 1), freshnessSeconds: 172_800 * (index + 1),
    timeoutSeconds: 3_600, initialDueAt: '2026-11-01T00:00:00.000Z',
  })),
});

function result(kind, options = {}) {
  const contentDigests = kind === 'rotating-content' ? (options.contentDigests ?? [d('a')]) : [];
  const clientDecryption = kind === 'client-decryption' ? {
    attemptedArtifacts: 2, decryptedArtifacts: options.decryptedArtifacts ?? 2,
    recoveryMaterialDigest: d('e'),
  } : null;
  return {
    schemaVersion: 1, resultId: options.resultId ?? `${kind}-1`, policyId: 'critical-data', workloadId: 'postgres-primary', kind,
    scheduledAt: options.scheduledAt ?? '2026-11-09T00:00:00.000Z',
    startedAt: options.startedAt ?? '2026-11-09T00:00:01.000Z',
    completedAt: options.completedAt ?? '2026-11-09T00:10:00.000Z',
    status: options.status ?? 'passed', evidenceDigest: options.evidenceDigest ?? d('f'), contentDigests,
    serverSideChunkCheck: options.serverSideChunkCheck ?? kind === 'structural', clientDecryption,
  };
}

test('strict policy requires all four bounded schedules exactly once', () => {
  assert.equal(DataVerificationPolicySchema.parse(policy()).checks.length, 4);
  assert.throws(() => DataVerificationPolicySchema.parse({ ...policy(), checks: policy().checks.slice(0, 3) }));
  const duplicate = policy(); duplicate.checks[3] = { ...duplicate.checks[3], kind: 'structural' };
  assert.throws(() => DataVerificationPolicySchema.parse(duplicate), /every verification class exactly once/);
  const unbounded = policy(); unbounded.checks[0].timeoutSeconds = unbounded.checks[0].intervalSeconds;
  assert.throws(() => DataVerificationPolicySchema.parse(unbounded), /timeout must be shorter/);
});

test('scheduler coalesces missed intervals and caps admitted concurrency', () => {
  const constrained = policy(); constrained.maxConcurrentChecks = 2;
  const due = planDueDataVerificationChecks({ policy: constrained, results: [], now: '2026-11-10T00:00:00.000Z' });
  assert.deepEqual(due.map(item => item.kind), ['structural', 'rotating-content']);
  assert.ok(due.every(item => item.scheduledAt === '2026-11-10T00:00:00.000Z'));
  assert.ok(due.every(item => Date.parse(item.deadlineAt) - Date.parse(item.scheduledAt) === 3_600_000));

  const failed = result('structural', { status: 'failed' });
  const retry = planDueDataVerificationChecks({ policy: policy(), results: [failed], now: '2026-11-10T01:00:00.000Z' });
  assert.equal(retry.find(item => item.kind === 'structural').reason, 'retry-failure');
  assert.equal(retry.filter(item => item.kind === 'structural').length, 1, 'outage replay created duplicate checks');
  assert.throws(() => planDueDataVerificationChecks({
    policy: policy(),
    results: [result('structural', { scheduledAt: '2026-11-11T00:00:00.000Z', startedAt: '2026-11-11T00:00:01.000Z', completedAt: '2026-11-11T00:10:00.000Z' })],
    now: '2026-11-10T00:00:00.000Z',
  }), /future verification evidence cannot control/);
});

test('fresh complete client-side evidence and rotating coverage establish readiness', () => {
  const results = [
    result('structural'), result('full'), result('client-decryption'),
    result('rotating-content', { resultId: 'rotate-1', contentDigests: [d('a'), d('b')] }),
    result('rotating-content', {
      resultId: 'rotate-2', startedAt: '2026-11-09T01:00:00.000Z', completedAt: '2026-11-09T01:10:00.000Z',
      contentDigests: [d('b'), d('c')],
    }),
  ];
  const assessed = assessDataVerificationCoverage({ policy: policy(), results, now: '2026-11-10T00:00:00.000Z' });
  assert.equal(assessed.restoreReadiness, 'ready');
  assert.equal(assessed.rotatingCoverage.distinctContent, 3);
  assert.equal(assessed.rotatingCoverage.ratio, 0.75);
  assert.deepEqual(assessed.reasons, []);
});

test('server-side chunk success alone can never satisfy restore readiness', () => {
  const structuralOnly = assessDataVerificationCoverage({
    policy: policy(), results: [result('structural', { serverSideChunkCheck: true })], now: '2026-11-10T00:00:00.000Z',
  });
  assert.equal(structuralOnly.restoreReadiness, 'not-ready');
  assert.match(structuralOnly.reasons.join('\n'), /client-decryption:missing/);

  assert.throws(() => DataVerificationResultSchema.parse(result('client-decryption', { serverSideChunkCheck: true })),
    /server-side chunk verification is not client decryption/);
  assert.throws(() => DataVerificationResultSchema.parse(result('client-decryption', { decryptedArtifacts: 1 })),
    /decrypt every attempted artifact/);
});

test('latest failures, stale evidence, incomplete rotation, and future evidence fail closed', () => {
  const complete = [
    result('structural'), result('full'), result('client-decryption'),
    result('rotating-content', { contentDigests: [d('a'), d('b')] }),
  ];
  const incomplete = assessDataVerificationCoverage({ policy: policy(), results: complete, now: '2026-11-10T00:00:00.000Z' });
  assert.equal(incomplete.restoreReadiness, 'not-ready');
  assert.ok(incomplete.reasons.includes('rotating-content:insufficient-coverage'));

  const withFailure = [...complete,
    result('client-decryption', {
      resultId: 'client-failed', status: 'failed', decryptedArtifacts: 0,
      scheduledAt: '2026-11-09T02:00:00.000Z', startedAt: '2026-11-09T02:00:01.000Z', completedAt: '2026-11-09T02:10:00.000Z',
    })];
  const failed = assessDataVerificationCoverage({ policy: policy(), results: withFailure, now: '2026-11-10T00:00:00.000Z' });
  assert.ok(failed.reasons.includes('client-decryption:failed'));

  const stale = assessDataVerificationCoverage({ policy: policy(), results: complete, now: '2027-01-01T00:00:00.000Z' });
  assert.ok(stale.checks.every(check => check.state === 'stale'));
  assert.throws(() => assessDataVerificationCoverage({
    policy: policy(), results: [result('structural', {
      scheduledAt: '2026-11-11T00:00:00.000Z', startedAt: '2026-11-11T00:00:01.000Z', completedAt: '2026-11-11T00:10:00.000Z',
    })], now: '2026-11-10T00:00:00.000Z',
  }), /future verification evidence/);
});

test('rejects cross-policy evidence, duplicate ids, invalid sample placement, and unknown fields', () => {
  assert.throws(() => assessDataVerificationCoverage({
    policy: policy(), results: [{ ...result('structural'), policyId: 'other' }], now: '2026-11-10T00:00:00.000Z',
  }), /outside the selected policy/);
  assert.throws(() => assessDataVerificationCoverage({
    policy: policy(), results: [result('structural'), result('structural')], now: '2026-11-10T00:00:00.000Z',
  }), /ids must be unique/);
  assert.throws(() => DataVerificationResultSchema.parse({ ...result('full'), contentDigests: [d('a')] }), /only for rotating-content/);
  assert.throws(() => assessDataVerificationCoverage({
    policy: policy(),
    results: [result('structural', { completedAt: '2026-11-09T02:00:02.000Z' })],
    now: '2026-11-10T00:00:00.000Z',
  }), /exceeded its bounded timeout/);
  assert.throws(() => DataVerificationPolicySchema.parse({ ...policy(), surprise: true }));
});
