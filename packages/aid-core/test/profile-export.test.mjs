import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateBlueprintV2ToV3, migrateBlueprintV3ToV4 } from '../dist/core.js';
import {
  createPortableProfileExport,
  materializePortableDesiredState,
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
    secretReferences: [{ id: 'loki-writer', reference: 'infisical://desktop-tools/profiles/example/loki-writer', requiredAt: 'apply', offlineRecovery: 'not-required' }],
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
  assert.match(first.exportDigest, /^[a-f0-9]{64}$/);
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
