export type TargetAuthorizationDecisionRecord = Readonly<{
  requestId: string;
  verificationCode: string;
  profileId: string;
  profileRevision: string;
  profileRevisionDigest: string;
  targetKeyFingerprint: string;
  requestedScopes: readonly string[];
  status: string;
  expiresAt: string;
}>;

export type TargetAuthorizationDecisionRequest = Readonly<{
  requestId: string;
  verificationCode: string;
  profileId: string;
  profileRevision: string;
  profileRevisionDigest: string;
  targetKeyFingerprint: string;
  requestedScopes: readonly string[];
  decision: 'approve' | 'deny';
  approvedScopes?: readonly string[];
}>;

export type TargetAuthorizationDecisionResult =
  | { ok: true; status: 'approved' | 'denied'; decidedAt: string; approvedScopes: string[] | null }
  | { ok: false; status: 400 | 409 | 410; error: string };

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Pure exact-binding policy; authentication and tenant ownership are enforced by the HTTP adapter first. */
export function authorizeTargetAuthorizationDecision(
  record: TargetAuthorizationDecisionRecord,
  request: TargetAuthorizationDecisionRequest,
  now = new Date(),
): TargetAuthorizationDecisionResult {
  if (record.status !== 'pending') return { ok: false, status: 409, error: 'authorization_not_pending' };
  if (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now.getTime()) {
    return { ok: false, status: 410, error: 'authorization_expired' };
  }
  if (request.requestId !== record.requestId || request.verificationCode !== record.verificationCode
    || request.profileId !== record.profileId || request.profileRevision !== record.profileRevision
    || request.profileRevisionDigest !== record.profileRevisionDigest
    || request.targetKeyFingerprint !== record.targetKeyFingerprint
    || !exactArray(request.requestedScopes, record.requestedScopes)) {
    return { ok: false, status: 409, error: 'authorization_binding_mismatch' };
  }
  const approvedScopes = request.decision === 'approve'
    ? [...(request.approvedScopes ?? record.requestedScopes)] : null;
  if (approvedScopes && (approvedScopes.length === 0
    || new Set(approvedScopes).size !== approvedScopes.length
    || !exactArray(approvedScopes, [...approvedScopes].sort())
    || approvedScopes.some(scope => !record.requestedScopes.includes(scope)))) {
    return { ok: false, status: 400, error: 'invalid_approved_scopes' };
  }
  return { ok: true, status: request.decision === 'approve' ? 'approved' : 'denied',
    decidedAt: now.toISOString(), approvedScopes };
}
