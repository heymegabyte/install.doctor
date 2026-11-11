#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'packages/aid-core/src/software-catalog.ts');
const CONTRACT = resolve(ROOT, 'packages/aid-core/dist/software-catalog.js');

export async function validateSoftwareCatalogFile(path) {
  if (!existsSync(CONTRACT) || statSync(SOURCE).mtimeMs > statSync(CONTRACT).mtimeMs) {
    execFileSync('npm', ['run', 'build'], { cwd: resolve(ROOT, 'packages/aid-core'), stdio: 'inherit' });
  }
  const { parseSoftwareCatalog } = await import(`${pathToFileURL(CONTRACT).href}?mtime=${statSync(CONTRACT).mtimeMs}`);
  return parseSoftwareCatalog(JSON.parse(readFileSync(path, 'utf8')));
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: validate-software-catalog.mjs <catalog.json>');
  const entries = await validateSoftwareCatalogFile(path);
  process.stdout.write(`strict catalog schema: ${entries.length} v1 entries\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`strict catalog validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
