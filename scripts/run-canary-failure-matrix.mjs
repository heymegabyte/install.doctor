#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const childEnvironment = Object.freeze(Object.fromEntries([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])));
const scenarios = Object.freeze([
  ['denial', 'packages/installer-engine/test/engine.test.mjs', 'approval denial and invalid desired state cannot mutate'],
  ['expiry', 'packages/control-plane/test/broker-approval-signer.test.mjs', 'rejects expired grants and expired or not-yet-valid delegations before signing'],
  ['replay', 'packages/control-plane/test/broker-approval-signer.test.mjs', 'atomically denies replay even when the reconstructed state remains approved'],
  ['profile-race', 'packages/control-plane/test/owner-approval.test.mjs', 'owner decision rejects a mismatched code and stale profile revision'],
  ['provider-outage', 'packages/installer-engine/test/engine.test.mjs', 'provider outage, telemetry timeout, and telemetry observer failure preserve the authoritative terminal receipt'],
  ['hosted-service-outage', 'packages/control-plane/test/release-publication.test.mjs', 'post-CAS receipt failure reports activated receipt pending without repeating activation'],
  ['recording-failure', 'packages/aid-core/test/core.test.mjs', 'recording propagates storage errors rather than claiming success'],
  ['telemetry-timeout', 'packages/installer-engine/test/telemetry.test.mjs', 'transport failure and timeout are fail-open bounded outcomes'],
  ['rollback-modified-target', 'packages/installer-engine/test/cli.test.mjs', 'rollback-config CLI derives an identity-only stable plan, resumes explicitly, and rejects replay'],
]);

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]; const value = process.argv[index + 1];
  if (!key?.startsWith('--') || value === undefined || values.has(key)) throw new Error('usage: run-canary-failure-matrix --release-id ID --source-commit SHA --output PATH');
  values.set(key, value);
}
if (values.size !== 3) throw new Error('usage: run-canary-failure-matrix --release-id ID --source-commit SHA --output PATH');
const releaseId = values.get('--release-id'); const sourceCommit = values.get('--source-commit'); const output = values.get('--output');
if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(releaseId ?? '') || !/^[a-f0-9]{40}$/u.test(sourceCommit ?? '') || !output) {
  throw new Error('invalid canary failure-matrix identity');
}

const outputPath = resolve(output); const outputDirectory = dirname(outputPath);
const results = [];
for (const [id, source, testName] of scenarios) {
  const sourcePath = resolve(root, source);
  if (relative(root, sourcePath).startsWith('..')) throw new Error(`scenario source escaped repository: ${id}`);
  const sourceBytes = readFileSync(sourcePath);
  const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=^${escapePattern(testName)}$`, sourcePath], {
    cwd: root, encoding: 'utf8', env: { ...childEnvironment, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }, maxBuffer: 16 * 1024 * 1024,
  });
  const transcript = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0 || !transcript.includes(testName)) {
    process.stderr.write(transcript.slice(-8_192));
    throw new Error(`canary failure scenario did not pass: ${id}`);
  }
  const transcriptPath = `failure-scenarios.${id}.tap`;
  writeFileSync(resolve(outputDirectory, transcriptPath), transcript, { mode: 0o600, flag: 'wx' });
  results.push(Object.freeze({ id, source, sourceDigest: sha256(sourceBytes), testName,
    exitStatus: result.status, transcriptPath, transcriptDigest: sha256(transcript) }));
}

const evidence = Object.freeze({ schemaVersion: 1, releaseId, sourceCommit, runtime: process.version,
  runnerDigest: sha256(readFileSync(fileURLToPath(import.meta.url))), scenarios: results });
writeFileSync(outputPath, `${JSON.stringify(evidence)}\n`, { mode: 0o600, flag: 'wx' });
