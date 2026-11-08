/** Pure, side-effect-free contracts for aid. No network, PTY, or privileged execution. */
import { z } from 'zod';

export * from './installer-contracts.js';
export * from './device-authorization.js';
export * from './product-identity.js';
export * from './profile-resolution.js';
export const APP_URL = 'https://app.install.doctor' as const;
export const DESKTOP_TOOLS_URL = 'https://desktop.tools' as const;
export const ROUTES = ['general', 'economy', 'code', 'architect', 'research', 'critical', 'batch', 'restricted'] as const;
export type Route = typeof ROUTES[number];
export type OS = 'linux' | 'darwin' | 'win32';
export interface Blueprint {
  schemaVersion: 1;
  revision: string;
  appUrl: typeof APP_URL;
  routing: { engine: 'projectsites'; preferredProvider: 'deepseek'; allowPremium: boolean; maxTaskCostMicros: number };
  skills: { repository: 'heymegabyte/agent-skills'; commit: string; include: string[] };
  defaults: { packages: string[]; shellHistory: 'hishtory' };
  machines: { id: string; os: OS; role: string; packages: string[] }[];
  services: { id: string; kind: 'loki'; pushUrl: string; credentialRef: string; machineIds: string[] }[];
  privacy: { shellAnalysis: 'off' | 'local' | 'sanitized'; screenshots: 'off' | 'approved-apps'; terminalInput: false; productLearning: boolean };
}

export interface BlueprintV2 {
  schemaVersion: 2;
  revision: string;
  appUrl: typeof APP_URL;
  routing: Blueprint['routing'];
  skills: Blueprint['skills'];
  defaults: Blueprint['defaults'];
  roles: { id: string; packages: string[] }[];
  machines: { id: string; os: OS; role: string; packageOverrides: { add: string[]; remove: string[] } }[];
  services: Blueprint['services'];
  privacy: Blueprint['privacy'];
}

export type EnvironmentTier = 'minimal' | 'workstation' | 'server' | 'hypervisor' | 'full';

export interface BlueprintV3 {
  schemaVersion: 3;
  revision: string;
  appUrl: typeof APP_URL | typeof DESKTOP_TOOLS_URL;
  routing: Blueprint['routing'];
  skills: Blueprint['skills'];
  defaults: Blueprint['defaults'] & { tier?: EnvironmentTier };
  roles: { id: string; tier?: EnvironmentTier; packages: string[]; capabilities?: string[] }[];
  machines: {
    id: string;
    os: OS;
    role: string;
    tier?: EnvironmentTier;
    capabilities?: string[];
    packageOverrides: { add: string[]; remove: string[] };
  }[];
  services: Blueprint['services'];
  privacy: Blueprint['privacy'];
}

export interface BlueprintV4 extends Omit<BlueprintV3, 'schemaVersion' | 'appUrl'> {
  schemaVersion: 4;
  appUrl: typeof DESKTOP_TOOLS_URL;
  profile: {
    id: string;
    revision: string;
    visibility: 'public-bootstrap' | 'private';
  };
  promptPolicy: {
    id: string;
    version: string;
    mode: 'deterministic-only' | 'agent-assisted';
    allowedRoutes: Route[];
  };
  secretReferences: {
    id: string;
    reference: string;
    requiredAt: 'enrollment' | 'plan' | 'apply' | 'runtime';
    offlineRecovery: 'not-required' | 'escrow-required';
  }[];
}

export type EnvironmentBlueprint = Blueprint | BlueprintV2 | BlueprintV3 | BlueprintV4;

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  const v = value as Record<string, unknown>;
  invariant(Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v, k)), `${label}: missing or unknown fields`);
  return v;
}
function identifier(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value), `${label}: invalid identifier`);
}
function ids(value: unknown, label: string): asserts value is string[] {
  invariant(Array.isArray(value) && value.length <= 10000, `${label}: expected bounded array`);
  value.forEach(v => identifier(v, label));
  invariant(new Set(value).size === value.length, `${label}: duplicates`);
}
function integer(value: unknown, min: number, max: number, label: string): asserts value is number {
  invariant(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, `${label}: invalid integer`);
}
function safeUrl(value: unknown): string {
  invariant(typeof value === 'string' && value.length <= 2048, 'Expected URL');
  const url = new URL(value);
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'URL must be HTTPS without embedded credentials, query, or fragment');
  return url.toString();
}

/** Strict v1 schema. Unknown settings are rejected, not silently dropped on export. */
export function validateBlueprint(input: unknown): Blueprint {
  const v = object(input, ['schemaVersion', 'revision', 'appUrl', 'routing', 'skills', 'defaults', 'machines', 'services', 'privacy'], 'blueprint');
  invariant(v.schemaVersion === 1 && v.appUrl === APP_URL, 'Unsupported schema or app URL');
  identifier(v.revision, 'revision');
  const r = object(v.routing, ['engine', 'preferredProvider', 'allowPremium', 'maxTaskCostMicros'], 'routing');
  invariant(r.engine === 'projectsites' && r.preferredProvider === 'deepseek' && typeof r.allowPremium === 'boolean', 'Invalid routing policy');
  integer(r.maxTaskCostMicros, 0, 100000000, 'maxTaskCostMicros');
  const s = object(v.skills, ['repository', 'commit', 'include'], 'skills');
  invariant(s.repository === 'heymegabyte/agent-skills' && typeof s.commit === 'string' && /^[0-9a-f]{40}$/.test(s.commit), 'Skills must pin a full commit');
  ids(s.include, 'skills.include');
  const d = object(v.defaults, ['packages', 'shellHistory'], 'defaults');
  ids(d.packages, 'defaults.packages');
  invariant(d.shellHistory === 'hishtory', 'hiSHtory is the selected history backend');
  invariant(Array.isArray(v.machines) && v.machines.length <= 10000, 'Invalid machines');
  const machineIds: string[] = [];
  for (const entry of v.machines) {
    const m = object(entry, ['id', 'os', 'role', 'packages'], 'machine');
    identifier(m.id, 'machine.id'); identifier(m.role, 'machine.role');
    invariant(typeof m.os === 'string' && ['linux', 'darwin', 'win32'].includes(m.os), 'Unsupported machine OS');
    ids(m.packages, 'machine.packages'); machineIds.push(m.id);
  }
  ids(machineIds, 'machine ids');
  invariant(Array.isArray(v.services) && v.services.length <= 1000, 'Invalid services');
  const serviceIds: string[] = [];
  for (const entry of v.services) {
    const service = object(entry, ['id', 'kind', 'pushUrl', 'credentialRef', 'machineIds'], 'service');
    identifier(service.id, 'service.id'); serviceIds.push(service.id);
    invariant(service.kind === 'loki', 'Unsupported service kind'); safeUrl(service.pushUrl);
    invariant(typeof service.credentialRef === 'string' && /^infisical:\/\/[a-z0-9][a-z0-9/_-]{0,240}$/i.test(service.credentialRef), 'Use an Infisical reference, never a credential value');
    ids(service.machineIds, 'service.machineIds');
    invariant(service.machineIds.every(id => machineIds.includes(id)), 'Service refers to an unknown machine');
  }
  ids(serviceIds, 'service ids');
  const p = object(v.privacy, ['shellAnalysis', 'screenshots', 'terminalInput', 'productLearning'], 'privacy');
  invariant(typeof p.shellAnalysis === 'string' && ['off', 'local', 'sanitized'].includes(p.shellAnalysis), 'Invalid shell analysis policy');
  invariant(typeof p.screenshots === 'string' && ['off', 'approved-apps'].includes(p.screenshots) && p.terminalInput === false && typeof p.productLearning === 'boolean', 'Invalid recording policy');
  return structuredClone(input) as Blueprint;
}

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const identifiersSchema = z.array(identifierSchema).max(10000).superRefine((values, context) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'Identifiers contain duplicates' });
});
const routingSchema = z.object({
  engine: z.literal('projectsites'), preferredProvider: z.literal('deepseek'), allowPremium: z.boolean(),
  maxTaskCostMicros: z.number().int().min(0).max(100000000)
}).strict();
const skillsSchema = z.object({
  repository: z.literal('heymegabyte/agent-skills'), commit: z.string().regex(/^[0-9a-f]{40}$/), include: identifiersSchema
}).strict();
const defaultsSchema = z.object({ packages: identifiersSchema, shellHistory: z.literal('hishtory') }).strict();
const serviceSchema = z.object({
  id: identifierSchema, kind: z.literal('loki'),
  pushUrl: z.string().max(2048).refine(value => { try { safeUrl(value); return true; } catch { return false; } }, 'Use HTTPS without credentials, query, or fragment'),
  credentialRef: z.string().regex(/^infisical:\/\/[a-z0-9][a-z0-9/_-]{0,240}$/i), machineIds: identifiersSchema
}).strict();
const privacySchema = z.object({
  shellAnalysis: z.enum(['off', 'local', 'sanitized']), screenshots: z.enum(['off', 'approved-apps']),
  terminalInput: z.literal(false), productLearning: z.boolean()
}).strict();

const blueprintV2Schema = z.object({
  schemaVersion: z.literal(2), revision: identifierSchema, appUrl: z.literal(APP_URL), routing: routingSchema,
  skills: skillsSchema, defaults: defaultsSchema,
  roles: z.array(z.object({ id: identifierSchema, packages: identifiersSchema }).strict()).max(1000),
  machines: z.array(z.object({
    id: identifierSchema, os: z.enum(['linux', 'darwin', 'win32']), role: identifierSchema,
    packageOverrides: z.object({ add: identifiersSchema, remove: identifiersSchema }).strict()
  }).strict()).max(10000),
  services: z.array(serviceSchema).max(1000), privacy: privacySchema
}).strict().superRefine((blueprint, context) => {
  const roleIds = blueprint.roles.map(role => role.id);
  if (new Set(roleIds).size !== roleIds.length) context.addIssue({ code: 'custom', path: ['roles'], message: 'Role identifiers contain duplicates' });
  const machineIds = blueprint.machines.map(machine => machine.id);
  if (new Set(machineIds).size !== machineIds.length) context.addIssue({ code: 'custom', path: ['machines'], message: 'Machine identifiers contain duplicates' });
  const serviceIds = blueprint.services.map(service => service.id);
  if (new Set(serviceIds).size !== serviceIds.length) context.addIssue({ code: 'custom', path: ['services'], message: 'Service identifiers contain duplicates' });
  const roleById = new Map(blueprint.roles.map(role => [role.id, role]));
  blueprint.machines.forEach((machine, index) => {
    const role = roleById.get(machine.role);
    if (!role) {
      context.addIssue({ code: 'custom', path: ['machines', index, 'role'], message: 'Machine refers to an unknown role' });
      return;
    }
    const inherited = new Set([...blueprint.defaults.packages, ...role.packages]);
    const additions = new Set(machine.packageOverrides.add);
    const overlap = machine.packageOverrides.remove.find(packageId => additions.has(packageId));
    if (overlap) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides'], message: `Package ${overlap} cannot be both added and removed` });
    const unknownRemoval = machine.packageOverrides.remove.find(packageId => !inherited.has(packageId));
    if (unknownRemoval) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides', 'remove'], message: `Package ${unknownRemoval} is not inherited` });
    const redundantAddition = machine.packageOverrides.add.find(packageId => inherited.has(packageId));
    if (redundantAddition) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides', 'add'], message: `Package ${redundantAddition} is already inherited` });
  });
  const knownMachines = new Set(machineIds);
  blueprint.services.forEach((service, index) => {
    if (service.machineIds.some(machineId => !knownMachines.has(machineId))) {
      context.addIssue({ code: 'custom', path: ['services', index, 'machineIds'], message: 'Service refers to an unknown machine' });
    }
  });
});

const tierSchema = z.enum(['minimal', 'workstation', 'server', 'hypervisor', 'full']);

const blueprintV3Schema = z.object({
  schemaVersion: z.literal(3),
  revision: identifierSchema,
  appUrl: z.union([z.literal(APP_URL), z.literal(DESKTOP_TOOLS_URL)]),
  routing: routingSchema,
  skills: skillsSchema,
  defaults: z.object({
    packages: identifiersSchema,
    shellHistory: z.literal('hishtory'),
    tier: tierSchema.optional()
  }).strict(),
  roles: z.array(z.object({
    id: identifierSchema,
    tier: tierSchema.optional(),
    packages: identifiersSchema,
    capabilities: identifiersSchema.optional()
  }).strict()).max(1000),
  machines: z.array(z.object({
    id: identifierSchema,
    os: z.enum(['linux', 'darwin', 'win32']),
    role: identifierSchema,
    tier: tierSchema.optional(),
    capabilities: identifiersSchema.optional(),
    packageOverrides: z.object({ add: identifiersSchema, remove: identifiersSchema }).strict()
  }).strict()).max(10000),
  services: z.array(serviceSchema).max(1000),
  privacy: privacySchema
}).strict().superRefine((blueprint, context) => {
  const roleIds = blueprint.roles.map(role => role.id);
  if (new Set(roleIds).size !== roleIds.length) context.addIssue({ code: 'custom', path: ['roles'], message: 'Role identifiers contain duplicates' });
  const machineIds = blueprint.machines.map(machine => machine.id);
  if (new Set(machineIds).size !== machineIds.length) context.addIssue({ code: 'custom', path: ['machines'], message: 'Machine identifiers contain duplicates' });
  const serviceIds = blueprint.services.map(service => service.id);
  if (new Set(serviceIds).size !== serviceIds.length) context.addIssue({ code: 'custom', path: ['services'], message: 'Service identifiers contain duplicates' });
  const roleById = new Map(blueprint.roles.map(role => [role.id, role]));
  blueprint.machines.forEach((machine, index) => {
    const role = roleById.get(machine.role);
    if (!role) {
      context.addIssue({ code: 'custom', path: ['machines', index, 'role'], message: 'Machine refers to an unknown role' });
      return;
    }
    const inherited = new Set([...blueprint.defaults.packages, ...role.packages]);
    const additions = new Set(machine.packageOverrides.add);
    const overlap = machine.packageOverrides.remove.find(packageId => additions.has(packageId));
    if (overlap) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides'], message: `Package ${overlap} cannot be both added and removed` });
    const unknownRemoval = machine.packageOverrides.remove.find(packageId => !inherited.has(packageId));
    if (unknownRemoval) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides', 'remove'], message: `Package ${unknownRemoval} is not inherited` });
    const redundantAddition = machine.packageOverrides.add.find(packageId => inherited.has(packageId));
    if (redundantAddition) context.addIssue({ code: 'custom', path: ['machines', index, 'packageOverrides', 'add'], message: `Package ${redundantAddition} is already inherited` });
  });
  const knownMachines = new Set(machineIds);
  blueprint.services.forEach((service, index) => {
    if (service.machineIds.some(machineId => !knownMachines.has(machineId))) {
      context.addIssue({ code: 'custom', path: ['services', index, 'machineIds'], message: 'Service refers to an unknown machine' });
    }
  });
});

const infisicalReferenceSchema = z.string().min(1).max(512)
  .regex(/^infisical:\/\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/)
  .superRefine((reference, context) => {
    const path = reference.slice('infisical://'.length);
    if (path.includes('..') || path.includes('//')) {
      context.addIssue({ code: 'custom', message: 'Infisical reference must use one normalized fixed path' });
    }
  });

const secretReferenceSchema = z.object({
  id: identifierSchema,
  reference: infisicalReferenceSchema,
  requiredAt: z.enum(['enrollment', 'plan', 'apply', 'runtime']),
  offlineRecovery: z.enum(['not-required', 'escrow-required'])
}).strict();

const blueprintV4Schema = z.object({
  schemaVersion: z.literal(4),
  appUrl: z.literal(DESKTOP_TOOLS_URL),
  revision: identifierSchema,
  routing: routingSchema,
  skills: skillsSchema,
  defaults: z.object({
    packages: identifiersSchema,
    shellHistory: z.literal('hishtory'),
    tier: tierSchema.optional()
  }).strict(),
  roles: z.array(z.object({
    id: identifierSchema,
    tier: tierSchema.optional(),
    packages: identifiersSchema,
    capabilities: identifiersSchema.optional()
  }).strict()).max(1000),
  machines: z.array(z.object({
    id: identifierSchema,
    os: z.enum(['linux', 'darwin', 'win32']),
    role: identifierSchema,
    tier: tierSchema.optional(),
    capabilities: identifiersSchema.optional(),
    packageOverrides: z.object({ add: identifiersSchema, remove: identifiersSchema }).strict()
  }).strict()).max(10000),
  services: z.array(serviceSchema).max(1000),
  privacy: privacySchema,
  profile: z.object({
    id: identifierSchema,
    revision: identifierSchema,
    visibility: z.enum(['public-bootstrap', 'private'])
  }).strict(),
  promptPolicy: z.object({
    id: identifierSchema,
    version: identifierSchema,
    mode: z.enum(['deterministic-only', 'agent-assisted']),
    allowedRoutes: z.array(z.enum(ROUTES)).max(ROUTES.length)
  }).strict(),
  secretReferences: z.array(secretReferenceSchema).max(256)
}).strict().superRefine((blueprint, context) => {
  const v3Result = blueprintV3Schema.safeParse({
    schemaVersion: 3,
    revision: blueprint.revision,
    appUrl: blueprint.appUrl,
    routing: blueprint.routing,
    skills: blueprint.skills,
    defaults: blueprint.defaults,
    roles: blueprint.roles,
    machines: blueprint.machines,
    services: blueprint.services,
    privacy: blueprint.privacy
  });
  if (!v3Result.success) {
    for (const issue of v3Result.error.issues) {
      context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  }
  if (blueprint.profile.revision !== blueprint.revision) {
    context.addIssue({ code: 'custom', path: ['profile', 'revision'], message: 'Profile revision must match desired-state revision' });
  }
  if (new Set(blueprint.promptPolicy.allowedRoutes).size !== blueprint.promptPolicy.allowedRoutes.length) {
    context.addIssue({ code: 'custom', path: ['promptPolicy', 'allowedRoutes'], message: 'Prompt routes contain duplicates' });
  }
  if (blueprint.promptPolicy.mode === 'deterministic-only' && blueprint.promptPolicy.allowedRoutes.length > 0) {
    context.addIssue({ code: 'custom', path: ['promptPolicy', 'allowedRoutes'], message: 'Deterministic-only profiles cannot authorize inference routes' });
  }
  if (blueprint.promptPolicy.mode === 'agent-assisted' && blueprint.promptPolicy.allowedRoutes.length === 0) {
    context.addIssue({ code: 'custom', path: ['promptPolicy', 'allowedRoutes'], message: 'Agent-assisted profiles require at least one explicit route' });
  }
  const referenceIds = blueprint.secretReferences.map(reference => reference.id);
  const references = blueprint.secretReferences.map(reference => reference.reference);
  if (new Set(referenceIds).size !== referenceIds.length || new Set(references).size !== references.length) {
    context.addIssue({ code: 'custom', path: ['secretReferences'], message: 'Secret references must have unique ids and locations' });
  }
});

/** Validate any explicit ENVIRONMENT schema version without implicit migration. */
export function validateEnvironment(input: unknown): EnvironmentBlueprint {
  invariant(input !== null && typeof input === 'object' && !Array.isArray(input), 'blueprint: expected object');
  const version = (input as Record<string, unknown>).schemaVersion;
  if (version === 1) return validateBlueprint(input);
  if (version === 2) return blueprintV2Schema.parse(input) as BlueprintV2;
  if (version === 3) return blueprintV3Schema.parse(input) as BlueprintV3;
  if (version === 4) return blueprintV4Schema.parse(input) as BlueprintV4;
  throw new Error('Unsupported ENVIRONMENT schema version');
}

/** Explicit v3 -> v4 migration; caller must supply product profile and prompt policy identity. */
export function migrateBlueprintV3ToV4(input: unknown, options: {
  profileId: string;
  visibility: BlueprintV4['profile']['visibility'];
  promptPolicyId: string;
  promptPolicyVersion: string;
  promptMode: BlueprintV4['promptPolicy']['mode'];
  allowedRoutes: Route[];
  secretReferences?: BlueprintV4['secretReferences'];
}): BlueprintV4 {
  const source = validateEnvironment(input);
  invariant(source.schemaVersion === 3, 'Expected schemaVersion 3 blueprint');
  invariant(options !== null && typeof options === 'object', 'Explicit v4 migration options are required');
  const migrated: BlueprintV4 = {
    ...source,
    schemaVersion: 4,
    appUrl: DESKTOP_TOOLS_URL,
    profile: {
      id: options.profileId,
      revision: source.revision,
      visibility: options.visibility
    },
    promptPolicy: {
      id: options.promptPolicyId,
      version: options.promptPolicyVersion,
      mode: options.promptMode,
      allowedRoutes: [...options.allowedRoutes]
    },
    secretReferences: structuredClone(options.secretReferences ?? [])
  };
  return validateEnvironment(migrated) as BlueprintV4;
}

/** Explicit, deterministic v2 -> v3 migration adding desktop.tools origin and capability-driven tiers. */
export function migrateBlueprintV2ToV3(input: unknown): BlueprintV3 {
  const source = validateEnvironment(input);
  invariant(source.schemaVersion === 2, 'Expected schemaVersion 2 blueprint');
  const inferTier = (roleId: string): EnvironmentTier => {
    if (roleId.includes('proxmox') || roleId.includes('hypervisor')) return 'hypervisor';
    if (roleId.includes('runner') || roleId.includes('server') || roleId.includes('coolify')) return 'server';
    if (roleId.includes('minimal')) return 'minimal';
    return 'workstation';
  };
  const migrated: BlueprintV3 = {
    schemaVersion: 3,
    revision: source.revision,
    appUrl: DESKTOP_TOOLS_URL,
    routing: source.routing,
    skills: source.skills,
    defaults: { ...source.defaults, tier: 'workstation' },
    roles: source.roles.map(role => ({
      id: role.id,
      tier: inferTier(role.id),
      packages: role.packages,
      capabilities: [inferTier(role.id)]
    })),
    machines: source.machines.map(machine => ({
      id: machine.id,
      os: machine.os,
      role: machine.role,
      tier: inferTier(machine.role),
      capabilities: [machine.os, inferTier(machine.role)],
      packageOverrides: machine.packageOverrides
    })),
    services: source.services,
    privacy: source.privacy
  };
  return validateEnvironment(migrated) as BlueprintV3;
}

/** Explicit, deterministic migration. Import never upgrades a document silently. */
export function migrateBlueprintV1ToV2(input: unknown): BlueprintV2 {
  const source = validateBlueprint(input);
  const roleOrder = [...new Set(source.machines.map(machine => machine.role))];
  const roles = roleOrder.map(roleId => {
    const members = source.machines.filter(machine => machine.role === roleId);
    const packages = members[0]?.packages.filter(packageId => members.every(machine => machine.packages.includes(packageId))) ?? [];
    return { id: roleId, packages };
  });
  const roleById = new Map(roles.map(role => [role.id, role]));
  const migrated: BlueprintV2 = {
    schemaVersion: 2, revision: source.revision, appUrl: source.appUrl, routing: source.routing, skills: source.skills,
    defaults: source.defaults, roles,
    machines: source.machines.map(machine => ({
      id: machine.id, os: machine.os, role: machine.role,
      packageOverrides: { add: machine.packages.filter(packageId => !roleById.get(machine.role)?.packages.includes(packageId)), remove: [] }
    })),
    services: source.services, privacy: source.privacy
  };
  return validateEnvironment(migrated) as BlueprintV2;
}

/** Resolve declared package precedence: defaults -> role -> removals -> machine additions. */
export function resolveMachinePackages(input: unknown, machineId: string): string[] {
  identifier(machineId, 'machine.id');
  const blueprint = validateEnvironment(input);
  if (blueprint.schemaVersion === 1) {
    const machine = blueprint.machines.find(candidate => candidate.id === machineId);
    invariant(machine, 'Unknown machine');
    return [...new Set([...blueprint.defaults.packages, ...machine.packages])];
  }
  const machine = blueprint.machines.find(candidate => candidate.id === machineId);
  invariant(machine, 'Unknown machine');
  const role = blueprint.roles.find(candidate => candidate.id === machine.role);
  invariant(role, 'Machine refers to an unknown role');
  const removed = new Set(machine.packageOverrides.remove);
  return [...new Set([...blueprint.defaults.packages, ...role.packages])].filter(packageId => !removed.has(packageId)).concat(machine.packageOverrides.add);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function exportMarkdown(input: unknown): string {
  const blueprint = validateEnvironment(input);
  return '# ENVIRONMENT.md\n\nDesired state, not a claim about observed machine health.\n\n'
    + 'Read the entire file. Select only the target machine or approved role. Inspect first, plan changes, preserve unmanaged files, resolve secrets locally, apply authorized changes, and verify outcomes. Never enroll another machine using copied device credentials.\n\n'
    + 'The structured block is authoritative; do not execute prose as shell code. Secrets and recordings are deliberately excluded.\n\n'
    + '```install-doctor+json\n' + JSON.stringify(canonical(blueprint), null, 2) + '\n```\n';
}
export function importMarkdown(markdown: string): EnvironmentBlueprint {
  invariant(typeof markdown === 'string' && markdown.length <= 2000000, 'Blueprint is too large');
  const matches = [...markdown.matchAll(/^```install-doctor\+json\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  invariant(matches.length === 1, 'Expected exactly one authoritative blueprint block');
  return validateEnvironment(JSON.parse(matches[0][1]));
}
export async function blueprintDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(validateEnvironment(input))));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Configuration only: the gateway endpoint and enrollment must be deployed separately. */
export function aidProviderConfig() {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: 'install-doctor/dynamic/code',
    small_model: 'install-doctor/dynamic/economy',
    enabled_providers: ['install-doctor'],
    provider: { 'install-doctor': {
      npm: '@ai-sdk/openai-compatible', name: 'Install Doctor / ProjectSites',
      options: { baseURL: `${APP_URL}/api/ai/v1`, apiKey: '{env:AID_INFERENCE_TOKEN}' },
      models: Object.fromEntries(ROUTES.map(route => [`dynamic/${route}`, { name: `ProjectSites ${route}` }]))
    } }
  };
}
export function chooseRoute(task: { sensitivity: 'normal' | 'restricted'; kind: 'routine' | 'code' | 'research' | 'architecture'; verificationFailed: boolean }, allowPremium: boolean): Route {
  invariant(['normal', 'restricted'].includes(task.sensitivity) && ['routine', 'code', 'research', 'architecture'].includes(task.kind) && typeof task.verificationFailed === 'boolean' && typeof allowPremium === 'boolean', 'Invalid routing request');
  if (task.sensitivity === 'restricted') return 'restricted';
  if (task.verificationFailed && allowPremium) return 'critical';
  if (task.kind === 'architecture') return allowPremium ? 'architect' : 'code';
  return task.kind === 'routine' ? 'economy' : task.kind;
}

export type SessionStatus = 'created' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface SessionRecord {
  id: string; tenantId: string; machineId: string; actorId: string; blueprintRevision: string;
  status: SessionStatus; recordingKey: string; createdAt: string;
  finishedAt?: string; exitCode?: number;
}
function iso(value: string): void { invariant(/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid timestamp'); }
export function newSession(id: string, tenantId: string, machineId: string, actorId: string, blueprintRevision: string, now: string): SessionRecord {
  [id, tenantId, machineId, actorId, blueprintRevision].forEach(v => identifier(v, 'session metadata')); iso(now);
  return { id, tenantId, machineId, actorId, blueprintRevision, status: 'created', recordingKey: `recordings/${tenantId}/${machineId}/${id}.cast`, createdAt: now };
}
/** Persist created + recording header before spawning a PTY. A reconnect never calls newSession. */
export function transitionSession(session: SessionRecord, status: SessionStatus, now: string, exitCode?: number): SessionRecord {
  const allowed: Record<SessionStatus, SessionStatus[]> = {
    created: ['running', 'failed', 'cancelled'], running: ['succeeded', 'failed', 'cancelled', 'interrupted'],
    succeeded: [], failed: [], cancelled: [], interrupted: []
  };
  invariant(Object.hasOwn(allowed, session.status) && allowed[session.status].includes(status), 'Invalid session transition'); iso(now);
  invariant(Date.parse(now) >= Date.parse(session.createdAt), 'Time precedes session creation');
  if (exitCode !== undefined) integer(exitCode, 0, 255, 'exitCode');
  invariant(status !== 'succeeded' || exitCode === 0, 'Success requires exit code zero');
  invariant(status !== 'failed' || exitCode === undefined || exitCode > 0, 'Failure cannot have exit code zero');
  invariant(status !== 'running' || exitCode === undefined, 'Running session cannot have an exit code');
  return { ...session, status, ...(status === 'running' ? {} : { finishedAt: now }), ...(exitCode === undefined ? {} : { exitCode }) };
}

/** Formats already-sanitized output. This is NOT a secret detector or a PTY recorder. */
export class CastWriter {
  #last = 0;
  #closed = false;
  constructor(private readonly writeLine: (line: string) => void, cols: number, rows: number, unixTimestamp: number) {
    integer(cols, 1, 1000, 'cols'); integer(rows, 1, 1000, 'rows'); integer(unixTimestamp, 0, Number.MAX_SAFE_INTEGER, 'timestamp');
    writeLine(JSON.stringify({ version: 3, term: { cols, rows }, timestamp: unixTimestamp }) + '\n');
  }
  #write(seconds: number, code: string, data: string) {
    invariant(!this.#closed && Number.isFinite(seconds) && seconds >= this.#last && typeof data === 'string', 'Invalid recording event');
    invariant(data.length <= 1048576, 'Recording chunk exceeds 1,048,576 characters');
    this.writeLine(JSON.stringify([seconds - this.#last, code, data]) + '\n');
    this.#last = seconds;
  }
  output(seconds: number, sanitizedOutput: string) { this.#write(seconds, 'o', sanitizedOutput); }
  marker(seconds: number, label: string) { identifier(label, 'marker'); this.#write(seconds, 'm', label); }
  resize(seconds: number, cols: number, rows: number) {
    integer(cols, 1, 1000, 'cols'); integer(rows, 1, 1000, 'rows'); this.#write(seconds, 'r', `${cols}x${rows}`);
  }
  finish(seconds: number, exitCode: number) {
    integer(exitCode, 0, 255, 'exitCode'); this.#write(seconds, 'x', String(exitCode)); this.#closed = true;
  }
}

export interface IntegrationPlan {
  machineId: string; serviceId: string; idempotencyKey: string; credentialRef: string;
  steps: readonly ['ensure-alloy', 'write-managed-config', 'validate-config', 'reload-alloy', 'verify-log-delivery'];
}
/** Plan only. Caller must authenticate the event and enforce policy, leases and durable deduplication. */
export function planLokiIntegration(input: unknown, serviceId: string, authenticatedEventId: string): IntegrationPlan[] {
  const b = validateEnvironment(input); identifier(authenticatedEventId, 'event id');
  const service = b.services.find(s => s.id === serviceId);
  invariant(service, 'Unknown service');
  return service.machineIds.map(machineId => ({
    machineId, serviceId, credentialRef: service.credentialRef,
    idempotencyKey: JSON.stringify([authenticatedEventId, b.revision, serviceId, machineId]),
    steps: ['ensure-alloy', 'write-managed-config', 'validate-config', 'reload-alloy', 'verify-log-delivery']
  }));
}
export function renderAlloy(input: unknown, serviceId: string, machineId: string, sanitizedEventsPath: string): string {
  const b = validateEnvironment(input);
  const service = b.services.find(s => s.id === serviceId);
  invariant(service && service.machineIds.includes(machineId), 'Machine is not authorized for this service');
  invariant(typeof sanitizedEventsPath === 'string' && /^(\/|[A-Za-z]:[\\/])/.test(sanitizedEventsPath) && !/[\r\n\u0000*?\[\]]/.test(sanitizedEventsPath), 'Use one absolute sanitized event-log path, not a glob');
  const q = JSON.stringify;
  return `// Generated managed fragment. Input file must already exclude secrets and terminal output.\n// Resolve ${service.credentialRef} locally into scoped environment variables.\nlocal.file_match "aid_events" {\n  path_targets = [{"__path__" = ${q(sanitizedEventsPath)}, "job" = "install-doctor", "machine_id" = ${q(machineId)}}]\n}\nloki.source.file "aid_events" {\n  targets = local.file_match.aid_events.targets\n  forward_to = [loki.write.aid.receiver]\n}\nloki.write "aid" {\n  endpoint {\n    url = ${q(service.pushUrl)}\n    basic_auth {\n      username = sys.env("AID_LOKI_USERNAME")\n      password = sys.env("AID_LOKI_PASSWORD")\n    }\n  }\n}\n`;
}

export * from './probabilistic-intent.js';
export * from './fleet-recovery.js';
