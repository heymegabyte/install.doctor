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
import {
  BrokerApprovalDurableState,
  BrokerApprovalRequest,
  BrokerApprovalSignerDelegation,
  type SignedBrokerApprovalValue,
} from './broker-approval-signer.ts';
import {
  CurrentPlanAuthoritySchema,
  ReviewedPlanBindingSchema,
  admitReviewedPlan,
  createReviewedPlanBinding,
  type CurrentPlanAuthority,
  type ReviewedPlanBinding,
} from '../../installer-engine/src/reviewed-plan-binding.ts';

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
  persistReviewedPlan(runIntentId: string, value: ReviewedPlanBinding): Promise<boolean>;
  loadReviewedPlan(runIntentId: string): Promise<ReviewedPlanBinding | null>;
}>;

export type BrokerAuthorizationAuthority = Readonly<{
  reconstructRunIntent(request: BrokerRunIntentValue, principal: BrokerDevicePrincipal): Promise<BrokerRunIntentValue | null>;
  loadRunIntent(runIntentId: string): Promise<BrokerRunIntentValue | null>;
  ownerForTenant(tenantId: string): Promise<Readonly<{ authenticationActor: string; ownerActorId: string }> | null>;
  reconstructCurrentPlanAuthority(intent: BrokerRunIntentValue): Promise<CurrentPlanAuthority>;
}>;

export type BrokerApprovalIssuer = Readonly<{
  delegationForRelease(releaseId: string): Promise<z.infer<typeof BrokerApprovalSignerDelegation> | null>;
  persistApprovedState(value: unknown): Promise<boolean>;
  approve(request: unknown): Promise<SignedBrokerApprovalValue>;
}>;

export type BrokerAuthorizationServiceErrorCode =
  | 'insufficient_scope' | 'identity_mismatch' | 'authority_unavailable'
  | 'authoritative_state_mismatch' | 'run_intent_unavailable'
  | 'reauthentication_required' | 'wrong_actor' | 'exact_binding_mismatch'
  | 'approval_unavailable' | 'reviewed_plan_unavailable' | 'reviewed_plan_drift';

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
  if (!principal.permissions?.some(scope => scope === 'authorize-privileged-run' || scope === 'run:authorize')) {
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
  approval: BrokerApprovalIssuer;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  const admitCurrentReviewedPlan = async (intent: BrokerRunIntentValue, binding: ReviewedPlanBinding) => {
    let current: CurrentPlanAuthority;
    try {
      current = CurrentPlanAuthoritySchema.parse(await input.authority.reconstructCurrentPlanAuthority(intent));
    } catch {
      throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
    }
    const admission = admitReviewedPlan(binding, current);
    if (admission.decision !== 'allow') {
      throw new BrokerAuthorizationServiceError('reviewed_plan_drift', 409);
    }
  };
  const reviewAuthorization = async (runIntentId: string, owner: AuthenticatedOwner | null) => {
    const intent = await input.authority.loadRunIntent(runIntentId);
    if (!intent) throw new BrokerAuthorizationServiceError('run_intent_unavailable', 404);
    const expectedOwner = await input.authority.ownerForTenant(intent.tenantId);
    if (!expectedOwner) throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
    const access = authorizeOwnerContextRead(expectedOwner.authenticationActor, owner, now());
    if (!access.ok) throw new BrokerAuthorizationServiceError(access.error, access.status);
    const existing = await input.store.loadReviewedPlan(intent.runIntentId);
    if (existing) {
      if (existing.reviewedBy !== expectedOwner.ownerActorId) {
        throw new BrokerAuthorizationServiceError('exact_binding_mismatch', 409);
      }
      await admitCurrentReviewedPlan(intent, existing);
      return { runIntent: intent, ownerActorId: expectedOwner.ownerActorId, reviewedPlan: existing };
    }
    const reviewedAt = now();
    let current: CurrentPlanAuthority;
    try {
      current = CurrentPlanAuthoritySchema.parse(await input.authority.reconstructCurrentPlanAuthority(intent));
    } catch {
      throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
    }
    const { now: _observedAt, ...reviewedAuthority } = current;
    const binding = createReviewedPlanBinding({
      schemaVersion: 1,
      reviewId: intent.runIntentId,
      ...reviewedAuthority,
      reviewedBy: expectedOwner.ownerActorId,
      reviewedAt: reviewedAt.toISOString(),
      expiresAt: new Date(Math.min(Date.parse(intent.grantExpiresAt), reviewedAt.getTime() + DECISION_LIFETIME_MS)).toISOString(),
    });
    await input.store.persistReviewedPlan(intent.runIntentId, binding);
    return { runIntent: intent, ownerActorId: expectedOwner.ownerActorId, reviewedPlan: binding };
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
      await admitCurrentReviewedPlan(intent, reviewed.reviewedPlan);
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
      const reviewedPlan = await input.store.loadReviewedPlan(reconstruction.runIntentId);
      if (!reviewedPlan) throw new BrokerAuthorizationServiceError('reviewed_plan_unavailable', 409);
      const persistedIntent = await input.authority.loadRunIntent(reconstruction.runIntentId);
      if (!persistedIntent) throw new BrokerAuthorizationServiceError('run_intent_unavailable', 404);
      await admitCurrentReviewedPlan(persistedIntent, ReviewedPlanBindingSchema.parse(reviewedPlan));
      try {
        const delegation = await input.approval.delegationForRelease(reconstruction.grant.releaseId);
        if (!delegation) throw new Error('delegation unavailable');
        const state = BrokerApprovalDurableState.parse({
          schemaVersion: 1,
          authorizationId: reconstruction.authorizationId,
          ownerDecisionId: reconstruction.ownerDecisionId,
          ownerActorId: reconstruction.ownerActorId,
          ownerDecision: reconstruction.ownerDecision,
          ownerReauthenticatedAt: reconstruction.ownerReauthenticatedAt,
          tenantId: reconstruction.tenantId,
          profileId: reconstruction.profileId,
          profileRevisionDigest: reconstruction.profileRevisionDigest,
          deviceCredentialId: reconstruction.deviceCredentialId,
          deviceFingerprint: reconstruction.deviceFingerprint,
          runIntentId: reconstruction.runIntentId,
          status: reconstruction.status,
          grant: reconstruction.grant,
          delegation,
        });
        await input.approval.persistApprovedState(state);
        const request = BrokerApprovalRequest.parse({ ...lookup, schemaVersion: 1 });
        return { approval: await input.approval.approve(request) };
      } catch (error) {
        if (error instanceof BrokerAuthorizationServiceError) throw error;
        throw new BrokerAuthorizationServiceError('authority_unavailable', 503);
      }
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
