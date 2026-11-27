/** Pure desired-state contracts for provisioning theme.tools Deep Research infrastructure. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const bindingName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const resourceName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const infisicalReference = z.string().regex(/^infisical:\/\/workloads\/[a-z0-9][a-z0-9._-]{0,95}\/[A-Z][A-Z0-9_]{0,127}$/);
const authorityGrantReference = z.string().regex(/^theme-authority:\/\/[a-z0-9][a-z0-9._/-]{0,190}$/);
const cloudflareAccountReference = z.string().regex(/^cloudflare-account:\/\/[a-z0-9][a-z0-9._-]{0,95}$/);
const egressPolicyReference = z.string().regex(/^theme-egress:\/\/[A-Za-z0-9._:/-]{1,240}$/);
const deploymentEnvironment = z.enum(['development', 'staging', 'production']);

const baseResource = {
  id: identifier,
  binding: bindingName,
  resourceName,
};

const resourceSchema = z.discriminatedUnion('role', [
  z.object({ ...baseResource, role: z.literal('d1_metadata'), migrationsDirectory: z.string().regex(/^packages\/[a-z0-9/_-]+\/migrations$/) }).strict(),
  z.object({ ...baseResource, role: z.literal('r2_evidence'), jurisdiction: z.enum(['default', 'eu', 'fedramp']).default('default') }).strict(),
  z.object({ ...baseResource, role: z.literal('kv_catalog') }).strict(),
  z.object({ ...baseResource, role: z.literal('queue_jobs'), deadLetterResourceId: identifier, maximumRetries: z.number().int().min(1).max(100) }).strict(),
  z.object({ ...baseResource, role: z.literal('queue_dlq') }).strict(),
  z.object({ ...baseResource, role: z.literal('durable_object_runs'), className: z.literal('ResearchRunCoordinator') }).strict(),
  z.object({ ...baseResource, role: z.literal('workflow_research'), className: z.literal('DeepResearchWorkflow') }).strict(),
  z.object({ ...baseResource, role: z.literal('browser_rendering') }).strict(),
  z.object({ ...baseResource, role: z.literal('workers_ai') }).strict(),
  z.object({ ...baseResource, role: z.literal('service_binding'), serviceName: resourceName, entrypoint: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,95}$/) }).strict(),
]);

const consumerServiceBindingSchema = z.object({
  id: identifier,
  consumerServiceName: resourceName,
  consumerEnvironment: z.enum(['development', 'staging', 'production']),
  binding: bindingName,
  targetServiceName: resourceName,
  targetEnvironment: z.enum(['development', 'staging', 'production']),
  targetEntrypoint: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,95}$/).optional(),
  authorityGrantReference,
  bindingProps: z.object({
    schemaVersion: z.literal(1),
    consumerId: identifier,
    environmentId: identifier,
    authorityGrantReference,
    tenantScopeHeader: z.string().regex(/^x-[a-z0-9][a-z0-9-]{0,62}$/),
    actorScopeHeader: z.string().regex(/^x-[a-z0-9][a-z0-9-]{0,62}$/),
  }).strict(),
}).strict();

const runtimeServiceSchema = z.object({
  id: identifier,
  serviceName: resourceName,
  environment: deploymentEnvironment,
  accountReference: cloudflareAccountReference,
  role: z.enum(['workflow', 'branch', 'browser_egress', 'policy_egress']),
}).strict();

const branchEntrypointPropsSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  searchProviderId: identifier,
  searchEndpoint: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'Branch search endpoint must be credential-free HTTPS without query or fragment'),
  searchReadiness: z.enum(['declared', 'locally_tested', 'sandbox_verified', 'production_observed']),
  egressPolicyReference,
  retentionMs: z.number().int().min(3_600_000).max(31_536_000_000),
  maximumParallelFetches: z.number().int().min(1).max(16),
  browserEgressPolicy: z.literal('policy_routed_v1'),
  browserVirtualHostname: z.literal('research-browser.invalid'),
}).strict();

const browserEgressEntrypointPropsSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  virtualHostname: z.literal('research-browser.invalid'),
  maximumResponseBytes: z.number().int().min(1_024).max(10_000_000),
}).strict();

const runtimeSecretBindingSchema = z.object({
  serviceId: identifier,
  environmentVariable: z.literal('RESEARCH_BROWSER_DESCRIPTOR_KEY'),
  secretName: z.literal('RESEARCH_BROWSER_DESCRIPTOR_KEY'),
}).strict();

const internalBindingSchema = z.discriminatedUnion('role', [
  z.object({
    id: identifier,
    role: z.literal('branch_executor'),
    sourceServiceId: identifier,
    targetServiceId: identifier,
    binding: z.literal('RESEARCH_BRANCH_EXECUTOR'),
    targetEntrypoint: z.literal('ResearchBranchService'),
    props: branchEntrypointPropsSchema,
  }).strict(),
  z.object({
    id: identifier,
    role: z.literal('browser_egress'),
    sourceServiceId: identifier,
    targetServiceId: identifier,
    binding: z.literal('RESEARCH_BROWSER_EGRESS'),
    targetEntrypoint: z.literal('ResearchBrowserEgressService'),
    props: browserEgressEntrypointPropsSchema,
    directFetchFallback: z.literal(false),
  }).strict(),
  z.object({
    id: identifier,
    role: z.literal('policy_egress'),
    sourceServiceId: identifier,
    targetServiceId: identifier,
    binding: z.literal('RESEARCH_EGRESS'),
    policyReference: egressPolicyReference,
    directFetchFallback: z.literal(false),
  }).strict(),
]);

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: identifier,
  environment: deploymentEnvironment,
  accountReference: cloudflareAccountReference,
  worker: z.object({
    serviceName: resourceName,
    compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    migrationsOwner: z.literal('@theme.tools/crawl-research'),
  }).strict(),
  broker: z.object({
    endpoint: z.url().refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
    }, 'Broker endpoint must be credential-free HTTPS without a fragment'),
    serviceTokenEnvironmentVariable: z.literal('THEME_RESEARCH_SERVICE_TOKEN'),
  }).strict(),
  workloadIdentity: z.object({
    id: identifier,
    provider: z.literal('infisical'),
    authMode: z.enum(['workload-identity', 'universal-auth']),
    secretPath: z.string().regex(/^\/workloads\/[a-z0-9][a-z0-9._-]{0,95}$/),
  }).strict(),
  secretReferences: z.array(z.object({
    secretName: bindingName,
    environmentVariable: bindingName,
    reference: infisicalReference,
    required: z.boolean(),
  }).strict()).min(1).max(128),
  resources: z.array(resourceSchema).min(10).max(64),
  runtimeServices: z.array(runtimeServiceSchema).length(4),
  runtimeSecretBindings: z.array(runtimeSecretBindingSchema).length(2),
  internalBindings: z.array(internalBindingSchema).length(4),
  consumerBindings: z.array(consumerServiceBindingSchema).min(1).max(128),
  retention: z.object({
    evidenceDays: z.number().int().min(1).max(3650),
    eventDays: z.number().int().min(1).max(3650),
    usageDays: z.number().int().min(1).max(3650),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  const resourceIds = manifest.resources.map(resource => resource.id);
  const bindings = manifest.resources.map(resource => resource.binding);
  const roles = manifest.resources.map(resource => resource.role);
  const requiredRoles = ['d1_metadata', 'r2_evidence', 'kv_catalog', 'queue_jobs', 'queue_dlq', 'durable_object_runs', 'workflow_research', 'browser_rendering', 'workers_ai', 'service_binding'];
  if (new Set(resourceIds).size !== resourceIds.length) context.addIssue({ code: 'custom', path: ['resources'], message: 'Resource ids must be unique' });
  if (new Set(bindings).size !== bindings.length) context.addIssue({ code: 'custom', path: ['resources'], message: 'Binding names must be unique' });
  for (const role of requiredRoles) {
    if (!roles.includes(role as typeof roles[number])) context.addIssue({ code: 'custom', path: ['resources'], message: `Missing required resource role ${role}` });
  }
  const dlqIds = new Set(manifest.resources.filter(resource => resource.role === 'queue_dlq').map(resource => resource.id));
  for (const queue of manifest.resources.filter(resource => resource.role === 'queue_jobs')) {
    if (!dlqIds.has(queue.deadLetterResourceId)) context.addIssue({ code: 'custom', path: ['resources'], message: 'Job queue must reference a declared DLQ' });
  }
  const runtimeServiceIds = manifest.runtimeServices.map(service => service.id);
  const runtimeServiceNames = manifest.runtimeServices.map(service => service.serviceName);
  if (new Set(runtimeServiceIds).size !== runtimeServiceIds.length || new Set(runtimeServiceNames).size !== runtimeServiceNames.length) {
    context.addIssue({ code: 'custom', path: ['runtimeServices'], message: 'Runtime service ids and names must be unique' });
  }
  const servicesById = new Map(manifest.runtimeServices.map(service => [service.id, service]));
  for (const service of manifest.runtimeServices) {
    if (service.environment !== manifest.environment || service.accountReference !== manifest.accountReference) {
      context.addIssue({ code: 'custom', path: ['runtimeServices'], message: 'Runtime services must share the manifest environment and Cloudflare account' });
    }
  }
  for (const role of ['workflow', 'branch', 'browser_egress', 'policy_egress'] as const) {
    if (manifest.runtimeServices.filter(service => service.role === role).length !== 1) {
      context.addIssue({ code: 'custom', path: ['runtimeServices'], message: `Runtime topology requires exactly one ${role} service` });
    }
  }
  const workflowService = manifest.runtimeServices.find(service => service.role === 'workflow');
  if (workflowService && workflowService.serviceName !== manifest.worker.serviceName) {
    context.addIssue({ code: 'custom', path: ['runtimeServices'], message: 'Workflow runtime service must own the canonical research Worker' });
  }
  const descriptorKeyConsumers = manifest.runtimeSecretBindings.map(binding => binding.serviceId);
  if (new Set(descriptorKeyConsumers).size !== descriptorKeyConsumers.length
    || !['branch', 'browser_egress'].every(role => manifest.runtimeServices.some(service => service.role === role && descriptorKeyConsumers.includes(service.id)))) {
    context.addIssue({ code: 'custom', path: ['runtimeSecretBindings'], message: 'Descriptor key reference must be bound exactly once to branch and Browser egress services' });
  }
  const internalBindingIds = manifest.internalBindings.map(binding => binding.id);
  const internalBindingNames = manifest.internalBindings.map(binding => `${binding.sourceServiceId}:${binding.binding}`);
  if (new Set(internalBindingIds).size !== internalBindingIds.length || new Set(internalBindingNames).size !== internalBindingNames.length) {
    context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Internal binding ids and source binding names must be unique' });
  }
  for (const binding of manifest.internalBindings) {
    const source = servicesById.get(binding.sourceServiceId);
    const target = servicesById.get(binding.targetServiceId);
    if (!source || !target) {
      context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Internal bindings must reference declared runtime services' });
      continue;
    }
    if (binding.role === 'branch_executor' && (source.role !== 'workflow' || target.role !== 'branch')) {
      context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Branch executor must connect the Workflow service to the branch service' });
    }
    if (binding.role === 'browser_egress' && (source.role !== 'branch' || target.role !== 'browser_egress')) {
      context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Browser egress must connect the branch service to ResearchBrowserEgressService' });
    }
    if (binding.role === 'policy_egress' && (!['branch', 'browser_egress'].includes(source.role) || target.role !== 'policy_egress')) {
      context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Research egress must connect branch and browser-egress services to the policy-egress service' });
    }
  }
  const branchBinding = manifest.internalBindings.find(binding => binding.role === 'branch_executor');
  const browserBinding = manifest.internalBindings.find(binding => binding.role === 'browser_egress');
  const policyBindings = manifest.internalBindings.filter(binding => binding.role === 'policy_egress');
  const branchService = manifest.runtimeServices.find(service => service.role === 'branch');
  const browserEgressService = manifest.runtimeServices.find(service => service.role === 'browser_egress');
  if (!branchBinding || !browserBinding || policyBindings.length !== 2) {
    context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Runtime topology requires branch executor, browser-egress, and two policy-egress bindings' });
  } else {
    const expectedPolicySources = new Set([branchService?.id, browserEgressService?.id]);
    const actualPolicySources = new Set(policyBindings.map(binding => binding.sourceServiceId));
    if ([...expectedPolicySources].some(source => !source || !actualPolicySources.has(source))
      || policyBindings.some(binding => binding.policyReference !== branchBinding.props.egressPolicyReference)) {
      context.addIssue({ code: 'custom', path: ['internalBindings'], message: 'Ordinary and Browser retrieval must share one authoritative egress policy route' });
    }
  }
  const browserResources = manifest.resources.filter(resource => resource.role === 'browser_rendering');
  if (browserResources.length !== 1 || browserResources[0]?.binding !== 'BROWSER') {
    context.addIssue({ code: 'custom', path: ['resources'], message: 'Policy-routed Browser Run requires the exact BROWSER binding' });
  }
  const consumerIds = manifest.consumerBindings.map(binding => binding.id);
  const consumerBindingNames = manifest.consumerBindings.map(binding => `${binding.consumerServiceName}:${binding.binding}`);
  if (new Set(consumerIds).size !== consumerIds.length) {
    context.addIssue({ code: 'custom', path: ['consumerBindings'], message: 'Consumer service binding ids must be unique' });
  }
  if (new Set(consumerBindingNames).size !== consumerBindingNames.length) {
    context.addIssue({ code: 'custom', path: ['consumerBindings'], message: 'Consumer service binding names must be unique per consumer' });
  }
  for (const binding of manifest.consumerBindings) {
    if (binding.consumerEnvironment !== manifest.environment || binding.targetEnvironment !== manifest.environment) {
      context.addIssue({ code: 'custom', path: ['consumerBindings'], message: 'Consumer and target environments must match the manifest environment' });
    }
    if (binding.targetServiceName !== manifest.worker.serviceName) {
      context.addIssue({ code: 'custom', path: ['consumerBindings'], message: 'Consumer binding must target the canonical research Worker' });
    }
    if (binding.bindingProps.consumerId !== binding.consumerServiceName
      || binding.bindingProps.environmentId !== binding.consumerEnvironment
      || binding.bindingProps.authorityGrantReference !== binding.authorityGrantReference
      || binding.bindingProps.tenantScopeHeader === binding.bindingProps.actorScopeHeader) {
      context.addIssue({ code: 'custom', path: ['consumerBindings'], message: 'Consumer binding props must exactly attest the declared consumer, environment, authority reference, and distinct scope headers' });
    }
  }
  if (manifest.workloadIdentity.secretPath !== `/workloads/${manifest.workloadIdentity.id}`) {
    context.addIssue({ code: 'custom', path: ['workloadIdentity', 'secretPath'], message: 'Workload identity must own one fixed secret leaf' });
  }
  const secretNames = manifest.secretReferences.map(secret => secret.secretName);
  const variables = manifest.secretReferences.map(secret => secret.environmentVariable);
  if (new Set(secretNames).size !== secretNames.length || new Set(variables).size !== variables.length) {
    context.addIssue({ code: 'custom', path: ['secretReferences'], message: 'Secret mappings must be unique' });
  }
  for (const secret of manifest.secretReferences) {
    const expected = `infisical://${manifest.workloadIdentity.secretPath.slice(1)}/${secret.secretName}`;
    if (secret.reference !== expected) context.addIssue({ code: 'custom', path: ['secretReferences'], message: 'Secret reference must use the workload fixed leaf and declared name' });
  }
  if (!manifest.secretReferences.some(secret =>
    secret.secretName === 'THEME_RESEARCH_SERVICE_TOKEN'
    && secret.environmentVariable === manifest.broker.serviceTokenEnvironmentVariable
    && secret.required
  )) {
    context.addIssue({ code: 'custom', path: ['secretReferences'], message: 'Broker requires the fixed THEME_RESEARCH_SERVICE_TOKEN secret reference' });
  }
  if (!manifest.secretReferences.some(secret =>
    secret.secretName === 'RESEARCH_BROWSER_DESCRIPTOR_KEY'
    && secret.environmentVariable === 'RESEARCH_BROWSER_DESCRIPTOR_KEY'
    && secret.reference === `infisical://${manifest.workloadIdentity.secretPath.slice(1)}/RESEARCH_BROWSER_DESCRIPTOR_KEY`
    && secret.required
  )) {
    context.addIssue({ code: 'custom', path: ['secretReferences'], message: 'Policy-routed Browser Run requires the fixed RESEARCH_BROWSER_DESCRIPTOR_KEY reference' });
  }
});

export type ThemeToolsResearchProvisioningManifest = z.infer<typeof manifestSchema>;

export interface InstallDoctorProvisioningAction {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly operation: 'ensure-resource' | 'ensure-secret-reference' | 'ensure-config-reference' | 'validate-bindings' | 'ensure-consumer-service-binding' | 'validate-consumer-authority' | 'ensure-internal-service-binding' | 'validate-branch-entrypoint-props' | 'validate-browser-egress-entrypoint' | 'validate-browser-descriptor-key-reference' | 'validate-egress-policy-binding';
  readonly target: string;
  readonly mutationAllowed: false;
  readonly rollback: readonly string[];
}

export interface InstallDoctorProvisioningPlan {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly environment: ThemeToolsResearchProvisioningManifest['environment'];
  readonly mode: 'dry-run';
  readonly mutationAllowed: false;
  readonly actions: readonly InstallDoctorProvisioningAction[];
  readonly externalRequirements: readonly string[];
}

function deterministicDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** Validates desired state without resolving an account, identity, or secret value. */
export function validateThemeToolsResearchProvisioningManifest(input: unknown): ThemeToolsResearchProvisioningManifest {
  return manifestSchema.parse(input);
}

/** Builds a stable preview only. Applying the plan requires a separately authorized reconciler. */
export function buildInstallDoctorProvisioningSpec(input: unknown): InstallDoctorProvisioningPlan {
  const manifest = validateThemeToolsResearchProvisioningManifest(input);
  const resourceActions = [...manifest.resources]
    .sort((left, right) => left.role.localeCompare(right.role) || left.id.localeCompare(right.id))
    .map((resource): InstallDoctorProvisioningAction => ({
      actionId: `resource:${resource.id}`,
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${manifest.environment}:${resource.role}:${resource.id}:${resource.resourceName}`)}`,
      operation: 'ensure-resource',
      target: `${resource.role}:${resource.resourceName}:${resource.binding}`,
      mutationAllowed: false,
      rollback: ['preserve-current-binding', 'remove-only-new-resource'],
    }));
  const secretActions = [...manifest.secretReferences]
    .sort((left, right) => left.secretName.localeCompare(right.secretName))
    .map((secret): InstallDoctorProvisioningAction => ({
      actionId: `secret-reference:${secret.secretName}`,
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${manifest.workloadIdentity.id}:${secret.reference}`)}`,
      operation: 'ensure-secret-reference',
      target: `${secret.environmentVariable}:${secret.reference}`,
      mutationAllowed: false,
      rollback: ['preserve-existing-secret-version', 'revoke-only-new-workload-grant'],
    }));
  const consumerBindingActions = [...manifest.consumerBindings]
    .sort((left, right) => left.consumerServiceName.localeCompare(right.consumerServiceName) || left.binding.localeCompare(right.binding))
    .flatMap((binding): InstallDoctorProvisioningAction[] => [{
      actionId: `consumer-binding:${binding.id}`,
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${binding.consumerServiceName}:${binding.consumerEnvironment}:${binding.binding}:${binding.targetServiceName}:${binding.targetEnvironment}:${binding.targetEntrypoint ?? ''}:${JSON.stringify(binding.bindingProps)}`)}`,
      operation: 'ensure-consumer-service-binding',
      target: `${binding.consumerServiceName}:${binding.binding}:${binding.targetServiceName}:${binding.targetEntrypoint ?? 'default'}`,
      mutationAllowed: false,
      rollback: ['preserve-existing-binding', 'remove-only-new-binding'],
    }, {
      actionId: `consumer-authority:${binding.id}`,
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${binding.id}:${binding.authorityGrantReference}`)}`,
      operation: 'validate-consumer-authority',
      target: `${binding.consumerServiceName}:${binding.authorityGrantReference}`,
      mutationAllowed: false,
      rollback: ['no-mutation'],
    }]);
  const runtimeServiceName = (serviceId: string): string => {
    const service = manifest.runtimeServices.find(candidate => candidate.id === serviceId);
    if (!service) throw new Error(`Unknown runtime service: ${serviceId}`);
    return service.serviceName;
  };
  const internalBindingActions = [...manifest.internalBindings]
    .sort((left, right) => left.sourceServiceId.localeCompare(right.sourceServiceId) || left.binding.localeCompare(right.binding))
    .flatMap((binding): InstallDoctorProvisioningAction[] => {
      const sourceServiceName = runtimeServiceName(binding.sourceServiceId);
      const targetServiceName = runtimeServiceName(binding.targetServiceId);
      const bindingDigestInput = binding.role === 'branch_executor' || binding.role === 'browser_egress'
        ? `${binding.targetEntrypoint}:${JSON.stringify(binding.props)}:${binding.role === 'browser_egress' ? String(binding.directFetchFallback) : ''}`
        : `${binding.policyReference}:${String(binding.directFetchFallback)}`;
      const actions: InstallDoctorProvisioningAction[] = [{
        actionId: `internal-binding:${binding.id}`,
        idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${sourceServiceName}:${binding.binding}:${targetServiceName}:${bindingDigestInput}`)}`,
        operation: 'ensure-internal-service-binding',
        target: `${sourceServiceName}:${binding.binding}:${targetServiceName}`,
        mutationAllowed: false,
        rollback: ['preserve-existing-binding', 'remove-only-new-binding'],
      }];
      actions.push(binding.role === 'branch_executor' ? {
        actionId: `branch-entrypoint:${binding.id}`,
        idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${binding.id}:${JSON.stringify(binding.props)}`)}`,
        operation: 'validate-branch-entrypoint-props',
        target: `${targetServiceName}:${binding.targetEntrypoint}:${binding.props.egressPolicyReference}`,
        mutationAllowed: false,
        rollback: ['no-mutation'],
      } : binding.role === 'browser_egress' ? {
        actionId: `browser-egress-entrypoint:${binding.id}`,
        idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${binding.id}:${JSON.stringify(binding.props)}`)}`,
        operation: 'validate-browser-egress-entrypoint',
        target: `${targetServiceName}:${binding.targetEntrypoint}:${binding.props.virtualHostname}`,
        mutationAllowed: false,
        rollback: ['no-mutation'],
      } : {
        actionId: `egress-policy:${binding.id}`,
        idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${binding.id}:${binding.policyReference}`)}`,
        operation: 'validate-egress-policy-binding',
        target: `${targetServiceName}:${binding.policyReference}`,
        mutationAllowed: false,
        rollback: ['no-mutation'],
      });
      return actions;
    });
  const descriptorKey = manifest.secretReferences.find(secret => secret.secretName === 'RESEARCH_BROWSER_DESCRIPTOR_KEY');
  if (!descriptorKey) throw new Error('Missing Browser descriptor key reference');
  const descriptorKeyConsumerNames = manifest.runtimeSecretBindings
    .map(binding => runtimeServiceName(binding.serviceId))
    .sort();
  return {
    schemaVersion: 1,
    revision: manifest.revision,
    environment: manifest.environment,
    mode: 'dry-run',
    mutationAllowed: false,
    actions: [...resourceActions, ...secretActions, ...internalBindingActions, {
      actionId: 'browser-descriptor-key:validate-reference',
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${descriptorKey.reference}`)}`,
      operation: 'validate-browser-descriptor-key-reference',
      target: `${descriptorKey.environmentVariable}:${descriptorKey.reference}:${descriptorKeyConsumerNames.join(',')}`,
      mutationAllowed: false,
      rollback: ['no-mutation'],
    }, ...consumerBindingActions, {
      actionId: 'config-reference:theme-research-endpoint',
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:${manifest.environment}:${manifest.broker.endpoint}`)}`,
      operation: 'ensure-config-reference',
      target: `THEME_RESEARCH_ENDPOINT:${manifest.broker.endpoint}`,
      mutationAllowed: false,
      rollback: ['preserve-current-endpoint', 'remove-only-new-config-reference'],
    }, {
      actionId: 'validate:bindings',
      idempotencyKey: `install-doctor:${deterministicDigest(`${manifest.revision}:validate-bindings`)}`,
      operation: 'validate-bindings',
      target: manifest.worker.serviceName,
      mutationAllowed: false,
      rollback: ['no-mutation'],
    }],
    externalRequirements: [
      `Cloudflare account authority for ${manifest.accountReference}`,
      `Infisical workload identity enrollment for ${manifest.workloadIdentity.id}`,
      `Deployment permission for Worker ${manifest.worker.serviceName}`,
      `Deployment permission for internal Workers ${manifest.runtimeServices.map(service => service.serviceName).join(', ')}`,
      'Cloudflare network-policy authority for the declared research egress service',
      'Cloudflare Browser Run and named-entrypoint authority for the policy-routed browser service',
      `Deployment permission for consumer Workers ${[...new Set(manifest.consumerBindings.map(binding => binding.consumerServiceName))].join(', ')}`,
      'Server-controlled caller authority grants for every consumer binding',
      'Authorized environment-specific budget and retention approval',
    ],
  };
}
