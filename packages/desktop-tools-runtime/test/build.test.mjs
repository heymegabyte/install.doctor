import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('build emits byte-for-byte deterministic signed-closure inputs', async () => {
  assert.equal(spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root }).status, 0);
  const firstSupervisor = await readFile(resolve(root, 'dist/desktop-tools-supervisor.mjs'));
  const firstTools = await readFile(resolve(root, 'dist/desktop-tools-tools.tar.gz'));
  assert.equal(spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root }).status, 0);
  assert.equal(hash(await readFile(resolve(root, 'dist/desktop-tools-supervisor.mjs'))), hash(firstSupervisor));
  assert.equal(hash(await readFile(resolve(root, 'dist/desktop-tools-tools.tar.gz'))), hash(firstTools));
  assert.ok(firstSupervisor.length > 0);
  assert.ok(firstTools.length > 0);
  assert.match(gunzipSync(firstTools).toString('utf8'), /runtime\/encrypted-recording\.mjs/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /runtime\/durable-session\.mjs/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /contracts\/opencode-host-compatibility\.json/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /provisioning\/home\/dot_local\/bin\/executable_installx/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /provisioning\/home\/dot_config\/system\/usr\/local\/bin\/executable_process-software-groups/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /provisioning\/home\/dot_config\/system\/usr\/local\/bin\/executable_process-software-post-scripts/);
  assert.match(gunzipSync(firstTools).toString('utf8'), /provisioning\/home\/dot_local\/bin\/post-installx\/executable_post-/);
  assert.doesNotMatch(firstSupervisor.toString('utf8'), /from '\.\/session-evidence\.mjs'/);
  const state = await mkdtemp(resolve(tmpdir(), 'desktop-tools-bundled-supervisor-'));
  assert.equal(spawnSync(process.execPath, [resolve(root, 'dist/desktop-tools-supervisor.mjs'), 'prepare', '--state-dir', state]).status, 0);
});
