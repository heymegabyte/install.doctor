import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

export const DeprovisionEffectSchema = z.enum([
  'configuration',
  'service',
  'package',
  'operating-system',
  'network',
  'storage',
  'user-data',
  'unknown',
]);
export type DeprovisionEffect = z.infer<typeof DeprovisionEffectSchema>;

export const DeprovisionOwnershipEvidenceSchema = z.strictObject({
  schemaVersion: VERSION,
  owner: z.literal('install.doctor'),
  sourceRunId: identifier,
  artifactDigest: digest,
  appliedDigest: digest,
});
export type DeprovisionOwnershipEvidence = z.infer<typeof DeprovisionOwnershipEvidenceSchema>;

export const DeprovisionResourceSchema = z.strictObject({
  schemaVersion: VERSION,
  resourceId: identifier,
  effect: DeprovisionEffectSchema,
  target: z.string().min(1).max(4096),
  ownership: z.enum(['installer-owned', 'user-owned', 'unowned', 'unknown']),
  ownershipEvidence: DeprovisionOwnershipEvidenceSchema.nullable(),
  observedDigest: digest.nullable(),
  userData: z.enum(['absent', 'present', 'unknown']),
}).superRefine((resource, context) => {
  const evidenceExpected = resource.ownership === 'installer-owned';
  if (evidenceExpected !== (resource.ownershipEvidence !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['ownershipEvidence'],
      message: evidenceExpected
        ? 'installer-owned resources require ownership evidence'
        : 'ownership evidence is forbidden unless ownership is installer-owned',
    });
  }
});
export type DeprovisionResource = z.infer<typeof DeprovisionResourceSchema>;

export const DeprovisionPolicySchema = z.strictObject({
  preserveUserData: z.literal(true).default(true),
});
export type DeprovisionPolicy = z.infer<typeof DeprovisionPolicySchema>;

const deprovisionItemBase = {
  schemaVersion: VERSION,
  resourceId: identifier,
  effect: DeprovisionEffectSchema,
  target: z.string().min(1).max(4096),
  ownership: z.enum(['installer-owned', 'user-owned', 'unowned', 'unknown']),
};

export const DeprovisionPlanItemSchema = z.discriminatedUnion('disposition', [
  z.strictObject({
    ...deprovisionItemBase,
    disposition: z.literal('eligible'),
    operation: z.enum(['preview-remove-managed-configuration', 'preview-disable-managed-service']),
    reason: z.literal('installer-owned-managed-effect'),
  }),
  z.strictObject({
    ...deprovisionItemBase,
    disposition: z.literal('refused'),
    operation: z.literal('none'),
    reason: z.enum([
      'ownership-not-installer',
      'effect-prohibited',
      'user-data-preserved',
      'user-data-present',
      'user-data-unknown',
      'target-modified-since-install',
    ]),
  }),
]);
export type DeprovisionPlanItem = z.infer<typeof DeprovisionPlanItemSchema>;

export const DeprovisionPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  digest,
  sourceRunId: identifier,
  sourcePlanDigest: digest,
  createdAt: timestamp,
  policy: DeprovisionPolicySchema,
  executable: z.literal(false),
  items: z.array(DeprovisionPlanItemSchema).max(10_000),
  eligibleResourceIds: z.array(identifier).max(10_000),
  refusedResourceIds: z.array(identifier).max(10_000),
});
export type DeprovisionPlan = z.infer<typeof DeprovisionPlanSchema>;

const DeprovisionPlanInputSchema = z.strictObject({
  schemaVersion: VERSION,
  sourceRunId: identifier,
  sourcePlanDigest: digest,
  policy: DeprovisionPolicySchema.default({ preserveUserData: true }),
  resources: z.array(DeprovisionResourceSchema).max(10_000),
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function compareResourceId(left: { readonly resourceId: string }, right: { readonly resourceId: string }): number {
  return left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0;
}

function planItem(resource: DeprovisionResource): DeprovisionPlanItem {
  const base = {
    schemaVersion: 1 as const,
    resourceId: resource.resourceId,
    effect: resource.effect,
    target: resource.target,
    ownership: resource.ownership,
  };
  if (resource.effect === 'user-data') {
    return DeprovisionPlanItemSchema.parse({
      ...base,
      disposition: 'refused',
      operation: 'none',
      reason: 'user-data-preserved',
    });
  }
  if (resource.userData !== 'absent') {
    return DeprovisionPlanItemSchema.parse({
      ...base,
      disposition: 'refused',
      operation: 'none',
      reason: resource.userData === 'present' ? 'user-data-present' : 'user-data-unknown',
    });
  }
  if (resource.ownership !== 'installer-owned') {
    return DeprovisionPlanItemSchema.parse({
      ...base,
      disposition: 'refused',
      operation: 'none',
      reason: 'ownership-not-installer',
    });
  }
  if (resource.effect === 'configuration' || resource.effect === 'service') {
    if (resource.observedDigest === null
      || resource.ownershipEvidence === null
      || resource.observedDigest !== resource.ownershipEvidence.appliedDigest) {
      return DeprovisionPlanItemSchema.parse({
        ...base,
        disposition: 'refused',
        operation: 'none',
        reason: 'target-modified-since-install',
      });
    }
    return DeprovisionPlanItemSchema.parse({
      ...base,
      disposition: 'eligible',
      operation: resource.effect === 'configuration'
        ? 'preview-remove-managed-configuration'
        : 'preview-disable-managed-service',
      reason: 'installer-owned-managed-effect',
    });
  }
  return DeprovisionPlanItemSchema.parse({
    ...base,
    disposition: 'refused',
    operation: 'none',
    reason: 'effect-prohibited',
  });
}

/**
 * Produces an approval-preview artifact only. The returned contract is permanently
 * non-executable; applying a future deprovision plan requires a separate executor.
 */
export function buildDeprovisionPlan(
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): DeprovisionPlan {
  const parsed = DeprovisionPlanInputSchema.parse(input);
  const resources = [...parsed.resources].sort(compareResourceId);
  if (new Set(resources.map(resource => resource.resourceId)).size !== resources.length) {
    throw new Error('deprovision plan contains duplicate resource identifiers');
  }
  for (const resource of resources) {
    if (resource.ownershipEvidence !== null && resource.ownershipEvidence.sourceRunId !== parsed.sourceRunId) {
      throw new Error(`deprovision ownership evidence is not bound to source run: ${resource.resourceId}`);
    }
  }
  const items = resources.map(planItem);
  const semantic = {
    schemaVersion: 1 as const,
    sourceRunId: parsed.sourceRunId,
    sourcePlanDigest: parsed.sourcePlanDigest,
    policy: parsed.policy,
    executable: false as const,
    items,
    eligibleResourceIds: items.filter(item => item.disposition === 'eligible').map(item => item.resourceId),
    refusedResourceIds: items.filter(item => item.disposition === 'refused').map(item => item.resourceId),
  };
  const planDigest = sha256(semantic);
  return DeprovisionPlanSchema.parse({
    ...semantic,
    planId: `deprovision-${planDigest.slice(0, 24)}`,
    digest: planDigest,
    createdAt: now(),
  });
}
