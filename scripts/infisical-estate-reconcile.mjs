#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifestPath = join(repositoryRoot, 'config/infisical/estate-secret-profiles.json');
const defaultValidationLedgerPath = join(repositoryRoot, 'config/infisical/secret-validation-ledger.json');
const defaultSecretDirectories = [
  join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets'),
  join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets-workstation'),
];

function fail(message) {
  throw new Error(`infisical-estate-reconcile: ${message}`);
}

function parseArguments(values) {
  const options = {
    command: 'plan', manifestPath: defaultManifestPath, validationLedgerPath: defaultValidationLedgerPath,
    secretDirectories: defaultSecretDirectories,
    secretDirectoriesOverridden: false, secretNames: [],
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === 'plan' || value === 'apply') options.command = value;
    else if (value === '--manifest') options.manifestPath = resolve(values[++index] ?? fail('missing manifest path'));
    else if (value === '--validation-ledger') options.validationLedgerPath = resolve(values[++index] ?? fail('missing validation ledger path'));
    else if (value === '--host') options.host = values[++index] ?? fail('missing host');
    else if (value === '--workload') options.workload = values[++index] ?? fail('missing workload');
    else if (value === '--project-id') options.projectId = values[++index] ?? fail('missing project id');
    else if (value === '--secret-directory') {
      options.secretDirectories = [resolve(values[++index] ?? fail('missing secret directory'))];
      options.secretDirectoriesOverridden = true;
    }
    else if (value === '--name') options.secretNames.push(values[++index] ?? fail('missing secret name'));
    else fail(`unknown argument ${value}`);
  }
  return options;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.hosts !== 'object' || typeof manifest.workloads !== 'object' || typeof manifest.profiles !== 'object') fail('invalid manifest');
  for (const [target, configuration] of [...Object.entries(manifest.hosts), ...Object.entries(manifest.workloads)]) {
    const expectedSecretPath = `/hosts/${target.replaceAll('.', '-')}`;
    const validProjectId = /^[0-9a-f-]{36}$/.test(configuration.projectId ?? '');
    const validSecretPath = configuration.secretPath === '/' || configuration.secretPath === expectedSecretPath;
    if (!/^[a-z0-9.-]+$/.test(target) || !manifest.profiles[configuration.profile] || !validProjectId || !validSecretPath) {
      fail(`invalid target configuration for ${target}`);
    }
  }
  return manifest;
}

export function inventorySecretNames(secretDirectories) {
  const locations = new Map();
  for (const directory of secretDirectories) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).sort()) {
      if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) continue;
      // Later, more-specific directories override the general inventory. The
      // default order intentionally lets secrets-workstation win on hosts.
      locations.set(name, join(directory, name));
    }
  }
  return locations;
}

export function secretDirectoriesForHost({ secretDirectories, secretDirectoriesOverridden }, host) {
  if (secretDirectoriesOverridden || host === 'macos.megabyte.space') return secretDirectories;
  return [secretDirectories[0]];
}

export function selectHostSecrets(manifest, host, secretNames) {
  const hostConfiguration = manifest.hosts[host];
  if (!hostConfiguration) fail(`host ${host} is not declared`);
  return selectConfigurationSecrets(manifest, hostConfiguration, secretNames);
}

export function selectConfigurationSecrets(manifest, configuration, secretNames) {
  const capabilities = manifest.profiles[configuration.profile];
  const include = capabilities.flatMap((capability) => manifest.capabilityPatterns[capability] ?? []).map((pattern) => new RegExp(pattern));
  const exclude = (manifest.alwaysExcludePatterns ?? []).map((pattern) => new RegExp(pattern));
  return [...secretNames].filter((name) => include.some((pattern) => pattern.test(name)) && !exclude.some((pattern) => pattern.test(name))).sort();
}

export function assertSecretsValidated(ledger, secretNames) {
  if (ledger?.schemaVersion !== 1 || typeof ledger.records !== 'object') fail('invalid validation ledger');
  for (const name of secretNames) {
    if (ledger.records[name]?.status !== 'valid') fail(`secret ${name} has no current valid credential evidence`);
  }
}

function writeEncryptedSecret({ encryptedPath, environment, name, projectId, secretPath }) {
  const source = readFileSync(encryptedPath);
  const isAgeEnvelope = source.subarray(0, 64).toString('utf8').startsWith('-----BEGIN AGE ENCRYPTED FILE-----');
  const decrypt = isAgeEnvelope
    ? spawnSync('chezmoi', ['decrypt'], { input: source, maxBuffer: 16 * 1024 * 1024 })
    : { status: 0, stdout: Buffer.from(source) };
  source.fill(0);
  if (decrypt.status !== 0 || decrypt.stdout.length === 0) fail(`could not decrypt ${name}`);
  const write = spawnSync('infisical', [
    'secrets', 'set', `${name}=@/dev/stdin`, '--projectId', projectId, '--env', environment,
    '--path', secretPath, '--silent', '--telemetry=false',
  ], { input: decrypt.stdout, stdio: ['pipe', 'ignore', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (write.status !== 0) fail(`Infisical rejected ${name}`);
  const readBack = spawnSync('infisical', [
    'secrets', 'get', name, '--projectId', projectId, '--env', environment,
    '--path', secretPath, '--plain', '--secret-overriding=false', '--silent', '--telemetry=false',
  ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const expected = decrypt.stdout;
  const cliOutput = readBack.stdout;
  const actual = cliOutput.at(-1) === 0x0a ? cliOutput.subarray(0, -1) : cliOutput;
  const verified = readBack.status === 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
  expected.fill(0);
  cliOutput.fill(0);
  if (!verified) fail(`Infisical round-trip verification failed for ${name}`);
}

function ensureSecretPath({ environment, projectId, secretPath }) {
  let parent = '/';
  for (const segment of secretPath.split('/').filter(Boolean)) {
    const result = spawnSync('infisical', [
      'secrets', 'folders', 'create', '--name', segment, '--path', parent,
      '--projectId', projectId, '--env', environment, '--silent', '--telemetry=false',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const error = result.stderr.toString();
    if (result.status !== 0 && !/already exists|duplicate/i.test(error)) fail(`could not ensure secret path ${secretPath}`);
    parent = `${parent === '/' ? '' : parent}/${segment}`;
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = validateManifest(JSON.parse(readFileSync(options.manifestPath, 'utf8')));
  if (options.host && options.workload) fail('--host and --workload are mutually exclusive');
  const targetKind = options.workload ? 'workload' : 'host';
  const configurations = targetKind === 'workload' ? manifest.workloads : manifest.hosts;
  const targets = options.workload ? [options.workload] : options.host ? [options.host] : Object.keys(configurations).sort();
  const inventories = new Map(targets.map((target) => {
    const directories = targetKind === 'host' ? secretDirectoriesForHost(options, target) : [options.secretDirectories[0]];
    return [target, inventorySecretNames(directories)];
  }));
  const inventoryNames = new Set([...inventories.values()].flatMap((inventory) => [...inventory.keys()]));
  const plans = targets.map((target) => ({
    target,
    targetKind,
    profile: configurations[target]?.profile,
    projectId: configurations[target]?.projectId,
    secretPath: configurations[target]?.secretPath,
    secretNames: selectConfigurationSecrets(manifest, configurations[target] ?? fail(`${targetKind} ${target} is not declared`), inventories.get(target).keys()).filter((name) => options.secretNames.length === 0 || options.secretNames.includes(name)),
  }));
  for (const name of options.secretNames) if (!inventoryNames.has(name)) fail(`selected secret ${name} is not present in the inventory`);
  if (options.command === 'plan') {
    const planKey = targetKind === 'workload' ? 'workloads' : 'hosts';
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, inventoryCount: inventoryNames.size, [planKey]: plans }, null, 2)}\n`);
    return;
  }
  const validationLedger = JSON.parse(readFileSync(options.validationLedgerPath, 'utf8'));
  assertSecretsValidated(validationLedger, plans.flatMap((plan) => plan.secretNames));
  if (options.projectId && targets.length !== 1) fail('--project-id override requires exactly one target');
  execFileSync('infisical', ['login', 'status', '--silent'], { stdio: 'ignore' });
  for (const plan of plans) {
    const projectId = options.projectId ?? plan.projectId;
    if (!projectId) fail(`${plan.targetKind} ${plan.target} has no project binding`);
    ensureSecretPath({ environment: manifest.environment, projectId, secretPath: plan.secretPath });
    for (const name of plan.secretNames) {
      writeEncryptedSecret({ encryptedPath: inventories.get(plan.target).get(name), environment: manifest.environment, name, projectId, secretPath: plan.secretPath });
    }
    process.stdout.write(`${JSON.stringify({ target: plan.target, targetKind: plan.targetKind, status: 'reconciled', secretCount: plan.secretNames.length })}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
