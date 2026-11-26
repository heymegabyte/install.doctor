#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSecretsValidated, inventorySecretNames, secretDirectoriesForHost, selectHostSecrets, validateManifest,
} from './infisical-estate-reconcile.mjs';

const root = mkdtempSync(join(tmpdir(), 'infisical-estate-reconcile-'));
writeFileSync(join(root, 'CLOUDFLARE_API_TOKEN'), 'ciphertext fixture');
writeFileSync(join(root, 'SUDO_PASSWORD'), 'excluded fixture');

const manifest = validateManifest({
  schemaVersion: 1,
  hosts: {
    'macos.megabyte.space': {
      profile: 'developer',
      projectId: 'b9f92958-bd90-4e0a-a464-c51db5fa6d52',
      secretPath: '/',
    },
  },
  profiles: { developer: ['cloudflare'] },
  capabilityPatterns: { cloudflare: ['^CLOUDFLARE_'] },
  alwaysExcludePatterns: ['PASSWORD$'],
});
const inventory = inventorySecretNames([root]);
assert.deepEqual([...inventory.keys()], ['CLOUDFLARE_API_TOKEN', 'SUDO_PASSWORD']);
assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', inventory.keys()), ['CLOUDFLARE_API_TOKEN']);
const defaultDirectories = ['/general', '/workstation'];
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: defaultDirectories, secretDirectoriesOverridden: false,
}, 'macos.megabyte.space'), defaultDirectories);
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: defaultDirectories, secretDirectoriesOverridden: false,
}, 'ubuntu.megabyte.space'), ['/general']);
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: ['/explicit'], secretDirectoriesOverridden: true,
}, 'ubuntu.megabyte.space'), ['/explicit']);
assert.doesNotThrow(() => assertSecretsValidated({
  schemaVersion: 1, records: { CLOUDFLARE_API_TOKEN: { status: 'valid' } },
}, ['CLOUDFLARE_API_TOKEN']));
assert.throws(() => assertSecretsValidated({
  schemaVersion: 1, records: { CLOUDFLARE_API_TOKEN: { status: 'invalid-retired' } },
}, ['CLOUDFLARE_API_TOKEN']), /no current valid credential evidence/);
assert.throws(() => validateManifest({
  ...manifest,
  hosts: { 'macos.megabyte.space': { profile: 'developer', secretPath: '/' } },
}), /invalid host configuration/);
console.log('infisical-estate-reconcile unit tests: PASS');
