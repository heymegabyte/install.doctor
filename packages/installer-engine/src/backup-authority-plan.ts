import { createHash } from 'node:crypto';
import { z } from 'zod';

const VERSION = z.literal(1);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceReference = z.string().min(1).max(512).refine(value => !/\s/.test(value), 'evidence reference must not contain whitespace');

export const BackupAuthorityActionSchema = z.enum([
  'backup:create',
  'backup:read',
  'metadata:append',
  'snapshot:create',
  'backup:prune',
  'backup:delete',
  'backup:overwrite',
  'snapshot:delete',
  'retention:change',
  'retention:bypass',
]);
export type BackupAuthorityAction = z.infer<typeof BackupAuthorityActionSchema>;

const WRITER_ACTIONS = new Set<BackupAuthorityAction>([
  'backup:create', 'backup:read', 'metadata:append', 'snapshot:create',
]);
const DESTRUCTIVE_ACTIONS = new Set<BackupAuthorityAction>([
  'backup:prune', 'backup:delete', 'backup:overwrite', 'snapshot:delete',
  'retention:change', 'retention:bypass',
]);

const IdentitySchema = z.strictObject({
  identityId: identifier,
  principalId: z.string().min(1).max(256),
  credentialRef: z.string().regex(/^infisical:\/\/[a-zA-Z0-9._~:/-]+$/),
  allowedActions: z.array(BackupAuthorityActionSchema).min(1).max(10),
});

export const BackupProviderCapabilitySchema = z.strictObject({
  providerId: identifier,
  capabilityEvidenceDigest: digest,
  supportedActions: z.array(BackupAuthorityActionSchema).min(1).max(10),
  identityEnforcement: z.enum(['provider-iam', 'repository-acl', 'process-only', 'unsupported']),
  independentlyScopedPrincipals: z.boolean(),
  retention: z.strictObject({
    enforcement: z.enum(['provider-enforced', 'policy-only', 'unavailable']),
    retentionLockEnabled: z.boolean(),
    writerCannotDeleteRetainedData: z.boolean(),
    maintenanceCannotBypassRetention: z.boolean(),
    evidenceRef: evidenceReference.nullable(),
  }),
  limitations: z.array(z.string().min(1).max(512)).max(32),
});

export const BackupAuthorityPlanInputSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  provider: BackupProviderCapabilitySchema,
  writer: IdentitySchema,
  maintenance: IdentitySchema,
});

const FindingSchema = z.strictObject({
  code: z.enum([
    'provider-cannot-separate-identities',
    'provider-enforcement-insufficient',
    'provider-action-unsupported',
    'immutability-not-guaranteed',
  ]),
  detail: z.string().min(1).max(1024),
});

export const BackupAuthorityPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  providerId: identifier,
  planDigest: digest,
  status: z.enum(['ready', 'gated']),
  writer: IdentitySchema,
  maintenance: IdentitySchema,
  immutability: z.strictObject({
    guarantee: z.enum(['provider-enforced', 'not-guaranteed']),
    evidenceRef: evidenceReference.nullable(),
    reasons: z.array(z.string().min(1).max(512)).min(1).max(32),
  }),
  findings: z.array(FindingSchema).max(32),
});
export type BackupAuthorityPlan = z.infer<typeof BackupAuthorityPlanSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Produces a mutation-free authority plan. The provider declaration is evidence,
 * not a provider-name allowlist: S3 compatibility or a retention setting alone
 * never implies immutability.
 */
export function planBackupAuthorities(input: unknown): BackupAuthorityPlan {
  const parsed = BackupAuthorityPlanInputSchema.parse(input);
  const writerActions = new Set(parsed.writer.allowedActions);
  const maintenanceActions = new Set(parsed.maintenance.allowedActions);

  if (parsed.writer.identityId === parsed.maintenance.identityId
    || parsed.writer.principalId === parsed.maintenance.principalId
    || parsed.writer.credentialRef === parsed.maintenance.credentialRef) {
    throw new Error('writer and maintenance must use distinct identities, principals, and credentials');
  }
  if (writerActions.size !== parsed.writer.allowedActions.length
    || maintenanceActions.size !== parsed.maintenance.allowedActions.length) {
    throw new Error('identity actions must be unique');
  }
  const forbiddenWriterActions = [...writerActions].filter(action => !WRITER_ACTIONS.has(action));
  if (forbiddenWriterActions.length > 0) {
    throw new Error(`writer cannot prune, delete, overwrite, or administer retention: ${forbiddenWriterActions.sort().join(', ')}`);
  }
  if (![...maintenanceActions].some(action => DESTRUCTIVE_ACTIONS.has(action))) {
    throw new Error('maintenance identity must explicitly own at least one destructive maintenance action');
  }

  const supported = new Set(parsed.provider.supportedActions);
  if (supported.size !== parsed.provider.supportedActions.length) throw new Error('provider supported actions must be unique');
  const unsupported = [...new Set([...writerActions, ...maintenanceActions].filter(action => !supported.has(action)))].sort();
  const findings: z.infer<typeof FindingSchema>[] = [];
  if (!parsed.provider.independentlyScopedPrincipals) {
    findings.push({ code: 'provider-cannot-separate-identities', detail: 'provider evidence does not support independently scoped writer and maintenance principals' });
  }
  if (parsed.provider.identityEnforcement === 'process-only' || parsed.provider.identityEnforcement === 'unsupported') {
    findings.push({ code: 'provider-enforcement-insufficient', detail: `identity limits are ${parsed.provider.identityEnforcement}; process convention is not provider-enforced separation` });
  }
  if (unsupported.length > 0) {
    findings.push({ code: 'provider-action-unsupported', detail: `provider evidence does not support requested actions: ${unsupported.join(', ')}` });
  }

  const retention = parsed.provider.retention;
  const immutable = retention.enforcement === 'provider-enforced'
    && retention.retentionLockEnabled
    && retention.writerCannotDeleteRetainedData
    && retention.maintenanceCannotBypassRetention
    && retention.evidenceRef !== null;
  const immutabilityReasons = immutable
    ? ['provider evidence proves locked retention against both operational identities']
    : [
      ...(retention.enforcement !== 'provider-enforced' ? [`retention enforcement is ${retention.enforcement}`] : []),
      ...(!retention.retentionLockEnabled ? ['retention lock is not enabled'] : []),
      ...(!retention.writerCannotDeleteRetainedData ? ['writer deletion denial is not provider-enforced'] : []),
      ...(!retention.maintenanceCannotBypassRetention ? ['maintenance identity can bypass retained data'] : []),
      ...(retention.evidenceRef === null ? ['provider retention evidence is absent'] : []),
      ...parsed.provider.limitations,
    ];
  if (!immutable) {
    findings.push({
      code: 'immutability-not-guaranteed',
      detail: `provider cannot guarantee immutability: ${immutabilityReasons.join('; ')}`,
    });
  }

  const unsigned = {
    schemaVersion: 1 as const,
    planId: parsed.planId,
    providerId: parsed.provider.providerId,
    status: findings.some(finding => finding.code !== 'immutability-not-guaranteed') ? 'gated' as const : 'ready' as const,
    writer: parsed.writer,
    maintenance: parsed.maintenance,
    immutability: {
      guarantee: immutable ? 'provider-enforced' as const : 'not-guaranteed' as const,
      evidenceRef: immutable ? retention.evidenceRef : null,
      reasons: immutabilityReasons,
    },
    findings,
  };
  return BackupAuthorityPlanSchema.parse({
    ...unsigned,
    planDigest: createHash('sha256').update(canonical({ unsigned, capabilityEvidenceDigest: parsed.provider.capabilityEvidenceDigest })).digest('hex'),
  });
}
