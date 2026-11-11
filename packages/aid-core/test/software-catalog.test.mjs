import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacySoftwareCatalogEntrySchema, SoftwareCatalogEntrySchema,
  migrateLegacySoftwareCatalogEntry, parseSoftwareCatalog } from '../dist/software-catalog.js';

const legacy = { name: 'ripgrep', bin: 'rg', providers: ['brew', 'apt'], pkgs: { brew: 'ripgrep', apt: 'ripgrep' },
  platforms: ['macos', 'linux'], installMode: 'cli', preload: false, deliveryMode: 'lazy', loadPolicy: 'lazy',
  loadRationale: 'default-lazy', short: 'Fast recursive search.', github: 'https://github.com/BurntSushi/ripgrep' };

test('migrates legacy catalog entries byte-identically and preserves explicit unknown evidence', () => {
  const first = migrateLegacySoftwareCatalogEntry(legacy);
  const second = migrateLegacySoftwareCatalogEntry(structuredClone(legacy));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.identity, { key: 'ripgrep', command: 'rg' });
  assert.deepEqual(first.license, { status: 'unknown', spdx: null, evidence: null });
  assert.deepEqual(first.supportEvidence, { status: 'unverified', receiptDigests: [] });
  assert.equal(parseSoftwareCatalog([first])[0].schemaVersion, 1);
});

test('strict schemas reject unknown fields, versions, inconsistent dependencies, and provider identities', () => {
  assert.throws(() => LegacySoftwareCatalogEntrySchema.parse({ ...legacy, surprise: true }), /unrecognized/i);
  assert.throws(() => migrateLegacySoftwareCatalogEntry({ ...legacy, pkgs: { brew: 'ripgrep' } }), /same set/i);
  const current = migrateLegacySoftwareCatalogEntry({ ...legacy, deps: ['pcre2'] });
  assert.throws(() => SoftwareCatalogEntrySchema.parse({ ...current, schemaVersion: 2 }), /invalid/i);
  assert.throws(() => SoftwareCatalogEntrySchema.parse({ ...current, dependencies: [] }), /must match/i);
  assert.throws(() => SoftwareCatalogEntrySchema.parse({ ...current, hiddenInstaller: 'curl | sh' }), /unrecognized/i);
});

test('configuration, privilege, exposure, and immutable provenance are derived without broadening authority', () => {
  const service = migrateLegacySoftwareCatalogEntry({ ...legacy, name: 'daemon', bin: 'daemon', providers: [], pkgs: {},
    platforms: ['linux'], installMode: 'service', artifacts: [{ schemaVersion: 1, id: 'daemon', version: '1.0.0',
      platform: { os: 'linux', arch: 'x64' }, source: { url: 'https://github.com/acme/daemon/releases/download/v1.0.0/daemon',
        sha256: 'a'.repeat(64), sizeBytes: 4096 }, destination: { root: 'user-bin', filename: 'daemon', mode: '0700' } }],
    serviceDeclarations: [{ name: 'daemon.service', privilege: 'admin', manager: 'systemd' }] });
  assert.equal(service.provenance.kind, 'immutable-artifact');
  assert.equal(service.privilege.install, 'user');
  assert.equal(service.lifecycle.configure.support, 'unsupported');
  assert.equal(service.exposure.network, 'service-declared');
});
