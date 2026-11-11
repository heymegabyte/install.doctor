import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProxmoxLifecyclePlanSchema,
  executeDisposableProxmoxLifecycle,
} from '../dist/proxmox-lifecycle.js';
import {
  PROXMOX_FIXTURE_BOUNDARIES,
  PROXMOX_LIFECYCLE_PHASES,
} from '../dist/proxmox-fixture-contract.js';

const releaseDigest = 'a'.repeat(64);
const recipeDigest = 'b'.repeat(64);
const fixture = {
  schemaVersion: 1, fixtureId: 'pve-lifecycle-lab', isolation: 'disposable-nested-lab', platform: 'proxmox-ve',
  architecture: 'x86_64', version: '9.0.3', clusterSize: 1,
  repositories: [{ id: 'pve-no-subscription', family: 'no-subscription', enabled: true, suite: 'trixie',
    signedByDigest: 'c'.repeat(64) }],
  zfsPools: [{ name: 'labpool', guid: '12345678901234567890', health: 'ONLINE', topology: 'mirror',
    encryptedDatasets: true }],
  guests: [
    { vmid: 100, kind: 'qemu', node: 'pve-lab', status: 'stopped', guestAgent: 'configured', backupEnabled: true },
    { vmid: 101, kind: 'lxc', node: 'pve-lab', status: 'stopped', guestAgent: 'not-applicable', backupEnabled: true },
  ],
  backupTargets: [{ storageId: 'pbs-lab', kind: 'pbs', available: true, encryption: 'client-side' }],
  networks: [{ bridge: 'vmbr-lab', kind: 'linux-bridge', vlanAware: false, productionIngressObserved: false }],
  supportedBoundaries: [...PROXMOX_FIXTURE_BOUNDARIES],
};

function evidence(boundary) {
  return { schemaVersion: 1, evidenceId: `pve-${boundary}`, source: 'real-proxmox-host', fixtureId: fixture.fixtureId,
    boundary, releaseDigest, recipeDigest, observedAt: '2026-11-10T10:00:00.000Z',
    expiresAt: '2026-11-17T10:00:00.000Z', independentAttestor: 'proxmox-lab-attestor',
    phases: [...PROXMOX_LIFECYCLE_PHASES], outcome: 'passed' };
}

const operations = [
  { schemaVersion: 1, operationId: 'repo', dependsOn: [], timeoutMs: 60_000, kind: 'repository',
    repositoryId: 'pve-no-subscription', enabled: true, family: 'no-subscription', suite: 'trixie',
    signedByDigest: 'c'.repeat(64) },
  { schemaVersion: 1, operationId: 'host-config', dependsOn: ['repo'], timeoutMs: 60_000,
    kind: 'host-configuration', key: 'zfs.arc-max-bytes', value: 8_589_934_592 },
  { schemaVersion: 1, operationId: 'metadata', dependsOn: ['host-config'], timeoutMs: 60_000,
    kind: 'vm-lxc-metadata', vmid: 100, guestKind: 'qemu', description: 'Disposable qualification VM',
    tags: ['desktop-tools', 'fixture'], protected: true },
  { schemaVersion: 1, operationId: 'guest', dependsOn: ['metadata'], timeoutMs: 60_000,
    kind: 'guest', vmid: 100, desiredStatus: 'running', guestAgent: 'running' },
  { schemaVersion: 1, operationId: 'backup', dependsOn: ['guest'], timeoutMs: 300_000,
    kind: 'backup', backupId: 'qualification-backup-100', vmid: 100, storageId: 'pbs-lab', mode: 'snapshot',
    encryptionRequired: true },
  { schemaVersion: 1, operationId: 'network', dependsOn: ['backup'], timeoutMs: 60_000,
    kind: 'network-intent', bridge: 'vmbr-lab', vlanAware: true, ingressIntent: [] },
  { schemaVersion: 1, operationId: 'maintenance-enter', dependsOn: ['network'], timeoutMs: 60_000,
    kind: 'maintenance', action: 'enter', reason: 'Qualified fixture upgrade' },
  { schemaVersion: 1, operationId: 'upgrade', dependsOn: ['maintenance-enter'], timeoutMs: 600_000,
    kind: 'upgrade', fromVersion: '9.0.3', toVersion: '9.0.4', packageClosureDigest: 'd'.repeat(64),
    requiresMaintenance: true },
  { schemaVersion: 1, operationId: 'maintenance-exit', dependsOn: ['upgrade'], timeoutMs: 60_000,
    kind: 'maintenance', action: 'exit', reason: 'Qualified fixture upgrade verified' },
];

const allEvidence = PROXMOX_FIXTURE_BOUNDARIES.map(evidence);
const plan = { schemaVersion: 1, planId: 'proxmox-lifecycle-1', fixture, role: 'virtualization-host', releaseDigest,
  recipeDigest, evidence: allEvidence, verifiedEvidenceIds: allEvidence.map(item => item.evidenceId),
  now: '2026-11-10T12:00:00.000Z', expectedVersion: '9.0.3', operations };

function state() {
  return { fixtureId: fixture.fixtureId, version: fixture.version, maintenance: false,
    repositories: new Map(), hostConfiguration: new Map(), metadata: new Map(), guests: new Map(),
    backups: new Map(), networks: new Map() };
}

test('strict disposable lifecycle applies every Proxmox operation with exact evidence', () => {
  const target = state();
  const receipt = executeDisposableProxmoxLifecycle(plan, target);
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.finalVersion, '9.0.4');
  assert.equal(receipt.maintenance, false);
  assert.deepEqual(receipt.operationReceipts.map(item => item.kind), [
    'repository', 'host-configuration', 'vm-lxc-metadata', 'guest', 'backup', 'network-intent',
    'maintenance', 'upgrade', 'maintenance',
  ]);
  assert.ok(receipt.operationReceipts.every(item => item.outcome === 'applied'));
  assert.ok(receipt.operationReceipts.every(item => item.evidenceDigest.length === 64));
  assert.equal(target.backups.has('qualification-backup-100'), true);
  assert.equal(target.networks.has('vmbr-lab'), true);
});

test('unchanged reapply is idempotent and creates no duplicate lifecycle resources', () => {
  const target = state();
  executeDisposableProxmoxLifecycle(plan, target);
  const upgradedPlan = { ...plan, expectedVersion: '9.0.4', fixture: { ...fixture, version: '9.0.4' },
    operations: operations.map(operation => operation.kind === 'upgrade'
      ? { ...operation, fromVersion: '9.0.4' } : operation) };
  const second = executeDisposableProxmoxLifecycle(upgradedPlan, target);
  assert.ok(second.operationReceipts.every(item => item.outcome === 'unchanged'));
  assert.equal(target.backups.size, 1);
  assert.equal(target.metadata.size, 1);
});

test('plans reject unknown resources, unsafe backup targets, and upgrades outside maintenance', () => {
  assert.throws(() => ProxmoxLifecyclePlanSchema.parse({ ...plan,
    operations: operations.map(item => item.kind === 'backup' ? { ...item, storageId: 'unknown' } : item) }),
  /available, and encrypted/i);
  assert.throws(() => ProxmoxLifecyclePlanSchema.parse({ ...plan,
    operations: operations.map(item => item.kind === 'vm-lxc-metadata' ? { ...item, vmid: 999 } : item) }),
  /observed guest/i);
  assert.throws(() => ProxmoxLifecyclePlanSchema.parse({ ...plan,
    operations: operations.filter(item => item.kind !== 'maintenance') }), /maintenance entry/i);
  assert.throws(() => ProxmoxLifecyclePlanSchema.parse({ ...plan, unexpected: true }), /unrecognized/i);
});

test('generic role cannot invent ingress and denial occurs before disposable mutation', () => {
  const target = state();
  const unsafe = { ...plan, role: 'generic', operations: operations.map(item => item.kind === 'network-intent'
    ? { ...item, ingressIntent: [{ protocol: 'tcp', port: 8006, sourceCidrs: ['0.0.0.0/0'],
      purpose: 'public Proxmox UI', authority: 'explicit-desired-state', approvalId: 'approval-8006' }] } : item) };
  assert.throws(() => executeDisposableProxmoxLifecycle(unsafe, target), /generic-role-cannot-request-ingress/);
  assert.equal(target.repositories.size, 0);
  assert.equal(target.version, '9.0.3');
});

test('stale, unverified, mismatched fixture and changed version fail before mutation', () => {
  for (const changed of [
    { verifiedEvidenceIds: [] },
    { now: '2026-11-18T12:00:00.000Z' },
    { releaseDigest: 'f'.repeat(64) },
  ]) {
    const target = state();
    assert.throws(() => executeDisposableProxmoxLifecycle({ ...plan, ...changed }, target), /denied/);
    assert.equal(target.repositories.size, 0);
  }
  assert.throws(() => executeDisposableProxmoxLifecycle(plan, { ...state(), fixtureId: 'different-fixture' }),
    /identity changed/);
  assert.throws(() => executeDisposableProxmoxLifecycle(plan, { ...state(), version: '9.0.2' }),
    /version changed/);
});
