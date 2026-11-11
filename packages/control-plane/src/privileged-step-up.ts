import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN } from './auth-origin-policy.ts';

export const PRIVILEGED_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
export const PRIVILEGED_STEP_UP_SCOPES = [
  'device:authorize', 'plan:apply', 'recovery:manage', 'secret:read',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
const actor = z.string().min(1).max(240).regex(/^better-auth-user:[A-Za-z0-9._~-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const scope = z.enum(PRIVILEGED_STEP_UP_SCOPES);

export const PrivilegedStepUpBinding = z.strictObject({
  actor,
  origin: z.literal(DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN),
  target: z.strictObject({ kind: z.enum(['device', 'host', 'plan', 'recovery']), id: identifier }),
  planDigest: digest,
  scopes: z.array(scope).min(1).max(PRIVILEGED_STEP_UP_SCOPES.length)
    .refine(values => values.length === new Set(values).size && values.every((value, index) => index === 0 || values[index - 1]! < value),
      'scopes must be unique and sorted'),
});

export const PrivilegedStepUpRecord = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifier,
  challengeSha256: digest,
  binding: PrivilegedStepUpBinding,
  status: z.enum(['pending', 'verified', 'consumed', 'revoked']),
  issuedAt: timestamp,
  expiresAt: timestamp,
  verifiedAt: timestamp.nullable(),
  verifiedSessionId: identifier.nullable(),
  credentialId: identifier.nullable(),
  credentialRevocationEpoch: z.number().int().nonnegative(),
  consumedAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'challenge expiry must follow issuance' });
  }
  if (value.status === 'pending' && (value.verifiedAt || value.verifiedSessionId || value.credentialId)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'pending challenge cannot contain verification evidence' });
  }
  if ((value.status === 'verified' || value.status === 'consumed')
    && (!value.verifiedAt || !value.verifiedSessionId || !value.credentialId)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'verified challenge requires complete evidence' });
  }
  if (value.status === 'consumed' && !value.consumedAt) {
    context.addIssue({ code: 'custom', path: ['consumedAt'], message: 'consumed challenge requires timestamp' });
  }
  if (value.status === 'revoked' && !value.revokedAt) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'revoked challenge requires timestamp' });
  }
});

export type PrivilegedStepUpRecordValue = z.infer<typeof PrivilegedStepUpRecord>;
export type PrivilegedStepUpBindingValue = z.infer<typeof PrivilegedStepUpBinding>;

export type VerifiedPasskeySession = {
  actor: string;
  origin: string;
  sessionId: string;
  authenticatedAt: string;
  credentialId: string;
  credentialActive: boolean;
  credentialRevocationEpoch: number;
};

export type StepUpResult =
  | { ok: true; record: PrivilegedStepUpRecordValue }
  | { ok: false; error: 'invalid_binding' | 'challenge_mismatch' | 'expired' | 'wrong_actor' | 'wrong_origin'
      | 'reauthentication_required' | 'credential_revoked' | 'revocation_epoch_changed' | 'not_pending'
      | 'not_verified' | 'session_mismatch' };

export function hashStepUpChallenge(challenge: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('invalid step-up challenge');
  return createHash('sha256').update(challenge, 'utf8').digest('hex');
}

function matchesChallenge(record: PrivilegedStepUpRecordValue, challenge: string): boolean {
  let supplied: Buffer;
  try { supplied = Buffer.from(hashStepUpChallenge(challenge), 'hex'); } catch { return false; }
  return timingSafeEqual(Buffer.from(record.challengeSha256, 'hex'), supplied);
}

function sameBinding(left: PrivilegedStepUpBindingValue, right: PrivilegedStepUpBindingValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyPrivilegedStepUp(
  recordInput: unknown,
  challenge: string,
  expectedBindingInput: unknown,
  passkey: VerifiedPasskeySession,
  now = new Date(),
): StepUpResult {
  const recordResult = PrivilegedStepUpRecord.safeParse(recordInput);
  const bindingResult = PrivilegedStepUpBinding.safeParse(expectedBindingInput);
  if (!recordResult.success || !bindingResult.success || !sameBinding(recordResult.data.binding, bindingResult.data)) {
    return { ok: false, error: 'invalid_binding' };
  }
  const record = recordResult.data;
  if (record.status !== 'pending') return { ok: false, error: 'not_pending' };
  if (!matchesChallenge(record, challenge)) return { ok: false, error: 'challenge_mismatch' };
  if (Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, error: 'expired' };
  if (passkey.actor !== record.binding.actor) return { ok: false, error: 'wrong_actor' };
  if (passkey.origin !== record.binding.origin) return { ok: false, error: 'wrong_origin' };
  const authenticatedAt = Date.parse(passkey.authenticatedAt);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt < Date.parse(record.issuedAt)
    || authenticatedAt > now.getTime() || now.getTime() - authenticatedAt > PRIVILEGED_STEP_UP_MAX_AGE_MS) {
    return { ok: false, error: 'reauthentication_required' };
  }
  if (!passkey.credentialActive) return { ok: false, error: 'credential_revoked' };
  if (passkey.credentialRevocationEpoch !== record.credentialRevocationEpoch) {
    return { ok: false, error: 'revocation_epoch_changed' };
  }
  return { ok: true, record: {
    ...record, status: 'verified', verifiedAt: now.toISOString(),
    verifiedSessionId: passkey.sessionId, credentialId: passkey.credentialId,
  } };
}

export function consumePrivilegedStepUp(
  recordInput: unknown,
  challenge: string,
  expectedBindingInput: unknown,
  session: Omit<VerifiedPasskeySession, 'authenticatedAt'>,
  now = new Date(),
): StepUpResult {
  const recordResult = PrivilegedStepUpRecord.safeParse(recordInput);
  const bindingResult = PrivilegedStepUpBinding.safeParse(expectedBindingInput);
  if (!recordResult.success || !bindingResult.success || !sameBinding(recordResult.data.binding, bindingResult.data)) {
    return { ok: false, error: 'invalid_binding' };
  }
  const record = recordResult.data;
  if (record.status !== 'verified') return { ok: false, error: 'not_verified' };
  if (!matchesChallenge(record, challenge)) return { ok: false, error: 'challenge_mismatch' };
  if (Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, error: 'expired' };
  if (session.actor !== record.binding.actor) return { ok: false, error: 'wrong_actor' };
  if (session.origin !== record.binding.origin) return { ok: false, error: 'wrong_origin' };
  if (session.sessionId !== record.verifiedSessionId || session.credentialId !== record.credentialId) {
    return { ok: false, error: 'session_mismatch' };
  }
  if (!session.credentialActive) return { ok: false, error: 'credential_revoked' };
  if (session.credentialRevocationEpoch !== record.credentialRevocationEpoch) {
    return { ok: false, error: 'revocation_epoch_changed' };
  }
  return { ok: true, record: { ...record, status: 'consumed', consumedAt: now.toISOString() } };
}

/** Recovery uses Better Auth's fresh OAuth session only to register a replacement passkey.
 * It never creates a privileged grant; the replacement must complete a new step-up ceremony. */
export function authorizePasskeyRecoveryRegistration(
  expectedActor: string,
  session: { actor: string; authenticatedAt: string },
  now = new Date(),
): { ok: true } | { ok: false; error: 'wrong_actor' | 'reauthentication_required' } {
  if (session.actor !== expectedActor) return { ok: false, error: 'wrong_actor' };
  const authenticatedAt = Date.parse(session.authenticatedAt);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > now.getTime()
    || now.getTime() - authenticatedAt > PRIVILEGED_STEP_UP_MAX_AGE_MS) {
    return { ok: false, error: 'reauthentication_required' };
  }
  return { ok: true };
}
