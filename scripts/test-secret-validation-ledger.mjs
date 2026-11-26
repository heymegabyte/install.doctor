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
];

for (const [name, record] of Object.entries(ledger.records)) {
  assert.ok(allowedStatuses.has(record.status), `${name} has an unsupported validation status`);
  assert.ok(record.validator, `${name} has no validator provenance`);
  if (record.status === 'invalid-retired' || record.sourceRetired) {
    for (const directory of sourceDirectories) {
      assert.equal(existsSync(join(directory, name)), false, `${name} still exists in ${directory}`);
    }
  }
  if (record.migrated) assert.ok(record.destination, `${name} has no migration destination`);
}

console.log('secret validation ledger tests: PASS');
