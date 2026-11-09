import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDesktopToolsRelease } from '../../../scripts/build-desktop-tools-release.mjs';
import { verifyDesktopToolsReleaseOffline } from '../../../scripts/verify-desktop-tools-release.mjs';
import { publishDesktopRelease } from '../scripts/desktop-release-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
const semanticDigest = (domain, value) => digest(`${domain}\0${JSON.stringify(canonical(value))}`);
const platforms = ['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'];
const opencodeName = platform => platform.startsWith('macos-') ? `opencode-${platform}.zip` : `opencode-${platform}.tar.gz`;

test('creates a canonical public broker approval delegation from source-owned release policy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-delegation-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicKeySpki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const output = join(root, 'delegation.json');
  execFileSync(process.execPath, ['../../../scripts/create-broker-approval-signer-delegation.mjs',
    '../../../config/desktop-tools-broker-approval-policy.json', 'release-1', '2000000000', '2000003600',
    'approval-key-1', publicKeySpki, output], { cwd: new URL('.', import.meta.url).pathname });
  const bytes = await readFile(output);
  const delegation = JSON.parse(bytes);
  assert.deepEqual(bytes, Buffer.from(`${JSON.stringify(canonical(delegation))}\n`));
  const { delegationDigest, ...projection } = delegation;
  assert.equal(delegationDigest, semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', projection));
  assert.equal(delegation.revocationEpoch, 1);
  assert.equal(delegation.maximumApprovalLifetimeSeconds, 600);
});

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
  const approvalKey = generateKeyPairSync('ed25519').publicKey;
  const delegationProjection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId: 'approval-key-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools', releaseId, channel: 'stable',
    publicKeySpki: approvalKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    notBefore: new Date(Date.now() - 86_400_000).toISOString(),
    notAfter: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 7 };
  const brokerApprovalSignerDelegation = join(root, `input-${releaseId}-broker-approval-delegation.json`);
  await writeFile(brokerApprovalSignerDelegation, `${JSON.stringify(canonical({ ...delegationProjection,
    delegationDigest: semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', delegationProjection) }))}\n`, { mode: 0o600 });
  return { releaseId, sourceCommit, opencodeVersion, provisioner: paths['provision.sh'], engine: paths['desktop-tools-engine.mjs'],
    catalog: paths['catalog.json'], supervisor: paths['desktop-tools-supervisor.mjs'], tools: paths['desktop-tools-tools.tar.gz'],
    opencodeLock: paths['opencode.lock.json'], licenses: paths.licenses, debian,
    releaseChannel: 'stable', brokerApprovalSignerDelegation, brokerApprovalMinimumRevocationEpoch: 7,
    runtimes: Object.fromEntries(platforms.map(platform => [platform.replace('-', '_'), paths[`node-${platform}.tar.gz`]])),
    opencode: Object.fromEntries(platforms.map(platform => [platform.replace('-', '_'), paths[opencodeName(platform)]])) };
}

test('builds deterministic unsigned Desktop Tools v9 closure with release-delegated broker approval authority', async t => {
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
    'broker-approval-signer-delegation.json',
    'debian-bookworm-archive-keyring.gpg','debian-bookworm-inrelease','debian-bookworm-main-amd64-Packages.xz','tree_2.1.0-1_amd64.deb'].sort();
  assert.deepEqual((await readdir(first.outputDirectory)).sort(), expected);
  assert.deepEqual(await readFile(join(first.outputDirectory, 'manifest')), await readFile(join(second.outputDirectory, 'manifest')));
  assert.deepEqual(await readFile(join(first.outputDirectory, 'start')), await readFile(join(second.outputDirectory, 'start')));
  const manifest = await readFile(join(first.outputDirectory, 'manifest'), 'utf8');
  assert.match(manifest, /^schema_version=9$/m);
  assert.equal(manifest.trimEnd().split('\n').length, 80);
  assert.match(manifest, /^broker_approval_minimum_revocation_epoch=7$/m);
  assert.match(manifest, /^broker_approval_delegation_sha256=[a-f0-9]{64}$/m);
  for (const prefix of ['debian_inrelease','debian_keyring','debian_packages','debian_tree']) assert.match(manifest, new RegExp(`^${prefix}_sha256=[a-f0-9]{64}$`, 'm'));
  assert.match(manifest, /^opencode_version=2\.2\.5$/m);
  for (const platform of platforms) assert.match(manifest, new RegExp(`opencode_${platform.replace('-', '_')}_url=https://desktop\\.tools/releases/desktop-test-1/${opencodeName(platform).replaceAll('.', '\\.')}`));
  assert.equal((await readdir(first.outputDirectory)).includes('manifest.sig'), false);
  const delegationDigest = digest(await readFile(source.brokerApprovalSignerDelegation));
  const sbom = JSON.parse(await readFile(join(first.outputDirectory, 'release.sbom.json'), 'utf8'));
  const properties = new Map(sbom.metadata.component.properties.map(item => [item.name, item.value]));
  assert.equal(properties.get('desktop.tools:broker-approval-delegation-sha256'), delegationDigest);
  assert.equal(properties.get('desktop.tools:broker-approval-minimum-revocation-epoch'), '7');
  const provenance = JSON.parse(await readFile(join(first.outputDirectory, 'release.provenance.json'), 'utf8'));
  assert.equal(provenance.predicate.buildDefinition.externalParameters.brokerApprovalDelegationSha256, delegationDigest);
  assert.equal(provenance.predicate.buildDefinition.externalParameters.brokerApprovalMinimumRevocationEpoch, 7);
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

  async function mutateDelegation(sourceInput, mutate, { recompute = true, canonicalJson = true } = {}) {
    const delegation = JSON.parse(await readFile(sourceInput.brokerApprovalSignerDelegation, 'utf8'));
    mutate(delegation);
    if (recompute) {
      const { delegationDigest: ignored, ...projection } = delegation;
      delegation.delegationDigest = semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', projection);
    }
    await writeFile(sourceInput.brokerApprovalSignerDelegation,
      canonicalJson ? `${JSON.stringify(canonical(delegation))}\n` : `${JSON.stringify(delegation, null, 2)}\n`, { mode: 0o600 });
  }
  const badDigest = await inputs(root, { releaseId: 'desktop-test-bad-digest' });
  await mutateDelegation(badDigest, delegation => { delegation.delegationDigest = '0'.repeat(64); }, { recompute: false });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...badDigest, outputDirectory: join(root, 'bad-delegation-digest') }, now), /delegation digest/);
  const badScope = await inputs(root, { releaseId: 'desktop-test-bad-scope' });
  await mutateDelegation(badScope, delegation => { delegation.releaseId = 'other-release'; });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...badScope, outputDirectory: join(root, 'bad-delegation-scope') }, now), /release or channel scope/);
  const badSpki = await inputs(root, { releaseId: 'desktop-test-bad-spki' });
  await mutateDelegation(badSpki, delegation => { delegation.publicKeySpki = 'A'.repeat(64); });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...badSpki, outputDirectory: join(root, 'bad-delegation-spki') }, now), /SPKI/);
  const staleDelegation = await inputs(root, { releaseId: 'desktop-test-stale-delegation' });
  await mutateDelegation(staleDelegation, delegation => { delegation.notAfter = new Date((now + 60) * 1000).toISOString(); });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...staleDelegation, outputDirectory: join(root, 'stale-delegation') }, now), /release validity window/);
  const lowEpoch = await inputs(root, { releaseId: 'desktop-test-low-epoch' });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...lowEpoch, brokerApprovalMinimumRevocationEpoch: 8,
    outputDirectory: join(root, 'low-delegation-epoch') }, now), /minimum revocation epoch/);
  const noncanonical = await inputs(root, { releaseId: 'desktop-test-noncanonical-delegation' });
  await mutateDelegation(noncanonical, () => {}, { canonicalJson: false });
  await assert.rejects(buildDesktopToolsRelease({ ...common, ...noncanonical, outputDirectory: join(root, 'noncanonical-delegation') }, now), /canonical JSON/);
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
