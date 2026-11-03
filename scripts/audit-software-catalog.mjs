#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = new Set(process.argv.slice(2));
const outputArg = process.argv.find((value) => value.startsWith('--output='));
const output = outputArg?.slice('--output='.length) || 'artifacts/software-catalog-audit.json';
const definitions = JSON.parse(execFileSync('yq', ['-o=json', '.', 'software.yml'], { encoding: 'utf8' }));
const packages = definitions.softwarePackages || {};
const recipeKeys = new Set(Object.values(definitions.installerPreference || {}).flat());
const now = new Date().toISOString();

function githubRepo(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/#]+?)(?:\.git)?\/?$/i);
  return match?.[1] || null;
}

function capabilities(item) {
  const text = `${item._name || ''} ${item._short || ''} ${item._desc || ''}`.toLowerCase();
  return [
    item._app && 'gui', item._service && 'service', item._bin && 'cli',
    /\b(ai|llm|gpt|agent|model)\b/.test(text) && 'ai',
    /\b(web ui|web app|browser|dashboard|server)\b/.test(text) && 'web-ui',
  ].filter(Boolean);
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length || 1) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

const rows = Object.entries(packages).map(([key, item]) => {
  const recipes = Object.keys(item).filter((field) => recipeKeys.has(field.split(':')[0]));
  return {
    key,
    name: String(item._name || key).trim(),
    short: String(item._short || item._desc || `Install ${key}`).trim(),
    github: githubRepo(item._github),
    stars: null,
    archived: null,
    pushedAt: null,
    capabilities: capabilities(item),
    recipes,
    default: item._default !== false,
    preload: item._preload === true,
    deprecated: Boolean(item._deprecated),
    recommendation: item._default === false || item._deprecated ? 'on-demand' : (item._preload ? 'keep-default' : 'catalog-only'),
    issues: [
      !item._name && 'missing-name', !item._short && 'missing-short', !item._desc && 'missing-description',
      item._github === undefined && 'missing-github-decision', recipes.length === 0 && 'missing-install-recipe',
      item._preload === true && item._default === false && 'preload-default-conflict',
    ].filter(Boolean),
  };
});

if (args.has('--github')) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'install-doctor-catalog-audit' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  await mapLimit(rows.filter((row) => row.github), 8, async (row) => {
    const response = await fetch(`https://api.github.com/repos/${row.github}`, { headers });
    if (!response.ok) { row.issues.push(`github-http-${response.status}`); return; }
    const data = await response.json();
    row.stars = data.stargazers_count;
    row.archived = data.archived;
    row.pushedAt = data.pushed_at;
    if (data.archived) row.recommendation = 'remove-or-replace';
  });
}

rows.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.key.localeCompare(b.key));
const report = {
  schemaVersion: 1,
  generatedAt: now,
  scoringPolicy: 'security/maintenance/role-fit gates; GitHub stars break ties within a capability cohort; AI and web UI receive preference bonuses',
  summary: {
    total: rows.length,
    defaults: rows.filter((row) => row.default).length,
    preloads: rows.filter((row) => row.preload).length,
    deprecated: rows.filter((row) => row.deprecated).length,
    incomplete: rows.filter((row) => row.issues.length).length,
  },
  software: rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`${rows.length} entries audited; report written to ${output}`);
