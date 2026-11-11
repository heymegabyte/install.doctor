#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRevocation, validateRootRotation } from './lib/release-metadata.mjs';

const args = process.argv.slice(2);
const read = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`);
  return JSON.parse(readFileSync(resolve(args[index + 1]), 'utf8'));
};
const option = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
try {
  const currentRoot = read('--current-root');
  const nextRoot = read('--next-root');
  const revocation = read('--revocation');
  const now = option('--now');
  const rotation = validateRootRotation(currentRoot, nextRoot, { now });
  const revoked = validateRevocation(revocation, nextRoot, { now });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', rotation, revocation: revoked })}\n`);
} catch (error) {
  process.stderr.write(`release key ceremony rejected: ${error.message}\n`);
  process.exitCode = 1;
}
