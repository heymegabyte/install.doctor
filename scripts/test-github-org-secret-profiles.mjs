#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRepositoryProfiles, fetchPublicRepositories } from './reconcile-github-org-secret-profiles.mjs';

const inventory = JSON.parse(readFileSync(new URL('../config/infisical/github-org-repository-profiles.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../config/infisical/estate-secret-profiles.json', import.meta.url), 'utf8'));
const result = validateRepositoryProfiles(inventory, manifest);
assert.equal(result.repositoryCount, 10);
assert.deepEqual(result.runtimeGaps, ['bz.rocks', 'crawl.cheap', 'deskl.ink', 'ghost.claims', 'megabyte.space']);

const live = inventory.repositories.map(({ id, name, defaultBranch, archived, disabled }) => ({ id, name, defaultBranch, archived, disabled }));
assert.equal(validateRepositoryProfiles(inventory, manifest, live).repositoryCount, 10);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: inventory.repositories.slice(1) }, manifest, live), /listing drift/);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: inventory.repositories.map((repo, index) => index ? repo : { ...repo, secretAuthority: 'local' }) }, manifest), /Infisical authority/);
assert.throws(() => validateRepositoryProfiles({ ...inventory, repositories: [...inventory.repositories, inventory.repositories[0]] }, manifest), /duplicate repository id/);

const fetched = await fetchPublicRepositories('heymegabyte', async () => new Response(JSON.stringify([
  { id: 1, name: 'one', default_branch: 'main', archived: false, disabled: false },
])));
assert.deepEqual(fetched, [{ id: 1, name: 'one', defaultBranch: 'main', archived: false, disabled: false }]);
console.log('github org secret profile tests: PASS');
