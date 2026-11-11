import { z } from 'zod';
import { ImmutableArtifactDescriptorSchema } from './installer-contracts.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const command = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._+:-]*$/);
const text = z.string().min(1).max(2048);
const manager = z.enum(['brew', 'apt', 'dnf', 'pacman', 'cask', 'choco', 'scoop', 'go', 'cargo', 'npm', 'pipx', 'pip', 'gem', 'apk', 'flatpak']);
const platform = z.enum(['macos', 'linux', 'windows']);
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
  return SoftwareCatalogEntrySchema.parse({
    schemaVersion: 1,
    ...entry,
    identity: { key: entry.name, command: entry.bin },
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
