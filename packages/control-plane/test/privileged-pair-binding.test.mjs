import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePrivilegedPairBinding } from '../src/privileged-pair-binding.ts';

const hex = value => value.repeat(64);
const profiles = [{ id: 'profile-1', tenantId: 'tenant-authoritative', slug: 'brian', revision: 'revision-1',
  digest: hex('a'), visibility: 'public-bootstrap', enabled: true }];

test('derives privileged tenant, profile, digest, and owner only from server authorities', async () => {
  const tenants = [];
  const result = await resolvePrivilegedPairBinding({
    requestedPermissions: ['pull-desired-state', 'authorize-privileged-run'],
    machineFingerprint: hex('b'), profileId: 'profile-1', profileRevisionDigest: hex('a'), publicProfiles: profiles,
    async resolveOwnerForTenant(tenant) { tenants.push(tenant); return {
      authenticationActor: 'better-auth-user:user_1', ownerActorId: 'owner-1' }; },
  });
  assert.deepEqual(tenants, ['tenant-authoritative']);
  assert.deepEqual(result, { tenantId: 'tenant-authoritative', profileId: 'profile-1',
    profileRevision: hex('a'), profileRevisionDigest: hex('a'), machineFingerprint: hex('b'),
    ownerActor: 'better-auth-user:user_1', ownerActorId: 'owner-1' });
});

test('ordinary pairing requires no privileged authority', async () => {
  assert.equal(await resolvePrivilegedPairBinding({ requestedPermissions: ['report-status'],
    publicProfiles: 'not consulted', async resolveOwnerForTenant() { throw new Error('not consulted'); } }), null);
});

test('rejects missing/substituted binding, private/disabled profiles, and absent owner', async () => {
  const base = { requestedPermissions: ['authorize-privileged-run'], machineFingerprint: hex('b'),
    profileId: 'profile-1', profileRevisionDigest: hex('a'), publicProfiles: profiles,
    async resolveOwnerForTenant() { return { authenticationActor: 'better-auth-user:user_1', ownerActorId: 'owner-1' }; } };
  for (const changed of [
    { machineFingerprint: undefined }, { machineFingerprint: hex('B') }, { profileId: undefined },
    { profileId: 'caller-invented' }, { profileRevisionDigest: undefined },
    { profileRevisionDigest: hex('9') },
    { publicProfiles: [{ ...profiles[0], visibility: 'private' }] },
    { publicProfiles: [{ ...profiles[0], enabled: false }] },
    { resolveOwnerForTenant: async () => null },
  ]) await assert.rejects(resolvePrivilegedPairBinding({ ...base, ...changed }), /authority_unavailable/);
});
