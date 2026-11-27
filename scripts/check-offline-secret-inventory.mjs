#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateOfflineSecretExceptionInventory } from '../packages/aid-core/dist/offline-secret-exceptions.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const inventoryPath = fileURLToPath(new URL('../config/infisical/offline-secret-exceptions.json', import.meta.url));
const [mode = '--check', ...extra] = process.argv.slice(2);
if (!['--check', '--write'].includes(mode) || extra.length) {
  throw new Error('Usage: check-offline-secret-inventory.mjs [--check|--write]');
}

const source = await readFile(inventoryPath, 'utf8');
/** @type {unknown} */
const input = JSON.parse(source);
const inventory = validateOfflineSecretExceptionInventory(input);
const staged = execFileSync('git', ['ls-files', '--stage', '-z', '--', 'home/.chezmoitemplates'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const stores = inventory.stores.map(store => {
  const names = staged.flatMap(entry => {
    const separator = entry.indexOf('\t');
    const path = entry.slice(separator + 1);
    if (!path.startsWith(store.path + '/')) return [];
    const name = path.slice(store.path.length + 1);
    if (name.includes('/')) return [];
    if (!/^100(?:644|755) [0-9a-f]+ 0$/.test(entry.slice(0, separator)) || /[\r\n]/.test(name)) {
      throw new Error(`Unsupported Git index entry in ${store.path}`);
    }
    return [name];
  }).sort();
  return {
    ...store,
    fileCount: names.length,
    filenameSetSha256: createHash('sha256').update(names.join('\n') + '\n').digest('hex'),
  };
});

const changed = stores.filter((store, index) => {
  const previous = inventory.stores[index];
  if (!previous) throw new Error('Unexpected inventory store index');
  return store.fileCount !== previous.fileCount || store.filenameSetSha256 !== previous.filenameSetSha256;
});
if (!changed.length) {
  console.log('Offline inventory matches tracked template filenames.');
} else if (mode === '--check') {
  console.error(`Offline filename inventory is stale for ${changed.map(store => store.path).join(', ')}. Run with --write after staging template changes.`);
  process.exitCode = 1;
} else {
  // Preserve the existing one-record-per-line inventory layout.
  /** @param {typeof stores} values */
  const rows = values => values.map(value => '    { ' + JSON.stringify(value).slice(1, -1).replace(/"\s*:/g, '": ').replace(/,(?=")/g, ', ') + ' }').join(',\n');
  const storeStart = source.indexOf('  "stores": [');
  const exceptionStart = source.indexOf('  "exceptions": [', storeStart);
  if (storeStart < 0 || exceptionStart < 0) throw new Error('Unexpected inventory formatting');
  const output = source.slice(0, storeStart) + '  "stores": [\n' + rows(stores) + '\n  ],\n' + source.slice(exceptionStart);
  /** @type {unknown} */
  const refreshed = JSON.parse(output);
  const verified = validateOfflineSecretExceptionInventory(refreshed);
  if (JSON.stringify(verified) !== JSON.stringify({ ...inventory, stores })) throw new Error('Inventory refresh changed fields outside the expected update');
  const temporary = inventoryPath + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, output, { flag: 'wx' });
  try {
    if (await readFile(inventoryPath, 'utf8') !== source) throw new Error('Inventory changed during refresh; retry from the current file');
    await rename(temporary, inventoryPath);
  } finally {
    await unlink(temporary).catch((/** @type {unknown} */ error) => {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    });
  }
  console.log(`Refreshed filename counts and digests for ${String(changed.length)} stores.`);
}
