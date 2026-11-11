import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const effectClass = z.enum(['configuration', 'package', 'operating-system', 'network', 'storage', 'external-provider']);

const RollbackLimitsShapeSchema = z.strictObject({
  automaticEffects: z.array(effectClass).max(6),
  separatelyApprovedEffects: z.array(effectClass).max(6),
  destructiveAutomaticRepair: z.literal(false),
}).superRefine((value, context) => {
  const automatic = new Set(value.automaticEffects);
  const separate = new Set(value.separatelyApprovedEffects);
  if (automatic.size !== value.automaticEffects.length || separate.size !== value.separatelyApprovedEffects.length) {
    context.addIssue({ code: 'custom', message: 'rollback effect classes must be unique' });
  }
  if (value.automaticEffects.some(effect => separate.has(effect))) {
    context.addIssue({ code: 'custom', message: 'rollback effect classes cannot be both automatic and separately approved' });
  }
  if (value.automaticEffects.some((effect, index) => index > 0 && value.automaticEffects[index - 1]!.localeCompare(effect) >= 0)
    || value.separatelyApprovedEffects.some((effect, index) => index > 0 && value.separatelyApprovedEffects[index - 1]!.localeCompare(effect) >= 0)) {
    context.addIssue({ code: 'custom', message: 'rollback effect classes must be canonically sorted' });
  }
});

export const ReviewedPlanRollbackLimitsSchema = RollbackLimitsShapeSchema.superRefine((value, context) => {
  const requiredSeparate = ['external-provider', 'network', 'operating-system', 'package', 'storage'];
  if (JSON.stringify(value.separatelyApprovedEffects) !== JSON.stringify(requiredSeparate)) {
    context.addIssue({ code: 'custom', message: 'non-configuration rollback always requires separate approval' });
  }
  if (JSON.stringify(value.automaticEffects) !== JSON.stringify(['configuration'])) {
    context.addIssue({ code: 'custom', message: 'only exact configuration compensation may be automatic' });
  }
});

const reviewedPlanUnsigned = {
  schemaVersion: VERSION,
  reviewId: id,
  tenantId: id,
  profile: z.strictObject({ id, revision: id, digest }),
  host: z.strictObject({ id, factsDigest: digest }),
  release: z.strictObject({ id, manifestDigest: digest }),
  policyDigest: digest,
  normalizedPlanDigest: digest,
  operationClosureDigest: digest,
  approvalSetDigest: digest,
  rollbackLimits: ReviewedPlanRollbackLimitsSchema,
  reviewedBy: id,
  reviewedAt: instant,
  expiresAt: instant,
};

export const ReviewedPlanBindingSchema = z.strictObject({
  ...reviewedPlanUnsigned,
  bindingDigest: digest,
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.reviewedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'reviewed plan expiry must follow review' });
  }
  const { bindingDigest, ...unsigned } = value;
  if (bindingDigest !== reviewedPlanBindingDigest(unsigned)) {
    context.addIssue({ code: 'custom', path: ['bindingDigest'], message: 'reviewed plan binding digest does not match exact reviewed content' });
  }
});

export const CurrentPlanAuthoritySchema = z.strictObject({
  tenantId: id,
  profile: z.strictObject({ id, revision: id, digest }),
  host: z.strictObject({ id, factsDigest: digest }),
  release: z.strictObject({ id, manifestDigest: digest }),
  policyDigest: digest,
  normalizedPlanDigest: digest,
  operationClosureDigest: digest,
  approvalSetDigest: digest,
  // Admission accepts a structurally valid current policy so that any broadening or narrowing is
  // reported as drift. The reviewed artifact itself remains constrained to the safe exact policy.
  rollbackLimits: RollbackLimitsShapeSchema,
  now: instant,
});

export type ReviewedPlanBinding = z.infer<typeof ReviewedPlanBindingSchema>;
export type CurrentPlanAuthority = z.infer<typeof CurrentPlanAuthoritySchema>;
export type ReviewedPlanAdmission = Readonly<{
  decision: 'allow' | 'deny';
  reason: 'exact-reviewed-plan' | 'review-expired' | 'tenant-changed' | 'profile-changed'
    | 'host-identity-changed' | 'host-facts-changed' | 'release-changed' | 'policy-changed'
    | 'plan-changed' | 'operation-closure-changed' | 'approvals-changed' | 'rollback-limits-changed';
  reviewId: string;
  bindingDigest: string;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function reviewedPlanBindingDigest(value: unknown): string {
  const parsed = z.strictObject(reviewedPlanUnsigned).parse(value);
  return createHash('sha256').update(`desktop-tools:reviewed-plan-binding:v1\0${canonical(parsed)}`).digest('hex');
}

export function createReviewedPlanBinding(value: unknown): ReviewedPlanBinding {
  const unsigned = z.strictObject(reviewedPlanUnsigned).parse(value);
  return ReviewedPlanBindingSchema.parse({ ...unsigned, bindingDigest: reviewedPlanBindingDigest(unsigned) });
}

/**
 * Read-only admission. Every safety-relevant input is compared independently so a host-fact change
 * cannot hide behind an unchanged caller-supplied plan digest. Callers must compile and review again.
 */
export function admitReviewedPlan(bindingInput: unknown, currentInput: unknown): ReviewedPlanAdmission {
  const binding = ReviewedPlanBindingSchema.parse(bindingInput);
  const current = CurrentPlanAuthoritySchema.parse(currentInput);
  const deny = (reason: Exclude<ReviewedPlanAdmission['reason'], 'exact-reviewed-plan'>): ReviewedPlanAdmission =>
    Object.freeze({ decision: 'deny', reason, reviewId: binding.reviewId, bindingDigest: binding.bindingDigest });
  if (Date.parse(current.now) >= Date.parse(binding.expiresAt)) return deny('review-expired');
  if (current.tenantId !== binding.tenantId) return deny('tenant-changed');
  if (canonical(current.profile) !== canonical(binding.profile)) return deny('profile-changed');
  if (current.host.id !== binding.host.id) return deny('host-identity-changed');
  if (current.host.factsDigest !== binding.host.factsDigest) return deny('host-facts-changed');
  if (canonical(current.release) !== canonical(binding.release)) return deny('release-changed');
  if (current.policyDigest !== binding.policyDigest) return deny('policy-changed');
  if (current.normalizedPlanDigest !== binding.normalizedPlanDigest) return deny('plan-changed');
  if (current.operationClosureDigest !== binding.operationClosureDigest) return deny('operation-closure-changed');
  if (current.approvalSetDigest !== binding.approvalSetDigest) return deny('approvals-changed');
  if (canonical(current.rollbackLimits) !== canonical(binding.rollbackLimits)) return deny('rollback-limits-changed');
  return Object.freeze({ decision: 'allow', reason: 'exact-reviewed-plan', reviewId: binding.reviewId,
    bindingDigest: binding.bindingDigest });
}
