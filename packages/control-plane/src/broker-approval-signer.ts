import { z } from 'zod';
import {
  BrokerApprovalDurableState,
  BrokerApprovalGrant,
  BrokerApprovalRequest,
  BrokerApprovalSignerDelegation,
  SignedBrokerApproval,
  brokerApprovalAuditDigest,
  brokerApprovalSemanticDigest,
  brokerApprovalSigningBytes,
  type BrokerApprovalDurableStateValue,
  type BrokerApprovalRequestValue,
  type SignedBrokerApprovalValue,
} from '../../aid-core/src/broker-approval-contracts.ts';

export {
  BrokerApprovalDurableState,
  BrokerApprovalGrant,
  BrokerApprovalRequest,
  BrokerApprovalSignerDelegation,
  SignedBrokerApproval,
};
export type {
  BrokerApprovalDurableStateValue,
  BrokerApprovalRequestValue,
  SignedBrokerApprovalValue,
};

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);

export interface BrokerApprovalStateStore {
  loadExactState(request: BrokerApprovalRequestValue): Promise<unknown>;
  consumeApproval(input: { readonly approvalId: string; readonly authorizationId: string;
    readonly ownerDecisionId: string; readonly runIntentId: string }): Promise<boolean>;
}

/** An opaque managed signer. It deliberately has no private-key export method. */
export interface BrokerApprovalManagedSigner {
  readonly keyId: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function sameRequest(request: BrokerApprovalRequestValue, state: BrokerApprovalDurableStateValue): boolean {
  return request.authorizationId === state.authorizationId
    && request.ownerDecisionId === state.ownerDecisionId
    && request.tenantId === state.tenantId
    && request.profileId === state.profileId
    && request.profileRevisionDigest === state.profileRevisionDigest
    && request.deviceCredentialId === state.deviceCredentialId
    && request.deviceFingerprint === state.deviceFingerprint
    && request.runIntentId === state.runIntentId
    && request.grantId === state.grant.grantId;
}

export function createBrokerApprovalSigningBoundary(input: {
  readonly store: BrokerApprovalStateStore;
  readonly signer: BrokerApprovalManagedSigner;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly minimumRevocationEpoch: number;
}) {
  if (!Number.isSafeInteger(input.minimumRevocationEpoch) || input.minimumRevocationEpoch < 0) {
    throw new Error('minimum revocation epoch is invalid');
  }
  return Object.freeze({
    async approve(rawRequest: unknown): Promise<SignedBrokerApprovalValue> {
      const request = BrokerApprovalRequest.parse(rawRequest);
      const state = BrokerApprovalDurableState.parse(await input.store.loadExactState(request));
      if (!sameRequest(request, state)) throw new Error('approval request differs from durable state');
      if (state.delegation.keyId !== input.signer.keyId) throw new Error('managed signer differs from release delegation');
      if (state.delegation.releaseId !== state.grant.releaseId) throw new Error('delegation release differs from grant');
      if (state.delegation.revocationEpoch < input.minimumRevocationEpoch) throw new Error('approval signer delegation is revoked');

      const { delegationDigest, ...delegationProjection } = state.delegation;
      const expectedDelegationDigest = await brokerApprovalSemanticDigest(
        'desktop-tools:broker-approval-signer-delegation:v1', delegationProjection,
      );
      if (delegationDigest !== expectedDelegationDigest) throw new Error('release delegation digest is invalid');

      const now = (input.now ?? (() => new Date()))();
      const nowMs = now.getTime();
      const delegationStart = Date.parse(state.delegation.notBefore);
      const delegationEnd = Date.parse(state.delegation.notAfter);
      const grantStart = Date.parse(state.grant.issuedAt);
      const grantEnd = Date.parse(state.grant.expiresAt);
      const reauthenticatedAt = Date.parse(state.ownerReauthenticatedAt);
      if (reauthenticatedAt > nowMs || nowMs - reauthenticatedAt > 5 * 60 * 1000) {
        throw new Error('owner reauthentication is not current');
      }
      if (nowMs < delegationStart || nowMs >= delegationEnd) throw new Error('approval signer delegation is outside its validity window');
      if (nowMs < grantStart || nowMs >= grantEnd) throw new Error('broker grant is outside its validity window');
      const expiresMs = Math.min(grantEnd, delegationEnd,
        nowMs + state.delegation.maximumApprovalLifetimeSeconds * 1000);
      if (expiresMs <= nowMs) throw new Error('broker approval has no valid lifetime');

      const approvalId = (input.randomId ?? (() => crypto.randomUUID()))();
      if (!id.safeParse(approvalId).success) throw new Error('approval identifier is invalid');
      const grantDigest = await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', state.grant);
      const unsigned = {
        schemaVersion: 1 as const,
        kind: 'desktop-tools-broker-approval' as const,
        signerKeyId: state.delegation.keyId,
        signatureDomain: state.delegation.signatureDomain,
        approvalId,
        authorizationId: state.authorizationId,
        ownerDecisionId: state.ownerDecisionId,
        ownerActorId: state.ownerActorId,
        tenantId: state.tenantId,
        profileId: state.profileId,
        profileRevisionDigest: state.profileRevisionDigest,
        deviceCredentialId: state.deviceCredentialId,
        deviceFingerprint: state.deviceFingerprint,
        runIntentId: state.runIntentId,
        grant: state.grant,
        grantDigest,
        delegationDigest: state.delegation.delegationDigest,
        revocationEpoch: state.delegation.revocationEpoch,
        approvedAt: now.toISOString(),
        expiresAt: new Date(expiresMs).toISOString(),
      };
      const message = brokerApprovalSigningBytes(unsigned);
      const consumed = await input.store.consumeApproval({ approvalId, authorizationId: state.authorizationId,
        ownerDecisionId: state.ownerDecisionId, runIntentId: state.runIntentId });
      if (!consumed) throw new Error('broker approval was already consumed');
      const signatureBytes = await input.signer.sign(message);
      if (!(signatureBytes instanceof Uint8Array) || signatureBytes.byteLength !== 64) {
        throw new Error('managed signer returned an invalid Ed25519 signature');
      }
      const auditDigest = await brokerApprovalAuditDigest(unsigned);
      return SignedBrokerApproval.parse({ ...unsigned,
        signature: base64url(signatureBytes), auditDigest });
    },
  });
}
