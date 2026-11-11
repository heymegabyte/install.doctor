#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [leftInput, rightInput, outputInput] = process.argv.slice(2);
if (!leftInput || !rightInput || !outputInput) throw new Error('usage: compare-release-reproducibility.mjs LEFT RIGHT RECEIPT');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inspect = (input) => {
  const directory = resolve(input);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('comparison root must be a real directory');
  const root = realpathSync(directory);
  const result = {};
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error(`unsafe comparison artifact: ${name}`);
    result[name] = { sha256: digest(readFileSync(path)), size: entry.size };
  }
  return result;
};
const left = inspect(leftInput);
const right = inspect(rightInput);
if (JSON.stringify(left) !== JSON.stringify(right)) {
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const differences = names.filter((name) => JSON.stringify(left[name]) !== JSON.stringify(right[name]));
  throw new Error(`unexplained reproducibility divergence: ${differences.join(', ')}`);
}
const receipt = { schemaVersion: 1, kind: 'desktop-tools-release-reproducibility', result: 'identical', artifacts: left };
writeFileSync(resolve(outputInput), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: 'PASS', artifacts: Object.keys(left).length, receiptSha256: digest(readFileSync(resolve(outputInput))) })}\n`);
