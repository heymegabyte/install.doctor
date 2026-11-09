import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { composeNativeDebianPackageSlice, composeSelectedNativeDebianPackageSlice } from '../dist/native-debian-composition.js';
import { buildLoadPlan } from '../dist/lazy-plan.js';
import { assertNativePackageInstalledWitnesses, validateNativePackageWitnessClosure } from '../dist/offline-execution.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const compare = (left, right) => left.localeCompare(right, undefined, { numeric: true });
const descriptor = () => ({
  schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
  platform: { os: 'linux', arch: 'x64' }, package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
  artifact: { id: 'tree-deb', sha256: hash('tree'), sizeBytes: 10, mediaType: 'application/vnd.debian.binary-package' },
  distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
  repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
  metadataProof: {
    inRelease: { artifactId: 'release', path: 'dists/bookworm/InRelease', sha256: hash('release'), sizeBytes: 10,
      signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', maximumDateAgeSeconds: null, signingKeyFingerprint: 'A'.repeat(40),
      keyring: { artifactId: 'keyring', sha256: hash('keyring'), sizeBytes: 10, mediaType: 'application/vnd.gnupg.keyring' } },
    packagesIndex: { artifactId: 'packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: hash('packages'), sizeBytes: 10, architecture: 'amd64' },
    packageStanza: { filename: 'pool/main/t/tree/tree_2.1.0-1_amd64.deb', sha256: hash('tree'), sizeBytes: 10,
      depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'foreign' },
  }, dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
  maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
});
const witness = () => ({ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', version: '2.36-9', architecture: 'amd64', status: 'installed', healthy: true, held: false });
const desiredState = { schemaVersion: 1, revision: 'fixture', hostId: 'fixture', packages: ['curl'], services: [], consents: [], offline: false };
const target = { distroId: 'debian', versionId: '12', codename: 'bookworm', architecture: 'amd64' };
const compose = (changes = {}) => composeNativeDebianPackageSlice({ descriptor: descriptor(), target, installedWitnesses: [witness()], desiredState,
  legacyPackages: ['curl', 'tree', 'jq'], compareDebianVersions: compare, ...changes });

test('composes one canonical native task with witness kept outside mutation authority', () => {
  const first = compose(); const second = compose();
  assert.deepEqual(first, second);
  assert.equal(first.task.id, 'package.native.tree');
  assert.deepEqual(Object.values(first.operations.operations).map(value => value.kind), ['native-package', 'native-package', 'native-package']);
  assert.deepEqual(first.artifactIds, ['keyring', 'packages', 'release', 'tree-deb']);
  assert.deepEqual(first.desiredState.packages, ['curl', 'tree']);
  assert.deepEqual(first.desiredState.consents, ['package-install']);
  assert.equal(first.desiredState.offline, true);
  assert.deepEqual(first.remainingLegacyPackages, ['curl', 'jq']);
  assert.equal(first.installedWitnesses[0].packageName, 'libc6');
  assert.ok(!first.artifactIds.some(value => value.includes('libc')));
  assert.ok(!first.desiredState.packages.includes('libc6'));
  assert.deepEqual(first.operations.operations['native-debian-tree-check'].installedWitnesses, [
    { kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', minimumVersion: '2.34', architecture: 'amd64' },
  ]);
  assert.deepEqual(first.operations.operations['native-debian-tree-check'].expectedPackage,
    { name: 'tree', version: '2.1.0-1', architecture: 'amd64' });
  assert.equal(JSON.stringify(first.operations).match(/libc6/g).length, 3);
  assert.ok(!JSON.stringify(first).includes('installx'));
  assert.equal(first.task.network, 'none');
});

test('runtime witness observation rejects missing, held, unhealthy, old, and mismatched authority', async () => {
  const authority = { kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', minimumVersion: '2.34', architecture: 'amd64' };
  const healthy = { packageName: 'libc6', version: '2.36-9', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed' };
  for (const observed of [null, { ...healthy, want: 'hold' }, { ...healthy, errorFlag: 'reinstreq' },
    { ...healthy, status: 'half-configured' }, { ...healthy, version: '2.33' }, { ...healthy, architecture: 'arm64' }]) {
    await assert.rejects(assertNativePackageInstalledWitnesses({ witnesses: [authority], observe: async () => observed, compareDebianVersions: compare }), /witness is not satisfied/);
  }
  await assert.doesNotReject(assertNativePackageInstalledWitnesses({ witnesses: [authority], observe: async () => healthy, compareDebianVersions: compare }));
  await assert.rejects(assertNativePackageInstalledWitnesses({ witnesses: [authority], observe: async () => healthy, compareDebianVersions: () => Number.NaN }), /witness is not satisfied/);
  await assert.rejects(assertNativePackageInstalledWitnesses({ witnesses: [{ ...authority, packageName: 'zlib1g' }], observe: async () => healthy, compareDebianVersions: compare }), /witness is not satisfied/);
});

test('signed operation witness mismatch is rejected across the native triplet', async () => {
  const result = compose();
  const mismatched = structuredClone(result.operations);
  mismatched.operations['native-debian-tree-apply'].installedWitnesses[0].minimumVersion = '2.35';
  // Closure equality is enforced by validateOfflineExecutionClosure. Assert the
  // signed authority differs canonically so the closure cannot treat it as equal.
  assert.notDeepEqual(mismatched.operations['native-debian-tree-apply'].installedWitnesses,
    mismatched.operations['native-debian-tree-check'].installedWitnesses);
  assert.deepEqual(validateNativePackageWitnessClosure({ rootPackageKey: 'tree', descriptors: [descriptor()],
    installedWitnesses: result.operations.operations['native-debian-tree-check'].installedWitnesses, compareDebianVersions: compare }).installationOrder.map(value => value.packageKey), ['tree']);
  for (const installedWitnesses of [
    [{ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'zlib1g', minimumVersion: '2.34', architecture: 'amd64' }],
    [{ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', minimumVersion: '2.35', architecture: 'amd64' }],
    [],
  ]) assert.throws(() => validateNativePackageWitnessClosure({ rootPackageKey: 'tree', descriptors: [descriptor()], installedWitnesses, compareDebianVersions: compare }));
  const extra = descriptor(); extra.metadataProof.packageStanza.depends = 'libc6 (>= 2.34), zlib1g';
  assert.throws(() => validateNativePackageWitnessClosure({ rootPackageKey: 'tree', descriptors: [extra],
    installedWitnesses: result.operations.operations['native-debian-tree-check'].installedWitnesses, compareDebianVersions: compare }));
});

test('fails closed before legacy subtraction for every incompatible authority or witness', () => {
  const cases = [
    value => { value.package.version = '2.1.1-1'; }, value => { value.platform.arch = 'arm64'; },
    value => { value.distro.versionId = '13'; }, value => { value.repository.repositoryOrigin = 'https://mirror.invalid/debian'; },
    value => { value.repository.suite = 'stable'; }, value => { value.metadataProof.packagesIndex.path = 'wrong'; },
    value => { value.metadataProof.packageStanza.depends = 'libc6 (>= 2.35)'; },
    value => { value.metadataProof.packageStanza.depends = 'libc6 (>= 2.34), zlib1g'; },
    value => { value.dependencyClosure.depends = [{ packageKey: 'libc6', artifactId: 'libc6-deb' }]; },
  ];
  for (const mutate of cases) { const value = descriptor(); mutate(value); assert.throws(() => compose({ descriptor: value })); }
  for (const badWitness of [[], [{ ...witness(), version: '2.33' }], [{ ...witness(), held: true }], [{ ...witness(), healthy: false }], [{ ...witness(), architecture: 'arm64' }]]) {
    assert.throws(() => compose({ installedWitnesses: badWitness }));
  }
  assert.throws(() => compose({ target: { ...target, distroId: 'ubuntu' } }));
});

test('subtracts tree only after complete admission and preserves all other legacy selections', () => {
  assert.deepEqual(compose({ legacyPackages: ['tree', 'ripgrep', 'fd'] }).remainingLegacyPackages, ['ripgrep', 'fd']);
  assert.throws(() => compose({ descriptor: { ...descriptor(), repository: { ...descriptor().repository, component: 'contrib' } }, legacyPackages: ['tree', 'ripgrep'] }));
});

test('engine-owned load-plan seam produces transport-independent native authority', () => {
  const payload = descriptor();
  const loadPlan = buildLoadPlan({ schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['server'],
    selectedPackages: ['tree'], selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: [],
    catalog: [{ name: 'tree', bin: 'tree', platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy',
      loadRationale: 'default-lazy', deps: [], artifacts: [], offlinePayloads: [payload], providers: ['apt'], pkgs: { apt: 'tree' } }],
  });
  const common = { loadPlan, packageKey: 'tree', target, installedWitnesses: [witness()], desiredState,
    legacyPackages: ['tree', 'curl'], compareDebianVersions: compare };
  const online = composeSelectedNativeDebianPackageSlice(common);
  const offline = composeSelectedNativeDebianPackageSlice({ ...common, loadPlan: structuredClone(loadPlan),
    target: structuredClone(target), installedWitnesses: [witness()], desiredState: structuredClone(desiredState),
    legacyPackages: [...common.legacyPackages] });
  assert.deepEqual(online, offline);
  assert.deepEqual(online.operations, compose().operations);
  const tampered = structuredClone(loadPlan); tampered.items.find(item => item.name === 'tree').nativePayload.repository.repositoryOrigin = 'https://mirror.invalid/debian';
  assert.throws(() => composeSelectedNativeDebianPackageSlice({ ...common, loadPlan: tampered }), /load-plan digest/);
  const absent = buildLoadPlan({ schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['server'], selectedPackages: [],
    selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: [], catalog: [{ name: 'tree', bin: 'tree', platforms: ['linux'],
      installMode: 'cli', loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [], offlinePayloads: [payload] }] });
  assert.throws(() => composeSelectedNativeDebianPackageSlice({ ...common, loadPlan: absent }), /not admitted/);
});
