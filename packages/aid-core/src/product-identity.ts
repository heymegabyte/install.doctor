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

const capabilityStatusSchema = z.enum([
  'contract-only',
  'implemented-unverified',
  'verified-live',
  'blocked'
]);

const capabilityEvidenceSchema = z.object({
  kind: z.enum(['architecture', 'code', 'test', 'runtime']),
  reference: z.string().min(1).max(512)
}).strict();

const capabilitySchema = z.object({
  id: identityIdSchema,
  name: z.string().min(1).max(128),
  status: capabilityStatusSchema,
  summary: z.string().min(1).max(512),
  evidence: z.array(capabilityEvidenceSchema).min(1).max(32)
}).strict().superRefine((capability, context) => {
  const evidenceKinds = new Set(capability.evidence.map(item => item.kind));
  if (capability.status === 'contract-only' && [...evidenceKinds].some(kind => kind !== 'architecture')) {
    context.addIssue({ code: 'custom', message: `${capability.id}: contract-only capability may cite architecture evidence only` });
  }
  if (capability.status === 'implemented-unverified' && (!evidenceKinds.has('code') || !evidenceKinds.has('test'))) {
    context.addIssue({ code: 'custom', message: `${capability.id}: implemented capability requires code and test evidence` });
  }
  if (capability.status === 'verified-live' && !evidenceKinds.has('runtime')) {
    context.addIssue({ code: 'custom', message: `${capability.id}: live capability requires runtime evidence` });
  }
});

const productIdentityRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  canonical: z.array(canonicalIdentitySchema).min(7).max(64),
  legacy: z.array(legacyIdentitySchema).max(128),
  capabilities: z.array(capabilitySchema).min(1).max(128)
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

  const capabilityIds = registry.capabilities.map(capability => capability.id);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    context.addIssue({ code: 'custom', message: 'Capability ids must be unique' });
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
  ],
  capabilities: [
    {
      id: 'product-identity',
      name: 'Canonical product identity',
      status: 'implemented-unverified',
      summary: 'Strict Desktop Tools identity and compatibility mappings are implemented and unit-tested, but not yet propagated to every consumer.',
      evidence: [
        { kind: 'code', reference: 'packages/aid-core/src/product-identity.ts' },
        { kind: 'test', reference: 'packages/aid-core/test/product-identity.test.mjs' }
      ]
    },
    {
      id: 'portable-environment-contracts',
      name: 'Portable desired-state contracts',
      status: 'implemented-unverified',
      summary: 'Versioned ENVIRONMENT.md contracts and migrations are implemented as pure code; hosted profile integration is not live.',
      evidence: [
        { kind: 'code', reference: 'packages/aid-core/src/core.ts' },
        { kind: 'test', reference: 'packages/aid-core/test/core.test.mjs' }
      ]
    },
    {
      id: 'desktop-profile-bootstrap',
      name: 'Profile-subdomain bootstrap',
      status: 'contract-only',
      summary: 'The personalized wildcard-subdomain bootstrap is specified but not deployed or verified.',
      evidence: [
        { kind: 'architecture', reference: 'openspec/changes/establish-desktop-tools-bootstrap/specs/desktop-profile-bootstrap/spec.md' }
      ]
    },
    {
      id: 'device-authorization',
      name: 'Cross-device authorization',
      status: 'contract-only',
      summary: 'The headless cross-device enrollment protocol is specified but not integrated end to end.',
      evidence: [
        { kind: 'architecture', reference: 'openspec/changes/establish-desktop-tools-bootstrap/specs/device-authorization/spec.md' }
      ]
    },
    {
      id: 'agent-provisioning-session',
      name: 'OpenCode provisioning session',
      status: 'contract-only',
      summary: 'Pinned OpenCode supervision and typed deterministic mutation authority are specified but not shipped.',
      evidence: [
        { kind: 'architecture', reference: 'openspec/changes/establish-desktop-tools-bootstrap/specs/agent-provisioning-session/spec.md' }
      ]
    },
    {
      id: 'production-profile-route',
      name: 'Production profile routing',
      status: 'blocked',
      summary: 'Production wildcard routing remains disabled pending signed-release and canary evidence.',
      evidence: [
        { kind: 'architecture', reference: 'openspec/changes/establish-desktop-tools-bootstrap/design.md#migration-plan' }
      ]
    }
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

const statusRank: Record<z.infer<typeof capabilityStatusSchema>, number> = {
  'contract-only': 0,
  blocked: 0,
  'implemented-unverified': 1,
  'verified-live': 2
};

/** Reject user-facing claims that are stronger than the registry's evidence-backed status. */
export function assertCapabilityClaim(id: string, claimedStatus: z.infer<typeof capabilityStatusSchema>): void {
  const registry = validateProductIdentityRegistry(PRODUCT_IDENTITY);
  const capability = registry.capabilities.find(candidate => candidate.id === id);
  if (!capability) throw new Error(`Unknown capability: ${id}`);
  if (statusRank[claimedStatus] > statusRank[capability.status]) {
    throw new Error(`Capability claim exceeds evidence: ${id} is ${capability.status}, not ${claimedStatus}`);
  }
}

/** Render the generated public status ledger. Do not hand-edit its output. */
export function renderProductStatusMarkdown(input: unknown = PRODUCT_IDENTITY): string {
  const registry = validateProductIdentityRegistry(input);
  const lines = [
    '# Desktop Tools capability and migration status',
    '',
    '<!-- Generated from packages/aid-core/src/product-identity.ts. Do not edit by hand. -->',
    '',
    'Statuses are evidence boundaries: `contract-only` is designed but not shipped; `implemented-unverified` has tested code but no production proof; `verified-live` requires runtime evidence; `blocked` names an explicit release gate.',
    '',
    '## Capabilities',
    '',
    '| Capability | Status | Evidence-backed summary |',
    '|---|---|---|'
  ];
  for (const capability of registry.capabilities) {
    const references = capability.evidence.map(item => `${item.kind}: \`${item.reference}\``).join('<br>');
    lines.push(`| ${capability.name} | \`${capability.status}\` | ${capability.summary}<br>${references} |`);
  }
  lines.push('', '## Compatibility and migration names', '', '| Kind | Legacy name | Canonical target | Disposition | Removal date |', '|---|---|---|---|---|');
  for (const legacy of registry.legacy) {
    const target = registry.canonical.find(entry => entry.id === legacy.mapsTo);
    if (!target) throw new Error(`Unknown canonical target while rendering: ${legacy.mapsTo}`);
    lines.push(`| ${legacy.kind} | \`${legacy.value}\` | \`${target.value}\` | \`${legacy.disposition}\` | ${legacy.removeAfter ?? 'not scheduled'} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** Public, nonsecret status payload for hosted surfaces. */
export function productStatusPayload(input: unknown = PRODUCT_IDENTITY): {
  schemaVersion: 1;
  product: string;
  capabilities: ProductIdentityRegistry['capabilities'];
  migrations: Array<{
    kind: ProductIdentityRegistry['legacy'][number]['kind'];
    legacy: string;
    canonical: string;
    disposition: ProductIdentityRegistry['legacy'][number]['disposition'];
    removeAfter: string | null;
  }>;
} {
  const registry = validateProductIdentityRegistry(input);
  const product = registry.canonical.find(entry => entry.id === 'desktop-tools-product');
  if (!product) throw new Error('Desktop Tools product identity is missing');
  return {
    schemaVersion: 1,
    product: product.value,
    capabilities: structuredClone(registry.capabilities),
    migrations: registry.legacy.map(legacy => {
      const target = registry.canonical.find(entry => entry.id === legacy.mapsTo);
      if (!target) throw new Error(`Unknown canonical migration target: ${legacy.mapsTo}`);
      return {
        kind: legacy.kind,
        legacy: legacy.value,
        canonical: target.value,
        disposition: legacy.disposition,
        removeAfter: legacy.removeAfter
      };
    })
  };
}
