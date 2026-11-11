#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateReleaseMetadata } from './lib/release-metadata.mjs';

const args = process.argv.slice(2);
const value = (flag, required = false) => {
  const index = args.indexOf(flag);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (required && !result) throw new Error(`${flag} is required`);
  return result;
};
try {
  const metadata = JSON.parse(readFileSync(resolve(value('--metadata', true)), 'utf8'));
  const rootPath = value('--trusted-root');
  const trustedRoot = rootPath ? JSON.parse(readFileSync(resolve(rootPath), 'utf8')) : undefined;
  const expectedSubject = Object.fromEntries(['releaseId', 'platform', 'channel'].flatMap((field) => {
    const found = value(`--${field.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`);
    return found === undefined ? [] : [[field, found]];
  }));
  const result = validateReleaseMetadata(metadata, {
    trustedRoot,
    now: value('--now'),
    minimumVersion: value('--minimum-version') === undefined ? undefined : Number(value('--minimum-version')),
    expectedSubject,
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
} catch (error) {
  process.stderr.write(`release metadata rejected: ${error.message}\n`);
  process.exitCode = 1;
}
