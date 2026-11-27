#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = resolve(root, 'config/infisical/github-org-repository-profiles.json');
const manifestPath = resolve(root, 'config/infisical/estate-secret-profiles.json');

function fail(message) {
  throw new Error(`github-org-secret-profiles: ${message}`);
}

export function validateRepositoryProfiles(inventory, manifest, liveRepositories = null) {
  if (inventory?.schemaVersion !== 1 || inventory.organization !== 'heymegabyte' || inventory.visibility !== 'public') {
    fail('invalid inventory identity');
  }
  if (!Array.isArray(inventory.repositories) || inventory.repositories.length === 0) fail('empty repository inventory');
  const names = new Set();
  const ids = new Set();
  const gaps = [];
  for (const repository of inventory.repositories) {
    if (!Number.isSafeInteger(repository.id) || repository.id <= 0 || ids.has(repository.id)) fail('invalid or duplicate repository id');
    if (!/^[A-Za-z0-9._-]+$/.test(repository.name ?? '') || names.has(repository.name)) fail('invalid or duplicate repository name');
    if (!['main', 'master'].includes(repository.defaultBranch) || typeof repository.archived !== 'boolean' || typeof repository.disabled !== 'boolean') {
      fail(`invalid public metadata for ${repository.name}`);
    }
    if (repository.secretAuthority !== 'infisical') fail(`${repository.name} does not declare Infisical authority`);
    if (!['runtime', 'non-runtime', 'control-plane'].includes(repository.disposition) || typeof repository.reason !== 'string' || !repository.reason) {
      fail(`invalid secret disposition for ${repository.name}`);
    }
    if (repository.disposition === 'runtime') {
      if (!repository.infisicalWorkload || repository.runtimeReady !== true) gaps.push(repository.name);
      if (repository.infisicalWorkload) {
        const workload = manifest?.workloads?.[repository.infisicalWorkload];
        if (!workload) fail(`${repository.name} references unknown workload ${repository.infisicalWorkload}`);
        if (!Array.isArray(manifest.profiles?.[workload.profile])) {
          fail(`${repository.name} references an unknown workload profile`);
        }
        if (manifest.profiles[workload.profile].length === 0 && repository.secretlessRuntime !== true) {
          fail(`${repository.name} references an empty workload profile`);
        }
        if (manifest.profiles[workload.profile].length > 0 && repository.secretlessRuntime === true) {
          fail(`${repository.name} claims a secretless runtime with a non-empty profile`);
        }
      }
    } else if (repository.infisicalWorkload !== null) {
      fail(`${repository.name} cannot bind a workload with ${repository.disposition} disposition`);
    }
    ids.add(repository.id);
    names.add(repository.name);
  }
  if (liveRepositories) {
    const live = [...liveRepositories].sort((a, b) => a.name.localeCompare(b.name));
    const recorded = [...inventory.repositories].sort((a, b) => a.name.localeCompare(b.name));
    if (live.length !== recorded.length) fail(`public listing drift: expected ${recorded.length}, observed ${live.length}`);
    for (let index = 0; index < recorded.length; index += 1) {
      const expected = recorded[index];
      const actual = live[index];
      for (const field of ['id', 'name', 'defaultBranch', 'archived', 'disabled']) {
        if (actual[field] !== expected[field]) fail(`public listing drift for ${expected.name}: ${field}`);
      }
    }
  }
  return { repositoryCount: inventory.repositories.length, runtimeGapCount: gaps.length, runtimeGaps: gaps.sort() };
}

export async function fetchPublicRepositories(organization, fetcher = fetch) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const response = await fetcher(`https://api.github.com/orgs/${organization}/repos?type=public&per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'install.doctor-profile-reconciler' },
    });
    if (!response.ok) fail(`GitHub public listing returned HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) fail('GitHub public listing returned an invalid payload');
    repositories.push(...batch.map((repository) => ({
      id: repository.id,
      name: repository.name,
      defaultBranch: repository.default_branch,
      archived: repository.archived,
      disabled: repository.disabled,
    })));
    if (batch.length < 100) break;
  }
  return repositories;
}

async function main(args) {
  const live = args.includes('--live');
  const requireComplete = args.includes('--require-complete');
  if (args.some((argument) => !['--live', '--require-complete'].includes(argument))) fail('unknown argument');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const repositories = live ? await fetchPublicRepositories(inventory.organization) : null;
  const result = validateRepositoryProfiles(inventory, manifest, repositories);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, live, ...result }, null, 2)}\n`);
  if (requireComplete && result.runtimeGapCount > 0) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
