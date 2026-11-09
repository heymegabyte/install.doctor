import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveMachinePackages, validateEnvironment } from '@install-doctor/aid-core';
import {
  createPortableProfileExport,
  validatePortableProfileExport,
  type PortableProfileExport,
} from '@install-doctor/aid-core/profile-export';
import { HostFactsSchema, TaskNodeSchema, type HostFacts, type TaskNode } from './contracts.js';
import { LoadCatalogEntrySchema, buildLoadPlan } from './lazy-plan.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const catalogSchema = z.array(LoadCatalogEntrySchema).max(16_384);
type CatalogEntry = z.infer<typeof LoadCatalogEntrySchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function verifiedCatalog(bytes: Buffer, expectedDigest: string): CatalogEntry[] {
  digest.parse(expectedDigest);
  if (bytes.byteLength < 2 || bytes.byteLength > 8_388_608) throw new Error('trusted recipe catalog exceeds its byte bound');
  if (sha256(bytes) !== expectedDigest) throw new Error('trusted recipe catalog digest mismatch');
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('trusted recipe catalog must be valid JSON'); }
  return catalogSchema.parse(parsed);
}

function platform(facts: HostFacts): 'macos' | 'linux' | 'windows' {
  return facts.os === 'darwin' ? 'macos' : facts.os === 'win32' ? 'windows' : 'linux';
}

function recipeReferences(catalog: readonly CatalogEntry[], names: readonly string[]) {
  const entries = new Map(catalog.map(entry => [entry.name, entry]));
  return names.map(name => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`resolved recipe is absent from trusted catalog: ${name}`);
    return { id: name, version: 'catalog-v1', sha256: sha256(canonical(entry)) };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function loadPlanFor(catalog: readonly CatalogEntry[], facts: HostFacts, desired: { packages: readonly string[]; services: readonly string[] }) {
  return buildLoadPlan({
    schemaVersion: 1,
    platform: platform(facts),
    architecture: facts.arch,
    roles: facts.roles,
    selectedPackages: desired.packages,
    selectedServices: desired.services,
    selectedSupportedPaths: [],
    lazyResolverRequirements: [],
    catalog,
  });
}

/** Export only after the signed-release catalog bytes have been digest-verified and resolved. */
export async function createCatalogBoundProfileExport(input: {
  environment: unknown;
  machineId: string;
  facts: unknown;
  catalogBytes: Buffer;
  catalogSha256: string;
  consents?: readonly string[];
  offline?: boolean;
}): Promise<PortableProfileExport> {
  const environment = validateEnvironment(input.environment);
  if (environment.schemaVersion !== 4) throw new Error('catalog-bound export requires ENVIRONMENT schemaVersion 4');
  const machine = environment.machines.find(candidate => candidate.id === input.machineId);
  if (!machine) throw new Error('catalog-bound export target is unknown');
  const facts = HostFactsSchema.parse(input.facts);
  if (facts.os !== machine.os || !facts.roles.includes(machine.role)) throw new Error('export facts do not match the selected environment target');
  const catalog = verifiedCatalog(input.catalogBytes, input.catalogSha256);
  const desired = {
    packages: resolveMachinePackages(environment, machine.id),
    services: environment.services.filter(service => service.machineIds.includes(machine.id)).map(service => service.id),
  };
  const closure = loadPlanFor(catalog, facts, desired);
  return createPortableProfileExport({
    environment,
    machineId: machine.id,
    catalogSha256: input.catalogSha256,
    recipes: recipeReferences(catalog, closure.installOrder),
    ...(input.consents === undefined ? {} : { consents: input.consents }),
    ...(input.offline === undefined ? {} : { offline: input.offline }),
  });
}

function reconstructedTasks(catalog: readonly CatalogEntry[], installOrder: readonly string[]): { tasks: TaskNode[]; selectedTaskIds: string[] } {
  const entries = new Map(catalog.map(entry => [entry.name, entry]));
  const taskIds = new Map(installOrder.map(name => [name, `recipe.${sha256(name).slice(0, 24)}`]));
  const tasks = installOrder.map(name => {
    const entry = entries.get(name);
    const id = taskIds.get(name);
    if (!entry || !id) throw new Error(`trusted recipe closure is incomplete: ${name}`);
    return TaskNodeSchema.parse({
      schemaVersion: 1,
      id,
      inputDigest: sha256(canonical(entry)),
      dependencies: entry.deps.filter(dependency => taskIds.has(dependency)).map(dependency => taskIds.get(dependency)!).sort(),
      predicate: 'catalog-applicable',
      requiredCapabilities: [],
      operations: { check: `${id}.check`, apply: `${id}.apply`, verify: `${id}.verify` },
      timeoutMs: 3_600_000,
      retry: { class: 'transient', maxAttempts: 3, backoffMs: 1_000 },
      resources: { cpu: 1, memoryMiB: 256, network: true },
      privilege: 'user',
      network: 'optional',
      consent: 'none',
      lockDomains: [`recipe.${sha256(name).slice(0, 16)}`],
      cleanup: 'always',
      compensation: 'none',
    });
  });
  return { tasks, selectedTaskIds: tasks.map(task => task.id) };
}

/** Rebuild plan input solely from the export, fresh facts, and exact trusted catalog bytes. */
export async function reconstructPortablePlanDraft(input: {
  profileExport: unknown;
  facts: unknown;
  catalogBytes: Buffer;
}): Promise<{ tasks: TaskNode[]; selectedTaskIds: string[] }> {
  const profile = await validatePortableProfileExport(input.profileExport);
  const facts = HostFactsSchema.parse(input.facts);
  const catalog = verifiedCatalog(input.catalogBytes, profile.catalog.sha256);
  const closure = loadPlanFor(catalog, facts, profile.desired);
  const actualReferences = recipeReferences(catalog, closure.installOrder);
  if (canonical(actualReferences) !== canonical(profile.recipes)) throw new Error('exported recipe closure does not match trusted catalog resolution');
  return reconstructedTasks(catalog, closure.installOrder);
}
