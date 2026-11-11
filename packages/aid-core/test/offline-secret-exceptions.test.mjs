import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { eligibleOfflineSecretIds, validateOfflineSecretExceptionInventory } from '../dist/offline-secret-exceptions.js';

const inventoryUrl = new URL('../../../config/infisical/offline-secret-exceptions.json', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);
const load = async () => JSON.parse(await readFile(inventoryUrl, 'utf8'));

test('validates a value-free inventory whose store observations match repository material', async () => {
  const input = await load();
  assert.deepEqual(validateOfflineSecretExceptionInventory(input), input);
  for (const store of input.stores) {
    const names = (await readdir(new URL(store.path + '/', repositoryRoot), { withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => entry.name).sort();
    assert.equal(names.length, store.fileCount, `${store.path} file count drifted`);
    assert.equal(createHash('sha256').update(names.join('\n') + '\n').digest('hex'), store.filenameSetSha256, `${store.path} filename inventory drifted`);
  }
});

test('local eligibility is exactly the reviewed get-secret allowlist', async () => {
  const input = await load();
  const source = await readFile(new URL('../../../home/dot_local/bin/executable_get-secret', import.meta.url), 'utf8');
  const allowlist = source.match(/const offlineSecretNames = new Set\(\[([\s\S]*?)\]\)/)?.[1]
    .match(/'[^']+'/g)?.map(value => value.slice(1, -1)).sort();
  assert.deepEqual(allowlist, eligibleOfflineSecretIds(input));
  assert.ok(!allowlist.includes('INFISICAL_TOKEN'));
  assert.ok(!allowlist.includes('CLOUDFLARE_API_TOKEN'));
});

test('rejects undeclared purposes, online-only exceptions, secret values, and unknown fields', async () => {
  for (const mutate of [
    input => { input.exceptions[0].purpose = 'ordinary-online-operation'; },
    input => { input.exceptions[0].requiredWithoutNetwork = false; },
    input => { input.exceptions[0].value = 'not-allowed'; },
    input => { input.exceptions[0].authorizationToken = 'not-allowed'; },
  ]) {
    const input = await load(); mutate(input);
    assert.throws(() => validateOfflineSecretExceptionInventory(input));
  }
});

test('rejects hidden stores, mismatched secret names, duplicate exceptions, and permissive defaults', async () => {
  const hidden = await load(); hidden.exceptions[4].observedLocations[0] = 'home/.chezmoitemplates/hidden/RESTIC_PASSWORD';
  assert.throws(() => validateOfflineSecretExceptionInventory(hidden), /invalid|inventoried store/i);
  const mismatch = await load(); mismatch.exceptions[4].observedLocations[0] = 'home/.chezmoitemplates/secrets/OTHER_PASSWORD';
  assert.throws(() => validateOfflineSecretExceptionInventory(mismatch), /different secret name/i);
  const duplicate = await load(); duplicate.exceptions.push(structuredClone(duplicate.exceptions[0]));
  assert.throws(() => validateOfflineSecretExceptionInventory(duplicate), /unique/i);
  const permissive = await load(); permissive.stores[0].undeclaredDisposition = 'local-allowed';
  assert.throws(() => validateOfflineSecretExceptionInventory(permissive));
});
