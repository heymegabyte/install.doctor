#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifestPath = join(repositoryRoot, 'config/infisical/estate-secret-profiles.json');
const defaultValidationLedgerPath = join(repositoryRoot, 'config/infisical/secret-validation-ledger.json');
const defaultOfflineExceptionsPath = join(repositoryRoot, 'config/infisical/offline-secret-exceptions.json');
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
    offlineExceptionsPath: defaultOfflineExceptionsPath,
    secretDirectories: defaultSecretDirectories,
    secretDirectoriesOverridden: false, secretNames: [], applyRetirement: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === 'plan' || value === 'apply' || value === 'list' || value === 'retire') options.command = value;
    else if (value === '--manifest') options.manifestPath = resolve(values[++index] ?? fail('missing manifest path'));
    else if (value === '--validation-ledger') options.validationLedgerPath = resolve(values[++index] ?? fail('missing validation ledger path'));
    else if (value === '--offline-exceptions') options.offlineExceptionsPath = resolve(values[++index] ?? fail('missing offline exceptions path'));
    else if (value === '--host') options.host = values[++index] ?? fail('missing host');
    else if (value === '--workload') options.workload = values[++index] ?? fail('missing workload');
    else if (value === '--project-id') options.projectId = values[++index] ?? fail('missing project id');
    else if (value === '--secret-directory') {
      options.secretDirectories = [resolve(values[++index] ?? fail('missing secret directory'))];
      options.secretDirectoriesOverridden = true;
    }
    else if (value === '--name') options.secretNames.push(values[++index] ?? fail('missing secret name'));
    else if (value === '--source') {
      if (options.sourceId) fail('--source may be specified only once');
      options.sourceId = values[++index] ?? fail('missing source id');
    }
    else if (value === '--apply') options.applyRetirement = true;
    else fail(`unknown argument ${value}`);
  }
  return options;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.hosts !== 'object' || typeof manifest.workloads !== 'object' || typeof manifest.profiles !== 'object') fail('invalid manifest');
  for (const [target, configuration] of [...Object.entries(manifest.hosts), ...Object.entries(manifest.workloads)]) {
    const expectedSecretPath = `/hosts/${target.replaceAll('.', '-')}`;
    const validProjectId = /^[0-9a-f-]{36}$/.test(configuration.projectId ?? '');
    const workload = Object.hasOwn(manifest.workloads, target);
    const normalizedWorkloadPath = /^\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/.test(configuration.secretPath ?? '')
      && !configuration.secretPath.split('/').some((segment) => segment === '.' || segment === '..');
    const validSecretPath = configuration.secretPath === '/'
      || configuration.secretPath === expectedSecretPath
      || workload && normalizedWorkloadPath;
    if (!/^[a-z0-9.-]+$/.test(target) || !manifest.profiles[configuration.profile] || !validProjectId || !validSecretPath) {
      fail(`invalid target configuration for ${target}`);
    }
  }
  for (const [host, configuration] of Object.entries(manifest.hosts)) {
    if (configuration.sourceStore !== undefined) fail(`host ${host} cannot declare a workload source store`);
  }
  for (const [workload, configuration] of Object.entries(manifest.workloads)) {
    const sourceStore = configuration.sourceStore ?? 'general';
    if (!['general', 'wordpress'].includes(sourceStore)) fail(`workload ${workload} has an invalid source store`);
  }
  const reservedNames = manifest.reservedNames ?? [];
  const exactCapabilityNames = manifest.exactCapabilityNames ?? {};
  const blockedReservedNames = manifest.blockedReservedNames ?? [];
  if (!Array.isArray(reservedNames) || !Array.isArray(blockedReservedNames) || typeof exactCapabilityNames !== 'object' || Array.isArray(exactCapabilityNames)) fail('invalid reserved-name policy');
  if (new Set(reservedNames).size !== reservedNames.length || reservedNames.some((name) => !/^[A-Z][A-Z0-9_]{0,127}$/.test(name))) {
    fail('invalid or duplicate reserved secret name');
  }
  if (new Set(blockedReservedNames).size !== blockedReservedNames.length || blockedReservedNames.some((name) => !reservedNames.includes(name))) {
    fail('invalid or duplicate blocked reserved secret name');
  }
  const exactOwners = new Map();
  for (const [capability, names] of Object.entries(exactCapabilityNames)) {
    if (!Array.isArray(names) || names.length === 0 || manifest.capabilityPatterns?.[capability]) {
      fail(`exact capability ${capability} is ambiguous`);
    }
    for (const name of names) {
      if (!reservedNames.includes(name) || exactOwners.has(name)) fail(`reserved secret ${name} has ambiguous exact capability ownership`);
      exactOwners.set(name, capability);
    }
  }
  for (const name of blockedReservedNames) if (exactOwners.has(name)) fail(`blocked reserved secret ${name} also has an exact capability owner`);
  for (const name of reservedNames) {
    if (!exactOwners.has(name) && !blockedReservedNames.includes(name)) fail(`reserved secret ${name} has no exact capability owner or blocked disposition`);
  }
  for (const capabilities of Object.values(manifest.profiles)) {
    for (const capability of capabilities) {
      if (!manifest.capabilityPatterns?.[capability] && !exactCapabilityNames[capability]) fail(`profile references unknown capability ${capability}`);
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
  validateValidationLedger(ledger, listing.sources);
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

export function secretStoresForTarget(options, targetKind, target, manifest) {
  if (options.secretDirectoriesOverridden) {
    return [{ id: 'general', directory: options.secretDirectories[0], precedence: 10, hostDefault: true, workloadKinds: [targetKind] }];
  }
  if (targetKind === 'workload') {
    const sourceStore = manifest?.workloads?.[target]?.sourceStore ?? 'general';
    const store = defaultSecretStores.find(({ id }) => id === sourceStore);
    if (!store || !store.workloadKinds.includes(sourceStore === 'wordpress' ? 'wordpress-site' : 'workload')) {
      fail(`workload ${target} has no approved source store`);
    }
    return [store];
  }
  if (target !== 'macos.megabyte.space') return [defaultSecretStores[0]];
  return defaultSecretStores.filter(({ id }) => id === 'general' || id === 'workstation');
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
  const reserved = new Set(manifest.reservedNames ?? []);
  const exact = new Set(capabilities.flatMap((capability) => manifest.exactCapabilityNames?.[capability] ?? []));
  return [...secretNames].filter((name) => (
    !exclude.some((pattern) => pattern.test(name))
    && (exact.has(name) || !reserved.has(name) && include.some((pattern) => pattern.test(name)))
  )).sort();
}

export function selectConfigurationSources(manifest, configuration, sources) {
  const allowedNames = new Set(selectConfigurationSecrets(manifest, configuration, sources.map(({ canonicalName }) => canonicalName)));
  const candidates = sources.filter(({ canonicalName }) => allowedNames.has(canonicalName));
  const selected = new Map();
  for (const source of candidates) {
    const current = selected.get(source.canonicalName);
    if (!current || source.precedence > current.precedence) selected.set(source.canonicalName, source);
    else if (source.precedence === current.precedence) fail(`ambiguous source precedence for ${source.canonicalName}`);
  }
  return [...selected.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function selectRequestedSources(manifest, configuration, sources, selectors = []) {
  if (selectors.length === 0) return selectConfigurationSources(manifest, configuration, sources);
  const allowedNames = new Set(selectConfigurationSecrets(manifest, configuration, sources.map(({ canonicalName }) => canonicalName)));
  const allowedSources = sources.filter(({ canonicalName }) => allowedNames.has(canonicalName));
  const selected = new Map();
  for (const selector of selectors) {
    if (selector.includes(':')) {
      const source = allowedSources.find(({ sourceId }) => sourceId === selector);
      if (!source) fail(`selected secret source ${selector} is not permitted for the target`);
      selected.set(source.sourceId, source);
      continue;
    }
    const source = selectConfigurationSources(manifest, configuration, allowedSources.filter(({ canonicalName }) => canonicalName === selector))[0];
    if (!source) fail(`selected secret ${selector} is not permitted for the target`);
    selected.set(source.sourceId, source);
  }
  return [...selected.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function validateValidationLedger(ledger, inventorySources = []) {
  if (ledger?.schemaVersion !== 1 || typeof ledger.records !== 'object') fail('invalid validation ledger');
  const sourcesById = new Map(inventorySources.map((source) => [source.sourceId, source]));
  const canonicalNames = new Set(inventorySources.map(({ canonicalName }) => canonicalName));
  for (const [key, record] of Object.entries(ledger.records)) {
    if (!record || !['valid', 'unverified', 'invalid-retired'].includes(record.status)) fail(`validation record ${key} has invalid status`);
    if (key.includes(':')) {
      const source = sourcesById.get(key);
      if (!source) {
        const [store, canonicalName, ...extra] = key.split(':');
        const retiredLifecycleEvidence = record.status === 'invalid-retired'
          || record.status === 'valid'
            && record.migrated === true
            && record.targetRetrievalVerified === true
            && (Array.isArray(record.destination) ? record.destination.length > 0 : typeof record.destination === 'string' && record.destination.length > 0);
        const retiredExactSource = extra.length === 0
          && defaultSecretStores.some(({ id }) => id === store)
          && /^[A-Z][A-Z0-9_]{0,127}$/.test(canonicalName ?? '')
          && record.sourceId === key
          && record.canonicalName === canonicalName
          && retiredLifecycleEvidence
          && record.sourceRetired === true
          && /^[a-f0-9]{64}$/.test(record.ciphertextSha256 ?? '');
        if (!retiredExactSource) fail(`validation ledger references unknown source ${key}`);
        continue;
      }
      if (record.sourceId && record.sourceId !== key) fail(`validation record ${key} has mismatched source id`);
      if (record.canonicalName && record.canonicalName !== source.canonicalName) fail(`validation record ${key} has mismatched canonical name`);
      if (record.ciphertextSha256 && record.ciphertextSha256 !== source.ciphertextSha256) fail(`validation record ${key} has stale ciphertext evidence`);
    } else if (inventorySources.length > 0 && !canonicalNames.has(key) && record.status !== 'invalid-retired' && record.sourceRetired !== true) {
      const replacedByExactRetirement = Object.values(ledger.records).some((candidate) => (
        candidate?.sourceId?.includes(':')
        && candidate.canonicalName === key
        && candidate.sourceRetired === true
      ));
      if (!replacedByExactRetirement) fail(`validation ledger references unknown secret ${key}`);
    }
  }
  return ledger;
}

export function resolveSourceValidationRecord(ledger, source, inventorySources) {
  validateValidationLedger(ledger, inventorySources);
  const qualified = ledger.records[source.sourceId];
  if (qualified) return qualified;
  const siblings = inventorySources.filter(({ canonicalName }) => canonicalName === source.canonicalName);
  if (siblings.length !== 1 && ledger.records[source.canonicalName]) {
    fail(`legacy validation evidence for ${source.canonicalName} is ambiguous across ${siblings.map(({ sourceId }) => sourceId).sort().join(', ')}`);
  }
  return ledger.records[source.canonicalName];
}

export function assertSecretSourcesValidated(ledger, selectedSources, inventorySources = selectedSources) {
  for (const source of selectedSources) {
    if (resolveSourceValidationRecord(ledger, source, inventorySources)?.status !== 'valid') {
      fail(`secret source ${source.sourceId} has no current valid credential evidence`);
    }
  }
}

export function assertSecretsValidated(ledger, secretNames) {
  validateValidationLedger(ledger);
  for (const name of secretNames) if (ledger.records[name]?.status !== 'valid') {
    fail(`secret ${name} has no current valid credential evidence`);
  }
}

function activeOfflineExceptionForSource(offlineExceptions, source) {
  if (offlineExceptions?.schemaVersion !== 1 || !Array.isArray(offlineExceptions.exceptions)) fail('invalid offline exception inventory');
  return offlineExceptions.exceptions.find((exception) => {
    if (exception.active === false || exception.status === 'retired' || exception.retiredAt) return false;
    if ((exception.sourceIds ?? []).includes(source.sourceId)) return true;
    if (exception.id === source.canonicalName) return true;
    return (exception.observedLocations ?? []).some((location) => (
      location.endsWith(`/secrets/${source.canonicalName}`) && source.store === 'general'
      || location.endsWith(`/secrets-workstation/${source.canonicalName}`) && source.store === 'workstation'
      || location.endsWith(`/secrets-wordpress/${source.canonicalName}`) && source.store === 'wordpress'
    ));
  });
}

function assertSourceInsideApprovedRoot(source, approvedStores) {
  const store = approvedStores.map(normalizeStore).find(({ id }) => id === source.store);
  if (!store || !existsSync(store.directory)) fail(`source ${source.sourceId} is outside approved roots`);
  const root = realpathSync(store.directory);
  const stat = lstatSync(source.normalizedPath);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(source.normalizedPath) !== source.normalizedPath || dirname(source.normalizedPath) !== root) {
    fail(`source ${source.sourceId} is outside approved roots`);
  }
}

export function validateRetirementEvidence({ source, ledger, inventorySources, offlineExceptions }) {
  if (!source || source.sourceId !== `${source.store}:${source.canonicalName}`) fail('retirement requires one exact store-qualified source');
  const record = ledger?.records?.[source.sourceId];
  if (!record || record.sourceId !== source.sourceId || record.canonicalName !== source.canonicalName) {
    fail(`source ${source.sourceId} has no exact retirement evidence`);
  }
  validateValidationLedger(ledger, inventorySources);
  if (record.ciphertextSha256 !== source.ciphertextSha256) fail(`source ${source.sourceId} has stale ciphertext evidence`);
  const exception = activeOfflineExceptionForSource(offlineExceptions, source);
  if (exception) fail(`source ${source.sourceId} has active offline exception ${exception.id}`);
  if (record.status === 'invalid-retired') {
    const validInvalidRetirement = record.invalidRetirement === true
      && record.providerConfirmedInvalid === true
      && Array.isArray(record.requiredDestinations) && record.requiredDestinations.length === 0
      && Array.isArray(record.requiredConsumers) && record.requiredConsumers.length === 0;
    if (!validInvalidRetirement) fail(`source ${source.sourceId} has invalid status without complete invalid-retirement evidence`);
    return { record, evidenceKind: 'invalid-retirement', destinations: [] };
  }
  if (record.status !== 'valid') fail(`source ${source.sourceId} is not valid for retirement`);
  const destinations = Array.isArray(record.destination) ? record.destination : record.destination ? [record.destination] : [];
  if (record.migrated !== true) fail(`source ${source.sourceId} is missing migrated evidence`);
  if (destinations.length === 0 || destinations.some((destination) => typeof destination !== 'string' || destination.length === 0)) {
    fail(`source ${source.sourceId} is missing destination evidence`);
  }
  if (record.targetRetrievalVerified !== true) fail(`source ${source.sourceId} is missing target retrieval evidence`);
  return { record, evidenceKind: 'migrated', destinations: [...destinations].sort() };
}

export function retireSecretSource({
  sourceId, secretStores, ledger, offlineExceptions, apply = false,
}) {
  if (!/^(general|workstation|wordpress):[A-Z][A-Z0-9_]{0,127}$/.test(sourceId ?? '')) {
    fail('retire requires --source general:NAME, workstation:NAME, or wordpress:NAME');
  }
  const inventorySources = inventorySecretSources(secretStores);
  const matches = inventorySources.filter((source) => source.sourceId === sourceId);
  if (matches.length !== 1) fail(`retirement source ${sourceId} is missing or ambiguous`);
  const source = matches[0];
  assertSourceInsideApprovedRoot(source, secretStores);
  const { evidenceKind, destinations } = validateRetirementEvidence({ source, ledger, inventorySources, offlineExceptions });
  const currentCiphertext = readFileSync(source.normalizedPath);
  const currentDigest = createHash('sha256').update(currentCiphertext).digest('hex');
  currentCiphertext.fill(0);
  if (currentDigest !== source.ciphertextSha256) fail(`source ${source.sourceId} changed during retirement validation`);
  if (apply) unlinkSync(source.normalizedPath);
  return {
    schemaVersion: 1,
    operation: 'retire-source',
    mode: apply ? 'apply' : 'dry-run',
    status: apply ? 'retired' : 'eligible',
    sourceId: source.sourceId,
    store: source.store,
    canonicalName: source.canonicalName,
    ciphertextSha256: source.ciphertextSha256,
    evidenceKind,
    destinations,
    targetRetrievalVerified: evidenceKind === 'migrated',
  };
}

export function markRetiredSourceInLedgerText(ledgerText, sourceId) {
  const escaped = sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^\\s*"${escaped}"\\s*:\\s*\\{[^\\n]*)(\\}\\s*,?\\s*$)`, 'm');
  const match = ledgerText.match(pattern);
  if (!match) {
    const ledger = JSON.parse(ledgerText);
    const record = ledger?.records?.[sourceId];
    if (!record) fail(`validation ledger record ${sourceId} is missing`);
    if (record.sourceRetired !== undefined && record.sourceRetired !== true) {
      fail(`validation ledger record ${sourceId} has conflicting sourceRetired state`);
    }
    record.sourceRetired = true;
    return `${JSON.stringify(ledger, null, 2)}\n`;
  }
  if (/"sourceRetired"\s*:\s*true/.test(match[1])) return ledgerText;
  if (/"sourceRetired"\s*:/.test(match[1])) fail(`validation ledger record ${sourceId} has conflicting sourceRetired state`);
  return ledgerText.replace(pattern, `$1,"sourceRetired":true$2`);
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
  if (options.command === 'retire') {
    if (!options.sourceId) fail('retire requires exactly one --source store:NAME');
    if (options.host || options.workload || options.projectId || options.secretDirectoriesOverridden || options.secretNames.length > 0) {
      fail('retire accepts only --source, --validation-ledger, --offline-exceptions, and optional --apply');
    }
    const ledgerText = readFileSync(options.validationLedgerPath, 'utf8');
    // Validate the ledger mutation before any destructive unlink. A conflicting
    // sourceRetired marker must fail while the encrypted source still exists.
    const retiredLedgerText = options.applyRetirement
      ? markRetiredSourceInLedgerText(ledgerText, options.sourceId)
      : ledgerText;
    const receipt = retireSecretSource({
      sourceId: options.sourceId,
      secretStores: defaultSecretStores,
      ledger: JSON.parse(ledgerText),
      offlineExceptions: JSON.parse(readFileSync(options.offlineExceptionsPath, 'utf8')),
      apply: options.applyRetirement,
    });
    if (options.applyRetirement) {
      writeFileSync(options.validationLedgerPath, retiredLedgerText, { mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (options.sourceId || options.applyRetirement) fail('--source and retirement --apply require the retire command');
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
  const inventories = new Map(targets.map((target) => [target, inventorySecretSources(secretStoresForTarget(options, targetKind, target, manifest))]));
  const inventorySources = [...new Map([...inventories.values()].flat().map((source) => [source.sourceId, source])).values()];
  const inventoryNames = new Set(inventorySources.map(({ canonicalName }) => canonicalName));
  const inventorySourceIds = new Set(inventorySources.map(({ sourceId }) => sourceId));
  for (const selector of options.secretNames) {
    if (selector.includes(':') ? !inventorySourceIds.has(selector) : !inventoryNames.has(selector)) {
      fail(`selected secret ${selector} is not present in the inventory`);
    }
  }
  const plans = targets.map((target) => {
    const configuration = configurations[target] ?? fail(`${targetKind} ${target} is not declared`);
    const selectedSources = selectRequestedSources(manifest, configuration, inventories.get(target), options.secretNames);
    return {
      target,
      targetKind,
      profile: configuration.profile,
      projectId: configuration.projectId,
      secretPath: configuration.secretPath,
      secretNames: selectedSources.map(({ canonicalName }) => canonicalName).sort(),
      secretSources: selectedSources.map(({ sourceId, store, canonicalName, normalizedPath, ciphertextSha256 }) => ({
        sourceId, store, canonicalName, normalizedPath, ciphertextSha256,
      })),
    };
  });
  if (options.command === 'plan') {
    const planKey = targetKind === 'workload' ? 'workloads' : 'hosts';
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, inventoryCount: inventoryNames.size, [planKey]: plans }, null, 2)}\n`);
    return;
  }
  const validationLedger = JSON.parse(readFileSync(options.validationLedgerPath, 'utf8'));
  const validationInventorySources = options.secretDirectoriesOverridden
    ? [...new Map([
      ...inventorySecretSources(defaultSecretStores),
      ...inventorySources,
    ].map((source) => [source.sourceId, source])).values()]
    : inventorySecretSources(defaultSecretStores);
  assertSecretSourcesValidated(validationLedger, plans.flatMap((plan) => plan.secretSources), validationInventorySources);
  if (options.projectId && targets.length !== 1) fail('--project-id override requires exactly one target');
  execFileSync('infisical', ['login', 'status', '--silent'], { stdio: 'ignore' });
  for (const plan of plans) {
    const projectId = options.projectId ?? plan.projectId;
    if (!projectId) fail(`${plan.targetKind} ${plan.target} has no project binding`);
    ensureSecretPath({ environment: manifest.environment, projectId, secretPath: plan.secretPath });
    for (const source of plan.secretSources) {
      writeEncryptedSecret({ encryptedPath: source.normalizedPath, environment: manifest.environment, name: source.canonicalName, projectId, secretPath: plan.secretPath });
    }
    process.stdout.write(`${JSON.stringify({ target: plan.target, targetKind: plan.targetKind, status: 'reconciled', secretCount: plan.secretNames.length })}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
