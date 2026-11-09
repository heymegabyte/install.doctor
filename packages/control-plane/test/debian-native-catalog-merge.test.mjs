import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mergeDebianNativeCatalog, mergeDebianNativeCatalogFiles } from '../../../scripts/merge-debian-native-catalog.mjs';

const descriptor = Object.freeze({
  schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
  package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
  distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
});
const receipt = Object.freeze({ schemaVersion: 1, descriptor, artifacts: Object.freeze([
  { id: 'debian-bookworm-inrelease' },
  { id: 'debian-bookworm-archive-keyring' },
  { id: 'debian-bookworm-main-amd64-packages' },
  { id: 'tree-deb-bookworm-amd64' },
]) });

test('merges one descriptor into exactly one tree entry deterministically without reordering', () => {
  const base = [{ name: 'alpha', value: 1 }, { name: 'tree', providers: ['apt'] }, { name: 'zeta', value: 2 }];
  const first = mergeDebianNativeCatalog(base, receipt);
  const second = mergeDebianNativeCatalog(base, receipt);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(item => item.name), ['alpha', 'tree', 'zeta']);
  assert.deepEqual(first[1].offlinePayloads, [descriptor]);
  assert.equal(Object.hasOwn(base[1], 'offlinePayloads'), false);
});

test('writes canonical staged output and refuses input replacement', async t => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const basePath = join(root, 'catalog.json');
  const receiptPath = join(root, 'receipt.json');
  const outputPath = join(root, 'staged.json');
  await writeFile(basePath, `${JSON.stringify([{ name: 'tree' }])}\n`, { mode: 0o600 });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  await mergeDebianNativeCatalogFiles({ baseCatalogPath: basePath, receiptPath, outputPath });
  const output = await readFile(outputPath, 'utf8');
  assert.equal(output, `${JSON.stringify([{ name: 'tree', offlinePayloads: [descriptor] }])}\n`);
  await assert.rejects(mergeDebianNativeCatalogFiles({ baseCatalogPath: basePath, receiptPath, outputPath: basePath }), /must not replace/);
});

test('fails closed on duplicate authority, wrong artifacts, wrong package, and ambiguous catalog identities', () => {
  assert.throws(() => mergeDebianNativeCatalog([{ name: 'tree', offlinePayloads: [] }], receipt), /already contains/);
  assert.throws(() => mergeDebianNativeCatalog([{ name: 'tree' }], { ...receipt, artifacts: receipt.artifacts.slice(1) }), /identity is invalid/);
  assert.throws(() => mergeDebianNativeCatalog([{ name: 'tree' }], { ...receipt, descriptor: { ...descriptor, packageKey: 'other' } }), /outside/);
  assert.throws(() => mergeDebianNativeCatalog([{ name: 'tree' }, { name: 'tree' }], receipt), /ambiguous/);
});
