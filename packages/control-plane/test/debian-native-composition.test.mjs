import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { composeDebianTreeRelease } from '../../../scripts/compose-debian-native-release.mjs';

/** @param {Uint8Array} bytes */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = 'A'.repeat(40);

/** @param {import('node:test').TestContext} t @param {{ date?: string, validUntil?: string | null, now?: string }} [options] */
async function fixture(t, { date = 'Sun, 08 Nov 2026 10:00:00 +0000', validUntil = null,
  now = '2026-11-08T12:00:00.000Z' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'debian-tree-compose-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from('deterministic tree deb fixture\n');
  const packages = Buffer.from(['Package: tree','Version: 2.1.0-1','Architecture: amd64',
    'Filename: pool/main/t/tree/tree_2.1.0-1_amd64.deb',`Size: ${String(payload.length)}`,`SHA256: ${sha(payload)}`,
    'Depends: libc6 (>= 2.34)','Essential: no',''].join('\n'));
  const release = Buffer.from(['Suite: oldstable','Codename: bookworm','Components: main','Architectures: amd64',
    `Date: ${date}`,...(validUntil === null ? [] : [`Valid-Until: ${validUntil}`]),'SHA256:',
    ` ${sha(packages)} ${String(packages.length)} main/binary-amd64/Packages.xz`, ''].join('\n'));
  const files = { inRelease: Buffer.from('opaque signed InRelease\n'), packages, keyring: Buffer.from('public archive keyring\n'), payload };
  const paths = {
    inRelease: join(root, 'inRelease'), packages: join(root, 'Packages.xz'),
    keyring: join(root, 'keyring'), payload: join(root, 'payload'),
  };
  for (const name of /** @type {const} */ (['inRelease', 'packages', 'keyring', 'payload'])) {
    await writeFile(paths[name], files[name], { mode: 0o600 });
  }
  const policy = { version: '2.1.0-1', signingKeyFingerprint: fingerprint,
    dependencyClosure: { depends: [], preDepends: [] }, affectedServiceUnits: [], conffiles: [] };
  const input = { policy, inReleasePath: paths.inRelease, packagesPath: paths.packages,
    keyringPath: paths.keyring, payloadPath: paths.payload, now };
  /** @satisfies {NonNullable<Parameters<typeof composeDebianTreeRelease>[1]>} */
  const dependencies = {
    verifier: { verifyInRelease: () => Promise.resolve({ cleartext: release, signingKeyFingerprint: fingerprint }),
      decompressPackages: () => Promise.resolve(packages), now: () => new Date(input.now) },
    inspectControl: () => Promise.resolve({ control: { packageName: 'tree', version: policy.version, architecture: 'amd64',
      depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'absent' }, conffiles: [], members: [] }),
  };
  return { input, dependencies, paths, payload, release, root };
}

void test('deterministically composes exact Debian 12 tree descriptor and proof inventory without network or secrets', async t => {
  const state = await fixture(t);
  const first = await composeDebianTreeRelease(state.input, state.dependencies);
  const second = await composeDebianTreeRelease(state.input, state.dependencies);
  assert.deepEqual(second, first);
  assert.equal(first.descriptor.packageKey, 'tree');
  assert.equal(first.descriptor.distro.versionId, '12');
  assert.equal(first.descriptor.metadataProof.inRelease.validUntil, null);
  assert.equal(first.descriptor.metadataProof.inRelease.maximumDateAgeSeconds, 15_552_000);
  assert.equal(first.descriptor.artifact.sha256, sha(state.payload));
  assert.deepEqual(first.artifacts.map(item => item.id), ['debian-bookworm-inrelease','debian-bookworm-archive-keyring','debian-bookworm-main-amd64-packages','tree-deb-bookworm-amd64']);
  assert.doesNotMatch(JSON.stringify(first), /private|secret|token|credential/i);
});

void test('preserves present Valid-Until and rejects future, stale, and earlier-expired metadata', async t => {
  const bounded = await fixture(t, { validUntil: 'Mon, 09 Nov 2026 10:00:00 +0000' });
  const composed = await composeDebianTreeRelease(bounded.input, bounded.dependencies);
  assert.equal(composed.descriptor.metadataProof.inRelease.validUntil, '2026-11-09T10:00:00.000Z');
  assert.equal(composed.descriptor.metadataProof.inRelease.maximumDateAgeSeconds, null);

  const future = await fixture(t, { date: 'Sun, 08 Nov 2026 12:00:11 +0000' });
  await assert.rejects(composeDebianTreeRelease(future.input, future.dependencies), /10 seconds in the future/);
  const stale = await fixture(t, { date: 'Fri, 01 May 2026 00:00:00 +0000' });
  await assert.rejects(composeDebianTreeRelease(stale.input, stale.dependencies), /180-day freshness/);
  const expired = await fixture(t, { validUntil: 'Sun, 08 Nov 2026 11:59:59 +0000' });
  await assert.rejects(composeDebianTreeRelease(expired.input, expired.dependencies), /expired/);
});

void test('fails closed on signer, package identity, payload, expiry, control, and unsafe input authority', async t => {
  /** @type {((state: Awaited<ReturnType<typeof fixture>>) => void | Promise<void>)[]} */
  const cases = [
    s => { s.dependencies.verifier.verifyInRelease = () => Promise.resolve({ cleartext: Buffer.from(''), signingKeyFingerprint: 'B'.repeat(40) }); },
    s => { s.dependencies.verifier.verifyInRelease = () => Promise.resolve({ cleartext: Buffer.from(s.release.toString().replace('Codename: bookworm', 'Codename: trixie')), signingKeyFingerprint: fingerprint }); },
    s => { s.dependencies.verifier.verifyInRelease = () => Promise.resolve({ cleartext: Buffer.from(s.release.toString().replace('Architectures: amd64', 'Architectures: arm64')), signingKeyFingerprint: fingerprint }); },
    s => { s.input.policy.version = '9.9.9-1'; },
    async s => { await writeFile(s.paths.payload, 'substituted\n', { mode: 0o600 }); },
    s => { s.dependencies.verifier.now = () => new Date('2027-06-01T00:00:00Z'); },
    s => { s.dependencies.inspectControl = () => Promise.resolve({ control: { packageName: 'other', version: '2.1.0-1', architecture: 'amd64', depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'no', multiArch: 'absent' }, conffiles: [], members: [] }); },
    async s => { await chmod(s.paths.keyring, 0o666); },
    async s => { const path = join(s.root, 'keyring-link'); await symlink(s.paths.keyring, path); s.input.keyringPath = path; },
    async s => { const path = join(s.root, 'keyring-directory'); await mkdir(path); s.input.keyringPath = path; },
    async s => { const path = join(s.root, 'Packages.gz'); await writeFile(path, await readFile(s.paths.packages), { mode: 0o600 }); s.input.packagesPath = path; },
  ];
  for (const mutate of cases) {
    const state = await fixture(t); await mutate(state);
    await assert.rejects(composeDebianTreeRelease(state.input, state.dependencies));
  }
});

void test('rejects undeclared dependency and noncanonical policy shapes', async t => {
  const state = await fixture(t);
  const packages = (await readFile(state.paths.packages, 'utf8')).replace('libc6 (>= 2.34)', 'libc6 (>= 2.36)');
  await writeFile(state.paths.packages, packages, { mode: 0o600 });
  state.dependencies.verifier.decompressPackages = () => Promise.resolve(Buffer.from(packages));
  await assert.rejects(composeDebianTreeRelease(state.input, state.dependencies), /libc6/);
  const fresh = await fixture(t);
  const input = { ...fresh.input, policy: { ...fresh.input.policy, extra: true } };
  await assert.rejects(composeDebianTreeRelease(input, fresh.dependencies), /invalid shape/);
});
