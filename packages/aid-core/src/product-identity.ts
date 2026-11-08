/** Canonical Desktop Tools identity and compatibility-name contracts. */
import { z } from 'zod';

const identityKindSchema = z.enum([
  'product',
  'package',
  'executable',
  'environment-prefix',
  'state-directory',
  'domain',
  'domain-template'
]);

const identityIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

const canonicalIdentitySchema = z.object({
  id: identityIdSchema,
  kind: identityKindSchema,
  value: z.string().min(1).max(255),
  owner: z.literal('desktop-tools')
}).strict();

const legacyIdentitySchema = z.object({
  kind: identityKindSchema.exclude(['domain-template']),
  value: z.string().min(1).max(255),
  owner: z.literal('desktop-tools'),
  mapsTo: identityIdSchema,
  disposition: z.enum(['compatibility-alias', 'migration-only', 'retired']),
  removeAfter: z.string().date().nullable()
}).strict();

const productIdentityRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  canonical: z.array(canonicalIdentitySchema).min(7).max(64),
  legacy: z.array(legacyIdentitySchema).max(128)
}).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const entry of registry.canonical) {
    if (ids.has(entry.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate canonical identity id: ${entry.id}` });
    }
    ids.add(entry.id);

    const key = normalizedIdentityKey(entry.kind, entry.value);
    if (names.has(key)) {
      context.addIssue({ code: 'custom', message: `Ambiguous canonical identity: ${entry.kind}:${entry.value}` });
    }
    names.add(key);
  }

  for (const entry of registry.legacy) {
    const target = registry.canonical.find(candidate => candidate.id === entry.mapsTo);
    if (!target) {
      context.addIssue({ code: 'custom', message: `Legacy identity has unknown target: ${entry.mapsTo}` });
      continue;
    }
    if (target.kind !== entry.kind) {
      context.addIssue({ code: 'custom', message: `Legacy identity kind does not match target: ${entry.value}` });
    }

    const key = normalizedIdentityKey(entry.kind, entry.value);
    if (names.has(key)) {
      context.addIssue({ code: 'custom', message: `Duplicate or ambiguous identity name: ${entry.kind}:${entry.value}` });
    }
    names.add(key);
  }

  const requiredKinds = new Set([
    'product', 'package', 'executable', 'environment-prefix',
    'state-directory', 'domain', 'domain-template'
  ]);
  for (const entry of registry.canonical) requiredKinds.delete(entry.kind);
  if (requiredKinds.size > 0) {
    context.addIssue({ code: 'custom', message: `Missing canonical identity kinds: ${[...requiredKinds].join(', ')}` });
  }
});

function normalizedIdentityKey(kind: z.infer<typeof identityKindSchema>, value: string): string {
  return `${kind}:${value.normalize('NFKC').trim().toLocaleLowerCase('en-US')}`;
}

export type ProductIdentityRegistry = z.infer<typeof productIdentityRegistrySchema>;

/**
 * The single source of truth for new product identity and bounded compatibility names.
 * Existing repository and historical attribution names intentionally remain legacy values.
 */
export const PRODUCT_IDENTITY = {
  schemaVersion: 1,
  canonical: [
    { id: 'desktop-tools-product', kind: 'product', value: 'Desktop Tools', owner: 'desktop-tools' },
    { id: 'desktop-tools-core-package', kind: 'package', value: '@desktop-tools/core', owner: 'desktop-tools' },
    { id: 'desktop-tools-control-plane-package', kind: 'package', value: '@desktop-tools/control-plane', owner: 'desktop-tools' },
    { id: 'desktop-tools-installer-engine-package', kind: 'package', value: '@desktop-tools/installer-engine', owner: 'desktop-tools' },
    { id: 'desktop-tools-executable', kind: 'executable', value: 'desktop-tools', owner: 'desktop-tools' },
    { id: 'desktop-tools-environment-prefix', kind: 'environment-prefix', value: 'DESKTOP_TOOLS_', owner: 'desktop-tools' },
    { id: 'desktop-tools-state-directory', kind: 'state-directory', value: 'desktop-tools', owner: 'desktop-tools' },
    { id: 'desktop-tools-domain', kind: 'domain', value: 'desktop.tools', owner: 'desktop-tools' },
    { id: 'desktop-tools-profile-domain', kind: 'domain-template', value: '{profile}.desktop.tools', owner: 'desktop-tools' }
  ],
  legacy: [
    { kind: 'product', value: 'Install Doctor', owner: 'desktop-tools', mapsTo: 'desktop-tools-product', disposition: 'migration-only', removeAfter: null },
    { kind: 'package', value: '@install-doctor/aid-core', owner: 'desktop-tools', mapsTo: 'desktop-tools-core-package', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'package', value: '@install-doctor/control-plane', owner: 'desktop-tools', mapsTo: 'desktop-tools-control-plane-package', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'package', value: '@install-doctor/installer-engine', owner: 'desktop-tools', mapsTo: 'desktop-tools-installer-engine-package', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'executable', value: 'aid', owner: 'desktop-tools', mapsTo: 'desktop-tools-executable', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'environment-prefix', value: 'AID_', owner: 'desktop-tools', mapsTo: 'desktop-tools-environment-prefix', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'environment-prefix', value: 'INSTALL_DOCTOR_', owner: 'desktop-tools', mapsTo: 'desktop-tools-environment-prefix', disposition: 'compatibility-alias', removeAfter: null },
    { kind: 'state-directory', value: 'install.doctor', owner: 'desktop-tools', mapsTo: 'desktop-tools-state-directory', disposition: 'migration-only', removeAfter: null },
    { kind: 'state-directory', value: 'aid', owner: 'desktop-tools', mapsTo: 'desktop-tools-state-directory', disposition: 'migration-only', removeAfter: null },
    { kind: 'domain', value: 'app.install.doctor', owner: 'desktop-tools', mapsTo: 'desktop-tools-domain', disposition: 'migration-only', removeAfter: null },
    { kind: 'domain', value: 'install.doctor', owner: 'desktop-tools', mapsTo: 'desktop-tools-domain', disposition: 'migration-only', removeAfter: null }
  ]
} as const satisfies ProductIdentityRegistry;

/** Validate loaded or generated identity data without accepting unknown fields. */
export function validateProductIdentityRegistry(input: unknown): ProductIdentityRegistry {
  return productIdentityRegistrySchema.parse(input);
}

/** Resolve a canonical identity by stable id, never by a display label. */
export function canonicalIdentity(id: string): ProductIdentityRegistry['canonical'][number] {
  const registry = validateProductIdentityRegistry(PRODUCT_IDENTITY);
  const identity = registry.canonical.find(entry => entry.id === id);
  if (!identity) throw new Error(`Unknown canonical identity: ${id}`);
  return identity;
}
