import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { identityKinds, validateIdentityAuthorityEstate, validateIdentityAuthorityManifest } from '../dist/identity-authority.js';

/** @param {(typeof identityKinds)[number]} kind @param {Record<string, unknown>} overrides */
function identity(kind, overrides = {}) {
  const consumerId = `${kind}-primary`;
  return {
    id: `${kind}-identity`, kind, identityId: `infisical-${kind}-primary`,
    consumer: { id: consumerId, runtime: `${kind}-runtime` }, authority: 'infisical',
    authentication: {
      mode: kind === 'ci' ? 'github-oidc' : kind === 'platform' ? 'platform-oidc' : 'workload-identity',
      issuer: kind === 'ci' ? 'https://token.actions.githubusercontent.com' : 'https://app.infisical.com',
      tokenTtlSeconds: 900, tokenMaxUses: 32,
    },
    authorization: {
      tenant: 'desktop-tools', project: 'fleet', environment: 'prod', path: `/workloads/${kind}/${consumerId}`,
      actions: kind === 'recovery' ? ['read-recovery-secret'] : ['read-secret'], secretNames: [`${kind.toUpperCase()}_TOKEN`], inheritedGrants: [],
    },
    delivery: { mode: 'service-credential', recursive: false, includeImports: false, durablePlaintextCache: false },
    ...overrides,
  };
}

const estate = () => ({ schemaVersion: 1, identities: identityKinds.map(kind => identity(kind)) });

/** @param {(entry: ReturnType<typeof identity>) => unknown} update */
function withFirstIdentity(update) {
  const input = estate();
  const [first, ...rest] = input.identities;
  assert.ok(first);
  return { ...input, identities: [update(first), ...rest] };
}

void test('accepts a complete value-free estate with every required identity class', () => {
  assert.deepEqual(validateIdentityAuthorityEstate(estate()), estate());
});

void test('validates the canonical repository identity estate', async () => {
  /** @type {unknown} */
  const input = JSON.parse(await readFile(new URL('../../../config/infisical/desktop-tools-identity-estate.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateIdentityAuthorityEstate(input), input);
});

void test('rejects shared identities and duplicate intended consumers', () => {
  const shared = estate();
  const [first, second] = shared.identities;
  assert.ok(first && second);
  second.identityId = first.identityId;
  assert.throws(() => validateIdentityAuthorityEstate(shared), /shared identities/i);
  const consumer = { schemaVersion: 1, identities: [identity('service'), identity('service', { id: 'service-secondary', identityId: 'infisical-service-secondary' })] };
  assert.throws(() => validateIdentityAuthorityManifest(consumer), /intended consumer/i);
});

void test('rejects caller-selected runtime scope overrides and non-leaf scope changes', () => {
  const runtimeOverride = withFirstIdentity(entry => ({ ...entry, runtimeScopeOverride: { environment: 'dev' } }));
  assert.throws(() => validateIdentityAuthorityEstate(runtimeOverride), /unrecognized/i);
  const changedPath = withFirstIdentity(entry => ({ ...entry, authorization: { ...entry.authorization, path: '/workloads/host/another-host' } }));
  assert.throws(() => validateIdentityAuthorityEstate(changedPath), /fixed consumer leaf/i);
});

void test('rejects recursive exports, imports, and durable plaintext caches', () => {
  for (const field of ['recursive', 'includeImports', 'durablePlaintextCache']) {
    const input = withFirstIdentity(entry => ({ ...entry, delivery: { ...entry.delivery, [field]: true } }));
    assert.throws(() => validateIdentityAuthorityEstate(input), new RegExp(field, 'i'));
  }
});

void test('rejects missing or hidden inherited grants', () => {
  const missing = withFirstIdentity(entry => {
    const authorization = { ...entry.authorization };
    Reflect.deleteProperty(authorization, 'inheritedGrants');
    return { ...entry, authorization };
  });
  assert.throws(() => validateIdentityAuthorityEstate(missing), /inheritedGrants/);
  const inherited = withFirstIdentity(entry => ({ ...entry, authorization: { ...entry.authorization, inheritedGrants: ['project-viewer'] } }));
  assert.throws(() => validateIdentityAuthorityEstate(inherited), /inheritedGrants/);
});

void test('requires every identity class and confines recovery access', () => {
  const incomplete = estate(); incomplete.identities.pop();
  assert.throws(() => validateIdentityAuthorityEstate(incomplete), /missing the recovery class/i);
  const excess = withFirstIdentity(entry => ({ ...entry, authorization: { ...entry.authorization, actions: ['read-secret', 'read-recovery-secret'] } }));
  assert.throws(() => validateIdentityAuthorityEstate(excess), /recovery secret access/i);
});
