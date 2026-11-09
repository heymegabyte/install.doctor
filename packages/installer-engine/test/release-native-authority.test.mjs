import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyDesktopReleaseCatalog } from '../dist/offline-bundle.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('signed schema-v8 release independently binds the exact native descriptor and four objects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-native-release-'));
  const key = join(root, 'release-key');
  const generated = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const releaseId = 'native-release-1';
  const payload = Buffer.from('tree payload\n'); const inRelease = Buffer.from('signed release\n');
  const packages = Buffer.from('packages index\n'); const keyring = Buffer.from('archive keyring\n');
  const descriptor = {
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
    platform: { os: 'linux', arch: 'x64' }, package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
    artifact: { id: 'tree-deb-bookworm-amd64', sha256: sha(payload), sizeBytes: payload.length, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: { artifactId: 'debian-bookworm-inrelease', path: 'dists/bookworm/InRelease', sha256: sha(inRelease),
        sizeBytes: inRelease.length, signedAt: '2026-11-01T00:00:00.000Z', validUntil: null, maximumDateAgeSeconds: 15_552_000,
        signingKeyFingerprint: 'A'.repeat(40), keyring: { artifactId: 'debian-bookworm-archive-keyring',
          sha256: sha(keyring), sizeBytes: keyring.length, mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'debian-bookworm-main-amd64-packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz',
        sha256: sha(packages), sizeBytes: packages.length, architecture: 'amd64' },
      packageStanza: { filename: 'pool/main/t/tree/tree_2.1.0-1_amd64.deb', sha256: sha(payload), sizeBytes: payload.length,
        depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'foreign' },
    },
    dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [],
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  };
  const catalogBytes = Buffer.from(`${JSON.stringify([{ name: 'tree', bin: 'tree', platforms: ['linux'], installMode: 'cli',
    loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [], offlinePayloads: [descriptor],
    providers: ['apt'], pkgs: { apt: 'tree' } }])}\n`);
  const objects = [
    ['debian_inrelease', descriptor.metadataProof.inRelease.artifactId, 'debian-bookworm-inrelease', inRelease],
    ['debian_keyring', descriptor.metadataProof.inRelease.keyring.artifactId, 'debian-bookworm-archive-keyring.gpg', keyring],
    ['debian_packages', descriptor.metadataProof.packagesIndex.artifactId, 'debian-bookworm-main-amd64-Packages.xz', packages],
    ['debian_tree', descriptor.artifact.id, 'tree_2.1.0-1_amd64.deb', payload],
  ];
  const artifactPrefixes = ['artifact', 'engine', 'catalog', 'launcher', 'supervisor', 'tools', 'opencode_lock', 'sbom', 'provenance', 'licenses',
    'debian_keyring', 'debian_inrelease', 'debian_packages', 'debian_tree', 'runtime_macos_x64', 'runtime_macos_arm64',
    'runtime_linux_x64', 'runtime_linux_arm64', 'opencode_macos_x64', 'opencode_macos_arm64', 'opencode_linux_x64', 'opencode_linux_arm64'];
  const lines = ['schema_version=8', 'product_id=desktop-tools', `release_id=${releaseId}`, `source_commit=${'1'.repeat(40)}`,
    'created_at=1794080000', 'expires_at=1794083600', 'key_id=desktop-test', 'engine_node_min=22',
    'runtime_node_version=24.1.0', 'opencode_version=2.0.0'];
  for (const prefix of artifactPrefixes) {
    const native = objects.find(([candidate]) => candidate === prefix);
    const filename = native?.[2] ?? (prefix === 'catalog' ? 'catalog.json' : `${prefix}.fixture`); const bytes = native?.[3] ?? Buffer.from(prefix);
    const effectiveBytes = prefix === 'catalog' ? catalogBytes : bytes;
    lines.push(`${prefix}_url=https://desktop.tools/releases/${releaseId}/${filename}`,
      `${prefix}_sha256=${sha(effectiveBytes)}`, `${prefix}_size=${effectiveBytes.length}`);
  }
  assert.equal(lines.length, 76);
  const manifestPath = join(root, 'manifest');
  await writeFile(manifestPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  const signed = spawnSync('/usr/bin/ssh-keygen', ['-Y', 'sign', '-q', '-f', key, '-n', 'desktop.tools.release', manifestPath], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  const artifacts = objects.map(([prefix, artifactId, filename, bytes]) => ({ artifactId,
    url: `https://desktop.tools/releases/${releaseId}/${filename}`,
    authority: { sha256: sha(bytes), sizeBytes: bytes.length, mode: '0600' } }));
  const input = { manifestPath, signaturePath: `${manifestPath}.sig`,
    trust: { keyId: 'desktop-test', publicKey: (await readFile(`${key}.pub`, 'utf8')).trim() },
    expectedReleaseId: releaseId, catalogBytes, nativeAuthority: { descriptor, artifacts }, now: 1_794_080_100 };
  const verified = await verifyDesktopReleaseCatalog(input);
  assert.equal(verified.releaseId, releaseId);
  const substituted = { ...input, nativeAuthority: structuredClone(input.nativeAuthority) };
  substituted.nativeAuthority.artifacts.find(item => item.artifactId === descriptor.artifact.id).authority.sha256 = 'f'.repeat(64);
  await assert.rejects(verifyDesktopReleaseCatalog(substituted), /not an exact member/);
});
