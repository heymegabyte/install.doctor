#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRepositoryProfiles, fetchPublicRepositories } from './reconcile-github-org-secret-profiles.mjs';
import { selectConfigurationSecrets, selectHostSecrets, validateManifest } from './infisical-estate-reconcile.mjs';

const inventory = JSON.parse(readFileSync(new URL('../config/infisical/github-org-repository-profiles.json', import.meta.url), 'utf8'));
const manifest = validateManifest(JSON.parse(readFileSync(new URL('../config/infisical/estate-secret-profiles.json', import.meta.url), 'utf8')));
const result = validateRepositoryProfiles(inventory, manifest);
assert.equal(result.repositoryCount, 10);
assert.deepEqual(result.runtimeGaps, ['ghost.claims', 'megabyte.space']);

const live = inventory.repositories.map(({ id, name, defaultBranch, archived, disabled }) => ({ id, name, defaultBranch, archived, disabled }));
assert.equal(validateRepositoryProfiles(inventory, manifest, live).repositoryCount, 10);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: inventory.repositories.slice(1) }, manifest, live), /listing drift/);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: inventory.repositories.map((repo, index) => index ? repo : { ...repo, secretAuthority: 'local' }) }, manifest), /Infisical authority/);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: [...inventory.repositories, inventory.repositories[0]] }, manifest), /duplicate repository id/);

const bzSecrets = ['ANTHROPIC_API_KEY', 'LISTMONK_API_TOKEN'];
const deskSecrets = [
  'BETTER_AUTH_SECRET', 'CLOUDFLARE_ACCOUNT_ID', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
assert.deepEqual(selectConfigurationSecrets(manifest, manifest.workloads['bz.rocks'], [...bzSecrets, ...deskSecrets]), bzSecrets);
assert.deepEqual(selectConfigurationSecrets(manifest, manifest.workloads['deskl.ink'], [...bzSecrets, ...deskSecrets]), deskSecrets.sort());
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, [...bzSecrets, ...deskSecrets]), []);
}
assert.deepEqual(selectConfigurationSecrets(manifest, manifest.workloads['mcp.megabyte.space'], [...bzSecrets, ...deskSecrets]), []);
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['crawl.cheap'], ['EXA_API_KEY', 'SENTRY_DSN', 'ANTHROPIC_API_KEY'],
), ['EXA_API_KEY', 'SENTRY_DSN']);

const fetched = await fetchPublicRepositories('heymegabyte', async () => new Response(JSON.stringify([
  { id: 1, name: 'one', default_branch: 'main', archived: false, disabled: false },
])));
assert.deepEqual(fetched, [{ id: 1, name: 'one', defaultBranch: 'main', archived: false, disabled: false }]);
console.log('github org secret profile tests: PASS');
