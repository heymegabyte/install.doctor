#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isolated = 'debian-native-composition.test.mjs';
const files = (await readdir(join(root, 'test')))
  .filter(name => name.endsWith('.test.mjs') && name !== isolated)
  .sort()
  .map(name => join('test', name));

function run(argumentsInput) {
  const result = spawnSync(process.execPath, argumentsInput, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.stderr.write(`control-plane test process terminated by ${result.signal}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// This composition test imports the release-builder boundary outside the
// package. Node 24 workers have repeatedly terminated it before its first
// assertion only when it shares a multi-file test process; 100 isolated runs
// are stable. Keep the ordinary suite parallel and give that boundary one
// separate process so a worker-level failure cannot be misreported as a test
// assertion or hidden by a retry.
run(['--test', '--test-concurrency=4', ...files]);
run(['--test', join('test', isolated)]);
