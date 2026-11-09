import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadPlan, composeSelectedFlatpakLaunchers, flatpakLauncherCandidate } from '../dist/index.js';

const catalog = [{
  name: 'fixture-app', bin: 'fixture-app', platforms: ['linux'], installMode: 'app',
  loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [], offlinePayloads: [],
  providers: ['flatpak'], pkgs: { flatpak: 'org.example.Fixture' }, deliveryMode: 'lazy',
  flatpakLauncher: { appId: 'org.example.Fixture', bin: 'fixture-app' },
}];

function loadPlan(overrides = {}) {
  return buildLoadPlan({
    schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['workstation'],
    selectedPackages: ['fixture-app'], selectedServices: [], selectedSupportedPaths: [],
    lazyResolverRequirements: [], catalog: structuredClone(catalog), ...overrides,
  });
}

test('Flatpak launcher composition binds selected package, exact command, task, and legacy partition', () => {
  const plan = loadPlan();
  const result = composeSelectedFlatpakLaunchers({
    loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/home/fixture',
    legacyPackages: ['fixture-app', 'other-tool'], flatpakExecutable: { path: '/usr/bin/flatpak', sha256: 'a'.repeat(64) },
  });
  assert.deepEqual(result.migratedLauncherPackages, ['fixture-app']);
  assert.deepEqual(result.remainingLegacyLauncherPackages, ['other-tool']);
  assert.equal(result.launcherRoot, '/home/fixture/.local/bin/flatpak');
  assert.deepEqual(result.directoryRequirements.map(item => item.targetPath), ['/home/fixture/.local/bin/flatpak']);
  assert.equal(result.launchers.length, 1);
  const launcher = result.launchers[0];
  assert.equal(launcher.task.id, 'installer.flatpak-launcher.fixture-app');
  assert.deepEqual(launcher.task.dependencies, ['desired.packages', 'installer.flatpak-launcher-directory']);
  assert.equal(launcher.task.compensation, 'configuration');
  assert.equal(launcher.operations.apply.appId, 'org.example.Fixture');
  assert.equal(launcher.operations.apply.flatpakPath, '/usr/bin/flatpak');
  assert.equal(launcher.operations.apply.flatpakSha256, 'a'.repeat(64));
  assert.equal(launcher.operations.apply.homeDirectory, '/home/fixture');
  assert.equal(launcher.operations.apply.targetPath, '/home/fixture/.local/bin/flatpak/fixture-app');
  assert.equal(flatpakLauncherCandidate('org.example.Fixture').toString('utf8'),
    '#!/usr/bin/env bash\nexec "/usr/bin/flatpak" run "org.example.Fixture" "$@"\n');
});

test('Flatpak launcher composition rejects digest, platform, unsafe identifiers, duplicates, and missing legacy authority', () => {
  const plan = loadPlan();
  const valid = { loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/home/fixture',
    legacyPackages: ['fixture-app'], flatpakExecutable: { path: '/usr/bin/flatpak', sha256: 'a'.repeat(64) } };
  assert.throws(() => composeSelectedFlatpakLaunchers({ ...valid, approvedLoadPlanDigest: '0'.repeat(64) }), /exact approved/);
  assert.throws(() => composeSelectedFlatpakLaunchers({ ...valid, legacyPackages: ['fixture-app', 'fixture-app'] }), /duplicates/);
  assert.throws(() => composeSelectedFlatpakLaunchers({ ...valid, legacyPackages: [] }), /legacy package authority/);
  const macos = loadPlan({ platform: 'macos', selectedPackages: [] });
  assert.throws(() => composeSelectedFlatpakLaunchers({ ...valid, loadPlan: macos, approvedLoadPlanDigest: macos.digest }), /Linux/);
  for (const [appId, bin] of [['org.example', 'fixture-app'], ['../org.example.App', 'fixture-app'], ['org.example.App', 'bad name']]) {
    const badCatalog = structuredClone(catalog);
    badCatalog[0].flatpakLauncher = { appId, bin };
    const badPlan = loadPlan({ catalog: badCatalog });
    assert.throws(() => composeSelectedFlatpakLaunchers({ ...valid, loadPlan: badPlan, approvedLoadPlanDigest: badPlan.digest }), /invalid/i);
  }
});

test('unselected Flatpak launcher remains entirely outside engine ownership', () => {
  const plan = loadPlan({ selectedPackages: [] });
  const result = composeSelectedFlatpakLaunchers({
    loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/home/fixture', legacyPackages: ['fixture-app'],
    flatpakExecutable: { path: '/usr/bin/flatpak', sha256: 'a'.repeat(64) },
  });
  assert.deepEqual(result.launchers, []);
  assert.deepEqual(result.migratedLauncherPackages, []);
  assert.deepEqual(result.remainingLegacyLauncherPackages, ['fixture-app']);
});
