import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadPlan } from '../dist/index.js';

const entry = (name, overrides = {}) => ({
  name, bin: name, platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy',
  loadRationale: 'default-lazy', deps: [], ...overrides,
});
const input = overrides => ({
  schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['workstation'], selectedPackages: [], selectedServices: [],
  selectedSupportedPaths: [], lazyResolverRequirements: ['resolver'],
  catalog: [
    entry('resolver', { loadPolicy: 'eager-bootstrap', loadRationale: 'lazy-resolver:not-found-hook' }),
    entry('security', { loadPolicy: 'eager-security-recovery', loadRationale: 'security-recovery:offline' }),
    entry('dependency'),
    entry('tool', { deps: ['dependency'] }),
    entry('worker', { installMode: 'service', loadPolicy: 'eager-service', loadRationale: 'desired-state:worker',
      serviceDeclarations: [{ name: 'worker.service', privilege: 'admin', packageProvider: 'apt' }] }),
    entry('path-tool', { loadPolicy: 'eager-supported-path', loadRationale: 'supported-path:developer' }),
    entry('mac-only', { platforms: ['macos'] }),
  ],
  ...overrides,
});
const nativeOfflinePayload = (overrides = {}) => ({
  schemaVersion: 1,
  kind: 'native-offline-package',
  manager: 'dpkg',
  packageKey: 'tool',
  platform: { os: 'linux', arch: 'x64' },
  package: { name: 'tool', version: '1.2.3-1', architecture: 'amd64' },
  artifact: { id: 'tool_1.2.3-1_amd64.deb', sha256: 'a'.repeat(64), sizeBytes: 1234, mediaType: 'application/vnd.debian.binary-package' },
  distro: { id: 'ubuntu', versionId: '24.04', codename: 'noble' },
  repository: { repositoryOrigin: 'https://archive.ubuntu.com/ubuntu', suite: 'noble', component: 'main' },
  metadataProof: {
    inRelease: {
      artifactId: 'ubuntu-noble-inrelease', path: 'dists/noble/InRelease', sha256: 'b'.repeat(64), sizeBytes: 12345,
      signedAt: '2026-11-01T00:00:00.000Z', validUntil: '2026-11-15T00:00:00.000Z', maximumDateAgeSeconds: null, signingKeyFingerprint: 'C'.repeat(40),
      keyring: { artifactId: 'postgresql-keyring', sha256: 'f'.repeat(64), sizeBytes: 4096, mediaType: 'application/vnd.gnupg.keyring' },
    },
    packagesIndex: {
      artifactId: 'ubuntu-noble-main-amd64-packages', path: 'dists/noble/main/binary-amd64/Packages.xz',
      sha256: 'c'.repeat(64), sizeBytes: 56789, architecture: 'amd64',
    },
    packageStanza: {
      filename: 'pool/main/t/tool/tool_1.2.3-1_amd64.deb', sha256: 'a'.repeat(64), sizeBytes: 1234,
      depends: null, preDepends: null, essential: 'no', multiArch: 'absent',
    },
  },
  dependencyClosure: { depends: [], preDepends: [] },
  affectedServiceUnits: [],
  conffiles: [],
  maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  ...overrides,
});

test('builds a deterministic selected closure and never starts an unselected service', () => {
  const first = buildLoadPlan(input({ selectedPackages: ['tool'] }));
  const second = buildLoadPlan(input({ selectedPackages: ['tool'], roles: ['workstation', 'workstation'] }));
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.installOrder, ['resolver', 'security', 'dependency', 'tool']);
  assert.deepEqual(first.startOrder, []);
  assert.equal(first.items.find(item => item.name === 'dependency').selectionReason, 'transactional-prerequisite');
  assert.equal(first.items.find(item => item.name === 'worker').selectionReason, 'unselected-service');
  assert.deepEqual(first.items.find(item => item.name === 'worker').actions, []);
  assert.equal(first.items.find(item => item.name === 'mac-only').selectionReason, 'unsupported-platform');
});

test('carries system-identity reconciliation authority without selecting the package', () => {
  const catalog = input({}).catalog.map(candidate => candidate.name === 'tool'
    ? { ...candidate, systemIdentityReconciliation: true } : candidate);
  const unselected = buildLoadPlan(input({ catalog }));
  assert.equal(unselected.items.find(item => item.name === 'tool').systemIdentityReconciliation, true);
  assert.equal(unselected.items.find(item => item.name === 'tool').selected, false);
  const selected = buildLoadPlan(input({ catalog, selectedPackages: ['tool'] }));
  assert.equal(selected.items.find(item => item.name === 'tool').systemIdentityReconciliation, true);
  assert.notEqual(selected.digest, buildLoadPlan(input({ selectedPackages: ['tool'] })).digest);
});

test('binds post-install privilege authority and rejects incomplete declarations', () => {
  const catalog = input({}).catalog.map(candidate => candidate.name === 'tool'
    ? { ...candidate, configured: true, postInstall: 'post-tool.sh', postInstallPrivilege: 'user' } : candidate);
  const report = buildLoadPlan(input({ selectedPackages: ['tool'], catalog }));
  assert.equal(report.items.find(item => item.name === 'tool').postInstallPrivilege, 'user');
  assert.notEqual(report.digest, buildLoadPlan(input({ selectedPackages: ['tool'] })).digest);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, postInstall: 'post-tool.sh' } : candidate),
  })), /postInstall.*postInstallPrivilege/);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, postInstallPrivilege: 'user' } : candidate),
  })), /postInstall.*postInstallPrivilege/);
});

test('selects a desired service and a supported-path exception explicitly', () => {
  const report = buildLoadPlan(input({ selectedServices: ['worker'], selectedSupportedPaths: ['developer'] }));
  assert.deepEqual(report.startOrder, ['worker']);
  assert.deepEqual(report.items.find(item => item.name === 'worker').actions, ['install', 'start']);
  assert.equal(report.items.find(item => item.name === 'path-tool').selectionReason, 'supported-path');
});

test('requires strict service declarations without treating them as manager execution authority', () => {
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'worker'
      ? { ...candidate, serviceDeclarations: undefined } : candidate),
  })), /serviceDeclarations/);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, serviceDeclarations: [{ name: 'tool.service', privilege: 'user' }] } : candidate),
  })), /serviceDeclarations/);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'worker'
      ? { ...candidate, serviceDeclarations: [{ name: 'worker.service', privilege: 'root' }] } : candidate),
  })), /privilege/);
});

test('service start order follows dependency topology rather than lexical order', () => {
  const report = buildLoadPlan(input({
    lazyResolverRequirements: [], selectedServices:['service-a','service-z'],
    catalog:[
      entry('service-a', {installMode:'service',loadPolicy:'eager-service',loadRationale:'desired-state:a',deps:['service-z'],serviceDeclarations:[{name:'service-a',privilege:'user'}]}),
      entry('service-z', {installMode:'service',loadPolicy:'eager-service',loadRationale:'desired-state:z',serviceDeclarations:[{name:'service-z',privilege:'user'}]}),
    ],
  }));
  assert.deepEqual(report.installOrder, ['service-z','service-a']);
  assert.deepEqual(report.startOrder, ['service-z','service-a']);
});

test('rejects stale dependencies, cycles, invalid services, unavailable closure, and lazy resolver gaps', () => {
  assert.throws(() => buildLoadPlan(input({ lazyResolverRequirements: [], catalog: [entry('bad', { deps: ['missing'] })] })), /unknown dependency/);
  assert.throws(() => buildLoadPlan(input({ lazyResolverRequirements: [], selectedPackages: ['a'], catalog: [entry('a', { deps: ['b'] }), entry('b', { deps: ['a'] })] })), /cycle/);
  assert.throws(() => buildLoadPlan(input({ selectedServices: ['tool'] })), /not declared as a service/);
  assert.throws(() => buildLoadPlan(input({ selectedPackages: ['mac-only'] })), /unavailable on linux/);
  assert.throws(() => buildLoadPlan(input({ catalog: [entry('resolver')] })), /lazy resolver prerequisite/);
  assert.throws(() => buildLoadPlan(input({ selectedSupportedPaths:['unknown-path'] })), /unknown selected supported path/);
  assert.throws(() => buildLoadPlan(input({
    selectedPackages:['tool'],
    catalog:[...input({}).catalog, entry('latent-a',{deps:['latent-b']}), entry('latent-b',{deps:['latent-a']})],
  })), /cycle/);
});

test('strictly rejects unknown fields and inconsistent duplicate catalog metadata', () => {
  assert.throws(() => buildLoadPlan({ ...input({}), surprise: true }));
  assert.throws(() => buildLoadPlan(input({
    catalog: [entry('resolver', { loadPolicy: 'eager-bootstrap', loadRationale: 'lazy-resolver:hook' }), entry('resolver', { platforms: ['macos'] })],
  })), /inconsistent duplicate metadata/);
});

test('validates strict signed native offline payload authority in catalog entries', () => {
  const payload = nativeOfflinePayload();
  assert.doesNotThrow(() => buildLoadPlan(input({
    selectedPackages: ['tool'],
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool' ? { ...candidate, offlinePayloads: [payload] } : candidate),
  })));
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, offlinePayloads: [{ ...payload, surprise: true }] } : candidate),
  })), /unrecognized|invalid/i);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, offlinePayloads: [{ ...payload, packageKey: 'other' }] } : candidate),
  })), /payload.*identifier|package key/i);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, platforms: ['macos'], offlinePayloads: [payload] } : candidate),
  })), /payload platform/i);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, offlinePayloads: [payload, payload] } : candidate),
  })), /duplicate offline payload authority/i);
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? {
          ...candidate,
          offlinePayloads: [{
            ...payload,
            dependencyClosure: { depends: [{ packageKey: 'dependency', artifactId: 'missing-dependency-payload' }], preDepends: [] },
          }],
        } : candidate),
  })), /dependency does not resolve/i);
  const dependencyPayload = nativeOfflinePayload({
    packageKey: 'dependency',
    artifact: { ...payload.artifact, id: 'dependency-amd64', sha256: 'd'.repeat(64) },
    metadataProof: {
      ...payload.metadataProof,
      packageStanza: { ...payload.metadataProof.packageStanza, sha256: 'd'.repeat(64) },
    },
  });
  assert.throws(() => buildLoadPlan(input({
    catalog: input({}).catalog.map(candidate => {
      if (candidate.name === 'tool') return { ...candidate, offlinePayloads: [payload] };
      if (candidate.name === 'dependency') return { ...candidate, offlinePayloads: [dependencyPayload] };
      return candidate;
    }),
  })), /duplicate offline payload authority across catalog entries/i);
});

test('preserves exact native payload authority only for an explicitly selected lazy package', () => {
  const payload = nativeOfflinePayload();
  const catalog = input({}).catalog.map(candidate => candidate.name === 'tool'
    ? { ...candidate, offlinePayloads: [payload] } : candidate);
  const unselected = buildLoadPlan(input({ catalog }));
  const unselectedTool = unselected.items.find(item => item.name === 'tool');
  assert.equal(unselectedTool.selected, false);
  assert.equal(unselectedTool.selectionReason, 'unselected-lazy');
  assert.equal(unselectedTool.nativePayload, null, 'an unselected lazy package must not acquire payload materialization authority');
  assert.equal(unselected.installOrder.includes('tool'), false);

  const selected = buildLoadPlan(input({ selectedPackages: ['tool'], catalog }));
  const selectedTool = selected.items.find(item => item.name === 'tool');
  assert.equal(selectedTool.selected, true);
  assert.deepEqual(selectedTool.nativePayload, payload);
  assert.notEqual(selected.digest, unselected.digest);

  const substitutedPayload = nativeOfflinePayload({
    artifact: { ...payload.artifact, sha256: '9'.repeat(64) },
    metadataProof: {
      ...payload.metadataProof,
      packageStanza: { ...payload.metadataProof.packageStanza, sha256: '9'.repeat(64) },
    },
  });
  const substituted = buildLoadPlan(input({
    selectedPackages: ['tool'],
    catalog: input({}).catalog.map(candidate => candidate.name === 'tool'
      ? { ...candidate, offlinePayloads: [substitutedPayload] } : candidate),
  }));
  assert.notEqual(substituted.digest, selected.digest, 'native payload substitution must change the approved plan digest');

  assert.throws(
    () => buildLoadPlan(input({ selectedPackages: ['tool'], architecture: 'arm64', catalog })),
    /tool is unavailable on linux\/arm64/,
    'an explicitly selected package without signed native authority must fail closed',
  );
  const wrongArchitecture = buildLoadPlan(input({ architecture: 'arm64', catalog }));
  const wrongArchitectureTool = wrongArchitecture.items.find(item => item.name === 'tool');
  assert.equal(wrongArchitectureTool.applicable, false);
  assert.equal(wrongArchitectureTool.nativePayload, null);
  assert.equal(wrongArchitecture.installOrder.includes('tool'), false);
});

test('binds the exact immutable artifact for the selected OS and architecture into the plan digest', () => {
  const artifact = {
    schemaVersion: 1, id: 'artifact-tool', version: '1.2.3', platform: { os: 'linux', arch: 'x64' },
    source: {
      url: 'https://github.com/example/artifact-tool/releases/download/v1.2.3/artifact-tool',
      sha256: 'a'.repeat(64), sizeBytes: 123,
    },
    destination: { root: 'user-bin', filename: 'artifact-tool', mode: '0700' },
  };
  const catalog = [...input({}).catalog, entry('artifact-tool', { artifacts: [artifact] })];
  const report = buildLoadPlan(input({ selectedPackages: ['artifact-tool'], catalog }));
  assert.deepEqual(report.items.find(item => item.name === 'artifact-tool').artifact, artifact);
  const changed = buildLoadPlan(input({
    selectedPackages: ['artifact-tool'],
    catalog: [...input({}).catalog, entry('artifact-tool', { artifacts: [{ ...artifact, source: { ...artifact.source, sha256: 'b'.repeat(64) } }] })],
  }));
  assert.notEqual(changed.digest, report.digest);
});

test('rejects missing, duplicate, mismatched, and ambiguous artifact platform authority', () => {
  const artifact = {
    schemaVersion: 1, id: 'artifact-tool', version: '1.2.3', platform: { os: 'linux', arch: 'arm64' },
    source: {
      url: 'https://github.com/example/artifact-tool/releases/download/v1.2.3/artifact-tool',
      sha256: 'a'.repeat(64), sizeBytes: 123,
    },
    destination: { root: 'user-bin', filename: 'artifact-tool', mode: '0700' },
  };
  assert.throws(() => buildLoadPlan(input({
    selectedPackages: ['artifact-tool'], catalog: [...input({}).catalog, entry('artifact-tool', { artifacts: [artifact] })],
  })), /unavailable on linux\/x64/);
  assert.throws(() => buildLoadPlan(input({
    catalog: [...input({}).catalog, entry('artifact-tool', { artifacts: [artifact, artifact] })],
  })), /duplicate artifact platform/);
  assert.throws(() => buildLoadPlan(input({
    catalog: [...input({}).catalog, entry('artifact-tool', { artifacts: [{ ...artifact, id: 'other' }] })],
  })), /artifact identifier/);
  assert.throws(() => buildLoadPlan(input({
    catalog: [...input({}).catalog, entry('artifact-tool', { platforms: ['macos'], artifacts: [artifact] })],
  })), /artifact platform/);
});

test('rejects selected immutable artifacts that collide at one destination', () => {
  const artifact = (id, digest) => ({
    schemaVersion: 1, id, version: '1.2.3', platform: { os: 'linux', arch: 'x64' },
    source: {
      url: `https://github.com/example/${id}/releases/download/v1.2.3/${id}`,
      sha256: digest.repeat(64), sizeBytes: 123,
    },
    destination: { root: 'user-bin', filename: 'shared-tool', mode: '0700' },
  });
  assert.throws(() => buildLoadPlan(input({
    selectedPackages: ['artifact-a', 'artifact-b'],
    catalog: [
      ...input({}).catalog,
      entry('artifact-a', { artifacts: [artifact('artifact-a', 'a')] }),
      entry('artifact-b', { artifacts: [artifact('artifact-b', 'b')] }),
    ],
  })), /immutable artifact destination collision.*artifact-a.*artifact-b/i);
});
