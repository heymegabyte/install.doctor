#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ledger = JSON.parse(readFileSync(new URL('../config/infisical/secret-validation-ledger.json', import.meta.url), 'utf8'));
assert.equal(ledger.schemaVersion, 1);
const allowedStatuses = new Set(['valid', 'invalid-retired']);
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

for (const [name, record] of Object.entries(ledger.records)) {
  assert.ok(allowedStatuses.has(record.status), `${name} has an unsupported validation status`);
  assert.ok(record.validator, `${name} has no validator provenance`);
  if (record.status === 'invalid-retired' || record.sourceRetired) {
    if (name.includes(':')) {
      const [store, canonicalName] = name.split(':', 2);
      const directory = sourceDirectoriesByStore.get(store);
      assert.ok(directory, `${name} references an unknown source store`);
      assert.equal(record.sourceId, name, `${name} does not bind its exact source id`);
      assert.equal(record.canonicalName, canonicalName, `${name} does not bind its canonical name`);
      assert.equal(existsSync(join(directory, canonicalName)), false, `${name} still exists in its exact source store`);
    } else {
      for (const directory of sourceDirectories) {
        assert.equal(existsSync(join(directory, name)), false, `${name} still exists in ${directory}`);
      }
    }
  }
  if (record.migrated) assert.ok(record.destination, `${name} has no migration destination`);
}

console.log('secret validation ledger tests: PASS');
