import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { eligibleOfflineSecretIds, validateOfflineSecretExceptionInventory } from '../dist/offline-secret-exceptions.js';

const inventoryUrl = new URL('../../../config/infisical/offline-secret-exceptions.json', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);
/** @returns {Promise<unknown>} */
const load = async () => {
  /** @type {unknown} */
  const input = JSON.parse(await readFile(inventoryUrl, 'utf8'));
  return input;
};

void test('validates a value-free inventory whose store observations match repository material', async () => {
  const input = await load();
  const validated = validateOfflineSecretExceptionInventory(input);
  assert.deepEqual(validated, input);
  for (const store of validated.stores) {
    const names = (await readdir(new URL(store.path + '/', repositoryRoot), { withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => entry.name).sort();
    assert.equal(names.length, store.fileCount, `${store.path} file count drifted`);
    assert.equal(createHash('sha256').update(names.join('\n') + '\n').digest('hex'), store.filenameSetSha256, `${store.path} filename inventory drifted`);
  }
});

void test('local eligibility is exactly the reviewed get-secret allowlist', async () => {
  const input = await load();
  const source = await readFile(new URL('../../../home/dot_local/bin/executable_get-secret', import.meta.url), 'utf8');
  const allowlist = source.match(/const offlineSecretNames = new Set\(\[([\s\S]*?)\]\)/)?.[1]
    ?.match(/'[^']+'/g)?.map(value => value.slice(1, -1)).sort();
  assert.deepEqual(allowlist, eligibleOfflineSecretIds(input));
  assert.ok(allowlist);
  assert.ok(!allowlist.includes('INFISICAL_TOKEN'));
  assert.ok(!allowlist.includes('CLOUDFLARE_API_TOKEN'));
});

void test('rejects undeclared purposes, online-only exceptions, secret values, and unknown fields', async () => {
  const input = validateOfflineSecretExceptionInventory(await load());
  const [first, ...rest] = input.exceptions;
  assert.ok(first);
  for (const patch of [
    { purpose: 'ordinary-online-operation' },
    { requiredWithoutNetwork: false },
    { value: 'not-allowed' },
    { authorizationToken: 'not-allowed' },
  ]) {
    const invalid = { ...input, exceptions: [{ ...first, ...patch }, ...rest] };
    assert.throws(() => validateOfflineSecretExceptionInventory(invalid));
  }
});

void test('rejects hidden stores, mismatched secret names, duplicate exceptions, and permissive defaults', async () => {
  const input = validateOfflineSecretExceptionInventory(await load());
  const [first] = input.exceptions;
  const [store, ...remainingStores] = input.stores;
  assert.ok(first && store && input.exceptions[4]);
  const hidden = input.exceptions.map((entry, index) => index === 4
    ? { ...entry, observedLocations: ['home/.chezmoitemplates/hidden/RESTIC_PASSWORD'] } : entry);
  assert.throws(() => validateOfflineSecretExceptionInventory({ ...input, exceptions: hidden }), /invalid|inventoried store/i);
  const mismatch = input.exceptions.map((entry, index) => index === 4
    ? { ...entry, observedLocations: ['home/.chezmoitemplates/secrets/OTHER_PASSWORD'] } : entry);
  assert.throws(() => validateOfflineSecretExceptionInventory({ ...input, exceptions: mismatch }), /different secret name/i);
  assert.throws(() => validateOfflineSecretExceptionInventory({ ...input, exceptions: [...input.exceptions, first] }), /unique/i);
  const permissive = [{ ...store, undeclaredDisposition: 'local-allowed' }, ...remainingStores];
  assert.throws(() => validateOfflineSecretExceptionInventory({ ...input, stores: permissive }));
});
