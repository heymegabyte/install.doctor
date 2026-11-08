import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
});
