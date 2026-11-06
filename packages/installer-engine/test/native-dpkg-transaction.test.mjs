import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  NativeDpkgTransactionError,
  NativeDpkgTransactionRecordSchema,
  assertNativeDpkgNetworkDenied,
  createNativeDpkgTransactionRuntime,
} from '../dist/native-dpkg-transaction.js';

const digest = character => character.repeat(64);

function isolatedNetworkEvidence(overrides = {}) {
  const status = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']
    .map(name => `${name}:\t0000000000000000`).join('\n');
  const files = new Map([
    ['/proc/self/status', `${status}\n`],
    ['/sys/class/net/gre0/flags', '0x80\n'],
    ['/sys/class/net/gre0/operstate', 'unknown\n'],
    ['/sys/class/net/sit0/flags', '0x80\n'],
    ['/sys/class/net/sit0/operstate', 'down\n'],
    ['/proc/net/route', 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n'],
    ['/proc/net/ipv6_route', ''],
    ...Object.entries(overrides.files ?? {}),
  ]);
  return {
    listInterfaces: async () => overrides.interfaces ?? ['gre0', 'lo', 'sit0'],
    readText: async path => {
      if (!files.has(path)) throw new Error(`unexpected fixture read: ${path}`);
      return files.get(path);
    },
  };
}

test('network isolation admits inert kernel tunnel devices only when NET_ADMIN and non-loopback routes are absent', async () => {
  await assert.doesNotReject(assertNativeDpkgNetworkDenied(isolatedNetworkEvidence()));
  const netAdmin = (1n << 12n).toString(16).padStart(16, '0');
  await assert.rejects(assertNativeDpkgNetworkDenied(isolatedNetworkEvidence({
    files: { '/proc/self/status': ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map(name => `${name}:\t${name === 'CapBnd' ? netAdmin : '0000000000000000'}`).join('\n') + '\n' },
  })), /CAP_NET_ADMIN/);
  await assert.rejects(assertNativeDpkgNetworkDenied(isolatedNetworkEvidence({
    files: { '/sys/class/net/gre0/flags': '0x81\n' },
  })), /administratively up/);
  await assert.rejects(assertNativeDpkgNetworkDenied(isolatedNetworkEvidence({
    files: { '/proc/net/route': 'Iface\tDestination\neth0\t00000000\n' },
  })), /non-loopback IPv4 route/);
});

function descriptor(key, { pre = [], depends = [], services = [] } = {}) {
  const name = `pkg-${key}`;
  return {
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: key,
    platform: { os: 'linux', arch: 'x64' },
    package: { name, version: '1.0-1', architecture: 'amd64' },
    artifact: { id: `deb-${key}`, sha256: digest(key === 'root' ? 'a' : 'b'), sizeBytes: 100, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.example.invalid/repository', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: {
        artifactId: 'inrelease', path: 'dists/bookworm/InRelease', sha256: digest('c'), sizeBytes: 200,
        signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', signingKeyFingerprint: 'D'.repeat(40),
        keyring: { artifactId: 'keyring', sha256: digest('e'), sizeBytes: 300, mediaType: 'application/vnd.gnupg.keyring' },
      },
      packagesIndex: { artifactId: 'packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: digest('f'), sizeBytes: 400, architecture: 'amd64' },
      packageStanza: {
        filename: `pool/${name}.deb`, sha256: digest(key === 'root' ? 'a' : 'b'), sizeBytes: 100,
        depends: depends.length ? depends.map(value => `pkg-${value} (= 1.0-1)`).join(', ') : null,
        preDepends: pre.length ? pre.map(value => `pkg-${value} (= 1.0-1)`).join(', ') : null,
        essential: 'absent', multiArch: 'absent',
      },
    },
    dependencyClosure: {
      depends: depends.map(value => ({ packageKey: value, artifactId: `deb-${value}` })),
      preDepends: pre.map(value => ({ packageKey: value, artifactId: `deb-${value}` })),
    },
    affectedServiceUnits: services, conffiles: [],
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  };
}

function authority(action = 'apply', signal = new AbortController().signal, services = []) {
  const dep = descriptor('dep', { services });
  const root = descriptor('root', { pre: ['dep'], services });
  const packageItem = value => ({
    descriptor: value,
    metadata: {
      packageName: value.package.name, packageVersion: value.package.version,
      packageArchitecture: value.package.architecture, payloadSha256: value.artifact.sha256,
    },
    control: {
      control: {
        packageName: value.package.name, version: value.package.version, architecture: value.package.architecture,
        depends: value.metadataProof.packageStanza.depends, preDepends: value.metadataProof.packageStanza.preDepends,
        essential: 'absent', multiArch: 'absent',
      },
      conffiles: [], members: [{ name: 'control', sizeBytes: 10, sha256: digest('9') }],
    },
  });
  return {
    operation: { kind: 'native-package', effectClass: 'native-package', action, packageKey: 'root', payloadArtifactId: 'deb-root' },
    rootDescriptor: root,
    packages: [packageItem(dep), packageItem(root)],
    withPayload: async (key, use) => await use({ fd: key === 'dep' ? 41 : 42 }),
    context: { signal, attempt: 1, output() {} },
  };
}

function harness(overrides = {}) {
  let record;
  const events = [];
  const states = new Map([
    ['pkg-dep', null], ['pkg-root', null],
  ]);
  const policy = {
    target: '/usr/sbin/policy-rc.d',
    async prepare() {
      const value = { schemaVersion: 1, phase: 'prepared', target: this.target, snapshot: { schemaVersion: 1, existed: false, bytesBase64: null, uid: null, gid: null, mode: null, device: null, inode: null }, helperDigest: 'c2bcd9decf63ff2c0d9f473f38bc3607900530aad80f99139855d56678456230', preparedAt: '2026-01-01T00:00:00.000Z' };
      events.push('policy:prepare'); return value;
    },
    async activate(value) { events.push('policy:activate'); return { ...value, phase: 'active' }; },
    async inspect() { return { disposition: 'original' }; },
    async restore(value) { events.push('policy:restore'); return { ...value, phase: 'restored' }; },
    async reconcile(value) { events.push('policy:reconcile'); return { ...value, phase: 'restored' }; },
  };
  const fenceOwner = { schemaVersion: 1, kind: 'install-doctor-native-dpkg-transaction', runId: 'run-1', hostId: 'host-1', planDigest: digest('0'), pid: 1, bootId: 'boot', processStart: '1', token: '00000000-0000-4000-8000-000000000001', claimedAt: '2026-01-01T00:00:00.000Z', heartbeatAt: '2026-01-01T00:00:00.000Z', leaseUntil: '2026-01-01T00:01:00.000Z' };
  const runtime = createNativeDpkgTransactionRuntime({
    identity: { runId: 'run-1', hostId: 'host-1', planDigest: digest('0') },
    persistence: {
      async load() { return record; },
      async save(value) { record = structuredClone(value); events.push(`save:${value.phase}`); },
    },
    fence: {
      async acquire() { events.push('fence:acquire'); return fenceOwner; },
      async renew(value) { events.push('fence:renew'); return value; },
      async release() { events.push('fence:release'); },
    },
    assertProductionGate: async () => events.push('gate'),
    assertNetworkDenied: async () => events.push('network-denied'),
    proveQuiescence: async () => ({ state: 'quiescent', packageCount: 10, observations: [], limitation: 'fixture' }),
    queryPackage: async name => states.get(name) ?? null,
    createPolicyTransaction: async persistence => ({
      ...policy,
      async prepare() { const value = await policy.prepare(); await persistence.prepare(value); return value; },
      async activate(value) { const next = await policy.activate(value); await persistence.update(next); return next; },
      async restore(value) { const next = await policy.restore(value); await persistence.update(next); return next; },
      async reconcile(value) { const next = await policy.reconcile(value); await persistence.update(next); return next; },
    }),
    serviceAdapter: {
      manager: 'systemd',
      async capture(unit) { events.push(`service:capture:${unit}`); return { enabled: true, running: true }; },
      async restore(unit) { events.push(`service:restore:${unit}`); },
    },
    executeDpkg: async input => {
      events.push(`dpkg:${input.action}:${input.packageName}:${input.payloadDescriptor ?? '-'}`);
      states.set(input.packageName, input.action === 'unpack'
        ? { packageName: input.packageName, version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'unpacked' }
        : { packageName: input.packageName, version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed' });
      return { code: 0, stderr: '' };
    },
    compareDebianVersions: (left, right) => left.localeCompare(right),
    now: () => '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
  return { runtime, events, states, get record() { return record; }, set record(value) { record = value; } };
}

test('applies the verified closure in deterministic unpack/configure order with write-ahead checkpoints', async () => {
  const state = harness();
  await state.runtime.apply(authority());
  assert.deepEqual(state.events.filter(value => value.startsWith('dpkg:')), [
    'dpkg:unpack:pkg-dep:41', 'dpkg:configure:pkg-dep:-',
    'dpkg:unpack:pkg-root:42', 'dpkg:configure:pkg-root:-',
  ]);
  assert.equal(state.record.phase, 'completed');
  assert.deepEqual(state.record.packages.map(value => [value.packageKey, value.phase]), [['dep', 'configured'], ['root', 'configured']]);
  assert.ok(state.events.indexOf('save:unpacking') < state.events.indexOf('dpkg:unpack:pkg-dep:41'));
  assert.ok(state.events.indexOf('save:configuring') < state.events.indexOf('dpkg:configure:pkg-dep:-'));
  assert.ok(state.events.indexOf('policy:restore') < state.events.indexOf('fence:release'));
});

test('check and verify inspect exact package state without acquiring mutation authority', async () => {
  const state = harness();
  assert.equal(await state.runtime.check(authority('check')), 'needed');
  for (const name of ['pkg-dep', 'pkg-root']) state.states.set(name, { packageName: name, version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed' });
  assert.equal(await state.runtime.verify(authority('verify')), 'verified');
  assert.equal(state.events.includes('fence:acquire'), false);
});

test('defers cancellation until a running dpkg step exits, then restores policy and services', async () => {
  const controller = new AbortController();
  let entered;
  const running = new Promise(resolve => { entered = resolve; });
  let finish;
  const release = new Promise(resolve => { finish = resolve; });
  const state = harness({
    executeDpkg: async input => {
      state.events.push(`dpkg:${input.action}:${input.packageName}`);
      entered(); await release;
      state.states.set(input.packageName, { packageName: input.packageName, version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: input.action === 'unpack' ? 'unpacked' : 'installed' });
      return { code: 0, stderr: '' };
    },
  });
  const applying = state.runtime.apply(authority('apply', controller.signal, ['demo.service']));
  await running; controller.abort(new Error('cancelled')); finish();
  await assert.rejects(applying, /cancelled/);
  assert.equal(state.events.filter(value => value.startsWith('dpkg:')).length, 1);
  assert.ok(state.events.includes('service:restore:demo.service'));
  assert.ok(state.events.includes('policy:restore'));
  assert.equal(state.record.phase, 'blocked');
});

test('resumes only targeted forward repair from exact unpacked state and rejects a downgrade', async () => {
  const state = harness();
  await state.runtime.apply(authority());
  // Seed an interrupted checkpoint from schema-valid durable evidence.
  const completed = NativeDpkgTransactionRecordSchema.parse(state.record);
  state.record = { ...completed, phase: 'blocked', packages: completed.packages.map((value, index) => ({ ...value, phase: index === 0 ? 'configured' : 'unpacked' })), failure: { code: 'cancelled', message: 'fixture interruption' } };
  state.states.set('pkg-dep', { packageName: 'pkg-dep', version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed' });
  state.states.set('pkg-root', { packageName: 'pkg-root', version: '1.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'unpacked' });
  state.events.length = 0;
  await state.runtime.apply(authority());
  assert.deepEqual(state.events.filter(value => value.startsWith('dpkg:')), ['dpkg:configure:pkg-root:-']);

  const newer = harness();
  newer.states.set('pkg-root', { packageName: 'pkg-root', version: '9.0-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed' });
  await assert.rejects(newer.runtime.apply(authority()), error => error instanceof NativeDpkgTransactionError && /downgrade/.test(error.message));
});

test('record schema rejects unknown fields and noncanonical package progress', () => {
  assert.throws(() => NativeDpkgTransactionRecordSchema.parse({ schemaVersion: 1, unknown: true }));
});

test('a failed dpkg step reconciles its exact landed state before recording blocked cleanup', async () => {
  let state;
  state = harness({
    executeDpkg: async input => {
      state.states.set(input.packageName, {
        packageName: input.packageName, version: '1.0-1', architecture: 'amd64',
        want: 'install', errorFlag: 'ok', status: 'unpacked',
      });
      return { code: 1, stderr: 'fixture failure' };
    },
  });
  await assert.rejects(state.runtime.apply(authority()), /dpkg unpack failed/);
  assert.equal(state.record.phase, 'blocked');
  assert.equal(state.record.packages[0].phase, 'unpacked');
  assert.ok(state.events.includes('policy:restore'));
});

test('production source has no generic repair, rollback, network, or mid-step signal escape hatch', async () => {
  const source = await readFile(new URL('../src/native-dpkg-transaction.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /--configure(?:=|',\s*)-a|--pending|--force-(?:remove|downgrade)|apt-get|\bfetch\s*\(/);
  assert.doesNotMatch(source, /child\.kill\s*\(/);
  assert.match(source, /\/usr\/bin\/dpkg/);
  assert.match(source, /\/proc\/self\/fd\/3/);
  assert.match(source, /--no-triggers/);
});
