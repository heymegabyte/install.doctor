import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROXMOX_FIXTURE_BOUNDARIES,
  PROXMOX_LIFECYCLE_PHASES,
  ProxmoxFixtureEvidenceSchema,
  ProxmoxFixtureSchema,
  preflightProxmoxMutation,
} from '../dist/proxmox-fixture-contract.js';

const releaseDigest = 'a'.repeat(64);
const recipeDigest = 'b'.repeat(64);
const now = '2026-11-10T12:00:00.000Z';
const fixture = {
  schemaVersion: 1,
  fixtureId: 'pve-9-nested-amd64',
  isolation: 'disposable-nested-lab',
  platform: 'proxmox-ve',
  architecture: 'x86_64',
  version: '9.0.3',
  clusterSize: 1,
  repositories: [{ id: 'pve-no-subscription', family: 'no-subscription', enabled: true,
    suite: 'trixie', signedByDigest: 'c'.repeat(64) }],
  zfsPools: [{ name: 'labpool', guid: '12345678901234567890', health: 'ONLINE',
    topology: 'mirror', encryptedDatasets: true }],
  guests: [
    { vmid: 100, kind: 'qemu', node: 'pve-lab', status: 'running', guestAgent: 'running', backupEnabled: true },
    { vmid: 101, kind: 'lxc', node: 'pve-lab', status: 'stopped', guestAgent: 'not-applicable', backupEnabled: true },
  ],
  backupTargets: [{ storageId: 'pbs-lab', kind: 'pbs', available: true, encryption: 'client-side' }],
  networks: [{ bridge: 'vmbr-lab', kind: 'linux-bridge', vlanAware: true, productionIngressObserved: false }],
  supportedBoundaries: [...PROXMOX_FIXTURE_BOUNDARIES],
};

function receipt(boundary, overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: `pve-${boundary}`,
    source: 'real-proxmox-host',
    fixtureId: fixture.fixtureId,
    boundary,
    releaseDigest,
    recipeDigest,
    observedAt: '2026-11-10T10:00:00.000Z',
    expiresAt: '2026-11-17T10:00:00.000Z',
    independentAttestor: 'proxmox-lab-attestor',
    phases: [...PROXMOX_LIFECYCLE_PHASES],
    outcome: 'passed',
    ...overrides,
  };
}

function request(boundary, overrides = {}) {
  const evidence = [receipt(boundary)];
  return { fixture, boundary, role: 'virtualization-host', ingressIntent: [], releaseDigest, recipeDigest,
    evidence, verifiedEvidenceIds: [evidence[0].evidenceId], now, ...overrides };
}

test('strict disposable fixture covers every required Proxmox observation boundary', () => {
  const parsed = ProxmoxFixtureSchema.parse(fixture);
  assert.deepEqual(parsed.supportedBoundaries, [
    'repository', 'zfs', 'vm-lxc-inventory', 'guest-agent', 'backup',
    'network-intent', 'upgrade', 'maintenance',
  ]);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, unexpected: true }), /unrecognized/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, isolation: 'production-host' }));
});

test('fixture cannot claim coverage without representative observed resources', () => {
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, repositories: [] }), /observed repository/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, zfsPools: [] }), /observed pool/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, guests: [] }), /observed QEMU VM/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture,
    guests: fixture.guests.filter(guest => guest.kind === 'qemu') }), /observed LXC guest/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture,
    guests: fixture.guests.filter(guest => guest.kind === 'lxc') }), /observed QEMU VM/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture,
    guests: fixture.guests.map(guest => ({ ...guest, guestAgent: 'not-applicable' })) }), /applicable observed guest/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, backupTargets: [] }), /observed target/i);
  assert.throws(() => ProxmoxFixtureSchema.parse({ ...fixture, networks: [] }), /observed network/i);
});

test('every mutation boundary requires externally verified current exact lifecycle evidence', () => {
  for (const boundary of PROXMOX_FIXTURE_BOUNDARIES) {
    assert.deepEqual(preflightProxmoxMutation(request(boundary)), {
      decision: 'allow', boundary, evidenceId: `pve-${boundary}`,
      reason: 'verified-real-lifecycle-evidence',
    });
  }
});

test('generic role can never invent production ingress', () => {
  const ingressIntent = [{ protocol: 'tcp', port: 443, sourceCidrs: ['0.0.0.0/0'],
    purpose: 'public management endpoint', authority: 'explicit-desired-state', approvalId: 'approval-443' }];
  assert.deepEqual(preflightProxmoxMutation(request('network-intent', { role: 'generic', ingressIntent })), {
    decision: 'deny', boundary: 'network-intent', reason: 'generic-role-cannot-request-ingress',
  });
  assert.deepEqual(preflightProxmoxMutation(request('backup', { role: 'generic', ingressIntent })), {
    decision: 'deny', boundary: 'backup', reason: 'generic-role-cannot-request-ingress',
  });
  assert.throws(() => preflightProxmoxMutation(request('network-intent', {
    ingressIntent: [{ ...ingressIntent[0], authority: 'fixture-observation' }],
  })));
});

test('explicit ingress is confined to the network-intent boundary', () => {
  const ingressIntent = [{ protocol: 'tcp', port: 8443, sourceCidrs: ['10.0.0.0/24'],
    purpose: 'approved reverse proxy', authority: 'explicit-desired-state', approvalId: 'approval-8443' }];
  assert.deepEqual(preflightProxmoxMutation(request('upgrade', { role: 'edge-gateway', ingressIntent })), {
    decision: 'deny', boundary: 'upgrade', reason: 'ingress-requires-network-boundary',
  });
  assert.equal(preflightProxmoxMutation(request('network-intent', {
    role: 'edge-gateway', ingressIntent,
  })).decision, 'allow');
});

test('mocked, unverified, stale, future, mismatched, and incomplete evidence cannot authorize mutation', () => {
  const base = request('maintenance');
  for (const input of [
    { ...base, verifiedEvidenceIds: [] },
    { ...base, now: '2026-11-18T12:00:00.000Z' },
    { ...base, now: '2026-11-01T12:00:00.000Z' },
    { ...base, releaseDigest: 'd'.repeat(64) },
    { ...base, recipeDigest: 'e'.repeat(64) },
    { ...base, evidence: [receipt('maintenance', { fixtureId: 'different-fixture' })] },
  ]) {
    assert.deepEqual(preflightProxmoxMutation(input), {
      decision: 'deny', boundary: 'maintenance', reason: 'no-current-verified-real-lifecycle-evidence',
    });
  }
  assert.throws(() => ProxmoxFixtureEvidenceSchema.parse(receipt('maintenance', {
    phases: PROXMOX_LIFECYCLE_PHASES.slice(0, -1),
  })));
  assert.throws(() => ProxmoxFixtureEvidenceSchema.parse(receipt('maintenance', {
    source: 'simulated-proxmox-host',
  })));
});

test('unsupported boundaries and malformed input fail closed without platform side effects', () => {
  const limited = { ...fixture, supportedBoundaries: ['repository'] };
  assert.deepEqual(preflightProxmoxMutation(request('zfs', { fixture: limited })), {
    decision: 'deny', boundary: 'zfs', reason: 'unsupported-boundary',
  });
  assert.throws(() => preflightProxmoxMutation({ ...request('backup'), releaseDigest: 'unsigned' }));
  assert.throws(() => preflightProxmoxMutation({ ...request('upgrade'), extra: true }), /unrecognized/i);
});
