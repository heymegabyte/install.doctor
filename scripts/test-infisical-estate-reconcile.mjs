#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSecretSourcesValidated, assertSecretsValidated, inventorySecretNames, inventorySecretSources,
  metadataOnlyListing, resolveSourceValidationRecord, retireSecretSource, secretDirectoriesForHost, selectConfigurationSecrets,
  selectConfigurationSources, selectHostSecrets, selectRequestedSources, validateClosedSetSync, validateManifest,
  validateRetirementEvidence, validateValidationLedger,
} from './infisical-estate-reconcile.mjs';

const root = mkdtempSync(join(tmpdir(), 'infisical-estate-reconcile-'));
writeFileSync(join(root, 'CLOUDFLARE_API_TOKEN'), 'ciphertext fixture');
writeFileSync(join(root, 'SUDO_PASSWORD'), 'excluded fixture');

const manifest = validateManifest({
  schemaVersion: 1,
  hosts: {
    'macos.megabyte.space': {
      profile: 'developer',
      projectId: 'b9f92958-bd90-4e0a-a464-c51db5fa6d52',
      secretPath: '/',
    },
  },
  workloads: {
    'mcp.megabyte.space': {
      profile: 'cloudflare-mcp',
      projectId: '4ae065b0-c081-454e-a513-220a28e5d2f0',
      secretPath: '/',
    },
  },
  profiles: { developer: ['cloudflare'], 'cloudflare-mcp': ['cloudflare'] },
  capabilityPatterns: { cloudflare: ['^CLOUDFLARE_'] },
  alwaysExcludePatterns: ['PASSWORD$'],
});
const inventory = inventorySecretNames([root]);
assert.deepEqual([...inventory.keys()], ['CLOUDFLARE_API_TOKEN', 'SUDO_PASSWORD']);

const storesRoot = mkdtempSync(join(tmpdir(), 'infisical-source-stores-'));
const general = join(storesRoot, 'general');
const workstation = join(storesRoot, 'workstation');
const wordpress = join(storesRoot, 'wordpress');
for (const directory of [general, workstation, wordpress]) mkdirSync(directory);
writeFileSync(join(general, 'SHARED_TOKEN'), 'general ciphertext');
writeFileSync(join(workstation, 'SHARED_TOKEN'), 'workstation ciphertext');
writeFileSync(join(wordpress, 'SHARED_TOKEN'), 'wordpress ciphertext');
const storeDeclarations = [
  { id: 'general', directory: general, precedence: 10, hostDefault: true, workloadKinds: ['workload', 'host'] },
  { id: 'workstation', directory: workstation, precedence: 20, hostDefault: true, workloadKinds: ['host'] },
  { id: 'wordpress', directory: wordpress, precedence: 0, hostDefault: false, workloadKinds: ['wordpress-site'] },
];
const sourceInventory = inventorySecretSources(storeDeclarations);
assert.deepEqual(sourceInventory.map(({ sourceId }) => sourceId), [
  'general:SHARED_TOKEN', 'wordpress:SHARED_TOKEN', 'workstation:SHARED_TOKEN',
]);
assert.equal(new Set(sourceInventory.map(({ ciphertextSha256 }) => ciphertextSha256)).size, 3);
assert.equal(sourceInventory.find(({ store }) => store === 'wordpress').hostDefault, false);
const serializedListing = JSON.stringify(metadataOnlyListing(storeDeclarations));
assert.equal(serializedListing.includes('general ciphertext'), false);
assert.equal(serializedListing.includes('workstation ciphertext'), false);
assert.equal(serializedListing.includes('wordpress ciphertext'), false);
assert.throws(() => inventorySecretSources([...storeDeclarations, storeDeclarations[0]]), /duplicate secret store id/);
symlinkSync(join(general, 'SHARED_TOKEN'), join(general, 'SYMLINK_TOKEN'));
assert.throws(() => inventorySecretSources(storeDeclarations), /is a symlink/);
unlinkSync(join(general, 'SYMLINK_TOKEN'));
const generalShared = sourceInventory.find(({ sourceId }) => sourceId === 'general:SHARED_TOKEN');
const workstationShared = sourceInventory.find(({ sourceId }) => sourceId === 'workstation:SHARED_TOKEN');
assert.notEqual(generalShared.ciphertextSha256, workstationShared.ciphertextSha256);
const sourceQualifiedLedger = {
  schemaVersion: 1,
  records: {
    'general:SHARED_TOKEN': {
      status: 'valid', sourceId: 'general:SHARED_TOKEN', canonicalName: 'SHARED_TOKEN',
      ciphertextSha256: generalShared.ciphertextSha256, validator: 'general-provider-probe',
    },
    'workstation:SHARED_TOKEN': {
      status: 'invalid-retired', sourceId: 'workstation:SHARED_TOKEN', canonicalName: 'SHARED_TOKEN',
      ciphertextSha256: workstationShared.ciphertextSha256, validator: 'workstation-provider-probe',
    },
  },
};
assert.doesNotThrow(() => validateValidationLedger(sourceQualifiedLedger, sourceInventory));
assert.equal(resolveSourceValidationRecord(sourceQualifiedLedger, generalShared, sourceInventory).status, 'valid');
assert.equal(resolveSourceValidationRecord(sourceQualifiedLedger, workstationShared, sourceInventory).status, 'invalid-retired');
assert.doesNotThrow(() => assertSecretSourcesValidated(sourceQualifiedLedger, [generalShared], sourceInventory));
assert.throws(
  () => assertSecretSourcesValidated(sourceQualifiedLedger, [workstationShared], sourceInventory),
  /workstation:SHARED_TOKEN has no current valid credential evidence/,
);
assert.equal(resolveSourceValidationRecord(sourceQualifiedLedger, generalShared, sourceInventory).status, 'valid');
assert.throws(() => assertSecretSourcesValidated({
  schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid', validator: 'legacy-probe' } },
}, [generalShared], sourceInventory), /legacy validation evidence.*ambiguous/);
assert.throws(() => validateValidationLedger({
  schemaVersion: 1,
  records: { 'general:SHARED_TOKEN': { status: 'valid', ciphertextSha256: workstationShared.ciphertextSha256 } },
}, sourceInventory), /stale ciphertext evidence/);
assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', inventory.keys()), ['CLOUDFLARE_API_TOKEN']);
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['mcp.megabyte.space'], inventory.keys(),
), ['CLOUDFLARE_API_TOKEN']);
const sharedManifest = { ...manifest, capabilityPatterns: { cloudflare: ['^SHARED_'] } };
assert.deepEqual(
  selectConfigurationSources(sharedManifest, sharedManifest.hosts['macos.megabyte.space'], sourceInventory)
    .map(({ sourceId }) => sourceId),
  ['workstation:SHARED_TOKEN'],
);
assert.deepEqual(
  selectRequestedSources(sharedManifest, sharedManifest.hosts['macos.megabyte.space'], sourceInventory, ['general:SHARED_TOKEN'])
    .map(({ sourceId }) => sourceId),
  ['general:SHARED_TOKEN'],
);
const defaultDirectories = ['/general', '/workstation'];
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: defaultDirectories, secretDirectoriesOverridden: false,
}, 'macos.megabyte.space'), defaultDirectories);
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: defaultDirectories, secretDirectoriesOverridden: false,
}, 'ubuntu.megabyte.space'), ['/general']);
assert.deepEqual(secretDirectoriesForHost({
  secretDirectories: ['/explicit'], secretDirectoriesOverridden: true,
}, 'ubuntu.megabyte.space'), ['/explicit']);
assert.doesNotThrow(() => assertSecretsValidated({
  schemaVersion: 1, records: { CLOUDFLARE_API_TOKEN: { status: 'valid' } },
}, ['CLOUDFLARE_API_TOKEN']));
assert.throws(() => assertSecretsValidated({
  schemaVersion: 1, records: { CLOUDFLARE_API_TOKEN: { status: 'invalid-retired' } },
}, ['CLOUDFLARE_API_TOKEN']), /no current valid credential evidence/);
assert.throws(() => validateManifest({
  ...manifest,
  hosts: { 'macos.megabyte.space': { profile: 'developer', secretPath: '/' } },
}), /invalid target configuration/);
assert.doesNotThrow(() => validateClosedSetSync({
  listing: metadataOnlyListing(storeDeclarations.map((store) => ({
    ...store,
    directory: store.directory === general ? join(storesRoot, 'general-clean') : store.directory,
  })).filter(({ directory }) => directory !== general)),
  manifest,
  ledger: { schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid' } } },
  offlineExceptions: { schemaVersion: 1, exceptions: [] },
  destinationEvidence: [{
    id: 'destination-1', sourceId: 'workstation:SHARED_TOKEN', canonicalName: 'SHARED_TOKEN',
    target: 'macos.megabyte.space', targetKind: 'host',
  }],
  retirementAssertions: [{ id: 'retirement-1', sourceId: 'workstation:SHARED_TOKEN', canonicalName: 'SHARED_TOKEN' }],
}));
assert.throws(() => validateClosedSetSync({
  listing: { schemaVersion: 1, sources: [{
    sourceId: 'wordpress:SHARED_TOKEN', store: 'wordpress', canonicalName: 'SHARED_TOKEN', hostDefault: true,
  }] },
  manifest,
  ledger: { schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid' } } },
  offlineExceptions: { schemaVersion: 1, exceptions: [] },
}), /cannot enter host defaults/);
assert.throws(() => validateClosedSetSync({
  listing: metadataOnlyListing(storeDeclarations),
  manifest,
  ledger: { schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid' } } },
  offlineExceptions: { schemaVersion: 1, exceptions: [] },
  destinationEvidence: [{ id: 'destination-bad', sourceId: 'general:MISSING_TOKEN' }],
}), /unknown or mismatched source/);
assert.throws(() => validateClosedSetSync({
  listing: metadataOnlyListing(storeDeclarations),
  manifest,
  ledger: { schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid' } } },
  offlineExceptions: { schemaVersion: 1, exceptions: [] },
  retirementAssertions: [{
    id: 'retirement-wordpress-host', sourceId: 'wordpress:SHARED_TOKEN', target: 'macos.megabyte.space', targetKind: 'host',
  }],
}), /routes a WordPress source to a host default/);

const cliHome = mkdtempSync(join(tmpdir(), 'infisical-source-cli-'));
const cliStoresRoot = join(cliHome, '.local/share/chezmoi/home/.chezmoitemplates');
mkdirSync(join(cliStoresRoot, 'secrets'), { recursive: true });
mkdirSync(join(cliStoresRoot, 'secrets-workstation'));
writeFileSync(join(cliStoresRoot, 'secrets/SHARED_TOKEN'), 'general cli ciphertext');
writeFileSync(join(cliStoresRoot, 'secrets-workstation/SHARED_TOKEN'), 'workstation cli ciphertext');
const cliManifestPath = join(cliHome, 'manifest.json');
writeFileSync(cliManifestPath, JSON.stringify(sharedManifest));
const planResult = spawnSync(process.execPath, [
  join(process.cwd(), 'scripts/infisical-estate-reconcile.mjs'), 'plan', '--manifest', cliManifestPath,
  '--host', 'macos.megabyte.space', '--name', 'SHARED_TOKEN',
], { encoding: 'utf8', env: { ...process.env, HOME: cliHome } });
assert.equal(planResult.status, 0, planResult.stderr);
const cliPlan = JSON.parse(planResult.stdout);
assert.deepEqual(cliPlan.hosts[0].secretNames, ['SHARED_TOKEN']);
assert.deepEqual(cliPlan.hosts[0].secretSources.map(({ sourceId }) => sourceId), ['workstation:SHARED_TOKEN']);
const exactPlanResult = spawnSync(process.execPath, [
  join(process.cwd(), 'scripts/infisical-estate-reconcile.mjs'), 'plan', '--manifest', cliManifestPath,
  '--host', 'macos.megabyte.space', '--name', 'general:SHARED_TOKEN',
], { encoding: 'utf8', env: { ...process.env, HOME: cliHome } });
assert.equal(exactPlanResult.status, 0, exactPlanResult.stderr);
assert.deepEqual(JSON.parse(exactPlanResult.stdout).hosts[0].secretSources.map(({ sourceId }) => sourceId), ['general:SHARED_TOKEN']);
const legacyLedgerPath = join(cliHome, 'legacy-ledger.json');
writeFileSync(legacyLedgerPath, JSON.stringify({
  schemaVersion: 1, records: { SHARED_TOKEN: { status: 'valid', validator: 'legacy-probe' } },
}));
const ambiguousApply = spawnSync(process.execPath, [
  join(process.cwd(), 'scripts/infisical-estate-reconcile.mjs'), 'apply', '--manifest', cliManifestPath,
  '--validation-ledger', legacyLedgerPath, '--host', 'macos.megabyte.space', '--name', 'SHARED_TOKEN',
], { encoding: 'utf8', env: { ...process.env, HOME: cliHome, PATH: '' } });
assert.notEqual(ambiguousApply.status, 0);
assert.match(ambiguousApply.stderr, /legacy validation evidence.*ambiguous/);
writeFileSync(join(cliStoresRoot, 'secrets/CLI_RETIRE_TOKEN'), 'cli general retirement ciphertext');
writeFileSync(join(cliStoresRoot, 'secrets-workstation/CLI_RETIRE_TOKEN'), 'cli workstation sibling ciphertext');
const cliRetirementSource = inventorySecretSources([{
  id: 'general', directory: join(cliStoresRoot, 'secrets'), precedence: 10, hostDefault: true, workloadKinds: ['host'],
}]).find(({ sourceId }) => sourceId === 'general:CLI_RETIRE_TOKEN');
const cliRetirementLedgerPath = join(cliHome, 'retirement-ledger.json');
writeFileSync(cliRetirementLedgerPath, JSON.stringify({
  schemaVersion: 1,
  records: {
    [cliRetirementSource.sourceId]: {
      status: 'valid', sourceId: cliRetirementSource.sourceId, canonicalName: cliRetirementSource.canonicalName,
      ciphertextSha256: cliRetirementSource.ciphertextSha256, validator: 'provider-probe', migrated: true,
      destination: 'macos.megabyte.space', targetRetrievalVerified: true,
    },
  },
}));
const cliOfflinePath = join(cliHome, 'offline.json');
writeFileSync(cliOfflinePath, JSON.stringify({ schemaVersion: 1, exceptions: [] }));
const cliRetireArgs = [
  join(process.cwd(), 'scripts/infisical-estate-reconcile.mjs'), 'retire',
  '--validation-ledger', cliRetirementLedgerPath, '--offline-exceptions', cliOfflinePath,
  '--source', cliRetirementSource.sourceId,
];
const cliDryRun = spawnSync(process.execPath, cliRetireArgs, { encoding: 'utf8', env: { ...process.env, HOME: cliHome } });
assert.equal(cliDryRun.status, 0, cliDryRun.stderr);
assert.equal(JSON.parse(cliDryRun.stdout).mode, 'dry-run');
assert.equal(existsSync(join(cliStoresRoot, 'secrets/CLI_RETIRE_TOKEN')), true);
const cliApplied = spawnSync(process.execPath, [...cliRetireArgs, '--apply'], { encoding: 'utf8', env: { ...process.env, HOME: cliHome } });
assert.equal(cliApplied.status, 0, cliApplied.stderr);
assert.equal(JSON.parse(cliApplied.stdout).status, 'retired');
assert.equal(existsSync(join(cliStoresRoot, 'secrets/CLI_RETIRE_TOKEN')), false);
assert.equal(existsSync(join(cliStoresRoot, 'secrets-workstation/CLI_RETIRE_TOKEN')), true);

const retirementRoot = mkdtempSync(join(tmpdir(), 'infisical-source-retirement-'));
const retirementGeneral = join(retirementRoot, 'general');
const retirementWorkstation = join(retirementRoot, 'workstation');
mkdirSync(retirementGeneral);
mkdirSync(retirementWorkstation);
writeFileSync(join(retirementGeneral, 'RETIRE_TOKEN'), 'general retirement ciphertext');
writeFileSync(join(retirementGeneral, 'INVALID_TOKEN'), 'invalid retirement ciphertext');
writeFileSync(join(retirementWorkstation, 'RETIRE_TOKEN'), 'workstation sibling ciphertext');
const retirementStores = [
  { id: 'general', directory: retirementGeneral, precedence: 10, hostDefault: true, workloadKinds: ['host'] },
  { id: 'workstation', directory: retirementWorkstation, precedence: 20, hostDefault: true, workloadKinds: ['host'] },
];
const retirementInventory = inventorySecretSources(retirementStores);
const retirementSource = retirementInventory.find(({ sourceId }) => sourceId === 'general:RETIRE_TOKEN');
const invalidRetirementSource = retirementInventory.find(({ sourceId }) => sourceId === 'general:INVALID_TOKEN');
const completeRetirementRecord = {
  status: 'valid',
  sourceId: retirementSource.sourceId,
  canonicalName: retirementSource.canonicalName,
  ciphertextSha256: retirementSource.ciphertextSha256,
  validator: 'provider-identity-probe',
  migrated: true,
  destination: 'macos.megabyte.space',
  targetRetrievalVerified: true,
};
const noOfflineExceptions = { schemaVersion: 1, exceptions: [] };
const dryRunReceipt = retireSecretSource({
  sourceId: retirementSource.sourceId,
  secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: completeRetirementRecord } },
  offlineExceptions: noOfflineExceptions,
});
assert.equal(dryRunReceipt.mode, 'dry-run');
assert.equal(dryRunReceipt.status, 'eligible');
assert.equal(existsSync(join(retirementGeneral, 'RETIRE_TOKEN')), true);
assert.equal(existsSync(join(retirementWorkstation, 'RETIRE_TOKEN')), true);
assert.equal(JSON.stringify(dryRunReceipt).includes('general retirement ciphertext'), false);

for (const [recordPatch, error] of [
  [{ migrated: false }, /missing migrated evidence/],
  [{ destination: undefined }, /missing destination evidence/],
  [{ targetRetrievalVerified: false }, /missing target retrieval evidence/],
  [{ status: 'unverified' }, /not valid for retirement/],
]) {
  assert.throws(() => retireSecretSource({
    sourceId: retirementSource.sourceId,
    secretStores: retirementStores,
    ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: { ...completeRetirementRecord, ...recordPatch } } },
    offlineExceptions: noOfflineExceptions,
    apply: true,
  }), error);
  assert.equal(existsSync(join(retirementGeneral, 'RETIRE_TOKEN')), true);
  assert.equal(existsSync(join(retirementWorkstation, 'RETIRE_TOKEN')), true);
}
assert.throws(() => retireSecretSource({
  sourceId: retirementSource.sourceId,
  secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: completeRetirementRecord } },
  offlineExceptions: { schemaVersion: 1, exceptions: [{ id: 'recovery', sourceIds: [retirementSource.sourceId], active: true }] },
  apply: true,
}), /active offline exception/);
assert.equal(existsSync(join(retirementGeneral, 'RETIRE_TOKEN')), true);
assert.throws(() => validateRetirementEvidence({
  source: retirementSource,
  inventorySources: retirementInventory,
  ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: { ...completeRetirementRecord, ciphertextSha256: '0'.repeat(64) } } },
  offlineExceptions: noOfflineExceptions,
}), /stale ciphertext evidence/);
assert.throws(() => retireSecretSource({
  sourceId: retirementSource.sourceId,
  secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: {
    ...completeRetirementRecord, status: 'invalid-retired', migrated: false, destination: undefined,
  } } },
  offlineExceptions: noOfflineExceptions,
  apply: true,
}), /invalid status without complete invalid-retirement evidence/);
assert.equal(existsSync(join(retirementGeneral, 'RETIRE_TOKEN')), true);
const invalidRetirementReceipt = retireSecretSource({
  sourceId: invalidRetirementSource.sourceId,
  secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: { [invalidRetirementSource.sourceId]: {
    status: 'invalid-retired', sourceId: invalidRetirementSource.sourceId,
    canonicalName: invalidRetirementSource.canonicalName,
    ciphertextSha256: invalidRetirementSource.ciphertextSha256,
    validator: 'provider-invalid-probe', invalidRetirement: true, providerConfirmedInvalid: true,
    requiredDestinations: [], requiredConsumers: [],
  } } },
  offlineExceptions: noOfflineExceptions,
});
assert.equal(invalidRetirementReceipt.evidenceKind, 'invalid-retirement');
assert.equal(existsSync(join(retirementGeneral, 'INVALID_TOKEN')), true);
assert.throws(() => retireSecretSource({
  sourceId: 'RETIRE_TOKEN', secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: {} }, offlineExceptions: noOfflineExceptions,
}), /requires --source/);
assert.throws(() => retireSecretSource({
  sourceId: 'general:MISSING_TOKEN', secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: {} }, offlineExceptions: noOfflineExceptions,
}), /missing or ambiguous/);

const appliedReceipt = retireSecretSource({
  sourceId: retirementSource.sourceId,
  secretStores: retirementStores,
  ledger: { schemaVersion: 1, records: { [retirementSource.sourceId]: completeRetirementRecord } },
  offlineExceptions: noOfflineExceptions,
  apply: true,
});
assert.equal(appliedReceipt.status, 'retired');
assert.equal(existsSync(join(retirementGeneral, 'RETIRE_TOKEN')), false);
assert.equal(existsSync(join(retirementWorkstation, 'RETIRE_TOKEN')), true);
console.log('infisical-estate-reconcile unit tests: PASS');

const estate = validateManifest(JSON.parse(
  readFileSync(new URL('../config/infisical/estate-secret-profiles.json', import.meta.url), 'utf8'),
));
const nexusPair = ['NEXUS_ACCESS_CLIENT_ID', 'NEXUS_ACCESS_CLIENT_SECRET'];
const nexusInventory = [...nexusPair, 'NEXUS_ADMIN_PASSWORD', 'NEXUS_ACCESS_CLIENT_SECRET_OTHER'];
for (const host of Object.keys(estate.hosts)) {
  assert.deepEqual(selectHostSecrets(estate, host, nexusInventory),
    host === 'legion.megabyte.space' ? nexusPair : []);
}
for (const workload of Object.values(estate.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(estate, workload, nexusInventory), []);
}
