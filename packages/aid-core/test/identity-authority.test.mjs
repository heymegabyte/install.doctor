import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { identityKinds, validateIdentityAuthorityEstate, validateIdentityAuthorityManifest } from '../dist/identity-authority.js';

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

test('accepts a complete value-free estate with every required identity class', () => {
  assert.deepEqual(validateIdentityAuthorityEstate(estate()), estate());
});

test('validates the canonical repository identity estate', async () => {
  const input = JSON.parse(await readFile(new URL('../../../config/infisical/desktop-tools-identity-estate.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateIdentityAuthorityEstate(input), input);
});

test('rejects shared identities and duplicate intended consumers', () => {
  const shared = estate(); shared.identities[1].identityId = shared.identities[0].identityId;
  assert.throws(() => validateIdentityAuthorityEstate(shared), /shared identities/i);
  const consumer = { schemaVersion: 1, identities: [identity('service'), identity('service', { id: 'service-secondary', identityId: 'infisical-service-secondary' })] };
  assert.throws(() => validateIdentityAuthorityManifest(consumer), /intended consumer/i);
});

test('rejects caller-selected runtime scope overrides and non-leaf scope changes', () => {
  const runtimeOverride = estate(); runtimeOverride.identities[0].runtimeScopeOverride = { environment: 'dev' };
  assert.throws(() => validateIdentityAuthorityEstate(runtimeOverride), /unrecognized/i);
  const changedPath = estate(); changedPath.identities[0].authorization.path = '/workloads/host/another-host';
  assert.throws(() => validateIdentityAuthorityEstate(changedPath), /fixed consumer leaf/i);
});

test('rejects recursive exports, imports, and durable plaintext caches', () => {
  for (const [field, value] of [['recursive', true], ['includeImports', true], ['durablePlaintextCache', true]]) {
    const input = estate(); input.identities[0].delivery[field] = value;
    assert.throws(() => validateIdentityAuthorityEstate(input), new RegExp(field, 'i'));
  }
});

test('rejects missing or hidden inherited grants', () => {
  const missing = estate(); delete missing.identities[0].authorization.inheritedGrants;
  assert.throws(() => validateIdentityAuthorityEstate(missing), /inheritedGrants/);
  const inherited = estate(); inherited.identities[0].authorization.inheritedGrants = ['project-viewer'];
  assert.throws(() => validateIdentityAuthorityEstate(inherited), /inheritedGrants/);
});

test('requires every identity class and confines recovery access', () => {
  const incomplete = estate(); incomplete.identities.pop();
  assert.throws(() => validateIdentityAuthorityEstate(incomplete), /missing the recovery class/i);
  const excess = estate(); excess.identities[0].authorization.actions = ['read-secret', 'read-recovery-secret'];
  assert.throws(() => validateIdentityAuthorityEstate(excess), /recovery secret access/i);
});
