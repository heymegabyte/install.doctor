import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDesktopToolsRelease } from '../../../scripts/build-desktop-tools-release.mjs';
import { verifyDesktopToolsReleaseOffline } from '../../../scripts/verify-desktop-tools-release.mjs';
import { publishDesktopRelease } from '../scripts/desktop-release-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const platforms = ['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'];
const opencodeName = platform => platform.startsWith('macos-') ? `opencode-${platform}.zip` : `opencode-${platform}.tar.gz`;

async function inputs(root, { releaseId = 'desktop-test-1', sourceCommit = 'a'.repeat(40), opencodeVersion = '2.2.5' } = {}) {
  const outputBodies = new Map([
    ['provision.sh', Buffer.from('provision\n')], ['desktop-tools-engine.mjs', Buffer.from('engine\n')],
    ['desktop-tools-supervisor.mjs', Buffer.from('supervisor\n')],
    ['desktop-tools-tools.tar.gz', Buffer.from('tools\n')]
  ]);
  for (const platform of platforms) {
    outputBodies.set(`node-${platform}.tar.gz`, Buffer.from(`node-${platform}\n`));
    outputBodies.set(opencodeName(platform), Buffer.from(`opencode-${platform}\n`));
  }
  const lock = { schemaVersion: 1, name: 'opencode', version: opencodeVersion, sourceCommit: 'c'.repeat(40), license: 'MIT',
    sourceVerification: { tagCommit: 'c'.repeat(40), gitHubVerified: false, assetDigestSource: 'github-release-api' }, artifacts: {} };
  for (const platform of platforms) {
    const key = platform.replace('-', '_'); const name = opencodeName(platform); const bytes = outputBodies.get(name);
    lock.artifacts[key] = { releaseFilename: name,
      upstreamUrl: `https://github.com/anomalyco/opencode/releases/download/v${opencodeVersion}/fixture-${platform}${name.endsWith('.zip') ? '.zip' : '.tar.gz'}`,
      sha256: digest(bytes), size: bytes.byteLength };
  }
  outputBodies.set('opencode.lock.json', Buffer.from(`${JSON.stringify(lock)}\n`));
  const debianBodies = {
    archiveKeyring: Buffer.from('debian keyring\n'), inRelease: Buffer.from('signed InRelease\n'),
    packagesIndex: Buffer.from('compressed Packages\n'), treePayload: Buffer.from('tree deb\n'),
  };
  const receipt = { schemaVersion: 1, descriptor: { packageKey: 'tree', package: { version: '2.1.0-1' },
    metadataProof: { inRelease: { signedAt: new Date().toISOString(), validUntil: null, maximumDateAgeSeconds: 180 * 86_400 } } }, artifacts: [
    ['debian-bookworm-inrelease', debianBodies.inRelease], ['debian-bookworm-archive-keyring', debianBodies.archiveKeyring],
    ['debian-bookworm-main-amd64-packages', debianBodies.packagesIndex], ['tree-deb-bookworm-amd64', debianBodies.treePayload],
  ].map(([id, bytes]) => ({ id, sha256: digest(bytes), sizeBytes: bytes.length })) };
  outputBodies.set('catalog.json', Buffer.from(`${JSON.stringify([{ name: 'tree', offlinePayloads: [receipt.descriptor] }])}\n`));
  const trustPolicy = { archiveKeyringUri: 'https://deb.debian.org/debian/keyring.gpg',
    inReleaseUri: 'https://deb.debian.org/debian/dists/bookworm/InRelease',
    packagesIndexUri: 'https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.xz',
    treePayloadUri: 'https://deb.debian.org/debian/pool/main/t/tree/tree_2.1.0-1_amd64.deb' };
  const paths = {};
  for (const [name, bytes] of outputBodies) {
    const path = join(root, `input-${name}`); await writeFile(path, bytes, { mode: 0o600 }); paths[name] = path;
  }
  paths.licenses = join(root, 'input-licenses.txt'); await writeFile(paths.licenses, `OpenCode ${opencodeVersion}\nMIT License\n`);
  const debian = {};
  for (const [name, bytes] of Object.entries(debianBodies)) { debian[name] = join(root, `input-debian-${name}`); await writeFile(debian[name], bytes, { mode: 0o600 }); }
  debian.trustPolicy = join(root, 'input-debian-trust-policy.json'); await writeFile(debian.trustPolicy, `${JSON.stringify(trustPolicy)}\n`, { mode: 0o600 });
  debian.compositionReceipt = join(root, 'input-debian-composition.json'); await writeFile(debian.compositionReceipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  return { releaseId, sourceCommit, opencodeVersion, provisioner: paths['provision.sh'], engine: paths['desktop-tools-engine.mjs'],
    catalog: paths['catalog.json'], supervisor: paths['desktop-tools-supervisor.mjs'], tools: paths['desktop-tools-tools.tar.gz'],
    opencodeLock: paths['opencode.lock.json'], licenses: paths.licenses, debian,
    runtimes: Object.fromEntries(platforms.map(platform => [platform.replace('-', '_'), paths[`node-${platform}.tar.gz`]])),
    opencode: Object.fromEntries(platforms.map(platform => [platform.replace('-', '_'), paths[opencodeName(platform)]])) };
}

test('builds deterministic unsigned Desktop Tools v8 closure with Debian authority and validated metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-builder-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Math.floor(Date.now() / 1_000);
  const source = await inputs(root);
  const base = { ...source, createdAt: now - 1, expiresAt: now + 86_400, signerId: 'desktop-production-1',
    signerPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    runtimeNodeVersion: '24.11.0' };
  const first = await buildDesktopToolsRelease({ ...base, outputDirectory: join(root, 'out-1') }, now);
  const second = await buildDesktopToolsRelease({ ...base, outputDirectory: join(root, 'out-2') }, now);
  const expected = ['THIRD_PARTY_LICENSES.txt','catalog.json','desktop-tools-engine.mjs','desktop-tools-supervisor.mjs',
    'desktop-tools-tools.tar.gz','manifest','node-linux-arm64.tar.gz','node-linux-x64.tar.gz','node-macos-arm64.tar.gz',
    'node-macos-x64.tar.gz','opencode-linux-arm64.tar.gz','opencode-linux-x64.tar.gz','opencode-macos-arm64.zip',
    'opencode-macos-x64.zip','opencode.lock.json','provision.sh','release.provenance.json','release.sbom.json','start',
    'debian-bookworm-archive-keyring.gpg','debian-bookworm-inrelease','debian-bookworm-main-amd64-Packages.xz','tree_2.1.0-1_amd64.deb'].sort();
  assert.deepEqual((await readdir(first.outputDirectory)).sort(), expected);
  assert.deepEqual(await readFile(join(first.outputDirectory, 'manifest')), await readFile(join(second.outputDirectory, 'manifest')));
  assert.deepEqual(await readFile(join(first.outputDirectory, 'start')), await readFile(join(second.outputDirectory, 'start')));
  const manifest = await readFile(join(first.outputDirectory, 'manifest'), 'utf8');
  assert.match(manifest, /^schema_version=8$/m);
  for (const prefix of ['debian_inrelease','debian_keyring','debian_packages','debian_tree']) assert.match(manifest, new RegExp(`^${prefix}_sha256=[a-f0-9]{64}$`, 'm'));
  assert.match(manifest, /^opencode_version=2\.2\.5$/m);
  for (const platform of platforms) assert.match(manifest, new RegExp(`opencode_${platform.replace('-', '_')}_url=https://desktop\\.tools/releases/desktop-test-1/${opencodeName(platform).replaceAll('.', '\\.')}`));
  assert.equal((await readdir(first.outputDirectory)).includes('manifest.sig'), false);
  await assert.rejects(buildDesktopToolsRelease({ ...base, outputDirectory: first.outputDirectory }, now), /overwrite/);

});

test('rejects malformed, stale, or substituted lock and license metadata before signing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-metadata-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Math.floor(Date.now() / 1_000);
  const source = await inputs(root);
  const common = { ...source, createdAt: now - 1, expiresAt: now + 86_400, signerId: 'desktop-production-1',
    signerPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', runtimeNodeVersion: '24.11.0' };
  await writeFile(source.opencodeLock, '{}\n');
  await assert.rejects(buildDesktopToolsRelease({ ...common, outputDirectory: join(root, 'bad-lock') }, now), /invalid|expected|lock/i);
  const fresh = await inputs(root, { releaseId: 'desktop-test-2' });
  await writeFile(fresh.licenses, 'unrelated notices\n');
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...fresh, outputDirectory: join(root, 'bad-license') }, now), /licenses/);
  const freshness = await inputs(root, { releaseId: 'desktop-test-3' });
  const receipt = JSON.parse(await readFile(freshness.debian.compositionReceipt, 'utf8'));
  receipt.descriptor.metadataProof.inRelease.validUntil = new Date((now + 60) * 1000).toISOString();
  await writeFile(freshness.debian.compositionReceipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...freshness, expiresAt: now + 86_400,
    outputDirectory: join(root, 'bad-debian-freshness') }, now), /freshness.*release expiry/);
});

test('signs and verifies the complete closure offline; tamper, surplus, and every platform substitution fail', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-signer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateKey = join(root, 'signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKey]);
  await chmod(privateKey, 0o600);
  const publicKey = execFileSync('ssh-keygen', ['-y', '-f', privateKey], { encoding: 'utf8' }).trim();
  const publicKeyFile = join(root, 'signer.pub'); await writeFile(publicKeyFile, `${publicKey}\n`, { mode: 0o600 });
  const now = Math.floor(Date.now() / 1_000);
  const source = await inputs(root, { releaseId: 'desktop-signed-1', sourceCommit: 'b'.repeat(40), opencodeVersion: '2.0.1' });
  const unsigned = join(root, 'unsigned');
  await buildDesktopToolsRelease({ ...source, createdAt: now - 1, expiresAt: now + 86_400,
    signerId: 'desktop-production-1', signerPublicKey: publicKey, runtimeNodeVersion: '24.11.0', outputDirectory: unsigned }, now);
  const signed = join(root, 'signed');
  execFileSync('bash', ['../../../scripts/sign-desktop-tools-release.sh', 'desktop-production-1', privateKey, unsigned, signed], { cwd: new URL('.', import.meta.url).pathname });
  const verified = await verifyDesktopToolsReleaseOffline({ directory: signed, expectedReleaseId: source.releaseId,
    signerId: 'desktop-production-1', publicKeyPath: publicKeyFile, now });
  assert.equal(verified.verified, true); assert.equal(verified.opencodeVersion, '2.0.1');
  const objects = new Map();
  const allowed = join(root, 'allowed'); await writeFile(allowed, `desktop-production-1 ${publicKey}\n`, { mode: 0o600 });
  await publishDesktopRelease({ directory: signed, expectedReleaseId: source.releaseId,
    storage: { async create(key, bytes) { if (objects.has(key)) return false; objects.set(key, { bytes: Buffer.from(bytes) }); return true; }, async read(key) { return objects.get(key) ?? null; } },
    verifySignature: async ({ manifest, signerId, namespace }) => {
      assert.equal(namespace, 'desktop.tools.release');
      execFileSync('ssh-keygen', ['-Y','verify','-f',allowed,'-I',signerId,'-n',namespace,'-s',join(signed,'manifest.sig')], { input: manifest });
    }, now }).catch(async error => { throw error; });

  for (const platform of platforms) {
    const tampered = join(root, `tampered-${platform}`); await cp(signed, tampered, { recursive: true });
    await writeFile(join(tampered, opencodeName(platform)), `substituted-${platform}\n`);
    await assert.rejects(verifyDesktopToolsReleaseOffline({ directory: tampered, expectedReleaseId: source.releaseId,
      signerId: 'desktop-production-1', publicKeyPath: publicKeyFile, now }), /artifact binding/);
  }
  const surplus = join(root, 'surplus'); await cp(signed, surplus, { recursive: true }); await writeFile(join(surplus, 'unexpected'), 'x');
  await assert.rejects(verifyDesktopToolsReleaseOffline({ directory: surplus, expectedReleaseId: source.releaseId,
    signerId: 'desktop-production-1', publicKeyPath: publicKeyFile, now }), /exact allowlist/);
});
