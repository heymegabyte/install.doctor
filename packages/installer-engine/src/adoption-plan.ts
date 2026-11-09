import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const target = z.string().min(1).max(4096).refine(value => !/[\0\r\n]/.test(value), 'target contains unsafe text');

export const AdoptionResourceSchema = z.strictObject({
  schemaVersion: VERSION,
  resourceId: identifier,
  effect: z.enum(['configuration', 'service', 'package', 'operating-system', 'network', 'storage', 'user-data', 'unknown']),
  target,
  ownership: z.enum(['installer-owned', 'user-owned', 'unowned', 'unknown']),
  desiredDigest: digest.nullable(),
  observedState: z.enum(['present', 'absent', 'unreadable']),
  observedDigest: digest.nullable(),
  userData: z.enum(['absent', 'present', 'unknown']),
}).superRefine((resource, context) => {
  if ((resource.observedState === 'present') !== (resource.observedDigest !== null)) {
    context.addIssue({ code: 'custom', path: ['observedDigest'], message: 'present resources require a digest and absent or unreadable resources prohibit one' });
  }
});
export type AdoptionResource = z.infer<typeof AdoptionResourceSchema>;

export const AdoptionPlanInputSchema = z.strictObject({
  schemaVersion: VERSION,
  hostId: identifier,
  profileRevision: identifier,
  resources: z.array(AdoptionResourceSchema).max(10_000),
});

const disposition = z.enum([
  'already-managed', 'observe-existing', 'plan-create', 'requires-review', 'preserve',
]);
const reason = z.enum([
  'installer-ownership-retained', 'matching-preexisting-state', 'resource-absent',
  'state-differs', 'ownership-not-transferable', 'user-data-preserved', 'effect-prohibited',
  'evidence-incomplete',
]);

export const AdoptionPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  digest,
  hostId: identifier,
  profileRevision: identifier,
  executable: z.literal(false),
  transfersOwnership: z.literal(false),
  items: z.array(z.strictObject({
    schemaVersion: VERSION,
    resourceId: identifier,
    effect: AdoptionResourceSchema.shape.effect,
    target,
    disposition,
    reason,
    observedDigest: digest.nullable(),
    desiredDigest: digest.nullable(),
  })).max(10_000),
  alreadyManagedResourceIds: z.array(identifier).max(10_000),
  observedResourceIds: z.array(identifier).max(10_000),
  plannedCreateResourceIds: z.array(identifier).max(10_000),
  reviewResourceIds: z.array(identifier).max(10_000),
  preservedResourceIds: z.array(identifier).max(10_000),
});
export type AdoptionPlan = z.infer<typeof AdoptionPlanSchema>;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
};

/**
 * Classify an existing machine before mutation. Matching preexisting resources
 * remain preexisting: observing desired state never grants deletion authority.
 */
export function buildAdoptionPlan(inputValue: unknown): AdoptionPlan {
  const input = AdoptionPlanInputSchema.parse(inputValue);
  const seen = new Set<string>();
  const resources = [...input.resources].sort((left, right) => left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0);
  for (const resource of resources) {
    if (seen.has(resource.resourceId)) throw new Error(`duplicate adoption resource: ${resource.resourceId}`);
    seen.add(resource.resourceId);
  }
  const items = resources.map(resource => {
    let result: { disposition: z.infer<typeof disposition>; reason: z.infer<typeof reason> };
    if (resource.userData !== 'absent' || resource.effect === 'user-data') {
      result = { disposition: 'preserve', reason: 'user-data-preserved' };
    } else if (!['configuration', 'service'].includes(resource.effect)) {
      result = { disposition: 'preserve', reason: 'effect-prohibited' };
    } else if (resource.ownership === 'installer-owned') {
      result = resource.desiredDigest !== null && resource.observedDigest === resource.desiredDigest
        ? { disposition: 'already-managed', reason: 'installer-ownership-retained' }
        : { disposition: 'requires-review', reason: resource.observedDigest === null ? 'evidence-incomplete' : 'state-differs' };
    } else if (resource.ownership === 'user-owned' || resource.ownership === 'unknown') {
      result = { disposition: 'preserve', reason: 'ownership-not-transferable' };
    } else if (resource.observedState === 'absent' && resource.desiredDigest !== null) {
      result = { disposition: 'plan-create', reason: 'resource-absent' };
    } else if (resource.observedState === 'present' && resource.observedDigest !== null && resource.desiredDigest !== null && resource.observedDigest === resource.desiredDigest) {
      result = { disposition: 'observe-existing', reason: 'matching-preexisting-state' };
    } else {
      result = { disposition: 'requires-review', reason: resource.desiredDigest === null || resource.observedDigest === null ? 'evidence-incomplete' : 'state-differs' };
    }
    return Object.freeze({ schemaVersion: 1 as const, resourceId: resource.resourceId, effect: resource.effect,
      target: resource.target, ...result, observedDigest: resource.observedDigest, desiredDigest: resource.desiredDigest });
  });
  const semantic = { schemaVersion: 1, hostId: input.hostId, profileRevision: input.profileRevision, items };
  const planDigest = createHash('sha256').update(canonical(semantic)).digest('hex');
  const ids = (value: z.infer<typeof disposition>) => items.filter(item => item.disposition === value).map(item => item.resourceId);
  return AdoptionPlanSchema.parse({ ...semantic, planId: `adoption-${planDigest.slice(0, 24)}`, digest: planDigest,
    executable: false, transfersOwnership: false,
    alreadyManagedResourceIds: ids('already-managed'), observedResourceIds: ids('observe-existing'),
    plannedCreateResourceIds: ids('plan-create'), reviewResourceIds: ids('requires-review'),
    preservedResourceIds: ids('preserve') });
}
