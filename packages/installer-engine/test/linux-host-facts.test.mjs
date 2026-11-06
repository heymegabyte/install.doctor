import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  collectLinuxOfflineHostFacts,
  deriveLinuxImmutableHostId,
  parseLinuxOsRelease,
} from '../dist/linux-host-facts.js';

const at = '2026-11-06T12:00:00.000Z';
const machineId = '0123456789abcdef0123456789abcdef';

function fixture(overrides = {}) {
  const files = new Map([
    ['/etc/machine-id', machineId],
    ['/etc/os-release', 'ID=ubuntu\nVERSION_ID="24.04"\nNAME="Ubuntu"\n'],
    ['/proc/sys/kernel/osrelease', '6.8.0-generic\n'],
    ['/proc/version', 'Linux version 6.8.0\n'],
    ['/proc/1/cgroup', '0::/init.scope\n'],
  ]);
  const paths = new Set(['/usr/bin/apt-get', '/usr/bin/systemctl', '/usr/sbin/zfs']);
  return {
    platform: 'linux',
    arch: 'x64',
    now: () => at,
    readFile: async (path, options) => {
      assert.ok(options.maxBytes > 0);
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files.get(path);
    },
    pathExists: async path => paths.has(path),
    ...overrides,
  };
}

test('derives the attestor-compatible non-reversible immutable Linux host ID', () => {
  assert.equal(
    deriveLinuxImmutableHostId(machineId),
    `linux-${createHash('sha256').update(machineId, 'utf8').digest('hex')}`,
  );
  for (const invalid of ['', '0'.repeat(32), 'ABCDEF0123456789ABCDEF0123456789', 'a'.repeat(33)]) {
    assert.throws(() => deriveLinuxImmutableHostId(invalid), /machine identity source is invalid/i);
  }
});

test('parses os-release as data without expansion and rejects ambiguous authority', () => {
  assert.deepEqual(parseLinuxOsRelease('ID="ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="$(id) $HOME"\n'), {
    ID: 'ubuntu', VERSION_ID: '24.04', PRETTY_NAME: '$(id) $HOME',
  });
  assert.throws(() => parseLinuxOsRelease('ID=ubuntu\nID=debian\nVERSION_ID=24.04\n'), /duplicate/i);
  assert.throws(() => parseLinuxOsRelease('ID=ubuntu;id\nVERSION_ID=24.04\n'), /invalid unquoted/i);
  assert.equal(parseLinuxOsRelease('ID=ubuntu\nVERSION_ID="$VERSION"\n').VERSION_ID, '$VERSION');
});

test('collects strict deterministic native facts from observable evidence only', async () => {
  const facts = await collectLinuxOfflineHostFacts(fixture());
  assert.deepEqual(facts, {
    schemaVersion: 1,
    hostId: deriveLinuxImmutableHostId(machineId),
    collectedAt: at,
    os: 'linux',
    osVersion: '24.04',
    arch: 'x64',
    environment: 'native',
    roles: ['ubuntu'],
    packageManagers: ['apt'],
    capabilities: ['filesystem.zfs', 'service-manager.systemd'],
  });
});

test('uses the canonical protected os-release fallback and sorts all arrays', async () => {
  const base = fixture({ arch: 'arm64' });
  const reads = [];
  const facts = await collectLinuxOfflineHostFacts({
    ...base,
    readFile: async (path, options) => {
      reads.push([path, options]);
      if (path === '/etc/os-release') throw Object.assign(new Error('symlink rejected'), { code: 'ELOOP' });
      if (path === '/usr/lib/os-release') return 'ID=fedora\nVERSION_ID=41\n';
      return base.readFile(path, options);
    },
    pathExists: async path => new Set([
      '/usr/bin/dnf', '/usr/bin/rpm-ostree', '/usr/bin/podman', '/usr/bin/systemctl',
    ]).has(path),
  });
  assert.equal(facts.arch, 'arm64');
  assert.deepEqual(facts.roles, ['fedora']);
  assert.deepEqual(facts.packageManagers, ['dnf', 'rpm-ostree']);
  assert.deepEqual(facts.capabilities, ['containers.podman', 'service-manager.systemd']);
  assert.deepEqual(reads.slice(0, 3).map(([path]) => path), [
    '/etc/machine-id', '/etc/os-release', '/usr/lib/os-release',
  ]);
  assert.ok(reads[0][1].requireProtected);
  assert.ok(reads[1][1].requireProtected);
  assert.ok(reads[2][1].requireProtected);
});

test('classifies each supported environment only from injected fixed-path probes', async () => {
  const cases = [
    ['wsl', new Map([['/proc/sys/kernel/osrelease', '6.1.0-microsoft-standard-WSL2\n']])],
    ['proxmox', new Map(), new Set(['/etc/pve'])],
    ['qubes', new Map(), new Set(['/etc/qubes-release'])],
    ['container', new Map([['/run/systemd/container', 'docker\n']])],
  ];
  for (const [environment, replacements, addedPaths = new Set()] of cases) {
    const base = fixture();
    const facts = await collectLinuxOfflineHostFacts({
      ...base,
      readFile: async (path, options) => replacements.has(path)
        ? replacements.get(path)
        : base.readFile(path, options),
      pathExists: async path => addedPaths.has(path) || base.pathExists(path),
    });
    assert.equal(facts.environment, environment);
    assert.ok(facts.roles.includes(environment));
  }
});

test('fails closed for unsupported platform, architecture, distro, missing version, and ambiguous environment', async () => {
  await assert.rejects(collectLinuxOfflineHostFacts(fixture({ platform: 'darwin' })), /requires Linux/i);
  await assert.rejects(collectLinuxOfflineHostFacts(fixture({ arch: 'riscv64' })), /unsupported Linux architecture/i);
  const base = fixture();
  await assert.rejects(collectLinuxOfflineHostFacts({
    ...base,
    readFile: async (path, options) => path === '/etc/os-release'
      ? 'ID=gentoo\nVERSION_ID=2.17\n'
      : base.readFile(path, options),
  }), /unsupported Linux distribution/i);
  await assert.rejects(collectLinuxOfflineHostFacts({
    ...base,
    readFile: async (path, options) => path === '/etc/os-release'
      ? 'ID=ubuntu\n'
      : base.readFile(path, options),
  }), /VERSION_ID/i);
  await assert.rejects(collectLinuxOfflineHostFacts({
    ...base,
    pathExists: async path => path === '/etc/pve' || path === '/etc/qubes-release' || base.pathExists(path),
  }), /ambiguous Linux environment/i);
});

test('default collector rejects non-Linux invocation before reading host authority', async () => {
  let reads = 0;
  await assert.rejects(collectLinuxOfflineHostFacts(fixture({
    platform: 'win32',
    readFile: async () => { reads += 1; return machineId; },
  })), /requires Linux/i);
  assert.equal(reads, 0);
});
