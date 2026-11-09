import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthoritativeBrokerPlanFacts,
  createAuthoritativeBrokerRunIntentAdapter,
} from '../src/broker-run-intent-authority.ts';

const hex = value => value.repeat(64);
const current = new Date('2026-11-09T12:00:00.000Z');
const principal = { deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), tenantId: 'tenant-1',
  permissions: ['authorize-privileged-run'] };
const intent = {
  schemaVersion: 1, runIntentId: 'intent-1', authorizationId: 'authorization-1', tenantId: 'tenant-1',
  profileId: 'profile-1', profileRevisionDigest: hex('a'), deviceCredentialId: 'device-1',
  deviceFingerprint: hex('b'), grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1',
  runId: 'run-1', planDigest: hex('c'), enrolledUid: 1000, brokerExecutableDigest: hex('d'),
  runtimeDigest: hex('e'), workerDigest: hex('f'),
  operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
  descriptorDigest: hex('1'), closureDigest: hex('2'), consentDigest: hex('3'),
  requestedAt: '2026-11-09T11:59:00.000Z', grantExpiresAt: '2026-11-09T12:20:00.000Z',
};

const facts = request => ({
  hostId: request.hostId, runId: request.runId, planDigest: request.planDigest,
  enrolledUid: request.enrolledUid, brokerExecutableDigest: request.brokerExecutableDigest,
  runtimeDigest: request.runtimeDigest, workerDigest: request.workerDigest,
  operations: request.operations, descriptorDigest: request.descriptorDigest,
  closureDigest: request.closureDigest, consentDigest: request.consentDigest,
});

function fixture(overrides = {}) {
  const values = {
    device: { deviceCredentialId: principal.deviceCredentialId, deviceFingerprint: principal.deviceFingerprint,
      tenantId: principal.tenantId, profileId: intent.profileId,
      profileRevisionDigest: intent.profileRevisionDigest, active: true },
    profile: { profileId: intent.profileId, tenantId: principal.tenantId, revision: 'revision-7',
      digest: intent.profileRevisionDigest, visibility: 'public-bootstrap', enabled: true },
    release: { product: 'desktop-tools', channel: 'stable', releaseId: intent.releaseId,
      notBefore: '2026-11-09T11:00:00.000Z', expiresAt: '2026-11-10T12:00:00.000Z' },
    owner: { authenticationActor: 'owner@example.com', ownerActorId: 'owner-1' },
    plan: facts(intent),
    ...overrides,
  };
  const calls = [];
  const adapter = createAuthoritativeBrokerRunIntentAdapter({ now: () => current, resolvers: {
    device: { async resolve(id) { calls.push(['device', id]); return values.device; } },
    profile: { async resolve(id) { calls.push(['profile', id]); return values.profile; } },
    release: { async resolveActive(channel) { calls.push(['release', channel]); return values.release; } },
    plan: { async reconstruct(context) { calls.push(['plan', context]); return values.plan; } },
    owner: { async resolveForTenant(tenant) { calls.push(['owner', tenant]); return values.owner; } },
    runIntent: { async load(id) { calls.push(['load', id]); return id === intent.runIntentId ? intent : null; } },
  } });
  return { adapter, calls, values };
}

test('accepts only when independent device, public profile, active release, owner and plan facts agree', async () => {
  const { adapter, calls } = fixture();
  assert.deepEqual(await adapter.reconstructRunIntent(intent, principal), intent);
  assert.deepEqual(calls.map(([name]) => name), ['device', 'profile', 'release', 'owner', 'plan']);
  assert.deepEqual(await adapter.loadRunIntent(intent.runIntentId), intent);
  assert.deepEqual(await adapter.ownerForTenant(intent.tenantId), {
    authenticationActor: 'owner@example.com', ownerActorId: 'owner-1',
  });
});

test('rejects every authenticated device and immutable public-profile substitution', async () => {
  for (const changed of [
    { request: { tenantId: 'tenant-2' } },
    { request: { deviceCredentialId: 'device-2' } },
    { request: { deviceFingerprint: hex('9') } },
    { principal: { tenantId: 'tenant-2' } },
    { principal: { deviceCredentialId: 'device-2' } },
    { principal: { deviceFingerprint: hex('9') } },
    { request: { profileId: 'profile-2' } },
    { request: { profileRevisionDigest: hex('8') } },
  ]) {
    const { adapter } = fixture();
    assert.equal(await adapter.reconstructRunIntent({ ...intent, ...changed.request },
      { ...principal, ...changed.principal }), null);
  }
  for (const device of [
    { ...fixture().values.device, profileId: 'profile-2' },
    { ...fixture().values.device, profileRevisionDigest: hex('8') },
  ]) assert.equal(await fixture({ device }).adapter.reconstructRunIntent(intent, principal), null);
  for (const profile of [
    { ...fixture().values.profile, tenantId: 'tenant-2' },
    { ...fixture().values.profile, visibility: 'private' },
    { ...fixture().values.profile, enabled: false },
  ]) {
    const { adapter } = fixture({ profile });
    if (profile.visibility === 'private' || profile.enabled === false) {
      await assert.rejects(adapter.reconstructRunIntent(intent, principal));
    } else assert.equal(await adapter.reconstructRunIntent(intent, principal), null);
  }
});

test('rejects inactive, substituted, and expired releases and invalid grant time windows', async () => {
  for (const release of [
    { ...fixture().values.release, releaseId: 'release-2' },
    { ...fixture().values.release, product: 'other-product' },
    { ...fixture().values.release, channel: 'canary' },
    { ...fixture().values.release, notBefore: '2026-11-09T12:00:01.000Z' },
    { ...fixture().values.release, expiresAt: current.toISOString() },
  ]) {
    const { adapter } = fixture({ release });
    if (release.product !== 'desktop-tools' || release.channel !== 'stable') {
      await assert.rejects(adapter.reconstructRunIntent(intent, principal));
    } else assert.equal(await adapter.reconstructRunIntent(intent, principal), null);
  }
  const { adapter } = fixture();
  assert.equal(await adapter.reconstructRunIntent({ ...intent,
    requestedAt: '2026-11-09T12:05:01.000Z', grantExpiresAt: '2026-11-09T12:20:00.000Z' }, principal), null);
  assert.equal(await adapter.reconstructRunIntent({ ...intent,
    requestedAt: '2026-11-09T11:30:00.000Z', grantExpiresAt: current.toISOString() }, principal), null);
});

test('rejects missing owner mapping and every independently reconstructed plan substitution', async () => {
  assert.equal(await fixture({ owner: null }).adapter.reconstructRunIntent(intent, principal), null);
  for (const changed of [
    { hostId: 'host-2' }, { runId: 'run-2' }, { planDigest: hex('9') }, { enrolledUid: 0 },
    { brokerExecutableDigest: hex('9') }, { runtimeDigest: hex('9') }, { workerDigest: hex('9') },
    { operations: [{ taskId: 'task-2', operationId: 'operation-2', phase: 'apply' }] },
    { descriptorDigest: hex('9') }, { closureDigest: hex('9') }, { consentDigest: hex('9') },
  ]) assert.equal(await fixture({ plan: { ...facts(intent), ...changed } }).adapter
    .reconstructRunIntent(intent, principal), null);
  assert.throws(() => AuthoritativeBrokerPlanFacts.parse({ ...facts(intent), unknownAuthority: true }));
});

test('does not disguise resolver failure as authoritative mismatch', async () => {
  const setup = fixture();
  setup.values.plan = undefined;
  await assert.rejects(setup.adapter.reconstructRunIntent(intent, principal));
});
