import { z } from 'zod';
import { type BlueprintV4, resolveMachinePackages, validateEnvironment } from './core.js';
import { DesiredStateInputSchema, HostFactsSchema, type DesiredStateInput } from './installer-contracts.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const recipeIdentifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifiers = z.array(identifier).max(4096).refine(values => new Set(values).size === values.length, 'duplicate identifiers')
  .refine(values => values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0), 'identifiers must be sorted');
const recipeReferenceSchema = z.strictObject({
  id: recipeIdentifier,
  version: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
  sha256: digest,
});

const portableProfileExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('desktop-tools-portable-profile'),
  profile: z.strictObject({
    id: identifier,
    revision: identifier,
    visibility: z.enum(['public-bootstrap', 'private']),
  }),
  target: z.strictObject({
    os: z.enum(['linux', 'darwin', 'win32']),
    role: identifier,
    tier: z.enum(['minimal', 'workstation', 'server', 'hypervisor', 'full']).nullable(),
    capabilities: identifiers,
  }),
  desired: z.strictObject({
    revision: identifier,
    packages: identifiers,
    services: identifiers.max(512),
    consents: identifiers.max(256),
    offline: z.boolean(),
  }),
  promptPolicy: z.strictObject({
    id: identifier,
    version: identifier,
    mode: z.enum(['deterministic-only', 'agent-assisted']),
    allowedRoutes: z.array(z.enum(['general', 'economy', 'code', 'architect', 'research', 'critical', 'batch', 'restricted'])).max(8)
      .refine(values => new Set(values).size === values.length, 'prompt routes must be unique')
      .refine(values => values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0), 'prompt routes must be sorted'),
  }),
  skills: z.strictObject({
    repository: z.literal('heymegabyte/agent-skills'),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    include: identifiers,
  }),
  catalog: z.strictObject({ sha256: digest }),
  recipes: z.array(recipeReferenceSchema).min(1).max(4096),
  sourceEnvironmentDigest: digest,
  exportDigest: digest,
}).superRefine((value, context) => {
  const recipeIds = value.recipes.map(recipe => recipe.id);
  if (new Set(recipeIds).size !== recipeIds.length) context.addIssue({ code: 'custom', path: ['recipes'], message: 'recipe ids must be unique' });
  if (value.recipes.some((recipe, index) => index > 0 && value.recipes[index - 1]!.id.localeCompare(recipe.id) >= 0)) {
    context.addIssue({ code: 'custom', path: ['recipes'], message: 'recipes must be sorted by id' });
  }
  if (value.profile.revision !== value.desired.revision) context.addIssue({ code: 'custom', path: ['desired', 'revision'], message: 'desired revision must match profile revision' });
});

export type PortableProfileExport = z.infer<typeof portableProfileExportSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function publicSource(environment: BlueprintV4): unknown {
  return {
    schemaVersion: environment.schemaVersion,
    revision: environment.revision,
    appUrl: environment.appUrl,
    profile: environment.profile,
    promptPolicy: { ...environment.promptPolicy, allowedRoutes: sorted(environment.promptPolicy.allowedRoutes) },
    skills: environment.skills,
    defaults: environment.defaults,
    roles: environment.roles,
    privacy: environment.privacy,
  };
}

/** Derive a credential-free, machine-identity-free standalone profile from canonical ENVIRONMENT state. */
export async function createPortableProfileExport(input: {
  environment: unknown;
  machineId: string;
  recipes: readonly { id: string; version: string; sha256: string }[];
  catalogSha256: string;
  consents?: readonly string[];
  offline?: boolean;
}): Promise<PortableProfileExport> {
  const environment = validateEnvironment(input.environment);
  if (environment.schemaVersion !== 4) throw new Error('portable profile export requires ENVIRONMENT schemaVersion 4');
  const machine = environment.machines.find(candidate => candidate.id === input.machineId);
  if (!machine) throw new Error('portable profile export target is unknown');
  const role = environment.roles.find(candidate => candidate.id === machine.role);
  if (!role) throw new Error('portable profile export role is unknown');
  const services = environment.services.filter(service => service.machineIds.includes(machine.id)).map(service => service.id);
  const recipes = [...input.recipes].sort((left, right) => left.id.localeCompare(right.id));
  const sourceEnvironmentDigest = await sha256(publicSource(environment));
  const unsigned = {
    schemaVersion: 1 as const,
    kind: 'desktop-tools-portable-profile' as const,
    profile: environment.profile,
    target: {
      os: machine.os,
      role: machine.role,
      tier: machine.tier ?? role.tier ?? environment.defaults.tier ?? null,
      capabilities: sorted([...(role.capabilities ?? []), ...(machine.capabilities ?? [])]),
    },
    desired: {
      revision: environment.revision,
      packages: sorted(resolveMachinePackages(environment, machine.id)),
      services: sorted(services),
      consents: sorted(input.consents ?? []),
      offline: input.offline ?? false,
    },
    promptPolicy: { ...environment.promptPolicy, allowedRoutes: sorted(environment.promptPolicy.allowedRoutes) },
    skills: { ...environment.skills, include: sorted(environment.skills.include) },
    catalog: { sha256: input.catalogSha256 },
    recipes,
    sourceEnvironmentDigest,
  };
  const exportDigest = await sha256(unsigned);
  return portableProfileExportSchema.parse({ ...unsigned, exportDigest });
}

export async function validatePortableProfileExport(input: unknown): Promise<PortableProfileExport> {
  const value = portableProfileExportSchema.parse(input);
  const { exportDigest, ...unsigned } = value;
  if (await sha256(unsigned) !== exportDigest) throw new Error('portable profile export digest mismatch');
  return structuredClone(value);
}

export async function serializePortableProfileExport(input: unknown): Promise<string> {
  const value = await validatePortableProfileExport(input);
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export async function parsePortableProfileExport(input: string): Promise<PortableProfileExport> {
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > 2_000_000) throw new Error('portable profile export exceeds its byte bound');
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('portable profile export must be valid JSON'); }
  return validatePortableProfileExport(value);
}

/** Bind portable desired state to fresh observed host identity without importing private source-machine data. */
export async function materializePortableDesiredState(input: unknown, factsInput: unknown): Promise<DesiredStateInput> {
  const value = await validatePortableProfileExport(input);
  const facts = HostFactsSchema.parse(factsInput);
  if (facts.os !== value.target.os) throw new Error('standalone target operating system does not match profile export');
  if (!facts.roles.includes(value.target.role)) throw new Error('standalone target role does not match profile export');
  const missingCapabilities = value.target.capabilities.filter(capability => !facts.capabilities.includes(capability));
  if (missingCapabilities.length > 0) throw new Error(`standalone target lacks profile capabilities: ${missingCapabilities.join(',')}`);
  return DesiredStateInputSchema.parse({ schemaVersion: 1, hostId: facts.hostId, ...value.desired });
}
