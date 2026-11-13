#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docsSiteRoot = resolve(scriptDir, '..');

const genResult = spawnSync(process.execPath, [join(scriptDir, 'generate-plugin-docs.mjs')], {
  cwd: docsSiteRoot,
  env: process.env,
  stdio: 'inherit',
});

if (genResult.error) {
  throw genResult.error;
}
if (genResult.status !== 0) {
  process.exit(genResult.status ?? 1);
}

if (process.env.CROWDIN_PERSONAL_TOKEN && process.env.CROWDIN_PERSONAL_TOKEN.trim().length > 0) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const crowdinResult = spawnSync(npmCmd, ['run', 'crowdin:sync'], {
    cwd: docsSiteRoot,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (crowdinResult.error) {
    throw crowdinResult.error;
  }
  if (crowdinResult.status !== 0) {
    process.exit(crowdinResult.status ?? 1);
  }
}
