import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadPlan, composeSelectedCaskLaunchers } from '../dist/index.js';

const catalog = [{
  name: 'fixture-app', bin: 'fixture-app', platforms: ['macos'], installMode: 'app',
  loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [], offlinePayloads: [],
  providers: ['cask'], pkgs: { cask: 'fixture-app' }, deliveryMode: 'lazy',
  caskLauncher: { appBundle: 'Fixture App.app', bin: 'fixture-app' },
}];

function loadPlan(overrides = {}) {
  return buildLoadPlan({
    schemaVersion: 1, platform: 'macos', architecture: 'arm64', roles: ['workstation'],
    selectedPackages: ['fixture-app'], selectedServices: [], selectedSupportedPaths: [],
    lazyResolverRequirements: [], catalog: structuredClone(catalog), ...overrides,
  });
}

test('cask launcher composition binds selected package, deterministic paths, task, and legacy partition', () => {
  const plan = loadPlan();
  const result = composeSelectedCaskLaunchers({
    loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/Users/fixture',
    legacyPackages: ['fixture-app', 'other-tool'],
  });
  assert.deepEqual(result.migratedLauncherPackages, ['fixture-app']);
  assert.deepEqual(result.remainingLegacyLauncherPackages, ['other-tool']);
  assert.equal(result.launcherRoot, '/Users/fixture/.local/bin/cask');
  assert.deepEqual(result.directoryRequirements.map(item => item.targetPath), ['/Users/fixture/.local/bin/cask']);
  assert.equal(result.launchers.length, 1);
  const launcher = result.launchers[0];
  assert.equal(launcher.task.id, 'installer.cask-launcher.fixture-app');
  assert.deepEqual(launcher.task.dependencies, ['desired.packages', 'installer.cask-launcher-directory']);
  assert.equal(launcher.task.compensation, 'configuration');
  assert.deepEqual(launcher.operations.apply.appPaths, [
    '/Users/fixture/Applications/Fixture App.app', '/Applications/Fixture App.app',
  ]);
  assert.equal(launcher.operations.apply.targetPath, '/Users/fixture/.local/bin/cask/fixture-app');
  assert.equal(launcher.operations.apply.candidateMode, 0o700);
  assert.equal(launcher.operations.check.action, 'check');
  assert.equal(launcher.operations.verify.action, 'verify');
});

test('cask launcher composition rejects digest, platform, unsafe names, duplicates, and missing legacy authority', () => {
  const plan = loadPlan();
  const valid = { loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/Users/fixture', legacyPackages: ['fixture-app'] };
  assert.throws(() => composeSelectedCaskLaunchers({ ...valid, approvedLoadPlanDigest: '0'.repeat(64) }), /exact approved/);
  assert.throws(() => composeSelectedCaskLaunchers({ ...valid, legacyPackages: ['fixture-app', 'fixture-app'] }), /duplicates/);
  assert.throws(() => composeSelectedCaskLaunchers({ ...valid, legacyPackages: [] }), /legacy package authority/);
  const linux = loadPlan({ platform: 'linux', selectedPackages: [] });
  assert.throws(() => composeSelectedCaskLaunchers({ ...valid, loadPlan: linux, approvedLoadPlanDigest: linux.digest }), /macOS/);

  for (const [appBundle, bin] of [['../Escape.app', 'fixture-app'], ['Bad/Path.app', 'fixture-app'], ['Good.app', 'bad name']]) {
    const badCatalog = structuredClone(catalog);
    badCatalog[0].caskLauncher = { appBundle, bin };
    const badPlan = loadPlan({ catalog: badCatalog });
    assert.throws(() => composeSelectedCaskLaunchers({ ...valid, loadPlan: badPlan, approvedLoadPlanDigest: badPlan.digest }), /invalid|basename/i);
  }
});

test('unselected cask launcher remains entirely outside engine ownership', () => {
  const plan = loadPlan({ selectedPackages: [] });
  const result = composeSelectedCaskLaunchers({
    loadPlan: plan, approvedLoadPlanDigest: plan.digest, homeDirectory: '/Users/fixture',
    legacyPackages: ['fixture-app'],
  });
  assert.deepEqual(result.launchers, []);
  assert.deepEqual(result.migratedLauncherPackages, []);
  assert.deepEqual(result.remainingLegacyLauncherPackages, ['fixture-app']);
});
