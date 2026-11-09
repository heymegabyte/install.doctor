import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  NativeDebInspectionError,
  inspectNativeDebianPackage,
  parseDebianControlArchive,
} from '../dist/native-deb-inspection.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function tarEntry(name, body, { type = '0', linkName = '' } = {}) {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write(linkName, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function tar(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

const control = Buffer.from([
  'Package: example',
  'Version: 1.2.3-1',
  'Architecture: amd64',
  'Depends: libc6 (>= 2.36), zlib1g',
  'Pre-Depends: init-system-helpers (>= 1.54~)',
  'Essential: no',
  'Multi-Arch: foreign',
  'Description: fixture',
  '',
].join('\n'));

const conffiles = Buffer.from('/etc/example.conf\n/etc/example.d/policy.conf\n');
const archive = tar([
  tarEntry('./', Buffer.alloc(0), { type: '5' }),
  tarEntry('./control', control),
  tarEntry('./conffiles', conffiles),
  tarEntry('./md5sums', Buffer.from('d41d8cd98f00b204e9800998ecf8427e  usr/bin/example\n')),
]);

const descriptor = {
  schemaVersion: 1,
  kind: 'native-offline-package',
  manager: 'dpkg',
  packageKey: 'example',
  platform: { os: 'linux', arch: 'x64' },
  package: { name: 'example', version: '1.2.3-1', architecture: 'amd64' },
  artifact: { id: 'example-deb', sha256: 'a'.repeat(64), sizeBytes: 1024, mediaType: 'application/vnd.debian.binary-package' },
  distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
  repository: { repositoryOrigin: 'https://deb.example.invalid/debian', suite: 'bookworm', component: 'main' },
  metadataProof: {
    inRelease: {
      artifactId: 'release', path: 'dists/bookworm/InRelease', sha256: 'b'.repeat(64), sizeBytes: 100,
      signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', maximumDateAgeSeconds: null,
      signingKeyFingerprint: 'A'.repeat(40),
      keyring: { artifactId: 'keyring', sha256: 'c'.repeat(64), sizeBytes: 100, mediaType: 'application/vnd.gnupg.keyring' },
    },
    packagesIndex: {
      artifactId: 'packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: 'd'.repeat(64),
      sizeBytes: 100, architecture: 'amd64',
    },
    packageStanza: {
      filename: 'pool/main/e/example/example_1.2.3-1_amd64.deb', sha256: 'a'.repeat(64), sizeBytes: 1024,
      depends: 'libc6 (>= 2.36), zlib1g', preDepends: 'init-system-helpers (>= 1.54~)', essential: 'no', multiArch: 'foreign',
    },
  },
  dependencyClosure: { depends: [], preDepends: [] },
  affectedServiceUnits: [],
  conffiles: ['/etc/example.conf', '/etc/example.d/policy.conf'],
  maintainerScriptPolicy: {
    trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local',
  },
};

function borrowedHandle() {
  return {
    fd: 41,
    async stat() { return { isFile: () => true, size: 1024, dev: 1, ino: 2, mtimeMs: 3 }; },
  };
}

test('admits an exact scripts-free control archive and reports every member digest', async () => {
  const calls = [];
  const result = await inspectNativeDebianPackage({
    descriptor,
    payloadHandle: borrowedHandle(),
    runner: {
      async extractControlArchive(input) {
        calls.push(input);
        return archive;
      },
    },
  });

  assert.deepEqual(calls, [{ payloadDescriptor: 41, timeoutMilliseconds: 30_000, maximumOutputBytes: 8_388_608 }]);
  assert.deepEqual(result.control, {
    packageName: 'example', version: '1.2.3-1', architecture: 'amd64',
    depends: 'libc6 (>= 2.36), zlib1g', preDepends: 'init-system-helpers (>= 1.54~)', essential: 'no', multiArch: 'foreign',
  });
  assert.deepEqual(result.conffiles, ['/etc/example.conf', '/etc/example.d/policy.conf']);
  assert.deepEqual(result.members.map(member => [member.name, member.sha256]), [
    ['conffiles', sha256(conffiles)],
    ['control', sha256(control)],
    ['md5sums', sha256(Buffer.from('d41d8cd98f00b204e9800998ecf8427e  usr/bin/example\n'))],
  ]);
});

test('rejects maintainer scripts, triggers, broad-effect files, and duplicate members', () => {
  for (const name of ['./preinst', './postinst', './prerm', './postrm', './config', './triggers', './templates', './shlibs']) {
    assert.throws(() => parseDebianControlArchive(tar([tarEntry('./control', control), tarEntry(name, Buffer.from('x'))])), /not admitted|maintainer|trigger/i);
  }
  assert.throws(
    () => parseDebianControlArchive(tar([tarEntry('./control', control), tarEntry('./control', control)])),
    /duplicate/i,
  );
});

test('rejects traversal, links, malformed checksums, trailing data, and unsafe archive shapes', () => {
  assert.throws(() => parseDebianControlArchive(tar([tarEntry('../control', control)])), /unsafe|canonical|traversal/i);
  assert.throws(() => parseDebianControlArchive(tar([tarEntry('./control', control, { type: '2', linkName: '/etc/passwd' })])), /regular file/i);
  const corrupt = Buffer.from(archive); corrupt[148] = 0x37;
  assert.throws(() => parseDebianControlArchive(corrupt), /checksum/i);
  assert.throws(() => parseDebianControlArchive(Buffer.concat([archive, Buffer.from('trailing')])), /trailing/i);
  assert.throws(() => parseDebianControlArchive(Buffer.alloc(1024)), /control/i);
});

test('rejects exact metadata and conffile mismatches', async () => {
  const runner = { async extractControlArchive() { return archive; } };
  await assert.rejects(inspectNativeDebianPackage({
    descriptor: { ...descriptor, package: { ...descriptor.package, version: '9.9.9' } }, payloadHandle: borrowedHandle(), runner,
  }), /Version.*authority|version.*authority/i);
  await assert.rejects(inspectNativeDebianPackage({
    descriptor: { ...descriptor, conffiles: ['/etc/other.conf'] }, payloadHandle: borrowedHandle(), runner,
  }), /conffiles.*authority/i);
  await assert.rejects(inspectNativeDebianPackage({
    descriptor: {
      ...descriptor,
      metadataProof: { ...descriptor.metadataProof, packageStanza: { ...descriptor.metadataProof.packageStanza, depends: 'other' } },
    },
    payloadHandle: borrowedHandle(), runner,
  }), /Depends.*authority/i);
});

test('rejects changed, non-regular, oversized, or invalid borrowed payload handles', async () => {
  const runner = { async extractControlArchive() { return archive; } };
  await assert.rejects(inspectNativeDebianPackage({
    descriptor, payloadHandle: { fd: -1, async stat() { return { isFile: () => true, size: 1024, dev: 1, ino: 2, mtimeMs: 3 }; } }, runner,
  }), /descriptor/i);
  await assert.rejects(inspectNativeDebianPackage({
    descriptor, payloadHandle: { fd: 41, async stat() { return { isFile: () => false, size: 1024, dev: 1, ino: 2, mtimeMs: 3 }; } }, runner,
  }), /regular/i);
  let call = 0;
  await assert.rejects(inspectNativeDebianPackage({
    descriptor,
    payloadHandle: { fd: 41, async stat() { call += 1; return { isFile: () => true, size: 1024, dev: 1, ino: call, mtimeMs: 3 }; } },
    runner,
  }), /changed/i);
});

test('validates process bounds before invoking an injected runner', async () => {
  let invoked = false;
  await assert.rejects(inspectNativeDebianPackage({
    descriptor, payloadHandle: borrowedHandle(), maximumOutputBytes: 0,
    runner: { async extractControlArchive() { invoked = true; return archive; } },
  }), NativeDebInspectionError);
  assert.equal(invoked, false);
});
