import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const esbuild = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');

function build(output) {
  execFileSync(esbuild, [
    'src/cli.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22',
    '--legal-comments=none', '--charset=utf8', '--minify-syntax', '--minify-whitespace', `--outfile=${output}`,
  ], { cwd: root, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' });
  return readFileSync(output);
}

function buildWorker(output) {
  execFileSync(esbuild, [
    'src/privileged-broker-worker.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22',
    '--legal-comments=none', '--charset=utf8', '--minify-syntax', '--minify-whitespace', `--outfile=${output}`,
  ], { cwd: root, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' });
  return readFileSync(output);
}

function buildController(output) {
  execFileSync(esbuild, [
    'src/privileged-broker-controller.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22',
    '--legal-comments=none', '--charset=utf8', '--minify-syntax', '--minify-whitespace', `--outfile=${output}`,
  ], { cwd: root, env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' });
  return readFileSync(output);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('self-contained engine artifact is byte-for-byte deterministic', () => {
  const directory = mkdtempSync(join(tmpdir(), 'install-doctor-engine-bundle-'));
  try {
    const first = build(join(directory, 'first.mjs'));
    const second = build(join(directory, 'second.mjs'));
    assert.equal(digest(first), digest(second));
    assert.match(first.toString('utf8', 0, 64), /^#!\/usr\/bin\/env node/);
    assert.doesNotMatch(first.toString('utf8'), /from ["'][^n][^o][^d][^e][^:]/);
    assert.ok(first.length < 2_000_000, `bundle is unexpectedly large: ${first.length}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('self-contained engine artifact runs without node_modules resolution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'install-doctor-engine-run-'));
  try {
    const artifact = join(directory, 'engine.mjs');
    build(artifact);
    chmodSync(artifact, 0o700);
    const invocation = join(directory, 'invocation.json');
    writeFileSync(invocation, JSON.stringify({
      schemaVersion: 1,
      command: 'validate',
      runId: 'bundle-test',
      releaseId: 'release-test',
      facts: {
        schemaVersion: 1, hostId: 'bundle-host', collectedAt: '2026-01-01T00:00:00.000Z',
        os: 'linux', osVersion: 'test', arch: 'x64', environment: 'container',
        roles: [], packageManagers: [], capabilities: [],
      },
      desiredState: {
        schemaVersion: 1, revision: 'bundle-state', hostId: 'bundle-host',
        packages: [], services: [], consents: [], offline: true,
      },
      plan: { tasks: [], selectedTaskIds: [] },
      operations: {},
    }), { mode: 0o600 });
    const result = spawnSync(process.execPath, ['--no-addons', artifact, '--input', invocation], {
      cwd: directory, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const validated = JSON.parse(result.stdout);
    assert.equal(validated.facts.hostId, 'bundle-host');
    assert.equal(validated.desiredState.revision, 'bundle-state');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('privileged worker artifact is deterministic, self-contained, and bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-tools-privileged-worker-bundle-'));
  try {
    const first = buildWorker(join(directory, 'first.mjs'));
    const second = buildWorker(join(directory, 'second.mjs'));
    assert.equal(digest(first), digest(second));
    assert.match(first.toString('utf8', 0, 64), /^#!\/usr\/bin\/env node/);
    assert.ok(first.length < 2_000_000, `worker bundle is unexpectedly large: ${first.length}`);
    assert.doesNotMatch(first.toString('utf8'), /from ["'][^n][^o][^d][^e][^:]/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('privileged controller artifact is deterministic, self-contained, and bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-tools-privileged-controller-bundle-'));
  try {
    const first = buildController(join(directory, 'first.mjs'));
    const second = buildController(join(directory, 'second.mjs'));
    assert.equal(digest(first), digest(second));
    assert.match(first.toString('utf8', 0, 64), /^#!\/usr\/bin\/env node/);
    assert.ok(first.length < 2_000_000, `controller bundle is unexpectedly large: ${first.length}`);
    assert.doesNotMatch(first.toString('utf8'), /from ["'][^n][^o][^d][^e][^:]/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
