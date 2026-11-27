import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHostSecrets, validateManifest } from './infisical-estate-reconcile.mjs';

const manifest = validateManifest({
  schemaVersion: 1,
  environment: 'prod',
  hosts: { 'macos.megabyte.space': { profile: 'developer', projectId: '11111111-1111-4111-8111-111111111111', secretPath: '/hosts/macos-megabyte-space' } },
  workloads: {},
  profiles: { developer: ['github', 'cloudflare'] },
  capabilityPatterns: { github: ['^GITHUB_'], cloudflare: ['^CLOUDFLARE_'] },
  alwaysExcludePatterns: ['PASSWORD$'],
});

test('selects relevant capabilities and excludes passwords', () => {
  assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', [
    'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_PASSWORD', 'STRIPE_SECRET_KEY',
  ]), ['CLOUDFLARE_API_TOKEN', 'GITHUB_TOKEN']);
});

test('rejects undeclared hosts', () => {
  assert.throws(() => selectHostSecrets(manifest, 'unknown.megabyte.space', []), /not declared/);
});
