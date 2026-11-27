#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRepositoryProfiles, fetchPublicRepositories } from './reconcile-github-org-secret-profiles.mjs';
import { selectConfigurationSecrets, selectHostSecrets, validateManifest } from './infisical-estate-reconcile.mjs';

const inventory = JSON.parse(readFileSync(new URL('../config/infisical/github-org-repository-profiles.json', import.meta.url), 'utf8'));
const manifest = validateManifest(JSON.parse(readFileSync(new URL('../config/infisical/estate-secret-profiles.json', import.meta.url), 'utf8')));
const result = validateRepositoryProfiles(inventory, manifest);
assert.equal(result.repositoryCount, 10);
assert.deepEqual(result.runtimeGaps, []);

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
  assert.deepEqual(
    selectHostSecrets(manifest, host, [...bzSecrets, ...deskSecrets]),
    host === 'ubuntu.megabyte.space' ? ['ANTHROPIC_API_KEY'] : [],
  );
}
assert.deepEqual(selectConfigurationSecrets(manifest, manifest.workloads['mcp.megabyte.space'], [...bzSecrets, ...deskSecrets]), []);
const sentryAdminSecrets = ['SENTRY_API_KEY', 'SENTRY_AUTH_TOKEN'];
for (const host of ['macos.megabyte.space', 'ubuntu.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, sentryAdminSecrets), sentryAdminSecrets);
}
for (const host of ['zen.megabyte.space', 'legion.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, sentryAdminSecrets), []);
}
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['mcp.megabyte.space'], sentryAdminSecrets,
), sentryAdminSecrets);
const posthogAdminSecrets = ['POSTHOG_HOST', 'POSTHOG_PERSONAL_API_KEY'];
for (const host of ['macos.megabyte.space', 'ubuntu.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, posthogAdminSecrets), posthogAdminSecrets);
}
for (const host of ['zen.megabyte.space', 'legion.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, posthogAdminSecrets), []);
}
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['mcp.megabyte.space'], posthogAdminSecrets,
), posthogAdminSecrets);
const langfuseSdkSecrets = ['LANGFUSE_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'];
const langfuseRuntimeSecrets = ['LANGFUSE_REDIS_URL', 'LANGFUSE_SMTP_CONNECTION_URL'];
const blockedLangfuseSecrets = [
  'LANGFUSE_BASE_URL', 'LANGFUSE_DATABASE_URL', 'LANGFUSE_CLICKHOUSE_HOST',
  'LANGFUSE_CLICKHOUSE_PASSWORD', 'LANGFUSE_ENCRYPTION_KEY', 'LANGFUSE_NEXTAUTH_SECRET', 'LANGFUSE_SALT',
];
assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', [
  ...langfuseSdkSecrets, ...langfuseRuntimeSecrets, ...blockedLangfuseSecrets,
]), langfuseSdkSecrets);
assert.deepEqual(selectHostSecrets(manifest, 'ubuntu.megabyte.space', [
  ...langfuseSdkSecrets, ...langfuseRuntimeSecrets, ...blockedLangfuseSecrets,
]), [...langfuseSdkSecrets, ...langfuseRuntimeSecrets].sort());
for (const host of ['zen.megabyte.space', 'legion.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, [
    ...langfuseSdkSecrets, ...langfuseRuntimeSecrets, ...blockedLangfuseSecrets,
  ]), []);
}
const blockedInfrastructureSecrets = [
  'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'TAILSCALE_AUTH_KEY', 'WASABI_CLIENT_ID', 'WASABI_CLIENT_SECRET',
  'PYPI_TOKEN',
  'NETDATA_ROOM', 'NETDATA_TOKEN', 'POSTHOG_API_KEY', 'POSTHOG_PUBLIC_KEY', 'SENTRY_DSN_CLIENT',
  'SENTRY_OAUTH_CLIENT_ID', 'SENTRY_OAUTH_CLIENT_SECRET',
];
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, blockedInfrastructureSecrets), []);
}
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['crawl.cheap'], ['EXA_API_KEY', 'SENTRY_DSN', 'ANTHROPIC_API_KEY'],
), ['EXA_API_KEY', 'SENTRY_DSN']);
const ghostSecrets = [
  'ANTHROPIC_API_KEY', 'HASS_ACCESS_CLIENT_ID', 'HASS_ACCESS_CLIENT_SECRET', 'HASS_SERVER', 'HASS_TOKEN',
  'SENTRY_DSN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
];
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['ghost.claims'], [...ghostSecrets, 'LISTMONK_API_TOKEN'],
), ghostSecrets.sort());
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['mcp.megabyte.space'], ghostSecrets,
), []);
assert.deepEqual(selectConfigurationSecrets(
  manifest, manifest.workloads['megabyte.space'], ghostSecrets,
), []);

const fetched = await fetchPublicRepositories('heymegabyte', async () => new Response(JSON.stringify([
  { id: 1, name: 'one', default_branch: 'main', archived: false, disabled: false },
])));
assert.deepEqual(fetched, [{ id: 1, name: 'one', defaultBranch: 'main', archived: false, disabled: false }]);
console.log('github org secret profile tests: PASS');
