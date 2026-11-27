#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error(`verify-infisical-secret-presence: ${message}`);
}

export function classifyInfisicalGetPayload(payload, sentinelName, requestedNames) {
  if (!Array.isArray(payload)) fail('Infisical returned a non-array payload');
  const values = new Map();
  for (const entry of payload) {
    if (!entry || typeof entry.secretKey !== 'string' || typeof entry.secretValue !== 'string') {
      fail('Infisical returned an invalid secret entry');
    }
    if (values.has(entry.secretKey)) fail(`Infisical returned duplicate key ${entry.secretKey}`);
    values.set(entry.secretKey, Buffer.from(entry.secretValue));
  }
  const missing = values.get(sentinelName);
  if (!missing) fail('Infisical omitted the missing-name sentinel');
  const present = [];
  const absent = [];
  for (const name of requestedNames) {
    const value = values.get(name);
    if (!value) fail(`Infisical omitted requested key ${name}`);
    const isPlaceholder = value.length === missing.length && timingSafeEqual(value, missing);
    (isPlaceholder ? absent : present).push(name);
  }
  for (const value of values.values()) value.fill(0);
  return { present: present.sort(), absent: absent.sort() };
}

function parseArguments(args) {
  const options = { names: [], environment: 'prod', secretPath: '/' };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--project-id') options.projectId = args[++index];
    else if (value === '--env') options.environment = args[++index];
    else if (value === '--path') options.secretPath = args[++index];
    else if (value === '--name') options.names.push(args[++index]);
    else fail(`unknown argument ${value}`);
  }
  if (!/^[0-9a-f-]{36}$/.test(options.projectId ?? '')) fail('missing or invalid --project-id');
  if (!/^[a-z0-9_-]+$/.test(options.environment ?? '')) fail('invalid --env');
  if (!options.secretPath?.startsWith('/')) fail('invalid --path');
  if (options.names.length === 0 || new Set(options.names).size !== options.names.length
    || options.names.some((name) => !/^[A-Z][A-Z0-9_]{0,127}$/.test(name))) fail('invalid or duplicate --name');
  return options;
}

function main(args) {
  const options = parseArguments(args);
  const sentinelName = `INFISICAL_MISSING_SENTINEL_${randomBytes(12).toString('hex').toUpperCase()}`;
  const result = spawnSync('infisical', [
    'secrets', 'get', ...options.names, sentinelName,
    '--projectId', options.projectId, '--env', options.environment, '--path', options.secretPath,
    '--output', 'json', '--silent', '--telemetry=false',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) fail('Infisical get failed');
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { fail('Infisical returned invalid JSON'); }
  const classification = classifyInfisicalGetPayload(payload, sentinelName, options.names);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...classification }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
