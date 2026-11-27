#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyInfisicalGetPayload } from './verify-infisical-secret-presence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(`verify-infisical-ledger-destinations: ${message}`);
}

export function collectLedgerDestinations(ledger, manifest) {
  const configurations = new Map([
    ...Object.entries(manifest.hosts ?? {}),
    ...Object.entries(manifest.workloads ?? {}),
  ]);
  const targets = [...configurations.keys()].sort((left, right) => right.length - left.length);
  const expected = new Map();
  for (const [sourceId, record] of Object.entries(ledger.records ?? {})) {
    if (!sourceId.includes(':') || record.migrated !== true || record.targetRetrievalVerified !== true) continue;
    const destinations = Array.isArray(record.destination)
      ? record.destination
      : typeof record.destination === 'string' ? record.destination.split(',') : [];
    for (const destination of destinations) {
      const target = targets.find((candidate) => destination === candidate || destination.startsWith(`${candidate}:`));
      if (!target) fail(`unknown destination ${destination} for ${sourceId}`);
      const suffix = destination.slice(target.length).replace(/^:/, '');
      let resolvedTarget = target;
      if (suffix.startsWith('/') && suffix !== '/' && configurations.get(target).secretPath !== suffix) {
        const pathAlias = [...configurations.entries()].find(([, configuration]) => (
          configuration.projectId === configurations.get(target).projectId && configuration.secretPath === suffix
        ));
        if (!pathAlias) fail(`unknown destination path ${destination} for ${sourceId}`);
        [resolvedTarget] = pathAlias;
      }
      const secretName = suffix && suffix !== '/' && !suffix.startsWith('/') ? suffix : record.canonicalName;
      if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(secretName ?? '')) fail(`invalid destination name for ${sourceId}`);
      if (!expected.has(resolvedTarget)) expected.set(resolvedTarget, new Set());
      expected.get(resolvedTarget).add(secretName);
    }
  }
  return [...expected.entries()].map(([target, names]) => ({
    target,
    projectId: configurations.get(target).projectId,
    secretPath: configurations.get(target).secretPath,
    names: [...names].sort(),
  })).sort((left, right) => left.target.localeCompare(right.target));
}

function verifyTarget(destination, environment) {
  const sentinelName = `INFISICAL_MISSING_SENTINEL_${randomBytes(12).toString('hex').toUpperCase()}`;
  const result = spawnSync('infisical', [
    'secrets', 'get', ...destination.names, sentinelName,
    '--projectId', destination.projectId, '--env', environment, '--path', destination.secretPath,
    '--output', 'json', '--silent', '--telemetry=false',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) fail(`Infisical read failed for ${destination.target}`);
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { fail(`Infisical returned invalid JSON for ${destination.target}`); }
  const classification = classifyInfisicalGetPayload(payload, sentinelName, destination.names);
  if (classification.absent.length > 0) fail(`${destination.target} is missing ${classification.absent.join(', ')}`);
  return { target: destination.target, verifiedCount: classification.present.length };
}

function main(args) {
  if (args.some((argument) => argument !== '--json')) fail('unknown argument');
  const manifest = JSON.parse(readFileSync(resolve(root, 'config/infisical/estate-secret-profiles.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(resolve(root, 'config/infisical/secret-validation-ledger.json'), 'utf8'));
  const destinations = collectLedgerDestinations(ledger, manifest);
  const results = destinations.map((destination) => verifyTarget(destination, manifest.environment));
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    targetCount: results.length,
    verifiedSecretCount: results.reduce((sum, result) => sum + result.verifiedCount, 0),
    targets: results,
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
