import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ImmutableArtifactDescriptorSchema, NativeOfflinePayloadDescriptorSchema } from './contracts.js';
import type { ImmutableArtifactDescriptor } from './contracts.js';

const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(128);
const CatalogKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(128);
const PlatformSchema = z.enum(['macos', 'linux', 'windows']);
const LoadPolicySchema = z.enum([
  'lazy',
  'eager-bootstrap',
  'eager-supported-path',
  'eager-security-recovery',
  'eager-service',
]);

export const LoadCatalogEntrySchema = z.object({
  name: CatalogKeySchema,
  bin: z.string().min(1).max(256),
  platforms: z.array(PlatformSchema).min(1),
  installMode: z.enum(['cli', 'app', 'service']),
  loadPolicy: LoadPolicySchema,
  loadRationale: z.string().min(1).max(512),
  deps: z.array(CatalogKeySchema).default([]),
  artifacts: z.array(ImmutableArtifactDescriptorSchema).max(16).default([]),
  offlinePayloads: z.array(NativeOfflinePayloadDescriptorSchema).max(256).default([]),
  providers: z.array(IdentifierSchema).max(64).optional(),
  pkgs: z.record(IdentifierSchema, z.string().min(1).max(4096)).optional(),
  deliveryMode: z.enum(['eager', 'lazy']).optional(),
  preload: z.boolean().optional(),
  preloadReason: z.enum([
    'bootstrap-critical',
    'lazy-installer-substrate',
    'security-recovery-prerequisite',
    'desired-state-service',
    'shell-profile-core',
    'web-dev-core',
    'media-management-core',
    'lsp-core',
  ]).optional(),
  short: z.string().max(4096).optional(),
  github: z.string().max(4096).optional(),
  home: z.string().max(4096).optional(),
  docs: z.string().max(4096).optional(),
  deprecated: z.string().max(4096).optional(),
  replacement: IdentifierSchema.optional(),
  configured: z.boolean().optional(),
  postInstall: z.string().min(1).max(512).optional(),
  caskLauncher: z.strictObject({
    appBundle: z.string().min(5).max(256),
    bin: z.string().min(1).max(128),
  }).optional(),
  flatpakLauncher: z.strictObject({
    appId: z.string().min(5).max(256),
    bin: z.string().min(1).max(128),
  }).optional(),
}).strict();

export const LoadPlanInputSchema = z.object({
  schemaVersion: z.literal(1),
  platform: PlatformSchema,
  architecture: z.enum(['x64', 'arm64']),
  roles: z.array(IdentifierSchema).max(32),
  selectedPackages: z.array(CatalogKeySchema).max(4096),
  selectedServices: z.array(CatalogKeySchema).max(1024),
  selectedSupportedPaths: z.array(IdentifierSchema).max(1024),
  lazyResolverRequirements: z.array(CatalogKeySchema).max(128),
  catalog: z.array(LoadCatalogEntrySchema).max(16_384),
}).strict();

export const LoadPlanItemSchema = z.object({
  name: CatalogKeySchema,
  classification: LoadPolicySchema,
  rationale: z.string().min(1),
  applicable: z.boolean(),
  selected: z.boolean(),
  dependencies: z.array(CatalogKeySchema),
  artifact: ImmutableArtifactDescriptorSchema.nullable(),
  nativePayload: NativeOfflinePayloadDescriptorSchema.nullable(),
  caskLauncher: z.strictObject({
    appBundle: z.string().min(5).max(256),
    bin: z.string().min(1).max(128),
  }).nullable(),
  flatpakLauncher: z.strictObject({
    appId: z.string().min(5).max(256),
    bin: z.string().min(1).max(128),
  }).nullable(),
  actions: z.array(z.enum(['install', 'start'])),
  selectionReason: z.enum([
    'bootstrap',
    'security-recovery',
    'supported-path',
    'desired-package',
    'desired-service',
    'transactional-prerequisite',
    'unsupported-platform',
    'unselected-lazy',
    'unselected-service',
    'unselected-supported-path',
  ]),
}).strict();

export const LoadPlanReportSchema = z.object({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  platform: PlatformSchema,
  architecture: z.enum(['x64', 'arm64']),
  roles: z.array(IdentifierSchema),
  selectedSupportedPaths: z.array(IdentifierSchema),
  installOrder: z.array(CatalogKeySchema),
  startOrder: z.array(CatalogKeySchema),
  items: z.array(LoadPlanItemSchema),
}).strict();

export type LoadPlanInput = z.infer<typeof LoadPlanInputSchema>;
export type LoadPlanReport = z.infer<typeof LoadPlanReportSchema>;
export type LoadPlanItem = z.infer<typeof LoadPlanItemSchema>;
type LoadCatalogEntry = z.infer<typeof LoadCatalogEntrySchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function calculateLoadPlanReportDigest(rawReport: unknown): string {
  const { digest: _digest, ...unsigned } = LoadPlanReportSchema.parse(rawReport);
  return createHash('sha256').update(canonical(unsigned)).digest('hex');
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function supportedPath(entry: LoadCatalogEntry): string | undefined {
  const prefix = 'supported-path:';
  return entry.loadRationale.startsWith(prefix) ? entry.loadRationale.slice(prefix.length) : undefined;
}

export function buildLoadPlan(rawInput: unknown): LoadPlanReport {
  const parsed = LoadPlanInputSchema.parse(rawInput);
  const input = {
    ...parsed,
    roles: uniqueSorted(parsed.roles),
    selectedPackages: uniqueSorted(parsed.selectedPackages),
    selectedServices: uniqueSorted(parsed.selectedServices),
    selectedSupportedPaths: uniqueSorted(parsed.selectedSupportedPaths),
    lazyResolverRequirements: uniqueSorted(parsed.lazyResolverRequirements),
  };
  const entries = new Map<string, LoadCatalogEntry>();
  for (const rawEntry of input.catalog) {
    const entry = { ...rawEntry, platforms: uniqueSorted(rawEntry.platforms), deps: uniqueSorted(rawEntry.deps) };
    const previous = entries.get(entry.name);
    if (previous) {
      const comparable = ({ bin: _bin, ...rest }: LoadCatalogEntry) => rest;
      if (canonical(comparable(previous)) !== canonical(comparable(entry))) {
        throw new Error(`catalog entry ${entry.name} has inconsistent duplicate metadata`);
      }
      previous.platforms = uniqueSorted([...previous.platforms, ...entry.platforms]);
      continue;
    }
    entries.set(entry.name, entry);
  }

  for (const name of [...input.selectedPackages, ...input.selectedServices, ...input.lazyResolverRequirements]) {
    if (!entries.has(name)) throw new Error(`unknown selected catalog entry: ${name}`);
  }
  const offlinePayloadAuthorities = new Map<string, string>();
  const offlinePayloadArtifactOwners = new Map<string, string>();
  for (const entry of entries.values()) {
    for (const dependency of entry.deps) {
      if (!entries.has(dependency)) throw new Error(`${entry.name} references unknown dependency: ${dependency}`);
    }
    if (entry.loadPolicy === 'lazy' && entry.loadRationale !== 'default-lazy') {
      throw new Error(`${entry.name} lazy rationale must be default-lazy`);
    }
    if (entry.loadPolicy !== 'lazy' && !entry.loadRationale.includes(':')) {
      throw new Error(`${entry.name} eager rationale lacks an owning reference`);
    }
    if (entry.loadPolicy === 'eager-supported-path' && !supportedPath(entry)) {
      throw new Error(`${entry.name} eager supported-path rationale is invalid`);
    }
    if (entry.loadPolicy === 'eager-service' && entry.installMode !== 'service') {
      throw new Error(`${entry.name} eager-service entry is not a service`);
    }
    const artifactPlatforms = new Set<string>();
    for (const artifact of entry.artifacts) {
      if (artifact.id !== entry.name) throw new Error(`${entry.name} artifact identifier does not match its catalog entry`);
      const catalogPlatform = artifact.platform.os === 'darwin' ? 'macos' : artifact.platform.os === 'win32' ? 'windows' : 'linux';
      if (!entry.platforms.includes(catalogPlatform)) {
        throw new Error(`${entry.name} artifact platform is absent from its catalog platforms`);
      }
      const tuple = `${artifact.platform.os}/${artifact.platform.arch}`;
      if (artifactPlatforms.has(tuple)) throw new Error(`${entry.name} has a duplicate artifact platform: ${tuple}`);
      artifactPlatforms.add(tuple);
    }
    for (const payload of entry.offlinePayloads) {
      if (payload.packageKey !== entry.name) {
        throw new Error(`${entry.name} offline payload package key does not match its catalog entry identifier`);
      }
      if (!entry.platforms.includes('linux')) {
        throw new Error(`${entry.name} offline payload platform is absent from its catalog platforms`);
      }
      const authority = [
        payload.manager, payload.platform.os, payload.platform.arch,
        payload.distro.id, payload.distro.versionId, payload.distro.codename,
        payload.package.name, payload.package.version, payload.package.architecture,
      ].join('/');
      const authorityOwner = offlinePayloadAuthorities.get(authority);
      const artifactOwner = offlinePayloadArtifactOwners.get(payload.artifact.id);
      if (authorityOwner !== undefined || artifactOwner !== undefined) {
        throw new Error(`${entry.name} has duplicate offline payload authority across catalog entries: ${authority}`);
      }
      offlinePayloadAuthorities.set(authority, entry.name);
      offlinePayloadArtifactOwners.set(payload.artifact.id, entry.name);
    }
  }
  for (const entry of entries.values()) {
    for (const payload of entry.offlinePayloads) {
      for (const dependency of [...payload.dependencyClosure.preDepends, ...payload.dependencyClosure.depends]) {
        const owner = offlinePayloadArtifactOwners.get(dependency.artifactId);
        if (owner === undefined || owner !== dependency.packageKey) {
          throw new Error(`${entry.name} offline payload dependency does not resolve to its exact catalog package key and artifact: ${dependency.packageKey}/${dependency.artifactId}`);
        }
      }
    }
  }

  const declaredSupportedPaths = new Set([...entries.values()].map(supportedPath).filter((value): value is string => Boolean(value)));
  for (const selectedPath of input.selectedSupportedPaths) {
    if (!declaredSupportedPaths.has(selectedPath)) throw new Error(`unknown selected supported path: ${selectedPath}`);
  }

  // Validate the entire catalog graph, not just today's selected closure. A latent cycle must not
  // become a delayed production failure when a previously lazy path is selected later.
  const graphVisiting = new Set<string>();
  const graphVisited = new Set<string>();
  const validateGraph = (name: string): void => {
    if (graphVisiting.has(name)) throw new Error(`catalog dependency cycle includes ${name}`);
    if (graphVisited.has(name)) return;
    graphVisiting.add(name);
    for (const dependency of entries.get(name)?.deps ?? []) validateGraph(dependency);
    graphVisiting.delete(name);
    graphVisited.add(name);
  };
  for (const name of [...entries.keys()].sort((left, right) => left.localeCompare(right))) validateGraph(name);

  const artifactOs = input.platform === 'macos' ? 'darwin' : input.platform === 'windows' ? 'win32' : 'linux';
  const selectedArtifact = (entry: LoadCatalogEntry): ImmutableArtifactDescriptor | null => {
    if (entry.artifacts.length === 0) return null;
    return entry.artifacts.find(artifact => artifact.platform.os === artifactOs && artifact.platform.arch === input.architecture) ?? null;
  };
  const selectedNativePayload = (entry: LoadCatalogEntry) => {
    const candidates = entry.offlinePayloads.filter(payload => payload.platform.os === artifactOs && payload.platform.arch === input.architecture);
    if (candidates.length > 1) throw new Error(`${entry.name} has ambiguous native payload authority for ${artifactOs}/${input.architecture}`);
    return candidates[0] ?? null;
  };
  const applicable = (name: string): boolean => {
    const entry = entries.get(name);
    return entry?.platforms.includes(input.platform) === true
      && (entry.artifacts.length === 0 || selectedArtifact(entry) !== null)
      && (entry.offlinePayloads.length === 0 || selectedNativePayload(entry) !== null);
  };
  const selected = new Set<string>();
  const reasons = new Map<string, LoadPlanReport['items'][number]['selectionReason']>();
  const select = (name: string, reason: LoadPlanReport['items'][number]['selectionReason']): void => {
    if (!applicable(name)) return;
    if (!selected.has(name)) reasons.set(name, reason);
    selected.add(name);
  };
  for (const entry of entries.values()) {
    if (entry.loadPolicy === 'eager-bootstrap') select(entry.name, 'bootstrap');
    if (entry.loadPolicy === 'eager-security-recovery') select(entry.name, 'security-recovery');
    if (entry.loadPolicy === 'eager-supported-path') {
      const owner = supportedPath(entry);
      if (owner && input.selectedSupportedPaths.includes(owner)) select(entry.name, 'supported-path');
    }
  }
  for (const name of input.selectedPackages) {
    if (!applicable(name)) throw new Error(`${name} is unavailable on ${input.platform}/${input.architecture}`);
    select(name, 'desired-package');
  }
  for (const name of input.selectedServices) {
    const entry = entries.get(name);
    if (entry?.installMode !== 'service') throw new Error(`selected service ${name} is not declared as a service`);
    if (!applicable(name)) throw new Error(`${name} is unavailable on ${input.platform}/${input.architecture}`);
    select(name, 'desired-service');
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const installOrder: string[] = [];
  const visit = (name: string, parent?: string): void => {
    if (!applicable(name)) throw new Error(`${parent ?? name} requires ${name}, which is unavailable on ${input.platform}/${input.architecture}`);
    if (visiting.has(name)) throw new Error(`catalog dependency cycle includes ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    const entry = entries.get(name);
    if (!entry) throw new Error(`unknown dependency: ${name}`);
    for (const dependency of entry.deps) {
      if (!selected.has(dependency)) reasons.set(dependency, 'transactional-prerequisite');
      selected.add(dependency);
      visit(dependency, name);
    }
    visiting.delete(name);
    visited.add(name);
    installOrder.push(name);
  };
  for (const name of [...selected].sort((left, right) => left.localeCompare(right))) visit(name);

  const artifactDestinations = new Map<string, string>();
  for (const name of installOrder) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`selected catalog entry disappeared: ${name}`);
    const artifact = selectedArtifact(entry);
    if (!artifact) continue;
    const destination = `${artifact.destination.root}/${artifact.destination.filename}`;
    const owner = artifactDestinations.get(destination);
    if (owner !== undefined && owner !== name) {
      throw new Error(`immutable artifact destination collision at ${destination}: ${owner} and ${name}`);
    }
    artifactDestinations.set(destination, name);
  }

  for (const requirement of input.lazyResolverRequirements) {
    const entry = entries.get(requirement);
    if (!applicable(requirement) || entry?.loadPolicy !== 'eager-bootstrap' || !selected.has(requirement)) {
      throw new Error(`lazy resolver prerequisite ${requirement} is not an applicable eager bootstrap dependency`);
    }
  }

  const items = [...entries.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry): LoadPlanReport['items'][number] => {
      const isApplicable = applicable(entry.name);
      const isSelected = selected.has(entry.name);
      let selectionReason = reasons.get(entry.name);
      if (!selectionReason) {
        if (!isApplicable) selectionReason = 'unsupported-platform';
        else if (entry.loadPolicy === 'eager-service') selectionReason = 'unselected-service';
        else if (entry.loadPolicy === 'eager-supported-path') selectionReason = 'unselected-supported-path';
        else selectionReason = 'unselected-lazy';
      }
      const actions: Array<'install' | 'start'> = isSelected
        ? entry.installMode === 'service' && input.selectedServices.includes(entry.name) ? ['install', 'start'] : ['install']
        : [];
      return {
        name: entry.name,
        classification: entry.loadPolicy,
        rationale: entry.loadRationale,
        applicable: isApplicable,
        selected: isSelected,
        dependencies: entry.deps,
        artifact: selectedArtifact(entry),
        nativePayload: isSelected ? selectedNativePayload(entry) : null,
        caskLauncher: isSelected ? entry.caskLauncher ?? null : null,
        flatpakLauncher: isSelected ? entry.flatpakLauncher ?? null : null,
        actions,
        selectionReason,
      };
    });
  const unsigned = {
    schemaVersion: 1 as const,
    platform: input.platform,
    architecture: input.architecture,
    roles: input.roles,
    selectedSupportedPaths: input.selectedSupportedPaths,
    installOrder,
    startOrder: installOrder.filter((name) => input.selectedServices.includes(name)),
    items,
  };
  return LoadPlanReportSchema.parse({
    ...unsigned,
    digest: createHash('sha256').update(canonical(unsigned)).digest('hex'),
  });
}
