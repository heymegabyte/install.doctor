#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderProductStatusMarkdown } from '../packages/aid-core/dist/product-identity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/desktop-tools/status.md');
const expected = renderProductStatusMarkdown();

if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== expected) {
    console.error('Desktop Tools status is stale. Run: npm run generate:desktop-tools-status');
    process.exitCode = 1;
  }
} else {
  await writeFile(output, expected, { encoding: 'utf8', mode: 0o644 });
}
