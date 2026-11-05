import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInfisicalWorkloadManifest } from '../dist/infisical-workload.js';

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    workloads: [{
      id: 'backup-agent',
      identityId: 'machine-backup-agent',
      projectId: 'project-fleet-prod',
      environment: 'prod',
      secretPath: '/workloads/backup-agent',
      principal: { kind: 'service', authMode: 'workload-identity', provider: 'infisical' },
      delivery: 'environment',
      secrets: [
        { secretName: 'RESTIC_PASSWORD', environmentVariable: 'RESTIC_PASSWORD' },
        { secretName: 'S3_ACCESS_KEY', environmentVariable: 'AWS_ACCESS_KEY_ID' }
      ],
      ...overrides
    }]
  };
}

test('accepts one fixed production leaf scope and exact secret-to-env mappings', () => {
  assert.deepEqual(validateInfisicalWorkloadManifest(manifest()), manifest());
});

test('rejects unknown fields, wildcard and parent paths, and production overrides', () => {
  assert.throws(() => validateInfisicalWorkloadManifest({ ...manifest(), unexpected: true }), /unrecognized/i);
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({ secretPath: '/workloads/*' })), /leaf path/i);
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({ secretPath: '/workloads' })), /leaf path/i);
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({ environment: 'dev' })), /prod/i);
});

test('rejects duplicate workload identities and ambiguous mappings', () => {
  const input = manifest();
  input.workloads.push({ ...structuredClone(input.workloads[0]), id: 'second', secretPath: '/workloads/second' });
  assert.throws(() => validateInfisicalWorkloadManifest(input), /identity/i);
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({
    secrets: [
      { secretName: 'FIRST', environmentVariable: 'TOKEN' },
      { secretName: 'SECOND', environmentVariable: 'TOKEN' }
    ]
  })), /mapping/i);
});

test('enforces the identity plane for every principal kind', () => {
  const valid = [
    ['public-human', 'oidc', 'cloudflare-access'],
    ['ci', 'oidc', 'github'],
    ['ci', 'oidc', 'native'],
    ['service', 'workload-identity', 'infisical'],
    ['service', 'universal-auth', 'infisical'],
    ['local-offline-human', 'oidc', 'authentik'],
    ['product-customer', 'native', 'product-native']
  ];
  for (const [kind, authMode, provider] of valid) {
    assert.doesNotThrow(() => validateInfisicalWorkloadManifest(manifest({ principal: { kind, authMode, provider } })));
  }
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({
    principal: { kind: 'public-human', authMode: 'oidc', provider: 'authentik' }
  })), /identity plane/i);
  assert.throws(() => validateInfisicalWorkloadManifest(manifest({
    principal: { kind: 'service', authMode: 'oidc', provider: 'cloudflare-access' }
  })), /identity plane/i);
});
