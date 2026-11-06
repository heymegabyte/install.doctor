import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename as fsRename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  OfflineBundleError,
  applyOfflineBundle,
  canonicalBundleManifestBytes,
  createOfflineBundle,
  planOfflineBundle,
  verifyOfflineBundle,
} from '../dist/index.js';
import { parseStageZeroReleaseEnvelope, serializeStageZeroReleaseEnvelope } from '../../aid-core/dist/installer-contracts.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);
const at = '2026-11-06T04:00:00.000Z';
const later = '2026-11-06T05:00:00.000Z';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-offline-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateKeyPath = join(root, 'signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'bundle-test', '-f', privateKeyPath]);
  await chmod(privateKeyPath, 0o600);
  const publicKey = (await readFile(`${privateKeyPath}.pub`, 'utf8')).trim();
  const releaseKeyPath = join(root, 'release-signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'release-test', '-f', releaseKeyPath]);
  await chmod(releaseKeyPath, 0o600);
  const releaseTrust = { keyId: 'release-test', publicKey: (await readFile(`${releaseKeyPath}.pub`, 'utf8')).trim() };
  const source = join(root, 'source');
  const bundles = join(root, 'bundles');
  await mkdir(source);
  await mkdir(bundles);
  const engine = join(source, 'engine.mjs');
  const catalog = join(source, 'catalog.json');
  await writeFile(engine, '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o700 });
  await writeFile(catalog, '[]\n', { mode: 0o600 });
  const envelopePath = join(source, 'release-envelope');
  const releaseSignaturePath = join(source, 'release-signature');
  const envelope = serializeStageZeroReleaseEnvelope({
    schemaVersion: 4, releaseId: 'release-1', sourceCommit: '1'.repeat(40),
    createdAt: Date.parse(at) / 1000, expiresAt: Date.parse(later) / 1000, keyId: releaseTrust.keyId,
    artifactUrl: 'https://app.install.doctor/releases/release-1/provision.sh', artifactSha256: '1'.repeat(64), artifactSize: 1,
    engineUrl: 'https://app.install.doctor/releases/release-1/install-doctor-engine.mjs', engineSha256: sha(await readFile(engine)), engineSize: (await readFile(engine)).length, engineNodeMin: 22,
    catalogUrl: 'https://app.install.doctor/releases/release-1/catalog.json', catalogSha256: sha(await readFile(catalog)), catalogSize: (await readFile(catalog)).length,
    runtimeNodeVersion: '24.1.0',
    runtimes: Object.fromEntries(['macos-x64','macos-arm64','linux-x64','linux-arm64'].map(name => [name, {
      url: `https://app.install.doctor/releases/release-1/node-${name}.tar.gz`, sha256: '2'.repeat(64), size: 1,
    }])),
  });
  await writeFile(envelopePath, envelope, { mode: 0o600 });
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', releaseKeyPath, '-n', 'install.doctor.release', envelopePath]);
  await fsRename(`${envelopePath}.sig`, releaseSignaturePath);
  const trust = { keyId: 'offline-test', publicKey };
  const base = {
    outputRoot: bundles,
    releaseId: 'release-1',
    planDigest: 'a'.repeat(64),
    graphDigest: 'b'.repeat(64),
    platform: { os: 'linux', arch: 'x64', environment: 'native' },
    selectedTaskIds: ['task.engine'],
    createdAt: at,
    expiresAt: later,
    signer: { keyId: trust.keyId, privateKeyPath },
    releaseTrust,
    artifacts: [
      { id: 'engine', sourcePath: engine, mediaType: 'text/javascript', mode: '0700', license: 'MIT', schema: null, containsSecrets: false },
      { id: 'catalog', sourcePath: catalog, mediaType: 'application/json', mode: '0600', license: 'MIT', schema: { id: 'software-catalog', version: '1' }, containsSecrets: false },
      { id: 'release-envelope', sourcePath: envelopePath, mediaType: 'text/plain', mode: '0600', license: 'MIT', schema: { id: 'stage-zero-release-envelope', version: '4' }, containsSecrets: false },
      { id: 'release-signature', sourcePath: releaseSignaturePath, mediaType: 'application/octet-stream', mode: '0600', license: 'MIT', schema: null, containsSecrets: false },
    ],
  };
  return {
    root, source, bundles, engine, catalog, envelopePath, releaseSignaturePath,
    trust, releaseTrust, privateKeyPath, releaseKeyPath, base,
  };
}

test('signed offline bundle verifies, plans an exact closure, and applies without its sources', async t => {
  const state = await fixture(t);
  const created = await createOfflineBundle(state.base);
  assert.equal(basename(created.bundleDirectory), created.manifestDigest);
  await rm(state.source, { recursive: true });

  const verified = await verifyOfflineBundle({ bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust});
  assert.equal(verified.manifest.containsSecrets, false);
  assert.deepEqual(verified.manifest.artifacts.map(item => item.id), ['catalog', 'engine', 'release-envelope', 'release-signature']);
  const plan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory,
    trust: state.trust, releaseTrust: state.releaseTrust, expected: {
      releaseId: 'release-1', planDigest: 'a'.repeat(64), platform: state.base.platform,
      selectedTaskIds: ['task.engine'], artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
    },
    now: '2026-11-06T04:30:00.000Z',
  });
  await assert.rejects(applyOfflineBundle({
    plan, destinationDirectory: join(created.bundleDirectory, 'applied'), trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z',
  }), /inside the immutable bundle/);
  const destination = join(state.root, 'offline-apply');
  const receipt = await applyOfflineBundle({ plan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z' });
  assert.equal(receipt.networkAllowed, false);
  assert.deepEqual(receipt.artifactIds, ['catalog', 'engine', 'release-envelope', 'release-signature']);
  assert.equal(await readFile(join(destination, 'catalog'), 'utf8'), '[]\n');
  assert.match(await readFile(join(destination, 'engine'), 'utf8'), /process\.exit/);
});

test('offline planning rejects expiry, wrong platform, wrong plan, and incomplete selection', async t => {
  const state = await fixture(t);
  const { bundleDirectory } = await createOfflineBundle(state.base);
  const common = {
    bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust, expected: {
      releaseId: 'release-1', planDigest: 'a'.repeat(64), platform: state.base.platform,
      selectedTaskIds: ['task.engine'], artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
    },
  };
  await assert.rejects(planOfflineBundle({ ...common, now: later }), /expired/);
  await assert.rejects(planOfflineBundle({ ...common, now: at, expected: { ...common.expected, platform: { ...state.base.platform, arch: 'arm64' } } }), /platform/);
  await assert.rejects(planOfflineBundle({ ...common, now: at, expected: { ...common.expected, planDigest: 'c'.repeat(64) } }), /plan digest/);
  await assert.rejects(planOfflineBundle({ ...common, now: at, expected: { ...common.expected, artifactIds: ['engine'] } }), /artifact closure/);
});

test('creation rejects release substitutions, missing provenance, wrong release trust, and excess validity', async t => {
  const state = await fixture(t);
  const withoutEnvelope = state.base.artifacts.filter(item => item.id !== 'release-envelope');
  await assert.rejects(createOfflineBundle({ ...state.base, artifacts: withoutEnvelope }), /release-envelope/);

  await writeFile(state.engine, '#!/usr/bin/env node\nprocess.exit(9)\n', { mode: 0o700 });
  await assert.rejects(createOfflineBundle(state.base), /engine.*signed release/);

  const fresh = await fixture(t);
  const wrongKey = join(fresh.root, 'wrong-release-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'wrong-release', '-f', wrongKey]);
  const wrongTrust = { keyId: fresh.releaseTrust.keyId, publicKey: (await readFile(`${wrongKey}.pub`, 'utf8')).trim() };
  await assert.rejects(createOfflineBundle({ ...fresh.base, releaseTrust: wrongTrust }), /signature verification/);
  await assert.rejects(createOfflineBundle({ ...fresh.base, expiresAt: '2026-11-06T06:00:00.000Z' }), /validity exceeds/);
});

test('creation rejects duplicate authority inside the signed catalog', async t => {
  const state = await fixture(t);
  const engineBytes = await readFile(state.engine);
  const descriptor = {
    schemaVersion: 1, id: 'duplicate-tool', version: '1.0.0', platform: { os: 'linux', arch: 'x64' },
    source: {
      url: 'https://github.com/fixture/install-doctor/releases/download/v1.0.0/duplicate-tool',
      sha256: sha(engineBytes), sizeBytes: engineBytes.length,
    },
    destination: { root: 'user-bin', filename: 'duplicate-tool', mode: '0700' },
  };
  await writeFile(state.catalog, `${JSON.stringify([{
    name: 'duplicate-tool', bin: 'duplicate-tool', platforms: ['linux'], installMode: 'cli',
    loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [descriptor, descriptor],
  }])}\n`, { mode: 0o600 });
  const envelope = parseStageZeroReleaseEnvelope(await readFile(state.envelopePath, 'utf8'));
  const catalogBytes = await readFile(state.catalog);
  await writeFile(state.envelopePath, serializeStageZeroReleaseEnvelope({
    ...envelope, catalogSha256: sha(catalogBytes), catalogSize: catalogBytes.length,
  }), { mode: 0o600 });
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', state.releaseKeyPath, '-n', 'install.doctor.release', state.envelopePath]);
  await fsRename(`${state.envelopePath}.sig`, state.releaseSignaturePath);
  await assert.rejects(createOfflineBundle(state.base), /duplicate artifact authority/);
});

test('verification rejects tampering, symlinks, and undeclared files', async t => {
  const state = await fixture(t);
  const first = await createOfflineBundle(state.base);
  await writeFile(join(first.bundleDirectory, 'artifacts', 'engine'), 'tampered\n');
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: first.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust}), /digest|size/);

  const secondRoot = join(state.root, 'second');
  await mkdir(secondRoot);
  const second = await createOfflineBundle({ ...state.base, outputRoot: secondRoot });
  await rm(join(second.bundleDirectory, 'artifacts', 'engine'));
  await symlink('/etc/passwd', join(second.bundleDirectory, 'artifacts', 'engine'));
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: second.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust}), /symbolic link|regular file/);

  const thirdRoot = join(state.root, 'third');
  await mkdir(thirdRoot);
  const third = await createOfflineBundle({ ...state.base, outputRoot: thirdRoot });
  await writeFile(join(third.bundleDirectory, 'artifacts', 'extra'), 'undeclared\n');
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: third.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust}), /undeclared|unexpected/);
});

test('signed malicious manifests cannot traverse paths or duplicate artifact identities', async t => {
  const state = await fixture(t);
  const maliciousRoot = join(state.root, 'malicious');
  await mkdir(maliciousRoot);

  async function signedBundle(artifacts) {
    const manifest = {
      schemaVersion: 2,
      releaseId: 'release-1', planDigest: 'a'.repeat(64), graphDigest: 'b'.repeat(64),
      platform: state.base.platform, selectedTaskIds: ['task.engine'], createdAt: at, expiresAt: later,
      containsSecrets: false,
      signature: { keyId: state.trust.keyId, algorithm: 'sshsig-ed25519', namespace: 'install.doctor.offline-bundle', detached: true },
      artifacts,
    };
    const bytes = canonicalBundleManifestBytes(manifest);
    const digest = sha(bytes);
    const directory = join(maliciousRoot, digest);
    await mkdir(join(directory, 'artifacts'), { recursive: true });
    const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, bytes);
    execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', state.privateKeyPath, '-n', 'install.doctor.offline-bundle', manifestPath]);
    await fsRename(`${manifestPath}.sig`, join(directory, 'manifest.sig'));
    return directory;
  }

  const metadata = { license: 'MIT', schema: null, catalogDescriptor: null, containsSecrets: false };
  const traversal = await signedBundle([{ id: 'engine', path: '../outside', sha256: 'd'.repeat(64), sizeBytes: 1, mediaType: 'text/plain', mode: '0600', ...metadata }]);
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: traversal, trust: state.trust, releaseTrust: state.releaseTrust}), /path/);

  const duplicate = await signedBundle([
    { id: 'engine', path: 'artifacts/engine', sha256: 'd'.repeat(64), sizeBytes: 1, mediaType: 'text/plain', mode: '0600', ...metadata },
    { id: 'engine', path: 'artifacts/other', sha256: 'e'.repeat(64), sizeBytes: 1, mediaType: 'text/plain', mode: '0600', ...metadata },
  ]);
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: duplicate, trust: state.trust, releaseTrust: state.releaseTrust}), /duplicate/);
});

test('bundle boundaries reject oversized artifacts and insecure signer keys', async t => {
  const state = await fixture(t);
  await chmod(state.privateKeyPath, 0o644);
  await assert.rejects(createOfflineBundle(state.base), /signing key.*permissions/);
  await chmod(state.privateKeyPath, 0o600);
  await writeFile(state.engine, Buffer.alloc(1025));
  await assert.rejects(createOfflineBundle({ ...state.base, maxArtifactBytes: 1024 }), OfflineBundleError);
});

test('artifact inventory requires license, schema, and an explicit nonsecret declaration', async t => {
  const state = await fixture(t);
  const incomplete = state.base.artifacts.map(item => ({ ...item }));
  delete incomplete[0].license;
  await assert.rejects(createOfflineBundle({ ...state.base, artifacts: incomplete }), /license|required|invalid/i);
  await assert.rejects(createOfflineBundle({
    ...state.base, artifacts: state.base.artifacts.map(item => ({ ...item, containsSecrets: true })),
  }), /containsSecrets|invalid literal/i);
  const created = await createOfflineBundle(state.base);
  assert.deepEqual(created.manifest.artifacts.map(item => ({
    id: item.id, license: item.license, schema: item.schema, containsSecrets: item.containsSecrets,
  })), [
    { id: 'catalog', license: 'MIT', schema: { id: 'software-catalog', version: '1' }, containsSecrets: false },
    { id: 'engine', license: 'MIT', schema: null, containsSecrets: false },
    { id: 'release-envelope', license: 'MIT', schema: { id: 'stage-zero-release-envelope', version: '4' }, containsSecrets: false },
    { id: 'release-signature', license: 'MIT', schema: null, containsSecrets: false },
  ]);
});

test('creation deterministically rejects credible secret content without echoing it', async t => {
  const state = await fixture(t);
  const secret = `client_secret=${'S'.repeat(32)}`;
  await writeFile(state.catalog, `${secret}\n`, { mode: 0o600 });
  await assert.rejects(createOfflineBundle(state.base), error => {
    assert.match(error.message, /credible operational secret material/);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes('S'.repeat(16)), false);
    return true;
  });
});

test('verification rejects secret content even when a trusted signer declares it nonsecret', async t => {
  const state = await fixture(t);
  const clean = await createOfflineBundle(state.base);
  const secretBytes = Buffer.from(`api_key=${'K'.repeat(32)}\n`);
  const manifest = structuredClone(clean.manifest);
  const catalog = manifest.artifacts.find(item => item.id === 'catalog');
  catalog.sha256 = sha(secretBytes);
  catalog.sizeBytes = secretBytes.length;
  const manifestBytes = canonicalBundleManifestBytes(manifest);
  const directory = join(state.root, 'signed-secret', sha(manifestBytes));
  await mkdir(join(directory, 'artifacts'), { recursive: true });
  await writeFile(join(directory, 'artifacts', 'catalog'), secretBytes, { mode: 0o600 });
  await writeFile(join(directory, 'artifacts', 'engine'), await readFile(state.engine), { mode: 0o700 });
  await writeFile(join(directory, 'artifacts', 'release-envelope'), await readFile(state.base.artifacts.find(item => item.id === 'release-envelope').sourcePath), { mode: 0o600 });
  await writeFile(join(directory, 'artifacts', 'release-signature'), await readFile(state.base.artifacts.find(item => item.id === 'release-signature').sourcePath), { mode: 0o600 });
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', state.privateKeyPath, '-n', 'install.doctor.offline-bundle', manifestPath]);
  await fsRename(`${manifestPath}.sig`, join(directory, 'manifest.sig'));
  await assert.rejects(verifyOfflineBundle({ bundleDirectory: directory, trust: state.trust, releaseTrust: state.releaseTrust}), error => {
    assert.match(error.message, /credible operational secret material/);
    assert.equal(error.message.includes('K'.repeat(16)), false);
    return true;
  });
});

test('faulted bundle publication and materialization clean private stages and retry safely', async t => {
  const state = await fixture(t);
  for (const point of ['after-artifacts-durable', 'before-bundle-publish']) {
    await assert.rejects(createOfflineBundle({
      ...state.base,
      fault: async candidate => { if (candidate === point) throw new Error(`fault:${point}`); },
    }), new RegExp(`fault:${point}`));
    assert.deepEqual((await readdir(state.bundles)).filter(name => name.startsWith('.bundle-stage-')), []);
  }
  const created = await createOfflineBundle(state.base);
  const plan = await planOfflineBundle({
    bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust, expected: {
      releaseId: state.base.releaseId, planDigest: state.base.planDigest, platform: state.base.platform,
      selectedTaskIds: state.base.selectedTaskIds, artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
    }, now: '2026-11-06T04:30:00.000Z',
  });
  const destination = join(state.root, 'durable-materialization');
  await assert.rejects(applyOfflineBundle({
    plan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z',
    fault: async point => { if (point === 'before-materialization-publish') throw new Error('fault:materialize'); },
  }), /fault:materialize/);
  assert.deepEqual((await readdir(state.root)).filter(name => name.startsWith('.offline-apply-')), []);
  await assert.rejects(readFile(join(destination, 'engine')), { code: 'ENOENT' });
  const receipt = await applyOfflineBundle({
    plan, destinationDirectory: destination, trust: state.trust, releaseTrust: state.releaseTrust, now: '2026-11-06T04:30:00.000Z',
  });
  assert.equal(receipt.manifestDigest, created.manifestDigest);
});

test('CLI bundle create, verify, plan, and approved deny-network apply share the strict contract', async t => {
  const state = await fixture(t);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invocationPath = join(state.root, 'bundle-invocation.json');
  const run = async invocation => {
    await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], {
      env: { PATH: process.env.PATH ?? '', HTTPS_PROXY: 'http://network-must-not-be-used.invalid' },
      timeout: 10_000, maxBuffer: 2_000_000,
    });
  };
  const createInvocation = {
    schemaVersion: 2, command: 'bundle-create',
    outputRoot: state.base.outputRoot, releaseId: state.base.releaseId,
    planDigest: state.base.planDigest, graphDigest: state.base.graphDigest,
    platform: state.base.platform, selectedTaskIds: state.base.selectedTaskIds,
    createdAt: state.base.createdAt, expiresAt: state.base.expiresAt,
    signer: state.base.signer, releaseTrust: state.releaseTrust, artifacts: state.base.artifacts,
  };
  const created = JSON.parse((await run(createInvocation)).stdout);
  const verifyInvocation = {
    schemaVersion: 2, command: 'bundle-verify', bundleDirectory: created.bundleDirectory, trust: state.trust, releaseTrust: state.releaseTrust,
  };
  const verified = JSON.parse((await run(verifyInvocation)).stdout);
  assert.equal(verified.manifestDigest, created.manifestDigest);
  const expected = {
    releaseId: state.base.releaseId, planDigest: state.base.planDigest, platform: state.base.platform,
    selectedTaskIds: state.base.selectedTaskIds, artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
  };
  const planInvocation = {
    schemaVersion: 2, command: 'bundle-plan', bundleDirectory: created.bundleDirectory,
    trust: state.trust, releaseTrust: state.releaseTrust, expected, now: '2026-11-06T04:30:00.000Z',
  };
  const plan = JSON.parse((await run(planInvocation)).stdout);
  assert.equal(plan.manifestDigest, created.manifestDigest);

  const destinationDirectory = join(state.root, 'cli-offline-apply');
  const applyInvocation = {
    ...planInvocation, command: 'bundle-apply', destinationDirectory,
    approvedManifestDigest: 'f'.repeat(64), offline: true, networkPolicy: 'deny',
  };
  await assert.rejects(run(applyInvocation), error => /requires exact manifest approval/.test(error.stderr));
  await assert.rejects(readFile(join(destinationDirectory, 'engine')), { code: 'ENOENT' });
  const receipt = JSON.parse((await run({ ...applyInvocation, approvedManifestDigest: plan.manifestDigest })).stdout);
  assert.equal(receipt.networkAllowed, false);
  assert.deepEqual(receipt.artifactIds, ['catalog', 'engine', 'release-envelope', 'release-signature']);
});

test('CLI bundle apply rejects unknown fields and any network-enabled policy before mutation', async t => {
  const state = await fixture(t);
  const created = await createOfflineBundle(state.base);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invocationPath = join(state.root, 'invalid-bundle-apply.json');
  const destinationDirectory = join(state.root, 'must-not-exist');
  const base = {
    schemaVersion: 2, command: 'bundle-apply', bundleDirectory: created.bundleDirectory,
    destinationDirectory, trust: state.trust, releaseTrust: state.releaseTrust, expected: {
      releaseId: state.base.releaseId, planDigest: state.base.planDigest, platform: state.base.platform,
      selectedTaskIds: state.base.selectedTaskIds, artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
    },
    now: '2026-11-06T04:30:00.000Z', approvedManifestDigest: created.manifestDigest,
    offline: true, networkPolicy: 'allow', unexpected: true,
  };
  await writeFile(invocationPath, `${JSON.stringify(base)}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => error.code === 2 && /unrecognized key|networkPolicy|invalid value/i.test(error.stderr),
  );
  await assert.rejects(readFile(join(destinationDirectory, 'engine')), { code: 'ENOENT' });
});

test('CLI rejects insecure bundle schema v1 instead of falling back', async t => {
  const state = await fixture(t);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invocationPath = join(state.root, 'legacy-v1.json');
  await writeFile(invocationPath, `${JSON.stringify({
    schemaVersion: 1, command: 'bundle-create', outputRoot: state.base.outputRoot,
    releaseId: state.base.releaseId, planDigest: state.base.planDigest, graphDigest: state.base.graphDigest,
    platform: state.base.platform, selectedTaskIds: state.base.selectedTaskIds,
    createdAt: state.base.createdAt, expiresAt: state.base.expiresAt,
    signer: state.base.signer, artifacts: state.base.artifacts,
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => error.code === 2 && /expected 2|invalid/i.test(error.stderr),
  );
  assert.deepEqual(await readdir(state.bundles), []);
});

test('CLI offline execution contract rejects clock overrides and network access before authority checks', async t => {
  const state = await fixture(t);
  const created = await createOfflineBundle(state.base);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invocationPath = join(state.root, 'invalid-offline-execute.json');
  const base = {
    schemaVersion: 2, command: 'bundle-execute', runId: 'offline-run-1',
    bundleDirectory: created.bundleDirectory, materializedRoot: join(state.root, 'materialized'),
    stateRoot: join(state.root, 'state'), trust: state.trust, releaseTrust: state.releaseTrust, expected: {
      releaseId: state.base.releaseId, planDigest: state.base.planDigest, platform: state.base.platform,
      selectedTaskIds: state.base.selectedTaskIds, artifactIds: ['catalog', 'engine', 'release-envelope', 'release-signature'],
    },
    approvedManifestDigest: created.manifestDigest, approvedPlanDigest: state.base.planDigest,
    renderer: 'ndjson', offline: true, networkPolicy: 'deny',
  };
  for (const invalid of [
    { ...base, now: '2026-11-06T04:30:00.000Z' },
    { ...base, networkPolicy: 'allow' },
  ]) {
    await writeFile(invocationPath, `${JSON.stringify(invalid)}\n`, { mode: 0o600 });
    await assert.rejects(
      execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
      error => error.code === 2 && /unrecognized key|networkPolicy|invalid value/i.test(error.stderr),
    );
  }
  await assert.rejects(readFile(base.materializedRoot), { code: 'ENOENT' });
});
