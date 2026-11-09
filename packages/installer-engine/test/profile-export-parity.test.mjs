import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { materializePortableDesiredState, parsePortableProfileExport } from '@install-doctor/aid-core/profile-export';
import { exportMarkdown, migrateBlueprintV2ToV3, migrateBlueprintV3ToV4 } from '@install-doctor/aid-core';
import { deriveBoundNormalizedPlan } from '../dist/index.js';
import { createCatalogBoundProfileExport, reconstructPortablePlanDraft } from '../dist/portable-profile.js';

const catalog = [
  {
    name: 'bootstrap-runtime', bin: 'bootstrap-runtime', platforms: ['linux'], installMode: 'cli',
    loadPolicy: 'eager-bootstrap', loadRationale: 'bootstrap:runtime', deps: [], artifacts: [], offlinePayloads: [],
  },
  {
    name: 'git', bin: 'git', platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy', loadRationale: 'default-lazy',
    deps: ['bootstrap-runtime'], artifacts: [], offlinePayloads: [], providers: ['apt'], pkgs: { apt: 'git' },
  },
];
const catalogBytes = Buffer.from(`${JSON.stringify(catalog)}\n`);
const catalogSha256 = createHash('sha256').update(catalogBytes).digest('hex');

async function signedRelease(root, bytes = catalogBytes, signingRoot = root) {
  const key = join(signingRoot, 'release-key');
  if (signingRoot === root) {
    const generated = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
  }
  const releaseId = 'release-1';
  const digest = createHash('sha256').update(bytes).digest('hex');
  const lines = ['schema_version=7', 'product_id=desktop-tools', `release_id=${releaseId}`,
    'source_commit=0000000000000000000000000000000000000000', 'created_at=1794138000', 'expires_at=1794224400',
    'key_id=desktop-test', 'engine_node_min=22', 'runtime_node_version=24.1.0', 'opencode_version=2.0.0',
    `catalog_url=https://desktop.tools/releases/${releaseId}/catalog.json`, `catalog_sha256=${digest}`, `catalog_size=${bytes.byteLength}`];
  while (lines.length < 64) lines.push(`test_field_${lines.length}=bound-value-${lines.length}`);
  const manifestPath = join(root, 'manifest');
  await writeFile(manifestPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  const signed = spawnSync('/usr/bin/ssh-keygen', ['-Y', 'sign', '-q', '-f', key, '-n', 'desktop.tools.release', manifestPath], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  return { releaseId, manifestPath, signaturePath: `${manifestPath}.sig`, key,
    publicKey: (await readFile(`${key}.pub`, 'utf8')).trim() };
}

function environment() {
  const v2 = {
    schemaVersion: 2, revision: 'revision-1', appUrl: 'https://app.install.doctor',
    routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
    skills: { repository: 'heymegabyte/agent-skills', commit: '0'.repeat(40), include: ['desktop-provisioning'] },
    defaults: { packages: ['git'], shellHistory: 'hishtory' },
    roles: [{ id: 'runner', packages: [] }],
    machines: [{ id: 'private-source-host', os: 'linux', role: 'runner', packageOverrides: { add: [], remove: [] } }],
    services: [], privacy: { shellAnalysis: 'off', screenshots: 'off', terminalInput: false, productLearning: false },
  };
  return migrateBlueprintV3ToV4(migrateBlueprintV2ToV3(v2), {
    profileId: 'example', visibility: 'public-bootstrap', promptPolicyId: 'offline-v1', promptPolicyVersion: 'v1',
    promptMode: 'deterministic-only', allowedRoutes: [],
  });
}

const facts = {
  schemaVersion: 1, hostId: 'rebuilt-host', collectedAt: '2026-11-08T12:00:00.000Z', os: 'linux', osVersion: '24.04', arch: 'x64',
  environment: 'native', roles: ['runner'], packageManagers: ['apt'], capabilities: ['linux', 'server'],
};

test('bounded CLI exports a catalog-verified profile without source-private state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-profile-cli-'));
  const environmentPath = join(root, 'ENVIRONMENT.md');
  const factsPath = join(root, 'facts.json');
  const catalogPath = join(root, 'catalog.json');
  const outputPath = join(root, 'profile.json');
  await writeFile(environmentPath, exportMarkdown(environment()), { mode: 0o600 });
  await writeFile(factsPath, `${JSON.stringify(facts)}\n`, { mode: 0o600 });
  await writeFile(catalogPath, catalogBytes, { mode: 0o600 });
  const release = await signedRelease(root);
  const cliBin = resolve(import.meta.dirname, '../bin/desktop-tools-profile-export.mjs');
  const result = spawnSync(process.execPath, [cliBin, 'export',
    '--environment', environmentPath, '--machine', 'private-source-host', '--facts', factsPath,
    '--catalog', catalogPath, '--release-manifest', release.manifestPath, '--release-signature', release.signaturePath,
    '--release-id', release.releaseId, '--signer-id', 'desktop-test', '--signer-public-key', `${release.key}.pub`,
    '--output', outputPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const profile = await parsePortableProfileExport(await readFile(outputPath, 'utf8'));
  assert.equal(profile.catalog.sha256, catalogSha256);
  assert.deepEqual(profile.recipes.map(recipe => recipe.id), ['bootstrap-runtime', 'git']);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(outputPath, 'utf8'), /private-source-host|infisical:|credential/i);
  const replay = spawnSync(process.execPath, [cliBin, 'export',
    '--environment', environmentPath, '--machine', 'private-source-host', '--facts', factsPath,
    '--catalog', catalogPath, '--release-manifest', release.manifestPath, '--release-signature', release.signaturePath,
    '--release-id', release.releaseId, '--signer-id', 'desktop-test', '--signer-public-key', `${release.key}.pub`,
    '--output', outputPath], { encoding: 'utf8' });
  assert.notEqual(replay.status, 0);
});

test('forged catalog and matching attacker manifest hash are rejected by trusted signer authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-profile-forgery-'));
  const trusted = await signedRelease(root);
  const attackerRoot = await mkdtemp(join(tmpdir(), 'desktop-tools-profile-attacker-'));
  const forged = Buffer.from('[{"attacker":true}]\n');
  const attacker = await signedRelease(attackerRoot, forged);
  await assert.rejects(createCatalogBoundProfileExport({ environment: environment(), machineId: 'private-source-host', facts,
    catalogBytes: forged, release: { manifestPath: attacker.manifestPath, signaturePath: attacker.signaturePath,
      expectedReleaseId: attacker.releaseId, trust: { keyId: 'desktop-test', publicKey: trusted.publicKey }, now: 1794140000 } }),
  /signature verification failed/);
});

test('fresh standalone target reconstructs its plan draft only from export and trusted catalog bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-profile-library-'));
  const release = await signedRelease(root);
  const exported = await createCatalogBoundProfileExport({
    environment: environment(), machineId: 'private-source-host', facts, catalogBytes,
    release: { manifestPath: release.manifestPath, signaturePath: release.signaturePath,
      expectedReleaseId: release.releaseId, trust: { keyId: 'desktop-test', publicKey: release.publicKey }, now: 1794140000 },
  });
  const sourceDesired = await materializePortableDesiredState(exported, facts);
  const sourceDraft = await reconstructPortablePlanDraft({ profileExport: exported, facts, catalogBytes });
  const sourcePlan = await deriveBoundNormalizedPlan(sourceDraft, facts, sourceDesired, 'release-1', '2026-11-08T12:01:00.000Z');

  const imported = await parsePortableProfileExport(`${JSON.stringify(exported)}\n`);
  const freshFacts = { ...facts, collectedAt: '2026-11-08T13:00:00.000Z' };
  const freshDesired = await materializePortableDesiredState(imported, freshFacts);
  const freshDraft = await reconstructPortablePlanDraft({ profileExport: imported, facts: freshFacts, catalogBytes });
  const freshPlan = await deriveBoundNormalizedPlan(freshDraft, freshFacts, freshDesired, 'release-1', '2026-11-08T13:01:00.000Z');

  assert.equal(freshPlan.digest, sourcePlan.digest);
  assert.equal(freshPlan.planId, sourcePlan.planId);
  await assert.rejects(reconstructPortablePlanDraft({ profileExport: imported, facts: freshFacts, catalogBytes: Buffer.from('[]\n') }), /catalog digest mismatch/);
  const tamperedCatalog = JSON.parse(catalogBytes.toString('utf8'));
  tamperedCatalog[1].pkgs.apt = 'different-git';
  const tamperedBytes = Buffer.from(`${JSON.stringify(tamperedCatalog)}\n`);
  const rebound = { ...imported, catalog: { sha256: createHash('sha256').update(tamperedBytes).digest('hex') } };
  await assert.rejects(reconstructPortablePlanDraft({ profileExport: rebound, facts: freshFacts, catalogBytes: tamperedBytes }), /export digest mismatch|recipe closure/);
});
