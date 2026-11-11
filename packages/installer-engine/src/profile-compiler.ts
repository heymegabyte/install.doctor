import { createHash } from 'node:crypto';
import {
  exportMarkdown,
  importMarkdown,
  migrateBlueprintV1ToV2,
  migrateBlueprintV2ToV3,
  migrateBlueprintV3ToV4,
  resolveMachinePackages,
  validateEnvironment,
  type BlueprintV4,
  type EnvironmentBlueprint,
  type Route,
} from '@install-doctor/aid-core';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const catalogEntrySchema = z.strictObject({
  id: identifier,
  dependencies: z.array(identifier).max(4096).default([]),
  conflicts: z.array(identifier).max(4096).default([]),
});
const catalogSchema = z.array(catalogEntrySchema).max(16_384);

export type ProfileMigrationOptions = Readonly<{
  profileId: string;
  visibility: 'public-bootstrap' | 'private';
  promptPolicyId: string;
  promptPolicyVersion: string;
  promptMode: 'deterministic-only' | 'agent-assisted';
  allowedRoutes: Route[];
  secretReferences?: BlueprintV4['secretReferences'];
}>;

export type ProfileConflict = Readonly<{
  code: 'catalog-cycle' | 'catalog-conflict' | 'missing-catalog-entry' | 'missing-secret-reference';
  path: string[];
  message: string;
  remediation: string;
}>;

export class ProfileCompilationError extends Error {
  readonly conflicts: readonly ProfileConflict[];
  constructor(conflicts: readonly ProfileConflict[]) {
    super(conflicts.map(item => item.message).join('; '));
    this.name = 'ProfileCompilationError';
    this.conflicts = conflicts;
  }
}

export type CompiledProfile = Readonly<{
  schemaVersion: 1;
  kind: 'desktop-tools-compiled-profile';
  digest: string;
  environment: BlueprintV4;
  markdown: string;
  hostOverlays: readonly Readonly<{
    machineId: string;
    os: 'linux' | 'darwin' | 'win32';
    role: string;
    packages: readonly string[];
    services: readonly string[];
    capabilities: readonly string[];
  }>[];
  catalogClosure: readonly string[];
  servicePolicy: readonly Readonly<{ serviceId: string; machineIds: readonly string[]; credentialReferenceId: string | null }>[];
  secretRequirements: readonly Readonly<{
    id: string;
    requiredAt: 'enrollment' | 'plan' | 'apply' | 'runtime';
    offlineRecovery: 'not-required' | 'escrow-required';
  }>[];
}>;

export type ProfileSemanticChange = Readonly<{
  operation: 'add' | 'remove' | 'replace';
  path: string;
  before?: unknown;
  after?: unknown;
}>;

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function normalizeV4(input: BlueprintV4): BlueprintV4 {
  return validateEnvironment({
    ...input,
    routing: { ...input.routing },
    skills: { ...input.skills, include: sorted(input.skills.include) },
    defaults: { ...input.defaults, packages: sorted(input.defaults.packages) },
    roles: input.roles.map(role => ({ ...role, packages: sorted(role.packages),
      ...(role.capabilities === undefined ? {} : { capabilities: sorted(role.capabilities) }) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    machines: input.machines.map(machine => ({ ...machine,
      ...(machine.capabilities === undefined ? {} : { capabilities: sorted(machine.capabilities) }),
      packageOverrides: { add: sorted(machine.packageOverrides.add), remove: sorted(machine.packageOverrides.remove) },
    })).sort((left, right) => left.id.localeCompare(right.id)),
    services: input.services.map(service => ({ ...service, machineIds: sorted(service.machineIds) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    promptPolicy: { ...input.promptPolicy, allowedRoutes: sorted(input.promptPolicy.allowedRoutes) },
    secretReferences: [...input.secretReferences].sort((left, right) => left.id.localeCompare(right.id)),
  }) as BlueprintV4;
}

/** Explicitly migrate a validated legacy profile. Import never migrates implicitly. */
export function migrateProfile(input: unknown, options: ProfileMigrationOptions): BlueprintV4 {
  let current: EnvironmentBlueprint = validateEnvironment(input);
  if (current.schemaVersion === 1) current = migrateBlueprintV1ToV2(current);
  if (current.schemaVersion === 2) current = migrateBlueprintV2ToV3(current);
  if (current.schemaVersion === 3) current = migrateBlueprintV3ToV4(current, options);
  return normalizeV4(current);
}

function resolveClosure(environment: BlueprintV4, rawCatalog: unknown): string[] {
  const catalog = catalogSchema.parse(rawCatalog);
  const entries = new Map(catalog.map(entry => [entry.id, {
    ...entry, dependencies: sorted(entry.dependencies), conflicts: sorted(entry.conflicts),
  }]));
  if (entries.size !== catalog.length) throw new Error('catalog identifiers must be unique');
  const selected = sorted(environment.machines.flatMap(machine => resolveMachinePackages(environment, machine.id)));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const conflicts: ProfileConflict[] = [];
  const visit = (id: string, path: string[]): void => {
    if (visited.has(id)) return;
    const entry = entries.get(id);
    if (!entry) {
      conflicts.push({ code: 'missing-catalog-entry', path: [...path, id],
        message: `Selected package '${id}' has no catalog entry.`,
        remediation: `Add an admitted '${id}' recipe or remove it from the profile.` });
      return;
    }
    if (visiting.has(id)) {
      conflicts.push({ code: 'catalog-cycle', path: [...path, id],
        message: `Catalog dependency cycle: ${[...path, id].join(' -> ')}.`,
        remediation: 'Remove the cycle before compiling the profile.' });
      return;
    }
    visiting.add(id);
    for (const dependency of entry.dependencies) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of selected) visit(id, []);
  for (const id of [...visited].sort()) {
    const entry = entries.get(id)!;
    for (const incompatible of entry.conflicts) {
      if (visited.has(incompatible) && id.localeCompare(incompatible) < 0) {
        conflicts.push({ code: 'catalog-conflict', path: ['packages', id, incompatible],
          message: `Packages '${id}' and '${incompatible}' are incompatible.`,
          remediation: `Remove either '${id}' or '${incompatible}' from defaults, its role, or its machine override.` });
      }
    }
  }
  if (conflicts.length > 0) throw new ProfileCompilationError(conflicts);
  return [...visited].sort();
}

function referenceId(environment: BlueprintV4, reference: string): string | null {
  return environment.secretReferences.find(item => item.reference === reference)?.id ?? null;
}

/** Compile portable desired state without reading or accepting any secret value. */
export function compileProfile(input: Readonly<{ environment: unknown; catalog: unknown }>): CompiledProfile {
  const validated = validateEnvironment(input.environment);
  if (validated.schemaVersion !== 4) throw new Error('profile compilation requires schemaVersion 4; migrate explicitly first');
  const environment = normalizeV4(validated);
  const catalogClosure = resolveClosure(environment, input.catalog);
  const missingReferences = environment.services.filter(service => referenceId(environment, service.credentialRef) === null);
  if (missingReferences.length > 0) {
    throw new ProfileCompilationError(missingReferences.map(service => ({
      code: 'missing-secret-reference' as const,
      path: ['services', service.id, 'credentialRef'],
      message: `Service '${service.id}' uses an undeclared secret reference.`,
      remediation: `Declare the service credential as a secretReferences entry or remove service '${service.id}'.`,
    })));
  }
  const markdown = exportMarkdown(environment);
  const unsigned = {
    schemaVersion: 1 as const,
    kind: 'desktop-tools-compiled-profile' as const,
    environment,
    markdown,
    hostOverlays: environment.machines.map(machine => {
      const role = environment.roles.find(candidate => candidate.id === machine.role)!;
      return {
        machineId: machine.id, os: machine.os, role: machine.role,
        packages: sorted(resolveMachinePackages(environment, machine.id)),
        services: sorted(environment.services.filter(service => service.machineIds.includes(machine.id)).map(service => service.id)),
        capabilities: sorted([...(role.capabilities ?? []), ...(machine.capabilities ?? [])]),
      };
    }),
    catalogClosure,
    servicePolicy: environment.services.map(service => ({ serviceId: service.id, machineIds: service.machineIds,
      credentialReferenceId: referenceId(environment, service.credentialRef) })),
    secretRequirements: environment.secretReferences.map(({ id, requiredAt, offlineRecovery }) => ({ id, requiredAt, offlineRecovery })),
  };
  return { ...unsigned, digest: digest(unsigned) };
}

export function exportCompiledProfile(input: CompiledProfile): string {
  const { digest: actual, ...unsigned } = input;
  if (digest(unsigned) !== actual) throw new Error('compiled profile digest mismatch');
  return canonicalJson(input);
}

export function importCompiledProfile(serialized: string): CompiledProfile {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 4_000_000) throw new Error('compiled profile exceeds its byte bound');
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error('compiled profile must be valid JSON'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('compiled profile must be an object');
  const record = parsed as Record<string, unknown>;
  const actual = record.digest;
  if (typeof actual !== 'string') throw new Error('compiled profile digest is missing');
  const { digest: _digest, ...unsigned } = record;
  if (digest(unsigned) !== actual) throw new Error('compiled profile digest mismatch');
  const environment = normalizeV4(validateEnvironment(record.environment) as BlueprintV4);
  if (exportMarkdown(environment) !== record.markdown) throw new Error('compiled profile markdown differs from desired state');
  if (!Array.isArray(record.catalogClosure) || record.catalogClosure.some(id => !identifier.safeParse(id).success)
    || new Set(record.catalogClosure).size !== record.catalogClosure.length) {
    throw new Error('compiled profile catalog closure is invalid');
  }
  const closure = sorted(record.catalogClosure as string[]);
  const selected = sorted(environment.machines.flatMap(machine => resolveMachinePackages(environment, machine.id)));
  const extras = closure.filter(id => !selected.includes(id));
  if (selected.some(id => !closure.includes(id)) || (selected.length === 0 && extras.length > 0)) {
    throw new Error('compiled profile catalog closure differs from selected desired state');
  }
  const syntheticCatalog = closure.map(id => ({ id, dependencies: id === selected[0] ? extras : [], conflicts: [] }));
  const expected = compileProfile({ environment, catalog: syntheticCatalog });
  const { digest: _expectedDigest, ...expectedUnsigned } = expected;
  if (JSON.stringify(canonicalValue(expectedUnsigned)) !== JSON.stringify(canonicalValue(unsigned))) {
    throw new Error('compiled profile derived state differs from desired state');
  }
  return structuredClone(parsed) as CompiledProfile;
}

function diffValue(before: unknown, after: unknown, path: string, output: ProfileSemanticChange[]): void {
  if (JSON.stringify(canonicalValue(before)) === JSON.stringify(canonicalValue(after))) return;
  if (before === undefined) { output.push({ operation: 'add', path, after }); return; }
  if (after === undefined) { output.push({ operation: 'remove', path, before }); return; }
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of sorted([...Object.keys(before as object), ...Object.keys(after as object)])) {
      diffValue((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}/${key}`, output);
    }
    return;
  }
  output.push({ operation: 'replace', path, before, after });
}

/** A stable structural diff; secret locations are represented only by ids and lifecycle metadata. */
export function semanticProfileDiff(before: CompiledProfile, after: CompiledProfile): ProfileSemanticChange[] {
  const safe = (profile: CompiledProfile) => ({
    environment: {
      ...profile.environment,
      services: profile.environment.services.map(service => ({
        ...service,
        credentialRef: profile.servicePolicy.find(policy => policy.serviceId === service.id)?.credentialReferenceId ?? null,
      })),
      secretReferences: profile.secretRequirements,
    },
    hostOverlays: profile.hostOverlays,
    catalogClosure: profile.catalogClosure,
    servicePolicy: profile.servicePolicy,
  });
  const changes: ProfileSemanticChange[] = [];
  diffValue(safe(before), safe(after), '', changes);
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

/** Preview all resolved state and conflicts without mutation, network access, or secret resolution. */
export function simulateProfile(input: Readonly<{ environment: unknown; catalog: unknown }>): Readonly<{
  valid: boolean;
  digest: string | null;
  hostOverlays: CompiledProfile['hostOverlays'];
  catalogClosure: readonly string[];
  servicePolicy: CompiledProfile['servicePolicy'];
  secretRequirements: CompiledProfile['secretRequirements'];
  conflicts: readonly ProfileConflict[];
}> {
  try {
    const compiled = compileProfile(input);
    return { valid: true, digest: compiled.digest, hostOverlays: compiled.hostOverlays,
      catalogClosure: compiled.catalogClosure, servicePolicy: compiled.servicePolicy,
      secretRequirements: compiled.secretRequirements, conflicts: [] };
  } catch (error) {
    if (!(error instanceof ProfileCompilationError)) throw error;
    return { valid: false, digest: null, hostOverlays: [], catalogClosure: [], servicePolicy: [], secretRequirements: [],
      conflicts: error.conflicts };
  }
}
