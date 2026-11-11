/**
 * Value-free effective-authorization simulation across every Desktop Tools
 * enforcement boundary. Native policy adapters normalize their rules into this
 * contract; this module never accepts credentials or secret values.
 */
import { z } from 'zod';

export const authorizationAuthorities = [
  'product',
  'cloudflare',
  'infisical',
  'opencode',
  'host-privilege',
] as const;

const authoritySchema = z.enum(authorizationAuthorities);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const claimName = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/);
const claimValue = z.string().regex(/^[a-z0-9][a-z0-9._:@/-]{0,191}$/);
const resource = z.string().min(1).max(512)
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[a-zA-Z0-9._~:@!$&'()*+,;=\/-]+$/)
  .superRefine((value, context) => {
    let parsed: URL;
    try { parsed = new URL(value); }
    catch {
      context.addIssue({ code: 'custom', message: 'Authorization resource must be an absolute URI' });
      return;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      context.addIssue({ code: 'custom', message: 'Authorization resources cannot contain credentials, queries, or fragments' });
    }
  });
const action = z.string().regex(/^[a-z][a-z0-9._:-]{0,95}$/);

const unique = <T extends z.ZodTypeAny>(schema: T, label: string) => z.array(schema).min(1).max(256)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `${label} must be unique` });
  });

const targetSchema = z.strictObject({ resource, action });
const claimsSchema = z.record(claimName, claimValue).superRefine((claims, context) => {
  if (Object.keys(claims).length > 64) context.addIssue({ code: 'custom', message: 'Authorization claims must be bounded' });
});

export const EffectiveAuthorizationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: identifier,
  principal: identifier,
  tenant: identifier,
  evaluatedAt: z.string().datetime({ offset: true }),
  claims: claimsSchema,
  targets: z.strictObject({
    product: targetSchema,
    cloudflare: targetSchema,
    infisical: targetSchema,
    opencode: targetSchema,
    'host-privilege': targetSchema,
  }),
});

const conditionSchema = z.strictObject({ claim: claimName, values: unique(claimValue, 'Condition values') });

export const EffectiveAuthorizationRuleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifier,
  authority: authoritySchema,
  effect: z.enum(['grant', 'deny']),
  principals: unique(z.union([identifier, z.literal('*')]), 'Rule principals'),
  tenants: unique(z.union([identifier, z.literal('*')]), 'Rule tenants'),
  resources: unique(z.union([resource, z.literal('*')]), 'Rule resources'),
  actions: unique(z.union([action, z.literal('*')]), 'Rule actions'),
  conditions: z.array(conditionSchema).max(64).superRefine((conditions, context) => {
    const names = conditions.map(condition => condition.claim);
    if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', message: 'Rule condition claims must be unique' });
  }),
  validFrom: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  source: z.strictObject({ policyId: identifier, revision: identifier }),
}).superRefine((rule, context) => {
  if (rule.validFrom && rule.expiresAt && Date.parse(rule.validFrom) >= Date.parse(rule.expiresAt)) {
    context.addIssue({ code: 'custom', message: 'Rule validity interval must be increasing' });
  }
});

export const EffectiveAuthorizationPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  rules: z.array(EffectiveAuthorizationRuleSchema).max(50_000),
}).superRefine((policy, context) => {
  const ids = policy.rules.map(rule => rule.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Authorization rule ids must be globally unique' });
});

const contributionSchema = z.strictObject({
  authority: authoritySchema,
  effect: z.enum(['grant', 'deny']),
  ruleId: identifier.nullable(),
  policyId: identifier.nullable(),
  policyRevision: identifier.nullable(),
  reason: z.enum(['matched-rule', 'missing-grant']),
});

export const EffectiveAuthorizationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: identifier,
  decision: z.enum(['grant', 'deny']),
  contributions: z.array(contributionSchema).min(5).max(50_005),
  authorityDecisions: z.strictObject({
    product: z.enum(['grant', 'deny']),
    cloudflare: z.enum(['grant', 'deny']),
    infisical: z.enum(['grant', 'deny']),
    opencode: z.enum(['grant', 'deny']),
    'host-privilege': z.enum(['grant', 'deny']),
  }),
});

export type EffectiveAuthorizationRequest = z.infer<typeof EffectiveAuthorizationRequestSchema>;
export type EffectiveAuthorizationPolicy = z.infer<typeof EffectiveAuthorizationPolicySchema>;
export type EffectiveAuthorizationResult = z.infer<typeof EffectiveAuthorizationResultSchema>;

function includes<T extends string>(values: readonly (T | '*')[], value: T): boolean {
  return values.includes('*') || values.includes(value);
}

function matches(
  rule: z.infer<typeof EffectiveAuthorizationRuleSchema>,
  request: EffectiveAuthorizationRequest,
): boolean {
  const target = request.targets[rule.authority];
  const instant = Date.parse(request.evaluatedAt);
  return includes(rule.principals, request.principal)
    && includes(rule.tenants, request.tenant)
    && includes(rule.resources, target.resource)
    && includes(rule.actions, target.action)
    && (!rule.validFrom || Date.parse(rule.validFrom) <= instant)
    && (!rule.expiresAt || instant < Date.parse(rule.expiresAt))
    && rule.conditions.every(condition => {
      const actual = request.claims[condition.claim];
      return actual !== undefined && condition.values.includes(actual);
    });
}

/**
 * Simulate the effective decision. Every matched rule is retained in the
 * explanation. An authority without a matching grant contributes an explicit
 * synthetic denial, and any denial overrides every grant.
 */
export function simulateEffectiveAuthorization(
  requestInput: unknown,
  policyInput: unknown,
): EffectiveAuthorizationResult {
  const request = EffectiveAuthorizationRequestSchema.parse(requestInput);
  const policy = EffectiveAuthorizationPolicySchema.parse(policyInput);
  const matched = policy.rules.filter(rule => matches(rule, request));
  const contributions: EffectiveAuthorizationResult['contributions'] = [];
  const authorityDecisions = {} as Record<typeof authorizationAuthorities[number], 'grant' | 'deny'>;

  for (const authority of authorizationAuthorities) {
    const authorityRules = matched.filter(rule => rule.authority === authority);
    for (const rule of authorityRules) {
      contributions.push({
        authority,
        effect: rule.effect,
        ruleId: rule.id,
        policyId: rule.source.policyId,
        policyRevision: rule.source.revision,
        reason: 'matched-rule',
      });
    }
    const denied = authorityRules.some(rule => rule.effect === 'deny');
    const granted = authorityRules.some(rule => rule.effect === 'grant');
    if (!granted) {
      contributions.push({
        authority,
        effect: 'deny',
        ruleId: null,
        policyId: null,
        policyRevision: null,
        reason: 'missing-grant',
      });
    }
    authorityDecisions[authority] = denied || !granted ? 'deny' : 'grant';
  }

  contributions.sort((left, right) => authorizationAuthorities.indexOf(left.authority) - authorizationAuthorities.indexOf(right.authority)
    || left.reason.localeCompare(right.reason)
    || (left.ruleId ?? '').localeCompare(right.ruleId ?? ''));
  const result = {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    decision: Object.values(authorityDecisions).every(decision => decision === 'grant') ? 'grant' as const : 'deny' as const,
    contributions,
    authorityDecisions,
  };
  return EffectiveAuthorizationResultSchema.parse(result);
}
