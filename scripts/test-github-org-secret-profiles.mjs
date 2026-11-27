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
  'NETDATA_ROOM', 'NETDATA_TOKEN', 'POSTHOG_API_KEY', 'POSTHOG_PUBLIC_KEY', 'SENTRY_DSN_CLIENT',
  'SENTRY_OAUTH_CLIENT_ID', 'SENTRY_OAUTH_CLIENT_SECRET',
];
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, blockedInfrastructureSecrets), []);
}
assert.deepEqual(selectHostSecrets(manifest, 'macos.megabyte.space', ['PYPI_TOKEN']), ['PYPI_TOKEN']);
for (const host of ['ubuntu.megabyte.space', 'zen.megabyte.space', 'legion.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['PYPI_TOKEN']), []);
}
for (const workload of ['projectsites-brandfetch', 'swarmlink-brandfetch']) {
  assert.deepEqual(
    selectConfigurationSecrets(manifest, manifest.workloads[workload], ['BRANDFETCH_API_KEY']),
    ['BRANDFETCH_API_KEY'],
  );
}
for (const workload of ['projectsites.dev', 'swarml.ink', 'mcp.megabyte.space']) {
  assert.deepEqual(
    selectConfigurationSecrets(manifest, manifest.workloads[workload], ['BRANDFETCH_API_KEY']),
    [],
  );
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['BRANDFETCH_API_KEY']), []);
}
assert.deepEqual(
  selectConfigurationSecrets(
    manifest,
    manifest.workloads['njsk-slack-notifications'],
    ['SLACK_WEBHOOK_URL'],
  ),
  ['SLACK_WEBHOOK_URL'],
);
for (const workload of ['projectsites.dev', 'swarml.ink', 'mcp.megabyte.space', 'cloudflare-control-plane.megabyte.space']) {
  assert.deepEqual(
    selectConfigurationSecrets(manifest, manifest.workloads[workload], ['SLACK_WEBHOOK_URL']),
    [],
  );
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['SLACK_WEBHOOK_URL']), []);
}
const matrixSecrets = ['MATRIX_HOMESERVER', 'MATRIX_PASSWORD', 'MATRIX_USERNAME'];
assert.deepEqual(
  selectHostSecrets(manifest, 'macos.megabyte.space', matrixSecrets),
  matrixSecrets,
);
for (const host of ['ubuntu.megabyte.space', 'zen.megabyte.space', 'legion.megabyte.space']) {
  assert.deepEqual(selectHostSecrets(manifest, host, matrixSecrets), []);
}
for (const workload of Object.keys(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, manifest.workloads[workload], matrixSecrets), []);
}
assert.deepEqual(
  selectConfigurationSecrets(
    manifest,
    manifest.workloads['google-maps-credential-archive'],
    ['GOOGLE_MAPS_API_KEY'],
  ),
  ['GOOGLE_MAPS_API_KEY'],
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'google-maps-credential-archive') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, ['GOOGLE_MAPS_API_KEY']), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['GOOGLE_MAPS_API_KEY']), []);
}
const netdataSecrets = ['NETDATA_ROOM', 'NETDATA_TOKEN'];
assert.deepEqual(
  selectConfigurationSecrets(
    manifest,
    manifest.workloads['netdata-cloud.megabyte.space'],
    netdataSecrets,
  ),
  netdataSecrets,
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'netdata-cloud.megabyte.space') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, netdataSecrets), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, netdataSecrets), []);
}
const wasabiAccountSecrets = ['WASABI_CLIENT_ID', 'WASABI_CLIENT_SECRET'];
assert.deepEqual(
  selectConfigurationSecrets(
    manifest,
    manifest.workloads['wasabi-account-credential-archive'],
    wasabiAccountSecrets,
  ),
  wasabiAccountSecrets,
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'wasabi-account-credential-archive') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, wasabiAccountSecrets), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, wasabiAccountSecrets), []);
}
const newlyContainedSecrets = [
  'DITTOFEED_ADMIN_API_KEY', 'DITTOFEED_PUBLIC_WRITE_KEY', 'FLY_REDIS_SHARED_PASSWORD',
  'GRAPESJS_API_KEY', 'GRAPESJS_PUBLIC_KEY', 'LANGFLOW_API_KEY', 'LANGFLOW_DATABASE_URL',
  'LANGFLOW_SECRET_KEY', 'LANGFLOW_SUPERUSER_PASSWORD',
];
for (const configuration of Object.values(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, newlyContainedSecrets), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, newlyContainedSecrets), []);
}
const postizFacebookSecrets = [
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_OAUTH_ID', 'FACEBOOK_OAUTH_SECRET',
];
assert.deepEqual(
  selectConfigurationSecrets(
    manifest,
    manifest.workloads['postiz.megabyte.space'],
    postizFacebookSecrets,
  ),
  ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'postiz.megabyte.space') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, postizFacebookSecrets), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, postizFacebookSecrets), []);
}
for (const configuration of Object.values(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, ['TINYBIRD_WORKSPACE_ID']), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['TINYBIRD_WORKSPACE_ID']), []);
}
const retiredTinybirdMetadata = ['TINYBIRD_HOST', 'TINYBIRD_PORT', 'TINYBIRD_MCP_SERVER'];
for (const configuration of Object.values(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, retiredTinybirdMetadata), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, retiredTinybirdMetadata), []);
}
for (const configuration of Object.values(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, ['STRIPE_ACCOUNT_ID']), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['STRIPE_ACCOUNT_ID']), []);
}
assert.deepEqual(
  selectConfigurationSecrets(manifest, manifest.workloads['mcp.megabyte.space'], ['POSTIZ_API_KEY', 'POSTIZ_MCP_URL']),
  ['POSTIZ_API_KEY', 'POSTIZ_MCP_URL'],
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'mcp.megabyte.space') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, ['POSTIZ_API_KEY', 'POSTIZ_MCP_URL']), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['POSTIZ_API_KEY', 'POSTIZ_MCP_URL']), []);
}
for (const configuration of Object.values(manifest.workloads)) {
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, ['TWENTY_API_KEY']), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, ['TWENTY_API_KEY']), []);
}
const stripeMeterMetadata = [
  'STRIPE_METER_ID_AI_CALL', 'STRIPE_METER_ID_BYTES_EGRESS',
  'STRIPE_METER_ID_IMAGE_GENERATION', 'STRIPE_METER_IDS',
];
assert.deepEqual(
  selectConfigurationSecrets(manifest, manifest.workloads['stripe-meter-metadata-archive'], stripeMeterMetadata),
  [...stripeMeterMetadata].sort(),
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'stripe-meter-metadata-archive') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, stripeMeterMetadata), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, stripeMeterMetadata), []);
}
const stripeCreditPrices = [
  'STRIPE_PRICE_CREDITS_100', 'STRIPE_PRICE_CREDITS_500', 'STRIPE_PRICE_CREDITS_2000',
];
const stripeCreditAliases = [
  'STRIPE_PRICE_ID_CREDITS_100', 'STRIPE_PRICE_ID_CREDITS_500', 'STRIPE_PRICE_ID_CREDITS_2000',
];
assert.deepEqual(
  selectConfigurationSecrets(manifest, manifest.workloads['projectsites.dev'], [...stripeCreditPrices, ...stripeCreditAliases]),
  [...stripeCreditPrices].sort(),
);
for (const [workload, configuration] of Object.entries(manifest.workloads)) {
  if (workload === 'projectsites.dev') continue;
  assert.deepEqual(selectConfigurationSecrets(manifest, configuration, [...stripeCreditPrices, ...stripeCreditAliases]), []);
}
for (const host of Object.keys(manifest.hosts)) {
  assert.deepEqual(selectHostSecrets(manifest, host, [...stripeCreditPrices, ...stripeCreditAliases]), []);
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
