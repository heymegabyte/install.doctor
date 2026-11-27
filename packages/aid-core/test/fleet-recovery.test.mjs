import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFleetRecoveryManifest, planFleetRecovery, classifyFleetRecoveryStatus,
  assessBackupSources, reconcileFleetRecovery, planAtomicConfiguration
} from '../dist/fleet-recovery.js';

const fixture = () => ({
  schemaVersion: 1,
  revision: 'recovery-1',
  host: {
    id: 'zen', os: 'linux', roles: ['zfs-source'], filesystems: ['zfs'],
    capabilities: [
      { id: 'snapshot', applicable: true, reason: 'zfs datasets present' },
      { id: 'replication', applicable: true, reason: 'authorized backup target exists' },
      { id: 'file-backup', applicable: false, reason: 'covered by dataset protection' },
      { id: 'scrub', applicable: false, reason: 'managed by an existing pool policy' },
      { id: 'restore-test', applicable: false, reason: 'no disposable target enrolled' }
    ]
  },
  objectives: { rpoMinutes: 60, rtoMinutes: 240 },
  encryption: { required: true, artifactKeyRef: 'infisical://fleet/zen/backup-key', recoveryRecipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' },
  schedules: [
    { operation: 'snapshot', owner: 'sanoid', expression: 'hourly' },
    { operation: 'replication', owner: 'syncoid', expression: '15 * * * *' }
  ],
  destinations: [{ id: 'vault', hostId: 'vault-1', dataset: 'tank/replicas/zen', boundary: 'tank/replicas/zen', encrypted: true, production: false }],
  exclusions: {
    file: [{ pattern: '/home/*/.cache', reason: 'reproducible cache' }],
    dataset: [{ pattern: 'rpool/tmp', reason: 'ephemeral dataset' }],
    snapshot: [{ pattern: 'rpool/swap', reason: 'swap volume' }],
    replication: [{ pattern: 'rpool/local-only', reason: 'host-local state' }]
  }
});

/** @param {ReturnType<typeof fixture>} input */
function firstDestination(input) {
  const [destination] = input.destinations;
  assert.ok(destination);
  return destination;
}

test('validates a strict manifest and returns an independent copy', () => {
  const input = fixture();
  const result = validateFleetRecoveryManifest(input);
  result.host.roles.push('changed');
  assert.deepEqual(input.host.roles, ['zfs-source']);
});

test('rejects unknown fields and plaintext secret values', () => {
  assert.throws(() => validateFleetRecoveryManifest({ ...fixture(), surprise: true }), /unknown fields/);
  const input = fixture(); input.encryption.artifactKeyRef = 'hunter2';
  assert.throws(() => validateFleetRecoveryManifest(input), /secret reference/);
});

test('requires explicit capability applicability and a reason', () => {
  const input = fixture();
  const [first, ...rest] = input.host.capabilities;
  assert.ok(first);
  const { applicable: _applicable, ...withoutApplicability } = first;
  assert.throws(() => validateFleetRecoveryManifest({ ...input, host: { ...input.host, capabilities: [withoutApplicability, ...rest] } }));
  first.reason = '';
  assert.throws(() => validateFleetRecoveryManifest(input));
});

test('rejects duplicate schedulers for one operation', () => {
  const input = fixture(); input.schedules.push({ operation: 'snapshot', owner: 'cron', expression: '0 * * * *' });
  assert.throws(() => validateFleetRecoveryManifest(input), /one scheduler/);
});

test('rejects unsafe or ambiguous destination boundaries', () => {
  const input = fixture(); firstDestination(input).dataset = 'tank/production';
  assert.throws(() => validateFleetRecoveryManifest(input), /boundary/);
  const production = fixture(); firstDestination(production).production = true;
  assert.throws(() => validateFleetRecoveryManifest(production), /production/);
});

test('requires encryption for every destination', () => {
  const input = fixture(); firstDestination(input).encrypted = false;
  assert.throws(() => validateFleetRecoveryManifest(input), /encrypted/);
});

test('keeps exclusion capabilities separate', () => {
  const input = fixture();
  const file = [...input.exclusions.file, { pattern: 'rpool/secret', reason: 'wrong namespace', capability: 'dataset' }];
  assert.throws(() => validateFleetRecoveryManifest({ ...input, exclusions: { ...input.exclusions, file } }), /unknown fields/);
});

test('plans only applicable capabilities with stable idempotency keys', () => {
  const first = planFleetRecovery(fixture());
  const second = planFleetRecovery(fixture());
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(action => action.capability), ['snapshot', 'replication']);
  assert.equal(new Set(first.map(action => action.idempotencyKey)).size, first.length);
});

test('a revision changes idempotency keys', () => {
  const input = fixture();
  const [before] = planFleetRecovery(input);
  input.revision = 'recovery-2';
  const [after] = planFleetRecovery(input);
  assert.ok(before && after);
  assert.notEqual(after.idempotencyKey, before.idempotencyKey);
});

test('status distinguishes unknown, stale, running, failed, and verified', () => {
  const now = '2026-11-04T12:00:00.000Z';
  assert.equal(classifyFleetRecoveryStatus(undefined, 60, now), 'unknown');
  assert.equal(classifyFleetRecoveryStatus({ state: 'running', startedAt: '2026-11-04T11:55:00.000Z' }, 60, now), 'running');
  assert.equal(classifyFleetRecoveryStatus({ state: 'failed', finishedAt: '2026-11-04T11:55:00.000Z' }, 60, now), 'failed');
  assert.equal(classifyFleetRecoveryStatus({ state: 'succeeded', finishedAt: '2026-11-04T10:00:00.000Z', verified: true }, 60, now), 'stale');
  assert.equal(classifyFleetRecoveryStatus({ state: 'succeeded', finishedAt: '2026-11-04T11:30:00.000Z', verified: false }, 60, now), 'unverified');
  assert.equal(classifyFleetRecoveryStatus({ state: 'succeeded', finishedAt: '2026-11-04T11:30:00.000Z', verified: true }, 60, now), 'verified');
});

/** @returns {[import('../dist/fleet-recovery.js').BackupSourcePolicy]} */
const sourcePolicy = () => [{
  id: 'user-data', path: '/srv/data', expectedMount: '/srv/data', allowSymlink: false,
  crossFilesystem: 'reject', allowEmpty: false
}];
/** @returns {[import('../dist/fleet-recovery.js').BackupSourceEvidence]} */
const sourceEvidence = () => [{
  id: 'user-data', requestedPath: '/srv/data', resolvedPath: '/srv/data', mountPath: '/srv/data',
  exists: true, readable: true, entryCount: 12, isSymlink: false, crossesFilesystem: false
}];

test('source validation accepts exact readable non-empty mount evidence', () => {
  assert.deepEqual(assessBackupSources(sourcePolicy(), sourceEvidence()), [{
    id: 'user-data', state: 'ready', path: '/srv/data', traversal: 'same-filesystem'
  }]);
});

test('source validation fails closed for missing evidence, mounts, readability, and empty data', () => {
  const [missing] = assessBackupSources(sourcePolicy(), []);
  assert.ok(missing?.state === 'blocked');
  assert.match(missing.reasons.join(','), /evidence missing/);
  const evidence = sourceEvidence()[0];
  evidence.exists = false; evidence.readable = false; evidence.entryCount = 0; evidence.mountPath = '/';
  const result = assessBackupSources(sourcePolicy(), [evidence])[0];
  assert.ok(result?.state === 'blocked');
  assert.match(result.reasons.join(','), /missing/);
  assert.match(result.reasons.join(','), /mount/);
  assert.match(result.reasons.join(','), /unreadable/);
  assert.match(result.reasons.join(','), /empty/);
});

test('source validation distinguishes symlink and filesystem-boundary policy', () => {
  const evidence = sourceEvidence()[0]; evidence.isSymlink = true; evidence.crossesFilesystem = true;
  const blocked = assessBackupSources(sourcePolicy(), [evidence])[0];
  assert.ok(blocked?.state === 'blocked');
  assert.match(blocked.reasons.join(','), /symlink/);
  assert.match(blocked.reasons.join(','), /filesystem boundary/);

  const policy = sourcePolicy()[0]; policy.allowSymlink = true; policy.crossFilesystem = 'stay-on-filesystem';
  const [ready] = assessBackupSources([policy], [evidence]);
  assert.ok(ready?.state === 'ready');
  assert.equal(ready.traversal, 'stay-on-filesystem');
});

test('source validation rejects mismatched and undeclared discovery evidence', () => {
  const mismatch = sourceEvidence()[0]; mismatch.requestedPath = '/srv/other';
  const [blocked] = assessBackupSources(sourcePolicy(), [mismatch]);
  assert.ok(blocked?.state === 'blocked');
  assert.match(blocked.reasons.join(','), /does not match/);
  const extra = sourceEvidence()[0]; extra.id = 'undeclared';
  assert.throws(() => assessBackupSources(sourcePolicy(), [extra]), /undeclared/);
});

test('dry-run reconciliation is stable and will not plan around blocked sources', () => {
  const first = reconcileFleetRecovery(fixture(), 'plan', sourcePolicy(), sourceEvidence());
  const second = reconcileFleetRecovery(fixture(), 'plan', sourcePolicy(), sourceEvidence());
  assert.deepEqual(first, second);
  assert.equal(first.mutationAllowed, false);
  assert.ok(first.actions.length > 0);
  const blocked = sourceEvidence(); blocked[0].entryCount = 0;
  assert.deepEqual(reconcileFleetRecovery(fixture(), 'plan', sourcePolicy(), blocked).actions, []);
  assert.deepEqual(reconcileFleetRecovery(fixture(), 'discover', sourcePolicy(), sourceEvidence()).actions, []);
});

test('atomic configuration plan preserves a validated rollback path', () => {
  assert.deepEqual(planAtomicConfiguration('/etc/install-doctor/recovery.json', 'run-42'), {
    target: '/etc/install-doctor/recovery.json',
    candidate: '/etc/install-doctor/recovery.json.install-doctor-run-42.candidate',
    previous: '/etc/install-doctor/recovery.json.install-doctor-run-42.previous',
    steps: ['write-candidate', 'validate-candidate', 'preserve-current', 'atomic-replace'],
    rollbackSteps: ['validate-previous', 'atomic-restore']
  });
  assert.throws(() => planAtomicConfiguration('relative/config', 'run-42'), /absolute/);
});
