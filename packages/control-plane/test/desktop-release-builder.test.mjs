import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDesktopToolsRelease } from '../../../scripts/build-desktop-tools-release.mjs';
import { publishDesktopRelease } from '../scripts/desktop-release-publication.mjs';

test('builds deterministic unsigned Desktop Tools v6 release input without a signing key', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-builder-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {};
  for (const name of ['provision.sh','engine.mjs','catalog.json','macos-x64','macos-arm64','linux-x64','linux-arm64']) {
    paths[name] = join(root, name);
    await writeFile(paths[name], name === 'catalog.json' ? '[]\n' : `${name}\n`, { mode: 0o600 });
  }
  const now = Math.floor(Date.now() / 1_000);
  const base = {
    releaseId: 'desktop-test-1', sourceCommit: 'a'.repeat(40), createdAt: now - 1, expiresAt: now + 86_400,
    signerId: 'desktop-production-1',
    signerPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    runtimeNodeVersion: '24.11.0', provisioner: paths['provision.sh'], engine: paths['engine.mjs'], catalog: paths['catalog.json'],
    runtimes: { macos_x64: paths['macos-x64'], macos_arm64: paths['macos-arm64'], linux_x64: paths['linux-x64'], linux_arm64: paths['linux-arm64'] }
  };
  const first = await buildDesktopToolsRelease({ ...base, outputDirectory: join(root, 'out-1') }, now);
  const second = await buildDesktopToolsRelease({ ...base, outputDirectory: join(root, 'out-2') }, now);
  const expected = ['catalog.json','desktop-tools-engine.mjs','manifest','node-linux-arm64.tar.gz','node-linux-x64.tar.gz','node-macos-arm64.tar.gz','node-macos-x64.tar.gz','provision.sh','start'];
  assert.deepEqual((await readdir(first.outputDirectory)).sort(), expected);
  assert.deepEqual(await readFile(join(first.outputDirectory, 'manifest')), await readFile(join(second.outputDirectory, 'manifest')));
  assert.deepEqual(await readFile(join(first.outputDirectory, 'start')), await readFile(join(second.outputDirectory, 'start')));
  const manifest = await readFile(join(first.outputDirectory, 'manifest'), 'utf8');
  assert.match(manifest, /^schema_version=6$/m);
  assert.match(manifest, /^product_id=desktop-tools$/m);
  assert.match(manifest, /engine_url=https:\/\/desktop\.tools\/releases\/desktop-test-1\/desktop-tools-engine\.mjs/);
  assert.equal((await readdir(first.outputDirectory)).includes('manifest.sig'), false);
  await assert.rejects(buildDesktopToolsRelease({ ...base, outputDirectory: first.outputDirectory }, now), /overwrite/);
});

test('isolated signer verifies bindings, matching trust root, and Desktop Tools SSHSIG namespace', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-signer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateKey = join(root, 'signer');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKey]);
  await chmod(privateKey, 0o600);
  const publicKey = execFileSync('ssh-keygen', ['-y', '-f', privateKey], { encoding: 'utf8' }).trim();
  const paths = {};
  for (const name of ['provision.sh','engine.mjs','catalog.json','macos-x64','macos-arm64','linux-x64','linux-arm64']) {
    paths[name] = join(root, name); await writeFile(paths[name], name === 'catalog.json' ? '[]\n' : `${name}\n`);
  }
  const now = Math.floor(Date.now() / 1_000);
  const unsigned = join(root, 'unsigned');
  await buildDesktopToolsRelease({ releaseId: 'desktop-signed-1', sourceCommit: 'b'.repeat(40), createdAt: now - 1,
    expiresAt: now + 86_400, signerId: 'desktop-production-1', signerPublicKey: publicKey,
    runtimeNodeVersion: '24.11.0', provisioner: paths['provision.sh'], engine: paths['engine.mjs'], catalog: paths['catalog.json'],
    runtimes: { macos_x64: paths['macos-x64'], macos_arm64: paths['macos-arm64'], linux_x64: paths['linux-x64'], linux_arm64: paths['linux-arm64'] },
    outputDirectory: unsigned }, now);
  const signed = join(root, 'signed');
  execFileSync('bash', ['../../../scripts/sign-desktop-tools-release.sh', 'desktop-production-1', privateKey, unsigned, signed], { cwd: new URL('.', import.meta.url).pathname });
  assert.equal((await readdir(signed)).includes('manifest.sig'), true);
  const allowed = join(root, 'allowed'); await writeFile(allowed, `desktop-production-1 ${publicKey}\n`);
  execFileSync('ssh-keygen', ['-Y','verify','-f',allowed,'-I','desktop-production-1','-n','desktop.tools.release','-s',join(signed,'manifest.sig')], { input: await readFile(join(signed,'manifest')) });
  const objects = new Map();
  const published = await publishDesktopRelease({ directory: signed, expectedReleaseId: 'desktop-signed-1',
    storage: { async create(key, bytes) { if (objects.has(key)) return false; objects.set(key, { bytes: Buffer.from(bytes) }); return true; }, async read(key) { return objects.get(key) ?? null; } },
    verifySignature: async ({ manifest, signature, signerId, namespace }) => {
      assert.equal(namespace, 'desktop.tools.release');
      execFileSync('ssh-keygen', ['-Y','verify','-f',allowed,'-I',signerId,'-n',namespace,'-s',join(signed,'manifest.sig')], { input: manifest });
      assert.deepEqual(Buffer.from(signature), await readFile(join(signed, 'manifest.sig')));
    }, now });
  assert.equal(published.releaseId, 'desktop-signed-1');
});
