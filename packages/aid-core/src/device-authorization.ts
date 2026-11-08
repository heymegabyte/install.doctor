import { z } from 'zod';

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
const scope = z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/);
const scopes = z.array(scope).min(1).max(64).superRefine((values, context) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'duplicate scopes' });
  if (values.some((value, index) => index > 0 && values[index - 1]!.localeCompare(value) >= 0)) {
    context.addIssue({ code: 'custom', message: 'scopes must be unique and sorted' });
  }
});

/** Public request authority. It never contains a polling secret or device credential. */
export const DeviceAuthorizationBindingSchema = strict({
  tenantId: identifier,
  profileId: identifier,
  targetPublicKey: z.string().min(43).max(1024).regex(/^[A-Za-z0-9_-]+$/),
  targetKeyFingerprint: digest,
  scopes,
  nonce,
  expiresAt: timestamp,
});
export type DeviceAuthorizationBinding = z.infer<typeof DeviceAuthorizationBindingSchema>;

const boundMessage = {
  schemaVersion: VERSION,
  requestId: identifier,
  binding: DeviceAuthorizationBindingSchema,
} as const;
const transitionEnvelope = z.object(boundMessage).passthrough();

export const DeviceAuthorizationRequestSchema = strict({
  ...boundMessage,
  machineLabel: z.string().min(1).max(128),
  verificationCode: z.string().regex(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4})?$/),
  pollKeyFingerprint: digest,
  createdAt: timestamp,
}).superRefine((value, context) => {
  if (Date.parse(value.binding.expiresAt) <= Date.parse(value.createdAt)) {
    context.addIssue({ code: 'custom', path: ['binding', 'expiresAt'], message: 'expiry must follow creation' });
  }
});
export type DeviceAuthorizationRequest = z.infer<typeof DeviceAuthorizationRequestSchema>;

export const DeviceAuthorizationApprovalSchema = strict({
  ...boundMessage,
  actorId: identifier,
  approvedAt: timestamp,
}).refine(value => Date.parse(value.approvedAt) <= Date.parse(value.binding.expiresAt), {
  path: ['approvedAt'], message: 'approval cannot occur after request expiry',
});
export type DeviceAuthorizationApproval = z.infer<typeof DeviceAuthorizationApprovalSchema>;

export const DeviceAuthorizationPollSchema = strict({
  ...boundMessage,
  pollProof: digest,
  polledAt: timestamp,
}).refine(value => Date.parse(value.polledAt) <= Date.parse(value.binding.expiresAt), {
  path: ['polledAt'], message: 'poll cannot occur after request expiry',
});
export type DeviceAuthorizationPoll = z.infer<typeof DeviceAuthorizationPollSchema>;

export const DeviceAuthorizationClaimSchema = strict({
  ...boundMessage,
  credentialId: identifier,
  claimedAt: timestamp,
  credentialExpiresAt: timestamp,
}).superRefine((value, context) => {
  if (Date.parse(value.claimedAt) > Date.parse(value.binding.expiresAt)) {
    context.addIssue({ code: 'custom', path: ['claimedAt'], message: 'claim cannot occur after request expiry' });
  }
  if (Date.parse(value.credentialExpiresAt) <= Date.parse(value.claimedAt)) {
    context.addIssue({ code: 'custom', path: ['credentialExpiresAt'], message: 'credential expiry must follow claim' });
  }
});
export type DeviceAuthorizationClaim = z.infer<typeof DeviceAuthorizationClaimSchema>;

export const DeviceAuthorizationDenialSchema = strict({
  ...boundMessage,
  actorId: identifier,
  deniedAt: timestamp,
  reason: z.enum(['owner-denied', 'policy-denied', 'expired', 'cancelled']),
}).refine(value => value.reason === 'expired' || Date.parse(value.deniedAt) <= Date.parse(value.binding.expiresAt), {
  path: ['deniedAt'], message: 'non-expiry denial cannot occur after request expiry',
});
export type DeviceAuthorizationDenial = z.infer<typeof DeviceAuthorizationDenialSchema>;

export const DeviceAuthorizationRevocationSchema = strict({
  ...boundMessage,
  credentialId: identifier,
  actorId: identifier,
  revokedAt: timestamp,
  reason: z.enum(['owner-revoked', 'device-lost', 'key-rotated', 'policy-changed', 'compromised']),
});
export type DeviceAuthorizationRevocation = z.infer<typeof DeviceAuthorizationRevocationSchema>;

export const DeviceAuthorizationAuditSchema = strict({
  ...boundMessage,
  eventId: identifier,
  event: z.enum(['requested', 'approved', 'polled', 'claimed', 'denied', 'revoked', 'expired', 'rejected']),
  outcome: z.enum(['accepted', 'denied', 'rejected']),
  actorId: identifier.nullable(),
  credentialId: identifier.nullable(),
  occurredAt: timestamp,
  reasonCode: z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*$/).nullable(),
});
export type DeviceAuthorizationAudit = z.infer<typeof DeviceAuthorizationAuditSchema>;

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Validates that a protocol message belongs to a request and cannot broaden
 * its authority. Narrower scope sets are allowed; every other binding is exact.
 */
export function assertDeviceAuthorizationTransition(
  requestInput: unknown,
  messageInput: unknown,
): DeviceAuthorizationBinding {
  const request = DeviceAuthorizationRequestSchema.parse(requestInput);
  const message = transitionEnvelope.parse(messageInput);
  const expected = request.binding;
  const actual = message.binding;
  if (message.requestId !== request.requestId
    || actual.tenantId !== expected.tenantId
    || actual.profileId !== expected.profileId
    || actual.targetPublicKey !== expected.targetPublicKey
    || actual.targetKeyFingerprint !== expected.targetKeyFingerprint
    || actual.nonce !== expected.nonce
    || actual.expiresAt !== expected.expiresAt) {
    throw new Error('authorization message is not bound to its originating request');
  }
  if (!actual.scopes.every(value => expected.scopes.includes(value))) {
    throw new Error('authorization message broadens requested scopes');
  }
  if (!sameArray(actual.scopes, [...actual.scopes].sort())) {
    throw new Error('authorization message scopes are not canonical');
  }
  return structuredClone(actual);
}
