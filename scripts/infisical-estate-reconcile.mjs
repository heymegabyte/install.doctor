#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
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
export const defaultSecretStores = [
  { id: 'general', directory: defaultSecretDirectories[0], precedence: 10, hostDefault: true, workloadKinds: ['host', 'workload'] },
  { id: 'workstation', directory: defaultSecretDirectories[1], precedence: 20, hostDefault: true, workloadKinds: ['host'] },
  { id: 'wordpress', directory: join(homedir(), '.local/share/chezmoi/home/.chezmoitemplates/secrets-wordpress'), precedence: 0, hostDefault: false, workloadKinds: ['wordpress-site'] },
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
    if (value === 'plan' || value === 'apply' || value === 'list') options.command = value;
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

function normalizeStore(store) {
  if (!store || !/^[a-z][a-z0-9-]{0,63}$/.test(store.id ?? '') || typeof store.directory !== 'string') {
    fail('invalid or undeclared secret store');
  }
  const directory = resolve(store.directory);
  if (directory !== store.directory) fail(`secret store ${store.id} must use an absolute normalized path`);
  return { ...store, directory };
}

export function inventorySecretSources(secretStores) {
  const stores = secretStores.map(normalizeStore);
  if (new Set(stores.map(({ id }) => id)).size !== stores.length) fail('duplicate secret store id');
  const sources = [];
  const sourceIds = new Set();
  for (const store of [...stores].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!existsSync(store.directory)) continue;
    const storeStat = lstatSync(store.directory);
    if (storeStat.isSymbolicLink() || !storeStat.isDirectory()) fail(`secret store ${store.id} is not a regular directory`);
    const storeRoot = realpathSync(store.directory);
    for (const filename of readdirSync(storeRoot).sort()) {
      const candidate = join(storeRoot, filename);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) fail(`secret source ${store.id}:${filename} is a symlink`);
      if (!stat.isFile()) continue;
      if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(filename)) fail(`secret source ${store.id}:${filename} has an invalid canonical name`);
      const normalizedPath = realpathSync(candidate);
      if (normalizedPath !== candidate || dirname(normalizedPath) !== storeRoot) fail(`secret source ${store.id}:${filename} escapes its store`);
      const sourceId = `${store.id}:${filename}`;
      if (sourceIds.has(sourceId)) fail(`duplicate secret source id ${sourceId}`);
      sourceIds.add(sourceId);
      const ciphertext = readFileSync(normalizedPath);
      const ciphertextSha256 = createHash('sha256').update(ciphertext).digest('hex');
      ciphertext.fill(0);
      sources.push({
        sourceId,
        store: store.id,
        canonicalName: filename,
        normalizedPath,
        ciphertextSha256,
        precedence: Number.isSafeInteger(store.precedence) ? store.precedence : 0,
        aliasOf: null,
        hostDefault: store.hostDefault === true,
        workloadKinds: [...(store.workloadKinds ?? [])].sort(),
      });
    }
  }
  return sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function metadataOnlyListing(secretStores) {
  const sources = inventorySecretSources(secretStores);
  return {
    schemaVersion: 1,
    sourceCount: sources.length,
    stores: [...new Set(sources.map(({ store }) => store))].sort(),
    sources,
  };
}

export function validateClosedSetSync({
  listing, manifest, ledger, offlineExceptions, destinationEvidence = [], retirementAssertions = [],
}) {
  if (listing?.schemaVersion !== 1 || !Array.isArray(listing.sources)) fail('invalid metadata listing');
  validateManifest(manifest);
  const sourceIds = new Set();
  const canonicalNames = new Set();
  for (const source of listing.sources) {
    if (sourceIds.has(source.sourceId)) fail(`duplicate secret source id ${source.sourceId}`);
    if (source.sourceId !== `${source.store}:${source.canonicalName}`) fail(`ambiguous secret source id ${source.sourceId}`);
    if (source.store === 'wordpress' && source.hostDefault) fail(`WordPress source ${source.sourceId} cannot enter host defaults`);
    sourceIds.add(source.sourceId);
    canonicalNames.add(source.canonicalName);
  }
  for (const [target, configuration] of [...Object.entries(manifest.hosts), ...Object.entries(manifest.workloads)]) {
    if (!manifest.profiles[configuration.profile]) fail(`target ${target} references an unknown profile`);
  }
  const targets = new Set([...Object.keys(manifest.hosts), ...Object.keys(manifest.workloads)]);
  if (ledger?.schemaVersion !== 1 || typeof ledger.records !== 'object') fail('invalid validation ledger');
  for (const name of Object.keys(ledger.records)) if (!canonicalNames.has(name)) fail(`validation ledger references unknown secret ${name}`);
  if (offlineExceptions?.schemaVersion !== 1 || !Array.isArray(offlineExceptions.exceptions)) fail('invalid offline exception inventory');
  for (const exception of offlineExceptions.exceptions) {
    for (const sourceId of exception.sourceIds ?? []) if (!sourceIds.has(sourceId)) fail(`offline exception ${exception.id} references unknown source ${sourceId}`);
    for (const observedPath of exception.observedLocations ?? []) {
      const matches = listing.sources.filter(({ normalizedPath }) => normalizedPath.endsWith(`/${observedPath.split('/').slice(-2).join('/')}`));
      if (matches.length !== 1) fail(`offline exception ${exception.id} has an ambiguous or unknown source path`);
    }
  }
  for (const [artifactType, artifacts] of [['destination evidence', destinationEvidence], ['retirement assertion', retirementAssertions]]) {
    if (!Array.isArray(artifacts)) fail(`invalid ${artifactType} collection`);
    const artifactIds = new Set();
    for (const artifact of artifacts) {
      if (typeof artifact.id !== 'string' || artifactIds.has(artifact.id)) fail(`duplicate or missing ${artifactType} id`);
      artifactIds.add(artifact.id);
      const source = listing.sources.find(({ sourceId }) => sourceId === artifact.sourceId);
      if (!source || (artifact.canonicalName && artifact.canonicalName !== source.canonicalName)) {
        fail(`${artifactType} ${artifact.id} references an unknown or mismatched source`);
      }
      if (artifact.target && !targets.has(artifact.target)) fail(`${artifactType} ${artifact.id} references unknown target ${artifact.target}`);
      if (source.store === 'wordpress' && artifact.targetKind === 'host') {
        fail(`${artifactType} ${artifact.id} routes a WordPress source to a host default`);
      }
    }
  }
  return true;
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
  if (options.command === 'list') {
    if (options.host || options.workload || options.projectId || options.secretDirectoriesOverridden || options.secretNames.length > 0) {
      fail('list does not accept target, project, directory, or name selectors');
    }
    process.stdout.write(`${JSON.stringify(metadataOnlyListing(defaultSecretStores), null, 2)}\n`);
    return;
  }
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
