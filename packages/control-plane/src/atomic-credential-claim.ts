import {
  DeviceAuthorizationClaimSchema,
  DeviceAuthorizationPollSchema,
  DeviceAuthorizationRequestSchema,
  assertDeviceAuthorizationTransition,
  type DeviceAuthorizationBinding,
  type DeviceAuthorizationRequest,
} from '../../aid-core/src/device-authorization.ts';

export const DEVICE_CREDENTIAL_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DEVICE_CLAIM_MIN_POLL_INTERVAL_MS = 5_000;

/** Exact comparison used by the HTTP adapter before any credential material is minted. */
export function matchesPresentedClaimBinding(
  expected: { tenantId: string; profileRevision: string | null; deviceKeyFingerprint: string | null },
  presented: { tenantId: string | undefined; profileRevision: string | undefined; deviceKeyFingerprint: string | undefined },
): boolean {
  const boundEnrollment = expected.profileRevision !== null || expected.deviceKeyFingerprint !== null;
  if (boundEnrollment && presented.tenantId !== expected.tenantId) return false;
  if (!boundEnrollment && presented.tenantId !== undefined && presented.tenantId !== expected.tenantId) return false;
  return (expected.profileRevision === null || presented.profileRevision === expected.profileRevision)
    && (expected.deviceKeyFingerprint === null || presented.deviceKeyFingerprint === expected.deviceKeyFingerprint);
}

export type ClaimRecord = {
  request: DeviceAuthorizationRequest;
  status: 'pending' | 'approved' | 'denied' | 'claimed';
  approvedScopes: readonly string[];
  lastPolledAt: string | null;
  revision: string;
};

export type IssuedDeviceCredential = {
  id: string;
  secret: string;
  tenantId: string;
  profileId: string;
  deviceKeyFingerprint: string;
  scopes: readonly string[];
  issuedAt: string;
  expiresAt: string;
};

export type AtomicClaimOutcome = 'claimed' | 'conflict' | 'credential-id-collision';

export interface AtomicCredentialClaimStore {
  readForClaim(requestId: string): Promise<ClaimRecord | null>;
  /** One conditional write must consume the request and insert the credential in the same transaction. */
  atomicClaim(input: {
    requestId: string;
    expectedRevision: string;
    expectedStatus: 'approved';
    credential: IssuedDeviceCredential;
    claimedAt: string;
  }): Promise<AtomicClaimOutcome>;
  atomicRevoke(input: {
    credentialId: string;
    tenantId: string;
    deviceKeyFingerprint: string;
    revokedAt: string;
    reason: 'owner-revoked' | 'device-lost' | 'key-rotated' | 'policy-changed' | 'compromised';
  }): Promise<'revoked' | 'not-found' | 'already-revoked' | 'binding-mismatch'>;
}

export type DeviceClaimRequest = {
  requestId: string;
  tenantId: string;
  profileId: string;
  deviceKeyFingerprint: string;
  pollProof: string;
};

export type PublicClaimResult =
  | { ok: true; status: 200; credential: IssuedDeviceCredential }
  | { ok: false; status: 404; error: 'claim_unavailable' }
  | { ok: false; status: 429; error: 'retry_later'; retryAfterSeconds: number };

const unavailable = (): PublicClaimResult => ({ ok: false, status: 404, error: 'claim_unavailable' });

function canonicalScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes)].sort((left, right) => left.localeCompare(right));
}

/**
 * Claims a credential exactly once. All authority-bearing comparisons precede minting, while the
 * store's single CAS transaction is the final replay/collision boundary. Public errors deliberately
 * collapse absent, denied, expired, cross-tenant/profile/device, bad-proof, and collision outcomes.
 */
export async function claimDeviceCredential(
  input: DeviceClaimRequest,
  dependencies: {
    store: AtomicCredentialClaimStore;
    verifyPollProof: (proof: string, expectedFingerprint: string) => Promise<boolean>;
    mintCredential: (authority: {
      tenantId: string;
      profileId: string;
      deviceKeyFingerprint: string;
      scopes: readonly string[];
      issuedAt: string;
      expiresAt: string;
    }) => Promise<{ id: string; secret: string }>;
    now?: Date;
    credentialLifetimeMs?: number;
  },
): Promise<PublicClaimResult> {
  const now = dependencies.now ?? new Date();
  const lifetime = dependencies.credentialLifetimeMs ?? DEVICE_CREDENTIAL_MAX_LIFETIME_MS;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > DEVICE_CREDENTIAL_MAX_LIFETIME_MS) return unavailable();

  const record = await dependencies.store.readForClaim(input.requestId);
  if (!record) return unavailable();
  let request: DeviceAuthorizationRequest;
  try {
    request = DeviceAuthorizationRequestSchema.parse(record.request);
  } catch {
    return unavailable();
  }
  const binding = request.binding;
  if (record.status !== 'approved'
    || Date.parse(binding.expiresAt) <= now.getTime()
    || input.tenantId !== binding.tenantId
    || input.profileId !== binding.profileId
    || input.deviceKeyFingerprint !== binding.targetKeyFingerprint) return unavailable();

  if (record.lastPolledAt) {
    const elapsed = now.getTime() - Date.parse(record.lastPolledAt);
    if (!Number.isFinite(elapsed) || elapsed < DEVICE_CLAIM_MIN_POLL_INTERVAL_MS) {
      return { ok: false, status: 429, error: 'retry_later', retryAfterSeconds: Math.ceil((DEVICE_CLAIM_MIN_POLL_INTERVAL_MS - Math.max(0, elapsed)) / 1000) };
    }
  }
  if (!await dependencies.verifyPollProof(input.pollProof, request.pollKeyFingerprint)) return unavailable();

  const approvedScopes = canonicalScopes(record.approvedScopes);
  if (approvedScopes.length === 0 || approvedScopes.some(scope => !binding.scopes.includes(scope))) return unavailable();
  const narrowedBinding: DeviceAuthorizationBinding = { ...binding, scopes: approvedScopes };
  const claimedAt = now.toISOString();
  const credentialExpiresAt = new Date(now.getTime() + lifetime).toISOString();
  try {
    const poll = DeviceAuthorizationPollSchema.parse({
      schemaVersion: 1, requestId: request.requestId, binding: narrowedBinding,
      pollProof: input.pollProof, polledAt: claimedAt,
    });
    assertDeviceAuthorizationTransition(request, poll);
  } catch {
    return unavailable();
  }

  const minted = await dependencies.mintCredential({
    tenantId: binding.tenantId,
    profileId: binding.profileId,
    deviceKeyFingerprint: binding.targetKeyFingerprint,
    scopes: approvedScopes,
    issuedAt: claimedAt,
    expiresAt: credentialExpiresAt,
  });
  const credential: IssuedDeviceCredential = {
    ...minted, tenantId: binding.tenantId, profileId: binding.profileId,
    deviceKeyFingerprint: binding.targetKeyFingerprint, scopes: approvedScopes,
    issuedAt: claimedAt, expiresAt: credentialExpiresAt,
  };
  try {
    const claim = DeviceAuthorizationClaimSchema.parse({
      schemaVersion: 1, requestId: request.requestId, binding: narrowedBinding,
      credentialId: credential.id, claimedAt, credentialExpiresAt,
    });
    assertDeviceAuthorizationTransition(request, claim);
  } catch {
    return unavailable();
  }
  const outcome = await dependencies.store.atomicClaim({
    requestId: request.requestId, expectedRevision: record.revision,
    expectedStatus: 'approved', credential, claimedAt,
  });
  return outcome === 'claimed' ? { ok: true, status: 200, credential } : unavailable();
}

export async function revokeDeviceCredential(
  input: Parameters<AtomicCredentialClaimStore['atomicRevoke']>[0],
  store: AtomicCredentialClaimStore,
): Promise<{ ok: true } | { ok: false; status: 404; error: 'credential_unavailable' }> {
  const result = await store.atomicRevoke(input);
  return result === 'revoked' ? { ok: true } : { ok: false, status: 404, error: 'credential_unavailable' };
}
