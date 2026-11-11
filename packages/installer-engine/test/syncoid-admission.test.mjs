import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverSyncoidState, planSyncoidAdmission } from '../dist/index.js';

const endpoint = (side) => ({
  hostId: side === 'source' ? 'zen' : 'vault',
  hostKeyFingerprint: side === 'source' ? `SHA256:${'A'.repeat(43)}` : `SHA256:${'B'.repeat(43)}`,
  pool: side === 'source' ? 'rpool' : 'backup',
  poolGuid: side === 'source' ? 'pool-zen-1' : 'pool-vault-1',
  dataset: side === 'source' ? 'rpool/data' : 'backup/zen/data',
  datasetGuid: side === 'source' ? 'dataset-zen-data-1' : 'dataset-vault-zen-data-1',
});
const identity = {
  identityId: 'syncoid-zen-data', principal: 'syncoid-zen-data',
  sourceDataset: 'rpool/data', destinationDataset: 'backup/zen/data',
  allowedOperations: ['zfs-list', 'zfs-hold', 'zfs-release', 'zfs-send', 'zfs-receive', 'zfs-bookmark'],
  interactiveShell: false, administrativeAccess: false, delegatedDatasetOnly: true,
};
const policy = {
  schemaVersion: 1, policyId: 'zen-data-replication', source: endpoint('source'), destination: endpoint('destination'),
  expectedIdentity: identity, encryptionMode: 'raw', resumable: true, preserveBookmarks: true, preserveHolds: true,
  bandwidthLimitBytesPerSecond: 50_000_000,
  retry: { maxAttempts: 4, initialDelaySeconds: 10, maxDelaySeconds: 300 },
  capacity: { reserveBytes: 100, admissionRatio: 0.9, estimatedTransferBytes: 200 },
};
const observation = {
  schemaVersion: 1, observationId: 'syncoid-observation-1', evidenceDigest: 'a'.repeat(64), readOnly: true,
  source: { ...endpoint('source'), mounted: true, encryption: 'native', keyLoaded: true, historyMode: 'raw' },
  destination: { ...endpoint('destination'), mounted: false, readOnly: true, encryption: 'native', keyLoaded: false, historyMode: 'raw', sizeBytes: 10_000, allocatedBytes: 1_000 },
  effectiveIdentity: identity,
  sourceSnapshots: [{ name: 'rpool/data@s1', guid: 'snap-1', createdTxg: 10 }, { name: 'rpool/data@s2', guid: 'snap-2', createdTxg: 20 }],
  destinationSnapshots: [{ name: 'backup/zen/data@s1', guid: 'snap-1', createdTxg: 10 }],
  sourceBookmarks: [{ name: 'rpool/data#syncoid', guid: 'snap-1' }], destinationBookmarks: [{ name: 'backup/zen/data#syncoid', guid: 'snap-1' }],
  holds: [{ snapshotGuid: 'snap-1', tags: ['syncoid:anchor'] }], resumeToken: null,
};

test('admits deterministic bounded raw incremental intent without destructive behavior', () => {
  const first = planSyncoidAdmission(policy, observation);
  const second = planSyncoidAdmission(structuredClone(policy), structuredClone(observation));
  assert.equal(first.status, 'ready');
  assert.equal(first.mode, 'read-only');
  assert.equal(first.commonAnchorGuid, 'snap-1');
  assert.equal(first.transfer.raw, true);
  assert.equal(first.transfer.bandwidthLimitBytesPerSecond, 50_000_000);
  assert.deepEqual(first.transfer.retry, policy.retry);
  assert.equal(first.transfer.destructiveRollback, false);
  assert.equal(first.transfer.destructiveTargetDeletion, false);
  assert.equal(first.transfer.preserveBookmarks, true);
  assert.equal(first.transfer.preserveHolds, true);
  assert.equal(first.planDigest, second.planDigest);
  assert.ok(first.findings.some(item => item.code === 'common-anchor'));
  assert.ok(first.findings.some(item => item.code === 'dependency-preserved'));
});

test('validates and prefers a dataset-bound resume token', () => {
  const input = structuredClone(observation);
  input.resumeToken = { tokenDigest: 'b'.repeat(64), sourceDatasetGuid: policy.source.datasetGuid, destinationDatasetGuid: policy.destination.datasetGuid, baseGuid: 'snap-1', targetGuid: 'snap-2' };
  const plan = planSyncoidAdmission(policy, input);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.transfer.resumeTokenDigest, 'b'.repeat(64));
  assert.ok(plan.findings.some(item => item.code === 'resume-ready'));
  input.resumeToken.destinationDatasetGuid = 'wrong-dataset';
  const denied = planSyncoidAdmission(policy, input);
  assert.equal(denied.status, 'blocked');
  assert.equal(denied.transfer.resumeTokenDigest, null);
  assert.ok(denied.findings.some(item => item.code === 'resume-invalid'));
  input.resumeToken = { tokenDigest: 'c'.repeat(64), sourceDatasetGuid: policy.source.datasetGuid, destinationDatasetGuid: policy.destination.datasetGuid, baseGuid: 'snap-2', targetGuid: 'snap-2' };
  assert.ok(planSyncoidAdmission(policy, input).findings.some(item => item.code === 'resume-invalid'));
});

test('fails closed on destination identity drift, excess authority, capacity, and mounted replicas', () => {
  const input = structuredClone(observation);
  input.destination.hostKeyFingerprint = `SHA256:${'C'.repeat(43)}`;
  input.destination.mounted = true;
  input.destination.readOnly = false;
  input.destination.allocatedBytes = 9_000;
  input.effectiveIdentity.interactiveShell = true;
  input.effectiveIdentity.administrativeAccess = true;
  input.effectiveIdentity.delegatedDatasetOnly = false;
  const plan = planSyncoidAdmission(policy, input);
  assert.equal(plan.status, 'blocked');
  for (const code of ['endpoint-mismatch', 'identity-mismatch', 'identity-overprivileged', 'destination-mounted', 'capacity-blocked']) assert.ok(plan.findings.some(item => item.code === code), code);
});

test('blocks raw/plain history mixing and invalid raw source encryption', () => {
  const mixed = structuredClone(observation);
  mixed.source.encryption = 'off';
  mixed.destination.historyMode = 'plain';
  const plan = planSyncoidAdmission(policy, mixed);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.findings.some(item => item.code === 'encryption-mismatch'));
  assert.ok(plan.findings.some(item => item.code === 'history-mode-mismatch'));
  const plainPolicy = { ...policy, encryptionMode: 'plain' };
  assert.equal(planSyncoidAdmission(plainPolicy, observation).status, 'blocked');
  const unavailable = structuredClone(observation);
  unavailable.source.mounted = false;
  assert.equal(planSyncoidAdmission(policy, unavailable).status, 'ready', 'raw send does not require mounting or loading the source key');
  unavailable.sourceSnapshots = [];
  unavailable.sourceBookmarks = [];
  assert.ok(planSyncoidAdmission(policy, unavailable).findings.some(item => item.code === 'source-unavailable'));
});

test('reports divergence and absent anchors for manual review, never rollback or deletion', () => {
  const diverged = structuredClone(observation);
  diverged.destinationSnapshots.push({ name: 'backup/zen/data@local', guid: 'destination-only', createdTxg: 30 });
  const plan = planSyncoidAdmission(policy, diverged);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.findings.some(item => item.code === 'destination-diverged'));
  assert.equal(plan.transfer.destructiveRollback, false);
  assert.equal(plan.transfer.destructiveTargetDeletion, false);
  const noAnchor = structuredClone(observation);
  noAnchor.destinationSnapshots = [{ name: 'backup/zen/data@other', guid: 'other', createdTxg: 5 }];
  noAnchor.destinationBookmarks = [];
  const denied = planSyncoidAdmission(policy, noAnchor);
  assert.ok(denied.findings.some(item => item.code === 'common-anchor-missing'));
});

test('strict validation rejects unsafe policy, mutable discovery, and ambiguous histories', () => {
  assert.throws(() => planSyncoidAdmission({ ...policy, destination: policy.source }, observation), /outside the source host failure domain/);
  assert.throws(() => planSyncoidAdmission({ ...policy, expectedIdentity: { ...identity, interactiveShell: true } }, observation), /deny shell/);
  assert.throws(() => planSyncoidAdmission({ ...policy, retry: { maxAttempts: 11, initialDelaySeconds: 1, maxDelaySeconds: 2 } }, observation));
  assert.throws(() => discoverSyncoidState({ ...observation, readOnly: false }), /readOnly/);
  const duplicate = structuredClone(observation); duplicate.sourceSnapshots.push({ name: 'rpool/data@s3', guid: 'snap-2', createdTxg: 30 });
  assert.throws(() => discoverSyncoidState(duplicate), /GUIDs must be unique/);
  const unknownHold = structuredClone(observation); unknownHold.holds[0].snapshotGuid = 'missing';
  assert.throws(() => discoverSyncoidState(unknownHold), /observed snapshot GUID/);
});
