import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDesktopToolsHostname,
  resolvePublicProfileDescriptor,
  resolveTenantProfile,
  validateProfileDirectory,
  validateProfileSlug
} from '../dist/profile-resolution.js';

test('classifies only one nonreserved label as a Desktop Tools profile', () => {
  assert.deepEqual(classifyDesktopToolsHostname('example.desktop.tools'), {
    kind: 'profile', hostname: 'example.desktop.tools', slug: 'example'
  });
  assert.equal(classifyDesktopToolsHostname('desktop.tools').kind, 'apex');
  assert.deepEqual(classifyDesktopToolsHostname('api.desktop.tools'), {
    kind: 'reserved', hostname: 'api.desktop.tools', name: 'api'
  });
  assert.equal(classifyDesktopToolsHostname('nested.example.desktop.tools').kind, 'invalid');
  assert.equal(classifyDesktopToolsHostname('example.desktop.tools.attacker.test').kind, 'unrelated');
  assert.equal(classifyDesktopToolsHostname('ｅｘａｍｐｌｅ.desktop.tools').kind, 'invalid');
});

const digest = 'a'.repeat(64);
const profiles = [{
  id: 'profile-example',
  tenantId: 'tenant-one',
  slug: 'example',
  revision: 'r1',
  digest,
  visibility: 'public-bootstrap',
  enabled: true
}, {
  id: 'profile-private',
  tenantId: 'tenant-two',
  slug: 'private-box',
  revision: 'r2',
  digest: 'b'.repeat(64),
  visibility: 'private',
  enabled: false
}];

test('accepts one canonical nonreserved DNS label', () => {
  assert.equal(validateProfileSlug('brian-workstation'), 'brian-workstation');
  assert.deepEqual(validateProfileDirectory(profiles), profiles);
});

test('rejects reserved, malformed, oversized, mixed-case, and Unicode-confusable slugs', () => {
  for (const slug of [
    'api', 'start', 'pair', '-example', 'example-', 'example--box', 'UPPER',
    'ｅｘａｍｐｌｅ', 'exаmple', 'a'.repeat(64), 'a/b', 'ab'
  ]) {
    assert.throws(() => validateProfileSlug(slug));
  }
});

test('resolves an enabled profile only inside its authenticated tenant', () => {
  const result = resolveTenantProfile(profiles, { tenantId: 'tenant-one', slug: 'example' });
  assert.equal(result.id, 'profile-example');
  result.slug = 'changed';
  assert.equal(profiles[0].slug, 'example');
});

test('public descriptor exposes only bounded identification and no tenant or authority', () => {
  const descriptor = resolvePublicProfileDescriptor(profiles, 'example');
  assert.deepEqual(descriptor, {
    schemaVersion: 1,
    profile: { id: 'profile-example', slug: 'example', revision: 'r1', digest }
  });
  const serialized = JSON.stringify(descriptor);
  for (const forbidden of ['tenant', 'permission', 'credential', 'secret', 'token', 'owner']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
  assert.throws(() => resolvePublicProfileDescriptor(profiles, 'private-box'), /unavailable/);
  assert.throws(() => resolvePublicProfileDescriptor(profiles, 'missing'), /unavailable/);
});

test('unknown, disabled, cross-tenant, and malformed lookups fail identically', () => {
  const attempts = [
    { tenantId: 'tenant-one', slug: 'missing' },
    { tenantId: 'tenant-two', slug: 'private-box' },
    { tenantId: 'tenant-two', slug: 'example' },
    { tenantId: 'tenant-one', slug: 'ｅｘａｍｐｌｅ' }
  ];
  for (const request of attempts) {
    assert.throws(() => resolveTenantProfile(profiles, request), error => error.message === 'Profile unavailable');
  }
});

test('directory rejects duplicate slugs, ids, unknown fields, and invalid digests', () => {
  assert.throws(() => validateProfileDirectory([...profiles, { ...profiles[0], id: 'second' }]), /globally unique/i);
  assert.throws(() => validateProfileDirectory([...profiles, { ...profiles[0], slug: 'second' }]), /ids must be unique/i);
  assert.throws(() => validateProfileDirectory([{ ...profiles[0], ownerEmail: 'private@example.com' }]), /unrecognized/i);
  assert.throws(() => validateProfileDirectory([{ ...profiles[0], digest: 'weak' }]), /invalid string/i);
});
