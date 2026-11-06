import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyDebianRepositoryMetadata } from '../dist/index.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const at = '2026-11-06T12:00:00.000Z';
const expires = '2026-11-07T12:00:00.000Z';
const releaseDate = 'Thu, 06 Nov 2026 12:00:00 +0000';
const releaseExpiry = 'Fri, 07 Nov 2026 12:00:00 +0000';
const payload = Buffer.from('fixture deb bytes\n');
const stanza = [
  'Package: fixture',
  'Version: 1.2.3-1',
  'Architecture: amd64',
  'Filename: pool/main/f/fixture/fixture_1.2.3-1_amd64.deb',
  `Size: ${payload.length}`,
  `SHA256: ${sha(payload)}`,
  'Depends: libc6 (>= 2.36)',
  'Essential: no',
  '',
].join('\n');
const packages = Buffer.from(stanza);
const release = Buffer.from([
  'Suite: stable',
  'Codename: stable',
  'Components: main',
  'Architectures: amd64 arm64',
  `Date: ${releaseDate}`,
  `Valid-Until: ${releaseExpiry}`,
  'SHA256:',
  ` ${sha(packages)} ${packages.length} main/binary-amd64/Packages`,
  '',
].join('\n'));
const inRelease = Buffer.from('opaque verified clearsigned bytes');
const keyring = Buffer.from('exact release-bound keyring bytes');
const fingerprint = 'A'.repeat(40);

function fixture() {
  return {
    descriptor: {
      schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'fixture',
      platform: { os: 'linux', arch: 'x64' },
      package: { name: 'fixture', version: '1.2.3-1', architecture: 'amd64' },
      artifact: { id: 'fixture-deb', sha256: sha(payload), sizeBytes: payload.length, mediaType: 'application/vnd.debian.binary-package' },
      distro: { id: 'debian', versionId: '13', codename: 'stable' },
      repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'stable', component: 'main' },
      metadataProof: {
        inRelease: { artifactId: 'inrelease', path: 'dists/stable/InRelease', sha256: sha(inRelease), sizeBytes: inRelease.length, signedAt: at, validUntil: expires, signingKeyFingerprint: fingerprint, keyring: { artifactId: 'keyring', sha256: sha(keyring), sizeBytes: keyring.length, mediaType: 'application/vnd.gnupg.keyring' } },
        packagesIndex: { artifactId: 'packages', path: 'dists/stable/main/binary-amd64/Packages', sha256: sha(packages), sizeBytes: packages.length, architecture: 'amd64' },
        packageStanza: { filename: 'pool/main/f/fixture/fixture_1.2.3-1_amd64.deb', sha256: sha(payload), sizeBytes: payload.length, depends: 'libc6 (>= 2.36)', preDepends: null, essential: 'no', multiArch: 'absent' },
      },
      dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
      maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
    },
    inReleaseBytes: inRelease, keyringBytes: keyring, packagesIndexBytes: packages, payloadBytes: payload,
    verifier: { verifyInRelease: async () => ({ cleartext: release, signingKeyFingerprint: fingerprint }), now: () => new Date('2026-11-06T13:00:00Z') },
  };
}

test('proves the exact InRelease to Packages stanza to Debian payload chain', async () => {
  const result = await verifyDebianRepositoryMetadata(fixture());
  assert.deepEqual(result, {
    packageName: 'fixture', packageVersion: '1.2.3-1', packageArchitecture: 'amd64',
    packageFilename: 'pool/main/f/fixture/fixture_1.2.3-1_amd64.deb', inReleaseFingerprint: fingerprint,
    inReleaseDate: at, inReleaseValidUntil: expires, packagesIndexSha256: sha(packages), payloadSha256: sha(payload),
  });
});

test('rejects every independently tampered trust-chain layer', async () => {
  const cases = [
    { mutate: value => { value.inReleaseBytes = Buffer.from('changed'); }, pattern: /InRelease (?:size|digest)/ },
    { mutate: value => { value.verifier.verifyInRelease = async () => ({ cleartext: release, signingKeyFingerprint: 'B'.repeat(40) }); }, pattern: /fingerprint/ },
    { mutate: value => { value.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(release.toString().replace(sha(packages), 'b'.repeat(64))), signingKeyFingerprint: fingerprint }); }, pattern: /differs from the checksum/ },
    { mutate: value => { value.packagesIndexBytes = Buffer.from(`${stanza}\nPackage: fixture\nVersion: 1.2.3-1\nArchitecture: amd64\nFilename: duplicate\nSize: ${payload.length}\nSHA256: ${sha(payload)}\nEssential: no\n`); value.descriptor.metadataProof.packagesIndex = { ...value.descriptor.metadataProof.packagesIndex, sha256: sha(value.packagesIndexBytes), sizeBytes: value.packagesIndexBytes.length }; value.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(release.toString().replace(`${sha(packages)} ${packages.length}`, `${sha(value.packagesIndexBytes)} ${value.packagesIndexBytes.length}`)), signingKeyFingerprint: fingerprint }); }, pattern: /exactly one matching/ },
    { mutate: value => { value.payloadBytes = Buffer.from('changed payload'); }, pattern: /payload (?:size|digest)/ },
  ];
  for (const { mutate, pattern } of cases) {
    const value = fixture(); mutate(value);
    await assert.rejects(verifyDebianRepositoryMetadata(value), pattern);
  }
});

test('rejects expired, future, ambiguous, and malformed signed metadata', async () => {
  const expired = fixture(); expired.verifier.now = () => new Date('2026-11-08T00:00:00Z');
  await assert.rejects(verifyDebianRepositoryMetadata(expired), /not currently valid/);
  const duplicate = fixture();
  duplicate.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(`${release.toString().trimEnd()}\nDate: ${releaseDate}\n`), signingKeyFingerprint: fingerprint });
  await assert.rejects(verifyDebianRepositoryMetadata(duplicate), /duplicate field date/);
  const weak = fixture();
  weak.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(release.toString().replace('SHA256:', 'SHA1:').replace(sha(packages), 'b'.repeat(40))), signingKeyFingerprint: fingerprint });
  await assert.rejects(verifyDebianRepositoryMetadata(weak), /missing SHA256/);
  const mismatch = fixture();
  mismatch.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(release.toString().replace('Components: main', 'Components: contrib')), signingKeyFingerprint: fingerprint });
  await assert.rejects(verifyDebianRepositoryMetadata(mismatch), /component/);
});

test('compressed indices require an explicit bounded trusted decompressor', async () => {
  const value = fixture();
  value.descriptor.metadataProof.packagesIndex.path = 'dists/stable/main/binary-amd64/Packages.xz';
  value.verifier.verifyInRelease = async () => ({ cleartext: Buffer.from(release.toString().replace('main/binary-amd64/Packages', 'main/binary-amd64/Packages.xz')), signingKeyFingerprint: fingerprint });
  await assert.rejects(verifyDebianRepositoryMetadata(value), /trusted decompressor/);
  value.verifier.decompressPackages = async (_path, bytes) => bytes;
  assert.equal((await verifyDebianRepositoryMetadata(value)).packageName, 'fixture');
});
