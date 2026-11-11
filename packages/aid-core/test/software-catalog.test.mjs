import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacySoftwareCatalogEntrySchema, SoftwareCatalogEntrySchema,
  buildSoftwareCatalogPlan, migrateLegacySoftwareCatalogEntry, parseSoftwareCatalog } from '../dist/software-catalog.js';

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

const entry = (name, overrides = {}) => {
  const { legacy: legacyOverrides = {}, ...currentOverrides } = overrides;
  const migrated = migrateLegacySoftwareCatalogEntry({ ...legacy, name, bin: name, providers: ['apt'], pkgs: { apt: name }, ...legacyOverrides });
  return { ...migrated, ...currentOverrides };
};

const load = (catalogEntry, policy) => ({
  ...catalogEntry,
  preload: policy !== 'lazy',
  deliveryMode: policy === 'lazy' ? 'lazy' : 'eager',
  loadPolicy: policy,
  loadRationale: `fixture:${policy}`,
  load: { delivery: policy === 'lazy' ? 'lazy' : 'eager', policy, rationale: `fixture:${policy}` },
});

test('catalog graph produces deterministic dependency order and explains every decision', () => {
  const runtime = entry('runtime');
  const bootstrap = load(entry('bootstrap', { legacy: { deps: ['runtime'] } }), 'eager-bootstrap');
  const post = load(entry('post'), 'eager-supported-path');
  const recovery = load(entry('recovery'), 'eager-security-recovery');
  const windows = entry('windows-only', { platforms: ['windows'] });
  const arm = entry('arm-only', { architectures: ['arm64'] });
  const server = entry('server-only', { roles: ['server'] });
  const alternative = entry('alternative', { conflicts: ['bootstrap'] });
  const catalog = [post, alternative, windows, bootstrap, runtime, arm, recovery, server];

  const first = buildSoftwareCatalogPlan(catalog, {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'bootstrap', requested: [],
  });
  const second = buildSoftwareCatalogPlan(structuredClone(catalog), {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'bootstrap', requested: [],
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.order, ['runtime', 'bootstrap', 'recovery']);
  assert.equal(first.inclusions.find(item => item.identity === 'runtime').reasons[0].code, 'dependency');
  assert.equal(first.exclusions.find(item => item.identity === 'post').reasons[0].code, 'deferred-until-post-bootstrap');
  assert.equal(first.exclusions.find(item => item.identity === 'windows-only').reasons[0].code, 'unsupported-platform');
  assert.equal(first.exclusions.find(item => item.identity === 'arm-only').reasons[0].code, 'unsupported-architecture');
  assert.equal(first.exclusions.find(item => item.identity === 'server-only').reasons[0].code, 'unsupported-role');
  assert.equal(first.exclusions.find(item => item.identity === 'alternative').reasons[0].code, 'conflicts-with-selected');
  assert.equal(first.inclusions.length + first.exclusions.length, catalog.length);
  assert.deepEqual(new Set([...first.inclusions, ...first.exclusions].map(item => item.identity)).size, catalog.length);

  assert.throws(() => buildSoftwareCatalogPlan(catalog, {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'post-bootstrap', requested: ['alternative'],
  }), /entries conflict/);
});

test('post-bootstrap graph admits matching eager entries and explicit lazy requests', () => {
  const requested = entry('requested');
  const eager = load(entry('eager'), 'eager-supported-path');
  const plan = buildSoftwareCatalogPlan([requested, eager], {
    platform: 'linux', architecture: 'x64', role: 'developer', phase: 'post-bootstrap', requested: ['requested'],
  });
  assert.deepEqual(plan.order, ['eager', 'requested']);
  assert.equal(plan.inclusions.find(item => item.identity === 'requested').reasons[0].code, 'requested');
  assert.equal(plan.inclusions.find(item => item.identity === 'eager').reasons[0].code, 'eager-supported-path');
});

test('catalog graph rejects unknown edges, cycles, conflicts, invalid load policy, and unsupported dependency paths', () => {
  const baseRequest = { platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'post-bootstrap', requested: [] };
  const unknown = entry('unknown', { legacy: { deps: ['missing'] } });
  assert.throws(() => buildSoftwareCatalogPlan([unknown], baseRequest), /unknown dependency missing/);

  const left = entry('left', { legacy: { deps: ['right'] } });
  const right = entry('right', { legacy: { deps: ['left'] } });
  assert.throws(() => buildSoftwareCatalogPlan([left, right], baseRequest), /dependency cycle/);

  const alpha = entry('alpha', { conflicts: ['beta'] });
  const beta = entry('beta');
  assert.throws(() => buildSoftwareCatalogPlan([alpha, beta], { ...baseRequest, requested: ['alpha', 'beta'] }), /entries conflict/);

  const invalidLoad = { ...entry('invalid-load'), preload: true };
  assert.throws(() => buildSoftwareCatalogPlan([invalidLoad], baseRequest), /inconsistent eager\/lazy/);

  const parent = entry('parent', { legacy: { deps: ['arm-dependency'] } });
  const dependency = entry('arm-dependency', { architectures: ['arm64'] });
  assert.throws(() => buildSoftwareCatalogPlan([parent, dependency], { ...baseRequest, requested: ['parent'] }), /not supported.*architecture x64/);
});

test('catalog graph rejects unsupported explicit selections across platform, architecture, and role', () => {
  const candidate = entry('candidate', { platforms: ['macos'], architectures: ['arm64'], roles: ['server'] });
  assert.throws(() => buildSoftwareCatalogPlan([candidate], {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'post-bootstrap', requested: ['candidate'],
  }), /platform linux, architecture x64, role workstation/);
});

test('multiple command aliases share one package graph identity and cannot disagree on graph semantics', () => {
  const primary = entry('archive');
  const alias = { ...primary, bin: 'unarchive', identity: { ...primary.identity, command: 'unarchive' } };
  const plan = buildSoftwareCatalogPlan([primary, alias], {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'post-bootstrap', requested: ['archive'],
  });
  assert.deepEqual(plan.order, ['archive']);
  assert.equal(plan.inclusions.length, 1);
  assert.throws(() => buildSoftwareCatalogPlan([primary, { ...alias, roles: ['server'] }], {
    platform: 'linux', architecture: 'x64', role: 'workstation', phase: 'post-bootstrap', requested: [],
  }), /aliases.*inconsistent graph semantics/);
});
