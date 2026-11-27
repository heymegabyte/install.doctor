#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ledgerText = readFileSync(new URL('../config/infisical/secret-validation-ledger.json', import.meta.url), 'utf8');
const recordKeys = [...ledgerText.matchAll(/^    "([^"]+)":/gm)].map((match) => match[1]);
assert.equal(new Set(recordKeys).size, recordKeys.length, 'validation ledger contains duplicate record keys');
const ledger = JSON.parse(ledgerText);
assert.equal(ledger.schemaVersion, 1);
const allowedStatuses = new Set(['valid', 'unverified', 'invalid-retired', 'public-retired']);
const sourceDirectories = [
  join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets'),
  join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets-workstation'),
  join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets-wordpress'),
];
const sourceDirectoriesByStore = new Map([
  ['general', sourceDirectories[0]],
  ['workstation', sourceDirectories[1]],
  ['wordpress', sourceDirectories[2]],
]);
const repositoryDirectoriesByStore = new Map([
  ['general', new URL('../home/.chezmoitemplates/secrets/', import.meta.url)],
  ['workstation', new URL('../home/.chezmoitemplates/secrets-workstation/', import.meta.url)],
  ['wordpress', new URL('../home/.chezmoitemplates/secrets-wordpress/', import.meta.url)],
]);

for (const [name, record] of Object.entries(ledger.records)) {
  assert.ok(allowedStatuses.has(record.status), `${name} has an unsupported validation status`);
  assert.ok(record.validator, `${name} has no validator provenance`);
  if (record.status === 'invalid-retired' || record.sourceRetired) {
    if (name.includes(':')) {
      const [store, canonicalName] = name.split(':', 2);
      const directory = sourceDirectoriesByStore.get(store);
      const repositoryDirectory = repositoryDirectoriesByStore.get(store);
      assert.ok(directory, `${name} references an unknown source store`);
      assert.ok(repositoryDirectory, `${name} references an unknown repository source store`);
      assert.equal(record.sourceId, name, `${name} does not bind its exact source id`);
      assert.equal(record.canonicalName, canonicalName, `${name} does not bind its canonical name`);
      assert.equal(existsSync(join(directory, canonicalName)), false, `${name} still exists in its exact source store`);
      assert.equal(existsSync(new URL(canonicalName, repositoryDirectory)), false, `${name} is retired locally but still tracked in the repository checkout`);
    } else {
      for (const directory of sourceDirectories) {
        assert.equal(existsSync(join(directory, name)), false, `${name} still exists in ${directory}`);
      }
    }
  }
  if (record.migrated) assert.ok(record.destination, `${name} has no migration destination`);
}

console.log('secret validation ledger tests: PASS');
