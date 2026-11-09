import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

const operation = z.object({
  taskId: id,
  operationId: id,
  phase: z.enum(['check', 'apply', 'verify']),
}).strict();

export const BrokerApprovalGrant = z.object({
  schemaVersion: z.literal(1),
  grantId: id,
  hostId: id,
  releaseId: id,
  runId: id,
  planDigest: digest,
  approvedPlanDigest: digest,
  enrolledUid: z.number().int().nonnegative(),
  brokerExecutableDigest: digest,
  runtimeDigest: digest,
  workerDigest: digest,
  operations: z.array(operation).min(1).max(256),
  descriptorDigest: digest,
  closureDigest: digest,
  consentDigest: digest,
  issuedAt: timestamp,
  expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (value.planDigest !== value.approvedPlanDigest) {
    context.addIssue({ code: 'custom', message: 'grant is not bound to the approved plan' });
  }
  if (new Set(value.operations.map(entry => entry.operationId)).size !== value.operations.length) {
    context.addIssue({ code: 'custom', message: 'grant contains duplicate operation identifiers' });
  }
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  if (lifetime <= 0 || lifetime > 30 * 60 * 1000) {
    context.addIssue({ code: 'custom', message: 'grant lifetime must be positive and no longer than thirty minutes' });
  }
});

export const BrokerApprovalSignerDelegation = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('desktop-tools-broker-approval-signer-delegation'),
  keyId: id,
  algorithm: z.literal('Ed25519'),
  signatureDomain: z.literal('desktop-tools-broker-approval-v1'),
  product: z.literal('desktop-tools'),
  releaseId: id,
  channel: id,
  publicKeySpki: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
  notBefore: timestamp,
  notAfter: timestamp,
  maximumApprovalLifetimeSeconds: z.number().int().positive().max(1800),
  revocationEpoch: z.number().int().nonnegative(),
  delegationDigest: digest,
}).strict();

export const BrokerApprovalDurableState = z.object({
  schemaVersion: z.literal(1),
  authorizationId: id,
  ownerDecisionId: id,
  ownerActorId: id,
  ownerDecision: z.literal('approved'),
  ownerReauthenticatedAt: timestamp,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  runIntentId: id,
  status: z.literal('approved'),
  grant: BrokerApprovalGrant,
  delegation: BrokerApprovalSignerDelegation,
}).strict();

export const BrokerApprovalRequest = z.object({
  schemaVersion: z.literal(1),
  authorizationId: id,
  ownerDecisionId: id,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  runIntentId: id,
  grantId: id,
}).strict();

export const SignedBrokerApprovalUnsigned = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('desktop-tools-broker-approval'),
  signerKeyId: id,
  signatureDomain: z.literal('desktop-tools-broker-approval-v1'),
  approvalId: id,
  authorizationId: id,
  ownerDecisionId: id,
  ownerActorId: id,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  runIntentId: id,
  grant: BrokerApprovalGrant,
  grantDigest: digest,
  delegationDigest: digest,
  revocationEpoch: z.number().int().nonnegative(),
  approvedAt: timestamp,
  expiresAt: timestamp,
}).strict();

export const SignedBrokerApproval = SignedBrokerApprovalUnsigned.extend({
  signature: z.string().min(64).max(512).regex(/^[A-Za-z0-9_-]+$/),
  auditDigest: digest,
}).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function brokerApprovalSigningBytes(value: unknown): Uint8Array {
  const unsigned = SignedBrokerApprovalUnsigned.parse(value);
  return new TextEncoder().encode(`${unsigned.signatureDomain}\0${JSON.stringify(canonical(unsigned))}`);
}

export async function brokerApprovalSemanticDigest(domain: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${domain}\0${JSON.stringify(canonical(value))}`);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function brokerApprovalAuditDigest(value: unknown): Promise<string> {
  return brokerApprovalSemanticDigest('desktop-tools:broker-approval-audit:v1',
    SignedBrokerApprovalUnsigned.parse(value));
}

export type BrokerApprovalRequestValue = z.infer<typeof BrokerApprovalRequest>;
export type BrokerApprovalDurableStateValue = z.infer<typeof BrokerApprovalDurableState>;
export type SignedBrokerApprovalValue = z.infer<typeof SignedBrokerApproval>;
export type SignedBrokerApprovalUnsignedValue = z.infer<typeof SignedBrokerApprovalUnsigned>;
