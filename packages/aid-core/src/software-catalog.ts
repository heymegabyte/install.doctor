import { z } from 'zod';
import { ImmutableArtifactDescriptorSchema } from './installer-contracts.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const command = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._+:-]*$/);
const text = z.string().min(1).max(2048);
const manager = z.enum(['brew', 'apt', 'dnf', 'pacman', 'cask', 'choco', 'scoop', 'go', 'cargo', 'npm', 'pipx', 'pip', 'gem', 'apk', 'flatpak']);
const platform = z.enum(['macos', 'linux', 'windows']);
const architecture = z.enum(['x64', 'arm64']);
const unique = <T extends z.ZodTypeAny>(item: T, maximum: number, label: string) => z.array(item).max(maximum)
  .refine(values => new Set(values).size === values.length, `duplicate ${label}`);
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

const serviceDeclaration = strict({
  name: z.string().min(1).max(128), privilege: z.enum(['user', 'admin']),
  packageProvider: identifier.optional(), manager: z.literal('systemd').optional(),
});
const launcher = strict({ appBundle: z.string().min(5).max(256), bin: command });
const flatpakLauncher = strict({ appId: z.string().min(5).max(256), bin: command });

const legacyShape = {
  name: identifier, bin: command, providers: unique(manager, 32, 'providers'),
  pkgs: z.partialRecord(manager, z.string().min(1).max(512)), platforms: unique(platform, 3, 'platforms').min(1),
  installMode: z.enum(['cli', 'app', 'service']), preload: z.boolean(),
  deliveryMode: z.enum(['eager', 'lazy']),
  loadPolicy: z.enum(['lazy', 'eager-bootstrap', 'eager-supported-path', 'eager-security-recovery', 'eager-service']),
  loadRationale: text, preloadReason: identifier.optional(),
  artifacts: unique(ImmutableArtifactDescriptorSchema, 16, 'artifacts').optional(),
  serviceDeclarations: z.array(serviceDeclaration).min(1).max(32).optional(),
  short: text.optional(), github: z.string().url().max(2048).optional(), home: z.string().url().max(2048).optional(),
  docs: z.string().url().max(2048).optional(), deprecated: text.optional(), replacement: identifier.optional(),
  deps: unique(identifier, 256, 'dependencies').optional(), systemIdentityReconciliation: z.boolean().optional(),
  postInstallPrivilege: z.enum(['user', 'admin']).optional(), caskLauncher: launcher.optional(),
  flatpakLauncher: flatpakLauncher.optional(), configured: z.literal(true).optional(), postInstall: z.string().min(1).max(256).optional(),
};

/** The only accepted pre-v1 shape. It exists solely at the generator boundary. */
export const LegacySoftwareCatalogEntrySchema = strict(legacyShape).superRefine((entry, context) => {
  if (new Set(entry.providers).size !== Object.keys(entry.pkgs).length
    || entry.providers.some(provider => !Object.hasOwn(entry.pkgs, provider))) {
    context.addIssue({ code: 'custom', message: 'providers and package identities must form the same set' });
  }
});

const lifecyclePhase = strict({
  support: z.enum(['supported', 'unsupported']),
  authority: z.enum(['package-provider', 'immutable-artifact', 'typed-hook', 'none']),
  consequence: text,
});
const lifecycle = strict({
  detect: lifecyclePhase, install: lifecyclePhase, configure: lifecyclePhase,
  update: lifecyclePhase, verify: lifecyclePhase, uninstall: lifecyclePhase,
});

export const SoftwareCatalogEntrySchema = strict({
  schemaVersion: z.literal(1),
  ...legacyShape,
  identity: strict({ key: identifier, command }),
  architectures: unique(architecture, 2, 'architectures').min(1),
  roles: unique(identifier, 64, 'roles').min(1),
  lifecycle,
  dependencies: unique(identifier, 256, 'dependencies'),
  conflicts: unique(identifier, 256, 'conflicts'),
  load: strict({ delivery: z.enum(['eager', 'lazy']), policy: legacyShape.loadPolicy, rationale: text }),
  privilege: strict({ install: z.enum(['user', 'system-package-manager']), configure: z.enum(['none', 'user', 'admin']) }),
  exposure: strict({ network: z.enum(['none', 'service-declared', 'unknown']), reason: text }),
  provenance: strict({ kind: z.enum(['package-provider', 'immutable-artifact', 'mixed']), upstream: z.string().url().max(2048).nullable() }),
  license: strict({ status: z.enum(['declared', 'unknown']), spdx: z.string().min(1).max(128).nullable(), evidence: z.string().url().max(2048).nullable() }),
  supportEvidence: strict({ status: z.enum(['verified', 'unverified']), receiptDigests: unique(z.string().regex(/^[a-f0-9]{64}$/), 256, 'support receipts') }),
}).superRefine((entry, context) => {
  if (entry.identity.key !== entry.name || entry.identity.command !== entry.bin) {
    context.addIssue({ code: 'custom', message: 'identity must match the compatibility fields' });
  }
  if (JSON.stringify(entry.dependencies) !== JSON.stringify(entry.deps ?? [])) {
    context.addIssue({ code: 'custom', message: 'dependency views must match exactly' });
  }
  if (entry.load.delivery !== entry.deliveryMode || entry.load.policy !== entry.loadPolicy || entry.load.rationale !== entry.loadRationale) {
    context.addIssue({ code: 'custom', message: 'load views must match exactly' });
  }
});

export type SoftwareCatalogEntry = z.infer<typeof SoftwareCatalogEntrySchema>;

const planReasonCode = z.enum([
  'requested', 'dependency', 'eager-bootstrap', 'eager-supported-path',
  'eager-security-recovery', 'eager-service', 'lazy-not-requested',
  'deferred-until-post-bootstrap', 'unsupported-platform',
  'unsupported-architecture', 'unsupported-role', 'conflicts-with-selected',
]);
const planReason = strict({ code: planReasonCode, detail: text, related: identifier.nullable() });

export const SoftwareCatalogPlanRequestSchema = strict({
  platform,
  architecture,
  role: identifier,
  phase: z.enum(['bootstrap', 'post-bootstrap']),
  requested: unique(identifier, 2048, 'requested entries'),
});
export type SoftwareCatalogPlanRequest = z.infer<typeof SoftwareCatalogPlanRequestSchema>;

export const SoftwareCatalogPlanSchema = strict({
  schemaVersion: z.literal(1),
  target: SoftwareCatalogPlanRequestSchema.omit({ requested: true }),
  order: unique(identifier, 20_000, 'plan entries'),
  inclusions: z.array(strict({ identity: identifier, reasons: z.array(planReason).min(1).max(512) })).max(20_000),
  exclusions: z.array(strict({ identity: identifier, reasons: z.array(planReason).min(1).max(512) })).max(20_000),
});
export type SoftwareCatalogPlan = z.infer<typeof SoftwareCatalogPlanSchema>;

function phase(supported: boolean, authority: z.infer<typeof lifecyclePhase>['authority'], consequence: string) {
  return { support: supported ? 'supported' as const : 'unsupported' as const, authority, consequence };
}

/** Deterministic, side-effect-free migration; it never invents license or support evidence. */
export function migrateLegacySoftwareCatalogEntry(input: unknown): SoftwareCatalogEntry {
  const entry = LegacySoftwareCatalogEntrySchema.parse(input);
  const packageAuthority = entry.providers.length > 0;
  const artifactAuthority = Boolean(entry.artifacts?.length);
  const installAuthority = artifactAuthority && packageAuthority ? 'mixed' : artifactAuthority ? 'immutable-artifact' : 'package-provider';
  const installPhaseAuthority = artifactAuthority ? 'immutable-artifact' : 'package-provider';
  const configured = entry.configured === true;
  const artifactArchitectures = entry.artifacts?.map(artifact => artifact.platform.arch) ?? [];
  const architectures = [...new Set(entry.providers.length > 0 ? ['x64', 'arm64'] as const : artifactArchitectures)].sort();
  return SoftwareCatalogEntrySchema.parse({
    schemaVersion: 1,
    ...entry,
    identity: { key: entry.name, command: entry.bin },
    architectures,
    roles: ['any'],
    lifecycle: {
      detect: phase(true, installPhaseAuthority, 'Installed identity is detected by the selected immutable recipe.'),
      install: phase(true, installPhaseAuthority, 'Installation requires an admitted provider or immutable artifact.'),
      configure: phase(configured, configured ? 'typed-hook' : 'none', configured
        ? 'Configuration is limited to the declared typed post-install hook.'
        : 'No configuration phase is declared; installation cannot imply configuration.'),
      update: phase(true, installPhaseAuthority, 'Updates resolve through the same admitted recipe and require post-update verification.'),
      verify: phase(true, installPhaseAuthority, 'Verification must confirm the selected command and installed recipe identity.'),
      uninstall: phase(true, installPhaseAuthority, 'Uninstall is limited to the selected provider or materialized artifact identity.'),
    },
    dependencies: entry.deps ?? [],
    conflicts: [],
    load: { delivery: entry.deliveryMode, policy: entry.loadPolicy, rationale: entry.loadRationale },
    privilege: { install: packageAuthority ? 'system-package-manager' : 'user', configure: configured ? (entry.postInstallPrivilege ?? 'admin') : 'none' },
    exposure: { network: entry.installMode === 'service' ? 'service-declared' : 'none',
      reason: entry.installMode === 'service' ? 'Service exposure requires separate host-policy admission.' : 'Catalog selection declares no listening service.' },
    provenance: { kind: installAuthority, upstream: entry.github ?? entry.home ?? null },
    license: { status: 'unknown', spdx: null, evidence: null },
    supportEvidence: { status: 'unverified', receiptDigests: [] },
  });
}

export function parseSoftwareCatalog(input: unknown): SoftwareCatalogEntry[] {
  return z.array(SoftwareCatalogEntrySchema).max(20_000).parse(input);
}

function supports(entry: SoftwareCatalogEntry, request: SoftwareCatalogPlanRequest): boolean {
  return entry.platforms.includes(request.platform)
    && entry.architectures.includes(request.architecture)
    && (entry.roles.includes('any') || entry.roles.includes(request.role));
}

function eagerReason(entry: SoftwareCatalogEntry, phase: SoftwareCatalogPlanRequest['phase']): z.infer<typeof planReasonCode> | null {
  if (entry.load.delivery === 'lazy') return null;
  if (entry.load.policy === 'eager-bootstrap') return 'eager-bootstrap';
  if (phase === 'bootstrap') {
    return entry.load.policy === 'eager-security-recovery' ? 'eager-security-recovery' : null;
  }
  return entry.load.policy === 'lazy' ? null : entry.load.policy;
}

/**
 * Resolves one target-specific supported path from the strict catalog. The
 * result is complete evidence: every catalog identity occurs exactly once in
 * inclusions or exclusions, and every decision has a stable machine reason.
 */
export function buildSoftwareCatalogPlan(input: unknown, requestInput: unknown): SoftwareCatalogPlan {
  const catalog = parseSoftwareCatalog(input);
  const request = SoftwareCatalogPlanRequestSchema.parse(requestInput);
  const entries = new Map<string, SoftwareCatalogEntry>();
  for (const entry of catalog) {
    if ((entry.load.delivery === 'lazy') !== (entry.load.policy === 'lazy') || entry.preload !== (entry.load.delivery === 'eager')) {
      throw new Error(`catalog entry ${entry.name} has inconsistent eager/lazy and preload policy`);
    }
    for (const dependency of entry.dependencies) {
      if (dependency === entry.name) throw new Error(`catalog entry ${entry.name} depends on itself`);
    }
    for (const conflict of entry.conflicts) {
      if (conflict === entry.name) throw new Error(`catalog entry ${entry.name} conflicts with itself`);
    }
    const prior = entries.get(entry.name);
    if (prior) {
      const graphView = (value: SoftwareCatalogEntry) => ({
        platforms: value.platforms, architectures: value.architectures, roles: value.roles,
        dependencies: value.dependencies, conflicts: value.conflicts, load: value.load,
      });
      if (JSON.stringify(graphView(prior)) !== JSON.stringify(graphView(entry))) {
        throw new Error(`catalog command aliases for ${entry.name} have inconsistent graph semantics`);
      }
      continue;
    }
    entries.set(entry.name, entry);
  }
  for (const entry of entries.values()) {
    for (const dependency of entry.dependencies) if (!entries.has(dependency)) {
      throw new Error(`catalog entry ${entry.name} has unknown dependency ${dependency}`);
    }
    for (const conflict of entry.conflicts) if (!entries.has(conflict)) {
      throw new Error(`catalog entry ${entry.name} has unknown conflict ${conflict}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitCycle = (identity: string, path: string[]) => {
    if (visiting.has(identity)) throw new Error(`catalog dependency cycle ${[...path, identity].join(' -> ')}`);
    if (visited.has(identity)) return;
    visiting.add(identity);
    for (const dependency of entries.get(identity)!.dependencies) visitCycle(dependency, [...path, identity]);
    visiting.delete(identity);
    visited.add(identity);
  };
  for (const identity of [...entries.keys()].sort()) visitCycle(identity, []);

  const selected = new Map<string, z.infer<typeof planReason>[] >();
  const add = (identity: string, reason: z.infer<typeof planReason>) => {
    const entry = entries.get(identity);
    if (!entry) throw new Error(`requested catalog identity ${identity} is unknown`);
    if (!supports(entry, request)) {
      const dimensions = [
        !entry.platforms.includes(request.platform) ? `platform ${request.platform}` : null,
        !entry.architectures.includes(request.architecture) ? `architecture ${request.architecture}` : null,
        !(entry.roles.includes('any') || entry.roles.includes(request.role)) ? `role ${request.role}` : null,
      ].filter(Boolean).join(', ');
      throw new Error(`catalog entry ${identity} is not supported for ${dimensions}`);
    }
    const prior = selected.get(identity);
    if (prior) {
      if (!prior.some(item => item.code === reason.code && item.related === reason.related)) prior.push(reason);
      return;
    }
    selected.set(identity, [reason]);
    for (const dependency of entry.dependencies) add(dependency, {
      code: 'dependency', related: identity, detail: `${dependency} is required by ${identity}.`,
    });
  };

  for (const identity of request.requested) add(identity, { code: 'requested', related: null, detail: `${identity} was explicitly requested.` });
  for (const entry of [...entries.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const reason = supports(entry, request) ? eagerReason(entry, request.phase) : null;
    if (reason) add(entry.name, { code: reason, related: null, detail: `${entry.name} is selected by ${entry.load.policy}.` });
  }

  for (const identity of selected.keys()) {
    const entry = entries.get(identity)!;
    for (const conflict of entry.conflicts) if (selected.has(conflict)) {
      throw new Error(`selected catalog entries conflict: ${identity} and ${conflict}`);
    }
  }

  const order: string[] = [];
  const ordered = new Set<string>();
  const orderVisit = (identity: string) => {
    if (ordered.has(identity)) return;
    for (const dependency of [...entries.get(identity)!.dependencies].sort()) if (selected.has(dependency)) orderVisit(dependency);
    ordered.add(identity);
    order.push(identity);
  };
  for (const identity of [...selected.keys()].sort()) orderVisit(identity);

  const exclusions = [...entries.values()].filter(entry => !selected.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name)).map(entry => {
    const reasons: z.infer<typeof planReason>[] = [];
    if (!entry.platforms.includes(request.platform)) reasons.push({ code: 'unsupported-platform', related: null, detail: `${entry.name} does not support ${request.platform}.` });
    if (!entry.architectures.includes(request.architecture)) reasons.push({ code: 'unsupported-architecture', related: null, detail: `${entry.name} does not support ${request.architecture}.` });
    if (!(entry.roles.includes('any') || entry.roles.includes(request.role))) reasons.push({ code: 'unsupported-role', related: null, detail: `${entry.name} does not support role ${request.role}.` });
    const conflict = entry.conflicts.find(identity => selected.has(identity))
      ?? [...selected.keys()].find(identity => entries.get(identity)!.conflicts.includes(entry.name));
    if (conflict) reasons.push({ code: 'conflicts-with-selected', related: conflict, detail: `${entry.name} conflicts with selected entry ${conflict}.` });
    if (reasons.length === 0 && request.phase === 'bootstrap' && entry.load.delivery === 'eager') {
      reasons.push({ code: 'deferred-until-post-bootstrap', related: null, detail: `${entry.name} is eager only after bootstrap.` });
    }
    if (reasons.length === 0) reasons.push({ code: 'lazy-not-requested', related: null, detail: `${entry.name} is lazy and was not requested.` });
    return { identity: entry.name, reasons };
  });

  return SoftwareCatalogPlanSchema.parse({
    schemaVersion: 1,
    target: { platform: request.platform, architecture: request.architecture, role: request.role, phase: request.phase },
    order,
    inclusions: order.map(identity => ({ identity, reasons: selected.get(identity)! })),
    exclusions,
  });
}
