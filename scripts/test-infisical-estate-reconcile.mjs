#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventorySecretNames, selectHostSecrets, validateManifest } from './infisical-estate-reconcile.mjs';

const root = mkdtempSync(join(tmpdir(), 'infisical-estate-reconcile-'));
writeFileSync(join(root, 'CLOUDFLARE_API_TOKEN'), 'ciphertext fixture');
writeFileSync(join(root, 'SUDO_PASSWORD'), 'excluded fixture');

const manifest = validateManifest({
  schemaVersion: 1,
  hosts: { 'macos.megabyte.space': { profile: 'developer', secretPath: '/hosts/macos-megabyte-space' } },
  profiles: { developer: ['cloudflare'] },
  capabilityPatterns: { cloudflare: ['^CLOUDFLARE_'] },
  alwaysExcludePatterns: ['PASSWORD$'],
});
const inventory = inventorySecretNames([root]);
assert.deepEqual([...inventory.keys()], ['CLOUDFLARE_API_TOKEN', 'SUDO_PASSWORD']);
assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', inventory.keys()), ['CLOUDFLARE_API_TOKEN']);
console.log('infisical-estate-reconcile unit tests: PASS');
