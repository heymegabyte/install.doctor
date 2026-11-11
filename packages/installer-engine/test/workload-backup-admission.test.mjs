import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkloadBackupPolicySchema,
  planWorkloadBackupAdmission,
  verifyWorkloadBackupRun,
  workloadBackupSourceIdentityDigest,
} from '../dist/workload-backup-admission.js';

const hex = character => character.repeat(64);
const source = { hostId: 'host-db-1', sourceId: 'billing-db', canonicalPath: '/srv/postgresql', filesystemId: 'fs-991', mountId: 'mount-44' };
const policy = {
  schemaVersion: 1,
  policyId: 'billing-protection',
  workloadId: 'billing',
  workloadKind: 'database',
  source,
  allowEmptySource: false,
  paths: [
    { pathId: 'native-dump', kind: 'database-native', existing: true, sourceId: source.sourceId, required: true, engine: 'postgresql', consistencyMode: 'transactional-dump', downstreamPathId: 'restic-primary', outputMode: 'stdout', persistentPlaintext: false },
    { pathId: 'restic-primary', kind: 'restic', existing: true, sourceId: source.sourceId, required: true, repositoryId: 'restic-prod-1', destinationFailureDomain: 'backup-host-2', repositoryEncryptionRequired: true },
    { pathId: 'offsite-copy', kind: 'rclone', existing: true, sourceId: source.sourceId, required: true, remoteId: 'offsite-crypt', upstreamPathId: 'restic-primary', transportOnly: true, deleteEnabled: false },
  ],
};

function observation(overrides = {}) {
  const sourceDigest = workloadBackupSourceIdentityDigest(source);
  return {
    schemaVersion: 1,
    observationId: 'observation-1',
    observedAt: '2026-11-10T12:00:00Z',
    evidenceDigest: hex('a'),
    readOnly: true,
    source: { ...source, present: true, mounted: true, readable: true, entryCount: 12, contentBytes: 50_000, readError: null, ...overrides.source },
    paths: [
      { pathId: 'native-dump', kind: 'database-native', detected: true, functioning: true, sourceIdentityDigest: sourceDigest, encryption: 'protected-transient', lastSuccessAt: '2026-11-10T11:00:00Z' },
      { pathId: 'restic-primary', kind: 'restic', detected: true, functioning: true, sourceIdentityDigest: sourceDigest, encryption: 'restic-repository', lastSuccessAt: '2026-11-10T11:01:00Z' },
      { pathId: 'offsite-copy', kind: 'rclone', detected: true, functioning: true, sourceIdentityDigest: sourceDigest, encryption: 'encrypted-upstream', lastSuccessAt: '2026-11-10T11:02:00Z' },
    ].map(path => overrides.paths?.[path.pathId] ? { ...path, ...overrides.paths[path.pathId] } : path),
  };
}

test('preserves existing encrypted database, restic, and rclone paths without mutation or replacement', () => {
  const plan = planWorkloadBackupAdmission(policy, observation());
  assert.equal(plan.status, 'ready');
  assert.equal(plan.replaceFunctioningProtection, false);
  assert.ok(plan.paths.every(path => path.disposition === 'preserve-and-use' && path.mutating === false));
  assert.ok(plan.findings.some(finding => finding.code === 'transport-only'));
});

test('supports suitable PBS protection for VM and container workloads', () => {
  const vmSource = { hostId: 'pve-1', sourceId: 'vm-100', canonicalPath: '/var/lib/vz/images/100', filesystemId: 'zfs-guid-1', mountId: 'rpool-data' };
  const vmPolicy = { schemaVersion: 1, policyId: 'vm-policy', workloadId: 'vm-100', workloadKind: 'vm', source: vmSource, allowEmptySource: false, paths: [{ pathId: 'pbs-main', kind: 'pbs', existing: true, sourceId: 'vm-100', required: true, repositoryId: 'pbs-repo', datastore: 'backups', namespace: 'production', clientEncryptionRequired: true }] };
  const vmObservation = { schemaVersion: 1, observationId: 'pve-observation', observedAt: '2026-11-10T12:00:00Z', evidenceDigest: hex('b'), readOnly: true, source: { ...vmSource, present: true, mounted: true, readable: true, entryCount: 1, contentBytes: 10_000, readError: null }, paths: [{ pathId: 'pbs-main', kind: 'pbs', detected: true, functioning: true, sourceIdentityDigest: workloadBackupSourceIdentityDigest(vmSource), encryption: 'pbs-client', lastSuccessAt: '2026-11-10T10:00:00Z' }] };
  assert.equal(planWorkloadBackupAdmission(vmPolicy, vmObservation).status, 'ready');
});

test('rejects policy graphs that use rclone as backup or omit database-native consistency', () => {
  assert.throws(() => WorkloadBackupPolicySchema.parse({ ...policy, paths: policy.paths.filter(path => path.kind !== 'database-native') }), /native consistency/);
  assert.throws(() => WorkloadBackupPolicySchema.parse({ ...policy, paths: policy.paths.map(path => path.kind === 'rclone' ? { ...path, upstreamPathId: 'native-dump' } : path) }), /PBS or restic/);
});

test('blocks wrong source identity, missing mount, unreadable source, and unexpectedly empty source', () => {
  for (const [candidate, code] of [
    [observation({ source: { filesystemId: 'wrong-fs' } }), 'source-identity-mismatch'],
    [observation({ source: { mounted: false } }), 'source-unmounted'],
    [observation({ source: { readable: false, readError: 'permission denied' } }), 'source-unreadable'],
    [observation({ source: { entryCount: 0, contentBytes: 0 } }), 'source-unexpectedly-empty'],
  ]) {
    const plan = planWorkloadBackupAdmission(policy, candidate);
    assert.equal(plan.status, 'blocked');
    assert.ok(plan.findings.some(finding => finding.code === code));
  }
});

test('blocks missing, unhealthy, source-mismatched, or insufficiently encrypted paths instead of replacing them', () => {
  const candidates = [
    ['restic-primary', { detected: false, functioning: false }, 'path-missing'],
    ['restic-primary', { functioning: false }, 'path-not-functioning'],
    ['restic-primary', { sourceIdentityDigest: hex('c') }, 'path-source-mismatch'],
    ['restic-primary', { encryption: 'none' }, 'encryption-unverified'],
    ['offsite-copy', { encryption: 'server-only' }, 'encryption-unverified'],
  ];
  for (const [pathId, changed, code] of candidates) {
    const plan = planWorkloadBackupAdmission(policy, observation({ paths: { [pathId]: changed } }));
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.replaceFunctioningProtection, false);
    assert.ok(plan.findings.some(finding => finding.code === code && finding.subject === pathId));
  }
});

test('denies false success despite exit zero when source, encryption, commit, or output proof is absent', () => {
  const plan = planWorkloadBackupAdmission(policy, observation());
  const successfulPath = pathId => ({ pathId, exitCode: 0, sourceReadVerified: true, encryptionVerified: true, destinationCommitted: true, producedBytes: 1_000 });
  const evidence = { schemaVersion: 1, planDigest: plan.planDigest, sourceIdentityDigest: workloadBackupSourceIdentityDigest(source), paths: policy.paths.map(path => successfulPath(path.pathId)) };
  assert.deepEqual(verifyWorkloadBackupRun(plan, policy, evidence), { status: 'verified', reasons: [] });
  for (const changed of [
    { sourceReadVerified: false },
    { encryptionVerified: false },
    { destinationCommitted: false },
    { producedBytes: 0 },
  ]) {
    const paths = evidence.paths.map(path => path.pathId === 'restic-primary' ? { ...path, ...changed } : path);
    assert.equal(verifyWorkloadBackupRun(plan, policy, { ...evidence, paths }).status, 'failed');
  }
  assert.equal(verifyWorkloadBackupRun({ ...plan, status: 'blocked' }, policy, evidence).status, 'failed');
  assert.equal(verifyWorkloadBackupRun(plan, { ...policy, policyId: 'substituted-policy' }, evidence).status, 'failed');
  assert.equal(verifyWorkloadBackupRun(plan, policy, { ...evidence, paths: [...evidence.paths, successfulPath('undeclared-path')] }).status, 'failed');
  assert.throws(() => verifyWorkloadBackupRun(plan, policy, { ...evidence, paths: [...evidence.paths, evidence.paths[0]] }), /unique/);
});

test('plans are deterministic and strict schemas reject surplus authority', () => {
  assert.deepEqual(planWorkloadBackupAdmission(policy, observation()), planWorkloadBackupAdmission(policy, observation()));
  assert.throws(() => WorkloadBackupPolicySchema.parse({ ...policy, shellCommand: 'restic backup /' }), /unrecognized/i);
  assert.throws(() => planWorkloadBackupAdmission(policy, observation({ paths: { 'restic-primary': { detected: false, functioning: true } } })), /undetected path/);
});
