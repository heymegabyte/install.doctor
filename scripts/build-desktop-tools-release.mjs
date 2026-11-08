#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { renderBootstrap } from '../packages/control-plane/src/bootstrap.ts';

const { z } = createRequire(new URL('../packages/control-plane/package.json', import.meta.url))('zod');

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const regularPath = z.string().min(1).max(4096);
const Configuration = z.strictObject({
  releaseId: id, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  createdAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
  signerId: z.string().regex(/^desktop-[a-z0-9][a-z0-9._-]{0,119}$/),
  signerPublicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  runtimeNodeVersion: z.string().regex(/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
  provisioner: regularPath, engine: regularPath, catalog: regularPath,
  runtimes: z.strictObject({ macos_x64: regularPath, macos_arm64: regularPath, linux_x64: regularPath, linux_arm64: regularPath }),
  outputDirectory: regularPath
});
const limits = { provisioner: 8_388_608, engine: 8_388_608, catalog: 8_388_608, launcher: 8_388_608, runtime: 100_663_296 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function input(pathInput, maximum, label) {
  const path = resolve(pathInput);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum) throw new Error(`${label} is not one safe bounded regular file`);
  return { path, bytes: await readFile(path) };
}

export async function buildDesktopToolsRelease(configurationInput, now = Math.floor(Date.now() / 1_000)) {
  const config = Configuration.parse(configurationInput);
  if (!Number.isSafeInteger(now) || config.createdAt > now + 300 || config.expiresAt <= now
    || config.createdAt >= config.expiresAt || config.expiresAt - config.createdAt > 604_800) {
    throw new Error('release validity window is not current and bounded');
  }
  const output = resolve(config.outputDirectory);
  const parent = dirname(output);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('output parent is unsafe');
  try { await lstat(output); throw new Error('refusing to overwrite release output'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const sources = {
    'provision.sh': await input(config.provisioner, limits.provisioner, 'provisioner'),
    'desktop-tools-engine.mjs': await input(config.engine, limits.engine, 'engine'),
    'catalog.json': await input(config.catalog, limits.catalog, 'catalog'),
    'node-macos-x64.tar.gz': await input(config.runtimes.macos_x64, limits.runtime, 'macOS x64 runtime'),
    'node-macos-arm64.tar.gz': await input(config.runtimes.macos_arm64, limits.runtime, 'macOS arm64 runtime'),
    'node-linux-x64.tar.gz': await input(config.runtimes.linux_x64, limits.runtime, 'Linux x64 runtime'),
    'node-linux-arm64.tar.gz': await input(config.runtimes.linux_arm64, limits.runtime, 'Linux arm64 runtime')
  };
  JSON.parse(sources['catalog.json'].bytes.toString('utf8'));
  const origin = 'https://desktop.tools';
  const launcher = Buffer.from(renderBootstrap({
    product: 'desktop-tools', manifestUrl: `${origin}/releases/${config.releaseId}/manifest`,
    signatureUrl: `${origin}/releases/${config.releaseId}/manifest.sig`,
    signerIdentity: config.signerId, signerPublicKey: config.signerPublicKey
  }), 'utf8');
  if (launcher.byteLength > limits.launcher) throw new Error('launcher exceeds size policy');
  const artifacts = [
    ['artifact','provision.sh', sources['provision.sh'].bytes],
    ['engine','desktop-tools-engine.mjs', sources['desktop-tools-engine.mjs'].bytes],
    ['catalog','catalog.json', sources['catalog.json'].bytes], ['launcher','start',launcher],
    ['runtime_macos_x64','node-macos-x64.tar.gz',sources['node-macos-x64.tar.gz'].bytes],
    ['runtime_macos_arm64','node-macos-arm64.tar.gz',sources['node-macos-arm64.tar.gz'].bytes],
    ['runtime_linux_x64','node-linux-x64.tar.gz',sources['node-linux-x64.tar.gz'].bytes],
    ['runtime_linux_arm64','node-linux-arm64.tar.gz',sources['node-linux-arm64.tar.gz'].bytes]
  ];
  const lines = ['schema_version=6', 'product_id=desktop-tools', `release_id=${config.releaseId}`,
    `source_commit=${config.sourceCommit}`, `created_at=${config.createdAt}`, `expires_at=${config.expiresAt}`,
    `key_id=${config.signerId}`, 'engine_node_min=22', `runtime_node_version=${config.runtimeNodeVersion}`];
  for (const [prefix, filename, bytes] of artifacts) lines.push(
    `${prefix}_url=${origin}/releases/${config.releaseId}/${filename}`,
    `${prefix}_sha256=${sha256(bytes)}`, `${prefix}_size=${bytes.byteLength}`
  );
  const manifest = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  if (manifest.byteLength > 16_384) throw new Error('manifest exceeds size policy');

  const stage = await mkdtemp(join(parent, '.desktop-tools-unsigned-'));
  await chmod(stage, 0o700);
  try {
    for (const [filename, source] of Object.entries(sources)) {
      await copyFile(source.path, join(stage, filename));
      await chmod(join(stage, filename), filename.endsWith('.sh') || filename.endsWith('.mjs') ? 0o700 : 0o600);
    }
    await writeFile(join(stage, 'start'), launcher, { mode: 0o700, flag: 'wx' });
    await writeFile(join(stage, 'manifest'), manifest, { mode: 0o600, flag: 'wx' });
    await rename(stage, output);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ schemaVersion: 1, product: 'desktop-tools', releaseId: config.releaseId,
    outputDirectory: output, manifestSha256: sha256(manifest) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [configurationPath] = process.argv.slice(2);
  if (!configurationPath) { process.stderr.write('usage: build-desktop-tools-release.mjs CONFIG.json\n'); process.exitCode = 64; }
  else buildDesktopToolsRelease(JSON.parse(await readFile(resolve(configurationPath), 'utf8')))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`build-desktop-tools-release: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
}
