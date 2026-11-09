import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateBlueprintV2ToV3, migrateBlueprintV3ToV4 } from '../dist/core.js';
import {
  assessPortableOfflineSecrets,
  createPortableProfileExport,
  materializePortableDesiredState,
  migratePortableProfileExportV1ToV2,
  parsePortableProfileExport,
  serializePortableProfileExport,
  validatePortableProfileExport,
} from '../dist/profile-export.js';

async function environment() {
  const v2 = JSON.parse(await readFile(new URL('./fixtures/environment-v2.json', import.meta.url), 'utf8'));
  const v3 = migrateBlueprintV2ToV3(v2);
  return migrateBlueprintV3ToV4(v3, {
    profileId: 'example', visibility: 'public-bootstrap', promptPolicyId: 'provision-v1', promptPolicyVersion: 'v1',
    promptMode: 'agent-assisted', allowedRoutes: ['economy', 'code'],
    secretReferences: [
      { id: 'backup-key', reference: 'infisical://desktop-tools/profiles/example/backup-key', requiredAt: 'apply', offlineRecovery: 'escrow-required' },
      { id: 'loki-writer', reference: 'infisical://desktop-tools/profiles/example/loki-writer', requiredAt: 'apply', offlineRecovery: 'not-required' },
    ],
  });
}

const recipes = [
  { id: 'packages', version: '2026.11.8', sha256: 'a'.repeat(64) },
  { id: 'shell', version: '4.0.0', sha256: 'b'.repeat(64) },
];

test('portable export is deterministic and excludes credentials, endpoints, and source machine identities', async () => {
  const source = await environment();
  const first = await createPortableProfileExport({ environment: source, machineId: 'runner-a', recipes, catalogSha256: 'c'.repeat(64), consents: ['network'] });
  const second = await createPortableProfileExport({ environment: structuredClone(source), machineId: 'runner-a', recipes: [...recipes].reverse(), catalogSha256: 'c'.repeat(64), consents: ['network'] });
  assert.deepEqual(second, first);
  const serialized = await serializePortableProfileExport(first);
  assert.deepEqual(await parsePortableProfileExport(serialized), first);
  assert.doesNotMatch(serialized, /runner-a|runner-b|laptop|infisical:|logs\.example|credential/i);
  assert.deepEqual(first.recipes, recipes);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.secretRequirementsState, 'complete');
  assert.deepEqual(first.secretRequirements, [
    { id: 'backup-key', requiredAt: 'apply', offlineRecovery: 'escrow-required' },
    { id: 'loki-writer', requiredAt: 'apply', offlineRecovery: 'not-required' },
  ]);
  assert.match(first.exportDigest, /^[a-f0-9]{64}$/);
});

test('offline secret readiness is value-free, deterministic, and gives exact missing-escrow remediation', async () => {
  const value = await createPortableProfileExport({ environment: await environment(), machineId: 'runner-a', recipes, catalogSha256: 'c'.repeat(64), offline: true });
  const missing = await assessPortableOfflineSecrets(value, []);
  assert.deepEqual(missing, {
    ready: false,
    requiredSecretIds: ['backup-key'],
    missingSecretIds: ['backup-key'],
    remediation: [{
      secretId: 'backup-key', action: 'provide-offline-escrow',
      guidance: "Provide protected offline escrow for secret reference 'backup-key' before planning; do not add secret values to the profile or bundle.",
    }],
  });
  assert.equal((await assessPortableOfflineSecrets(value, ['backup-key'])).ready, true);
  await assert.rejects(assessPortableOfflineSecrets(value, ['backup-key', 'backup-key']), /unique/);
  await assert.rejects(assessPortableOfflineSecrets(value, ['NOT-AN-ID']), /invalid/i);
  assert.doesNotMatch(JSON.stringify(missing), /infisical:|client_secret|password|token/i);
});

test('legacy portable exports require explicit migration and cannot imply secret readiness', async () => {
  const current = await createPortableProfileExport({ environment: await environment(), machineId: 'runner-a', recipes, catalogSha256: 'c'.repeat(64) });
  const { secretRequirements: _requirements, secretRequirementsState: _state, exportDigest: _digest, ...legacyUnsigned } = current;
  legacyUnsigned.schemaVersion = 1;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(legacyUnsigned)));
  const legacyDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const legacy = { ...legacyUnsigned, exportDigest: legacyDigest };
  await assert.rejects(assessPortableOfflineSecrets(legacy, []), /re-export from canonical ENVIRONMENT/);
  const migrated = await migratePortableProfileExportV1ToV2(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.secretRequirementsState, 'unknown-legacy');
  assert.deepEqual(migrated.secretRequirements, []);
  await assert.rejects(assessPortableOfflineSecrets(migrated, []), /re-export from canonical ENVIRONMENT/);
  await assert.rejects(migratePortableProfileExportV1ToV2({ ...legacy, exportDigest: '0'.repeat(64) }), /digest mismatch/);
});

test('strict export rejects unknown fields, mutable recipe refs, and digest tampering', async () => {
  const value = await createPortableProfileExport({ environment: await environment(), machineId: 'runner-a', recipes, catalogSha256: 'c'.repeat(64) });
  await assert.rejects(validatePortableProfileExport({ ...value, token: 'secret' }), /unrecognized|unknown/i);
  await assert.rejects(validatePortableProfileExport({ ...value, recipes: [{ id: 'packages', version: 'main', sha256: 'not-a-digest' }] }), /invalid/i);
  await assert.rejects(validatePortableProfileExport({ ...value, desired: { ...value.desired, offline: !value.desired.offline } }), /digest mismatch/);
});

test('fresh targets supply their own identity and must satisfy exported platform constraints', async () => {
  const value = await createPortableProfileExport({ environment: await environment(), machineId: 'runner-a', recipes, catalogSha256: 'c'.repeat(64), consents: ['network'] });
  const facts = {
    schemaVersion: 1, hostId: 'fresh-host', collectedAt: '2026-11-08T13:00:00.000Z', os: 'linux', osVersion: '24.04', arch: 'x64',
    environment: 'native', roles: ['runner'], packageManagers: ['apt'], capabilities: ['linux', 'server'],
  };
  const desired = await materializePortableDesiredState(value, facts);
  assert.equal(desired.hostId, 'fresh-host');
  assert.deepEqual(desired.packages, value.desired.packages);
  await assert.rejects(materializePortableDesiredState(value, { ...facts, os: 'darwin' }), /operating system/);
  await assert.rejects(materializePortableDesiredState(value, { ...facts, capabilities: [] }), /lacks profile capabilities/);
});
