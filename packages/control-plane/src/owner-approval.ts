import { z } from 'zod';

export const OWNER_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;
export const DESKTOP_DEVICE_SCOPE_ALLOWLIST = ['pull-desired-state', 'report-status', 'authorize-privileged-run'] as const;
const deviceScope = z.enum(DESKTOP_DEVICE_SCOPE_ALLOWLIST);

export const OwnerApprovalDecision = z.object({
  code: z.string().min(1).max(32),
  matchingCode: z.string().min(1).max(32),
  profileRevision: z.string().min(1).max(128),
  decision: z.enum(['approve', 'deny']),
  approvedScopes: z.array(deviceScope).min(1).max(DESKTOP_DEVICE_SCOPE_ALLOWLIST.length).optional(),
}).strict();

export type OwnerApprovalRequest = z.infer<typeof OwnerApprovalDecision>;

export type OwnerApprovalRecord = {
  code: string;
  status: string;
  profileRevision: string;
  ownerActor: string;
  expiresAt: string;
  requestedScopes?: readonly string[];
};

export type AuthenticatedOwner = {
  actor: string;
  authenticatedAt: string;
};

export type OwnerApprovalResult =
  | { ok: true; nextStatus: 'approved' | 'denied'; actor: string; decidedAt: string; approvedScopes: string[] | null }
  | { ok: false; status: 400 | 401 | 403 | 409 | 410; error: string };

export type OwnerContextReadResult =
  | { ok: true; actor: string }
  | { ok: false; status: 401 | 403; error: string };

function canonicalActor(value: string): string {
  return value.trim().toLowerCase();
}

export function authorizeOwnerContextRead(
  expectedActor: string,
  owner: AuthenticatedOwner | null,
  now = new Date(),
): OwnerContextReadResult {
  if (!owner) return { ok: false, status: 401, error: 'reauthentication_required' };
  if (canonicalActor(owner.actor) !== canonicalActor(expectedActor)) {
    return { ok: false, status: 403, error: 'wrong_actor' };
  }
  const authenticatedAt = Date.parse(owner.authenticatedAt);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > now.getTime() || now.getTime() - authenticatedAt > OWNER_REAUTH_MAX_AGE_MS) {
    return { ok: false, status: 401, error: 'reauthentication_required' };
  }
  return { ok: true, actor: canonicalActor(owner.actor) };
}

/** Pure fail-closed policy used by the HTTP boundary and focused tests. */
export function authorizeOwnerDecision(
  record: OwnerApprovalRecord,
  request: OwnerApprovalRequest,
  owner: AuthenticatedOwner | null,
  now = new Date(),
): OwnerApprovalResult {
  const contextAccess = authorizeOwnerContextRead(record.ownerActor, owner, now);
  if (!contextAccess.ok) return contextAccess;
  if (request.code !== record.code || request.matchingCode !== record.code) {
    return { ok: false, status: 400, error: 'matching_code_mismatch' };
  }
  if (record.status !== 'pending') return { ok: false, status: 409, error: 'pairing_not_pending' };
  if (Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, status: 410, error: 'expired' };
  if (request.profileRevision !== record.profileRevision) {
    return { ok: false, status: 409, error: 'stale_profile_revision' };
  }
  const requestedScopes = [...new Set(record.requestedScopes ?? [])].sort();
  const approvedScopes = request.approvedScopes ? [...new Set(request.approvedScopes)].sort() : requestedScopes;
  if (request.decision === 'approve'
    && (approvedScopes.length === 0
      || requestedScopes.some(scope => !(DESKTOP_DEVICE_SCOPE_ALLOWLIST as readonly string[]).includes(scope))
      || approvedScopes.some(scope => !requestedScopes.includes(scope)))) {
    return { ok: false, status: 400, error: 'invalid_approved_scopes' };
  }
  return {
    ok: true,
    nextStatus: request.decision === 'approve' ? 'approved' : 'denied',
    actor: contextAccess.actor,
    decidedAt: now.toISOString(),
    approvedScopes: request.decision === 'approve' ? approvedScopes : null,
  };
}
