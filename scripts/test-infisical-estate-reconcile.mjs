#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSecretSourcesValidated, assertSecretsValidated, inventorySecretNames, inventorySecretSources,
  metadataOnlyListing, resolveSourceValidationRecord, secretDirectoriesForHost, selectConfigurationSecrets,
  selectConfigurationSources, selectHostSecrets, selectRequestedSources, validateClosedSetSync, validateManifest,
  validateValidationLedger,
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
console.log('infisical-estate-reconcile unit tests: PASS');
