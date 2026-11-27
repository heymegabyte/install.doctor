import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  buildInstallDoctorProvisioningSpec,
  validateThemeToolsResearchProvisioningManifest,
} from '../dist/theme-tools-research-provisioning.js';

/** @template T @param {T | undefined} value */
function requiredFixture(value) {
  assert.ok(value !== undefined, 'expected the fixture entry to exist');
  return value;
}

const fixture = () => ({
  schemaVersion: 1,
  revision: 'research-platform-1',
  environment: 'staging',
  accountReference: 'cloudflare-account://theme-tools',
  worker: {
    serviceName: 'theme-tools-research-staging',
    compatibilityDate: '2026-11-22',
    migrationsOwner: '@theme.tools/crawl-research',
  },
  broker: {
    endpoint: 'https://research.theme.tools',
    serviceTokenEnvironmentVariable: 'THEME_RESEARCH_SERVICE_TOKEN',
  },
  workloadIdentity: {
    id: 'theme-tools-research',
    provider: 'infisical',
    authMode: 'workload-identity',
    secretPath: '/workloads/theme-tools-research',
  },
  secretReferences: [
    {
      secretName: 'THEME_RESEARCH_SERVICE_TOKEN',
      environmentVariable: 'THEME_RESEARCH_SERVICE_TOKEN',
      reference: 'infisical://workloads/theme-tools-research/THEME_RESEARCH_SERVICE_TOKEN',
      required: true,
    },
    {
      secretName: 'RESEARCH_TOKEN_ENCRYPTION_KEY',
      environmentVariable: 'RESEARCH_TOKEN_ENCRYPTION_KEY',
      reference: 'infisical://workloads/theme-tools-research/RESEARCH_TOKEN_ENCRYPTION_KEY',
      required: true,
    },
    {
      secretName: 'RESEARCH_BROWSER_DESCRIPTOR_KEY',
      environmentVariable: 'RESEARCH_BROWSER_DESCRIPTOR_KEY',
      reference: 'infisical://workloads/theme-tools-research/RESEARCH_BROWSER_DESCRIPTOR_KEY',
      required: true,
    },
    {
      secretName: 'LANGFUSE_SECRET_KEY',
      environmentVariable: 'LANGFUSE_SECRET_KEY',
      reference: 'infisical://workloads/theme-tools-research/LANGFUSE_SECRET_KEY',
      required: false,
    },
  ],
  resources: [
    { id: 'metadata', role: 'd1_metadata', binding: 'RESEARCH_DB', resourceName: 'theme-research-staging', migrationsDirectory: 'packages/crawl-research/migrations' },
    { id: 'evidence', role: 'r2_evidence', binding: 'RESEARCH_EVIDENCE', resourceName: 'theme-research-evidence-staging', jurisdiction: 'default' },
    { id: 'catalog', role: 'kv_catalog', binding: 'RESEARCH_CONFIG', resourceName: 'theme-research-config-staging' },
    { id: 'jobs', role: 'queue_jobs', binding: 'RESEARCH_JOBS', resourceName: 'theme-research-jobs-staging', deadLetterResourceId: 'jobs-dlq', maximumRetries: 5 },
    { id: 'jobs-dlq', role: 'queue_dlq', binding: 'RESEARCH_JOBS_DLQ', resourceName: 'theme-research-jobs-dlq-staging' },
    { id: 'runs', role: 'durable_object_runs', binding: 'RESEARCH_RUNS', resourceName: 'theme-research-runs-staging', className: 'ResearchRunCoordinator' },
    { id: 'workflow', role: 'workflow_research', binding: 'RESEARCH_WORKFLOW', resourceName: 'theme-research-workflow-staging', className: 'DeepResearchWorkflow' },
    { id: 'browser', role: 'browser_rendering', binding: 'BROWSER', resourceName: 'theme-research-browser-staging' },
    { id: 'ai', role: 'workers_ai', binding: 'AI', resourceName: 'theme-research-ai-staging' },
    { id: 'events', role: 'service_binding', binding: 'INTEGRATION_EVENTS', resourceName: 'theme-integration-events-staging', serviceName: 'theme-integration-events', entrypoint: 'IntegrationEventService' },
  ],
  runtimeServices: [
    { id: 'research-workflow', serviceName: 'theme-tools-research-staging', environment: 'staging', accountReference: 'cloudflare-account://theme-tools', role: 'workflow' },
    { id: 'research-branch', serviceName: 'theme-tools-research-branch-staging', environment: 'staging', accountReference: 'cloudflare-account://theme-tools', role: 'branch' },
    { id: 'research-browser-egress', serviceName: 'theme-tools-research-browser-egress-staging', environment: 'staging', accountReference: 'cloudflare-account://theme-tools', role: 'browser_egress' },
    { id: 'research-egress', serviceName: 'theme-tools-research-egress-staging', environment: 'staging', accountReference: 'cloudflare-account://theme-tools', role: 'policy_egress' },
  ],
  runtimeSecretBindings: [
    { serviceId: 'research-branch', environmentVariable: 'RESEARCH_BROWSER_DESCRIPTOR_KEY', secretName: 'RESEARCH_BROWSER_DESCRIPTOR_KEY' },
    { serviceId: 'research-browser-egress', environmentVariable: 'RESEARCH_BROWSER_DESCRIPTOR_KEY', secretName: 'RESEARCH_BROWSER_DESCRIPTOR_KEY' },
  ],
  internalBindings: [{
    id: 'workflow-branch-executor', role: 'branch_executor', sourceServiceId: 'research-workflow', targetServiceId: 'research-branch',
    binding: 'RESEARCH_BRANCH_EXECUTOR', targetEntrypoint: 'ResearchBranchService',
    props: {
      schemaVersion: '1.0.0', searchProviderId: 'searxng-staging', searchEndpoint: 'https://search.research.theme.tools',
      searchReadiness: 'declared', egressPolicyReference: 'theme-egress://research/staging', retentionMs: 7_776_000_000,
      maximumParallelFetches: 4, browserEgressPolicy: 'policy_routed_v1', browserVirtualHostname: 'research-browser.invalid',
    },
  }, {
    id: 'branch-policy-egress', role: 'policy_egress', sourceServiceId: 'research-branch', targetServiceId: 'research-egress',
    binding: 'RESEARCH_EGRESS', policyReference: 'theme-egress://research/staging', directFetchFallback: false,
  }, {
    id: 'branch-browser-egress', role: 'browser_egress', sourceServiceId: 'research-branch', targetServiceId: 'research-browser-egress',
    binding: 'RESEARCH_BROWSER_EGRESS', targetEntrypoint: 'ResearchBrowserEgressService', directFetchFallback: false,
    props: { schemaVersion: '1.0.0', virtualHostname: 'research-browser.invalid', maximumResponseBytes: 2_000_000 },
  }, {
    id: 'browser-policy-egress', role: 'policy_egress', sourceServiceId: 'research-browser-egress', targetServiceId: 'research-egress',
    binding: 'RESEARCH_EGRESS', policyReference: 'theme-egress://research/staging', directFetchFallback: false,
  }],
  consumerBindings: [{
    id: 'oneprompt-research',
    consumerServiceName: 'oneprompt',
    consumerEnvironment: 'staging',
    binding: 'RESEARCH',
    targetServiceName: 'theme-tools-research-staging',
    targetEnvironment: 'staging',
    targetEntrypoint: 'ResearchService',
    authorityGrantReference: 'theme-authority://research/consumers/oneprompt-staging',
    bindingProps: {
      schemaVersion: 1,
      consumerId: 'oneprompt',
      environmentId: 'staging',
      authorityGrantReference: 'theme-authority://research/consumers/oneprompt-staging',
      tenantScopeHeader: 'x-oneprompt-site-id',
      actorScopeHeader: 'x-oneprompt-job-id',
    },
  }, {
    id: 'projectsites-research',
    consumerServiceName: 'project-sites',
    consumerEnvironment: 'staging',
    binding: 'RESEARCH',
    targetServiceName: 'theme-tools-research-staging',
    targetEnvironment: 'staging',
    targetEntrypoint: 'ResearchService',
    authorityGrantReference: 'theme-authority://research/consumers/projectsites-staging',
    bindingProps: {
      schemaVersion: 1,
      consumerId: 'project-sites',
      environmentId: 'staging',
      authorityGrantReference: 'theme-authority://research/consumers/projectsites-staging',
      tenantScopeHeader: 'x-projectsites-org-id',
      actorScopeHeader: 'x-projectsites-actor-id',
    },
  }],
  retention: { evidenceDays: 90, eventDays: 30, usageDays: 365 },
});

void test('accepts the complete Cloudflare and Infisical desired-state topology', () => {
  const validated = validateThemeToolsResearchProvisioningManifest(fixture());
  assert.equal(validated.resources.length, 10);
  assert.equal(validated.workloadIdentity.secretPath, '/workloads/theme-tools-research');
});

void test('validates the canonical value-free staging manifest', () => {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync('../../config/theme-tools/deep-research.staging.json', 'utf8'));
  const validated = validateThemeToolsResearchProvisioningManifest(manifest);
  assert.equal(validated.environment, 'staging');
  assert.deepEqual(buildInstallDoctorProvisioningSpec(manifest).actions, buildInstallDoctorProvisioningSpec(fixture()).actions);
});

void test('builds a stable non-mutating idempotent dry-run plan with rollback metadata', () => {
  const first = buildInstallDoctorProvisioningSpec(fixture());
  const second = buildInstallDoctorProvisioningSpec(fixture());
  assert.deepEqual(first, second);
  assert.equal(first.mutationAllowed, false);
  assert.equal(first.mode, 'dry-run');
  assert.equal(new Set(first.actions.map(action => action.idempotencyKey)).size, first.actions.length);
  for (const action of first.actions) {
    assert.equal(action.mutationAllowed, false);
    assert.ok(action.rollback.length > 0);
  }
  assert.match(first.externalRequirements.join('\n'), /Cloudflare account authority/);
  assert.ok(first.actions.some(action => action.operation === 'ensure-consumer-service-binding' && action.target.includes('oneprompt:RESEARCH')));
  assert.ok(first.actions.some(action => action.operation === 'validate-consumer-authority' && action.target.includes('theme-authority:\/\/research\/consumers\/oneprompt-staging')));
  assert.ok(first.actions.some(action => action.operation === 'ensure-internal-service-binding' && action.target.includes('RESEARCH_BRANCH_EXECUTOR')));
  assert.ok(first.actions.some(action => action.operation === 'validate-branch-entrypoint-props' && action.target.includes('ResearchBranchService')));
  assert.ok(first.actions.some(action => action.operation === 'validate-egress-policy-binding' && action.target.includes('theme-egress:\/\/research\/staging')));
  assert.ok(first.actions.some(action => action.operation === 'validate-browser-egress-entrypoint' && action.target.includes('ResearchBrowserEgressService:research-browser.invalid')));
  assert.ok(first.actions.some(action => action.operation === 'validate-browser-descriptor-key-reference' && action.target.includes('infisical:\/\/workloads\/theme-tools-research\/RESEARCH_BROWSER_DESCRIPTOR_KEY')));
  const bindingAction = first.actions.find(action => action.operation === 'ensure-consumer-service-binding');
  assert.ok(bindingAction);
  assert.deepEqual(bindingAction.rollback, ['preserve-existing-binding', 'remove-only-new-binding']);
});

void test('rejects plaintext secrets, mismatched fixed leaves, and unknown fields', () => {
  const plaintext = fixture();
  requiredFixture(plaintext.secretReferences[0]).reference = 'hunter2';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(plaintext));
  const mismatched = fixture();
  mismatched.workloadIdentity.secretPath = '/workloads/shared-identity';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(mismatched), /fixed secret leaf/);
  assert.throws(() => validateThemeToolsResearchProvisioningManifest({ ...fixture(), token: 'secret' }));
});

void test('requires a credential-free HTTPS broker endpoint and fixed service-token reference', () => {
  const unsafeEndpoint = fixture();
  unsafeEndpoint.broker.endpoint = 'https://token@example.com/research';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(unsafeEndpoint), /credential-free HTTPS/);
  const missingToken = fixture();
  missingToken.secretReferences = missingToken.secretReferences.filter(secret => secret.secretName !== 'THEME_RESEARCH_SERVICE_TOKEN');
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(missingToken), /fixed THEME_RESEARCH_SERVICE_TOKEN/);
  const plan = buildInstallDoctorProvisioningSpec(fixture());
  assert.ok(plan.actions.some(action => action.operation === 'ensure-config-reference' && action.target === 'THEME_RESEARCH_ENDPOINT:https://research.theme.tools'));
});

void test('rejects duplicate bindings and queue references without a declared DLQ', () => {
  const duplicate = fixture();
  requiredFixture(duplicate.resources[1]).binding = requiredFixture(duplicate.resources[0]).binding;
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(duplicate), /Binding names must be unique/);
  const missingDlq = fixture();
  const queueJob = requiredFixture(missingDlq.resources.find(resource => resource.role === 'queue_jobs'));
  queueJob.deadLetterResourceId = 'missing';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(missingDlq), /declared DLQ/);
});

void test('rejects incomplete topologies instead of silently provisioning a partial runtime', () => {
  const incomplete = fixture();
  incomplete.resources = incomplete.resources.filter(resource => resource.role !== 'browser_rendering');
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(incomplete), /browser_rendering/);
});

void test('rejects duplicate consumer bindings and target or environment drift', () => {
  const duplicate = fixture();
  duplicate.consumerBindings.push({ ...requiredFixture(duplicate.consumerBindings[0]), id: 'oneprompt-research-copy' });
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(duplicate), /Consumer service binding names must be unique/);

  const wrongTarget = fixture();
  requiredFixture(wrongTarget.consumerBindings[0]).targetServiceName = 'attacker-worker';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongTarget), /canonical research Worker/);

  const wrongEnvironment = fixture();
  requiredFixture(wrongEnvironment.consumerBindings[0]).consumerEnvironment = 'production';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongEnvironment), /manifest environment/);
});

void test('consumer binding declarations reject credentials and unknown authority shapes', () => {
  const token = fixture();
  Object.assign(requiredFixture(token.consumerBindings[0]), { token: 'secret' });
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(token));

  const unsafeAuthority = fixture();
  requiredFixture(unsafeAuthority.consumerBindings[0]).authorityGrantReference = 'https://user:secret@example.com/grant';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(unsafeAuthority));

  const forgedProps = fixture();
  requiredFixture(forgedProps.consumerBindings[0]).bindingProps.consumerId = 'another-product';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(forgedProps), /exactly attest/);
});

void test('rejects duplicate, undeclared, and environment-drifted internal runtime topology', () => {
  const duplicate = fixture();
  duplicate.internalBindings.push({ ...requiredFixture(duplicate.internalBindings[1]), id: 'duplicate-egress' });
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(duplicate));

  const undeclared = fixture();
  requiredFixture(undeclared.internalBindings[0]).targetServiceId = 'missing-branch';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(undeclared), /declared runtime services/);

  const drift = fixture();
  requiredFixture(drift.runtimeServices[1]).environment = 'production';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(drift), /manifest environment/);

  const wrongWorkflowOwner = fixture();
  requiredFixture(wrongWorkflowOwner.runtimeServices[0]).serviceName = 'another-research-worker';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongWorkflowOwner), /canonical research Worker/);
});

void test('rejects unsafe branch properties and egress policy mismatch', () => {
  for (const endpoint of ['https://user:secret@search.example.test', 'https://search.example.test/?token=secret', 'http://search.example.test']) {
    const unsafeEndpoint = fixture();
    requiredFixture(requiredFixture(unsafeEndpoint.internalBindings[0]).props).searchEndpoint = endpoint;
    assert.throws(() => validateThemeToolsResearchProvisioningManifest(unsafeEndpoint));
  }

  const concurrency = fixture();
  requiredFixture(requiredFixture(concurrency.internalBindings[0]).props).maximumParallelFetches = 17;
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(concurrency));

  const policyMismatch = fixture();
  requiredFixture(policyMismatch.internalBindings[1]).policyReference = 'theme-egress://research/other';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(policyMismatch), /one authoritative egress policy/);

  const browserHostname = fixture();
  requiredFixture(requiredFixture(browserHostname.internalBindings[0]).props).browserVirtualHostname = 'another-browser.invalid';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(browserHostname));

  const fallback = fixture();
  requiredFixture(fallback.internalBindings[1]).directFetchFallback = true;
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(fallback));
});

void test('internal binding declarations reject credentials and preserve narrow rollback', () => {
  const credential = fixture();
  Object.assign(requiredFixture(credential.internalBindings[1]), { token: 'secret' });
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(credential));

  const actions = buildInstallDoctorProvisioningSpec(fixture()).actions.filter(action => action.operation === 'ensure-internal-service-binding');
  assert.equal(actions.length, 4);
  assert.ok(actions.every(action => JSON.stringify(action.rollback) === JSON.stringify(['preserve-existing-binding', 'remove-only-new-binding'])));
});

void test('requires the exact policy-routed Browser Run chain and fixed descriptor-key reference', () => {
  const missingKey = fixture();
  missingKey.secretReferences = missingKey.secretReferences.filter(secret => secret.secretName !== 'RESEARCH_BROWSER_DESCRIPTOR_KEY');
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(missingKey), /fixed RESEARCH_BROWSER_DESCRIPTOR_KEY/);

  const wrongKeyLeaf = fixture();
  requiredFixture(wrongKeyLeaf.secretReferences.find(secret => secret.secretName === 'RESEARCH_BROWSER_DESCRIPTOR_KEY')).reference = 'infisical://workloads/other/RESEARCH_BROWSER_DESCRIPTOR_KEY';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongKeyLeaf));

  const wrongEntrypoint = fixture();
  requiredFixture(wrongEntrypoint.internalBindings.find(binding => binding.role === 'browser_egress')).targetEntrypoint = 'OtherBrowserService';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongEntrypoint));

  const wrongVirtualHost = fixture();
  requiredFixture(requiredFixture(wrongVirtualHost.internalBindings.find(binding => binding.role === 'browser_egress')).props).virtualHostname = 'other-browser.invalid';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(wrongVirtualHost));

  const missingBrowser = fixture();
  missingBrowser.resources = missingBrowser.resources.filter(resource => resource.role !== 'browser_rendering');
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(missingBrowser), /browser_rendering|BROWSER/);

  const browserDirectFallback = fixture();
  requiredFixture(browserDirectFallback.internalBindings.find(binding => binding.role === 'browser_egress')).directFetchFallback = true;
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(browserDirectFallback));

  const missingVerifierBinding = fixture();
  requiredFixture(missingVerifierBinding.runtimeSecretBindings[1]).serviceId = 'research-workflow';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(missingVerifierBinding), /branch and Browser egress services/);
});

void test('requires Browser and ordinary retrieval to terminate at one environment-aligned policy service', () => {
  const policyTargetDrift = fixture();
  requiredFixture(policyTargetDrift.internalBindings.find(binding => binding.id === 'browser-policy-egress')).targetServiceId = 'research-branch';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(policyTargetDrift), /policy-egress service/);

  const accountDrift = fixture();
  requiredFixture(accountDrift.runtimeServices.find(service => service.role === 'browser_egress')).accountReference = 'cloudflare-account://other';
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(accountDrift), /Cloudflare account/);

  const oversized = fixture();
  requiredFixture(requiredFixture(oversized.internalBindings.find(binding => binding.role === 'browser_egress')).props).maximumResponseBytes = 10_000_001;
  assert.throws(() => validateThemeToolsResearchProvisioningManifest(oversized));
});
