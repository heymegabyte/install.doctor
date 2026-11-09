import { z } from 'zod';
import {
  BrokerOwnerDecision,
  BrokerAuthorizationStatusLookup,
  BrokerRunApprovalLookup,
  BrokerRunIntent,
  type BrokerApprovalReconstructionValue,
  type BrokerAuthorizationStatusValue,
  type BrokerOwnerDecisionValue,
  type BrokerRunApprovalLookupValue,
  type BrokerRunIntentValue,
} from './broker-run-intent-d1-store.ts';
import { authorizeOwnerContextRead, type AuthenticatedOwner } from './owner-approval.ts';

const DECISION_LIFETIME_MS = 10 * 60 * 1000;

export const BrokerAuthorizationDecisionRequest = z.object({
  schemaVersion: z.literal(1),
  ownerDecisionId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  runIntentId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  authorizationId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  consentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(['approved', 'denied']),
}).strict();

export const BrokerAuthorizationTargetStatusRequest = z.object({
  schemaVersion: z.literal(1),
  authorizationId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  runIntentId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  grantId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
}).strict();

export type BrokerDevicePrincipal = Readonly<{
  deviceCredentialId: string;
  deviceFingerprint: string;
  tenantId: string;
  permissions: readonly string[] | null;
}>;

export type BrokerAuthorizationStore = Readonly<{
  persistRunIntent(value: unknown): Promise<boolean>;
  persistOwnerDecision(value: unknown): Promise<boolean>;
  loadAuthorizationStatus(value: unknown): Promise<BrokerAuthorizationStatusValue>;
  loadApprovedReconstruction(value: unknown): Promise<BrokerApprovalReconstructionValue | null>;
}>;

export type BrokerAuthorizationAuthority = Readonly<{
  reconstructRunIntent(request: BrokerRunIntentValue, principal: BrokerDevicePrincipal): Promise<BrokerRunIntentValue | null>;
  loadRunIntent(runIntentId: string): Promise<BrokerRunIntentValue | null>;
  ownerForTenant(tenantId: string): Promise<Readonly<{ authenticationActor: string; ownerActorId: string }> | null>;
}>;

export type BrokerAuthorizationServiceErrorCode =
  | 'insufficient_scope' | 'identity_mismatch' | 'authority_unavailable'
  | 'authoritative_state_mismatch' | 'run_intent_unavailable'
  | 'reauthentication_required' | 'wrong_actor' | 'exact_binding_mismatch'
  | 'approval_unavailable';

export class BrokerAuthorizationServiceError extends Error {
  readonly code: BrokerAuthorizationServiceErrorCode;
  readonly status: 400 | 401 | 403 | 404 | 409 | 503;

  constructor(code: BrokerAuthorizationServiceErrorCode, status: 400 | 401 | 403 | 404 | 409 | 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requirePrivilegedScope(principal: BrokerDevicePrincipal): void {
  // Privileged authorization never inherits the compatibility behavior used by ordinary
  // device routes: SQL NULL means no recorded grant and therefore fails closed.
  if (!principal.permissions?.includes('authorize-privileged-run')) {
    throw new BrokerAuthorizationServiceError('insufficient_scope', 403);
  }
}

function requireDeviceBinding(intent: BrokerRunIntentValue, principal: BrokerDevicePrincipal): void {
  if (intent.tenantId !== principal.tenantId
    || intent.deviceCredentialId !== principal.deviceCredentialId
    || intent.deviceFingerprint !== principal.deviceFingerprint) {
    throw new BrokerAuthorizationServiceError('identity_mismatch', 403);
  }
}

export function createBrokerAuthorizationService(input: Readonly<{
  store: BrokerAuthorizationStore;
  authority: BrokerAuthorizationAuthority;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  const reviewAuthorization = async (runIntentId: string, owner: AuthenticatedOwner | null) => {
    const intent = await input.authority.loadRunIntent(runIntentId);
    if (!intent) throw new BrokerAuthorizationServiceError('run_intent_unavailable', 404);
    const expectedOwner = await input.authority.ownerForTenant(intent.tenantId);
    if (!expectedOwner) throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
    const access = authorizeOwnerContextRead(expectedOwner.authenticationActor, owner, now());
    if (!access.ok) throw new BrokerAuthorizationServiceError(access.error, access.status);
    return { runIntent: intent, ownerActorId: expectedOwner.ownerActorId };
  };
  return Object.freeze({
    async requestAuthorization(raw: unknown, principal: BrokerDevicePrincipal) {
      requirePrivilegedScope(principal);
      const request = BrokerRunIntent.parse(raw);
      requireDeviceBinding(request, principal);
      let authoritative: BrokerRunIntentValue | null;
      try {
        authoritative = await input.authority.reconstructRunIntent(request, principal);
      } catch {
        throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
      }
      if (!authoritative || !exact(authoritative, request)) {
        throw new BrokerAuthorizationServiceError('authoritative_state_mismatch', 409);
      }
      return { created: await input.store.persistRunIntent(authoritative), runIntent: authoritative };
    },

    reviewAuthorization,

    async decideAuthorization(raw: unknown, owner: AuthenticatedOwner | null) {
      const request = BrokerAuthorizationDecisionRequest.parse(raw);
      const reviewed = await reviewAuthorization(request.runIntentId, owner);
      const intent = reviewed.runIntent;
      if (request.authorizationId !== intent.authorizationId
        || request.approvedPlanDigest !== intent.planDigest
        || request.consentDigest !== intent.consentDigest) {
        throw new BrokerAuthorizationServiceError('exact_binding_mismatch', 409);
      }
      const decidedAt = now();
      const decision: BrokerOwnerDecisionValue = BrokerOwnerDecision.parse({
        schemaVersion: 1,
        ownerDecisionId: request.ownerDecisionId,
        runIntentId: intent.runIntentId,
        authorizationId: intent.authorizationId,
        tenantId: intent.tenantId,
        profileId: intent.profileId,
        profileRevisionDigest: intent.profileRevisionDigest,
        deviceCredentialId: intent.deviceCredentialId,
        deviceFingerprint: intent.deviceFingerprint,
        approvedPlanDigest: intent.planDigest,
        consentDigest: intent.consentDigest,
        ownerActorId: reviewed.ownerActorId,
        decision: request.decision,
        ownerReauthenticatedAt: owner!.authenticatedAt,
        decidedAt: decidedAt.toISOString(),
        expiresAt: new Date(decidedAt.getTime() + DECISION_LIFETIME_MS).toISOString(),
      });
      return { created: await input.store.persistOwnerDecision(decision), decision };
    },

    async claimApprovedAuthorization(raw: unknown, principal: BrokerDevicePrincipal) {
      requirePrivilegedScope(principal);
      const lookup: BrokerRunApprovalLookupValue = BrokerRunApprovalLookup.parse(raw);
      if (lookup.tenantId !== principal.tenantId
        || lookup.deviceCredentialId !== principal.deviceCredentialId
        || lookup.deviceFingerprint !== principal.deviceFingerprint) {
        throw new BrokerAuthorizationServiceError('identity_mismatch', 403);
      }
      const reconstruction = await input.store.loadApprovedReconstruction(lookup);
      if (!reconstruction) throw new BrokerAuthorizationServiceError('approval_unavailable', 404);
      return reconstruction;
    },

    async authorizationStatus(raw: unknown, principal: BrokerDevicePrincipal) {
      requirePrivilegedScope(principal);
      const request = BrokerAuthorizationTargetStatusRequest.parse(raw);
      return input.store.loadAuthorizationStatus(BrokerAuthorizationStatusLookup.parse({
        ...request, tenantId: principal.tenantId, deviceCredentialId: principal.deviceCredentialId,
        deviceFingerprint: principal.deviceFingerprint,
      }));
    },
  });
}
