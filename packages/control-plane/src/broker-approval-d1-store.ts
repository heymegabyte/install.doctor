import type {
  BrokerApprovalRequestValue,
  BrokerApprovalStateStore,
} from './broker-approval-signer.ts';

type D1Result = { readonly meta?: { readonly changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1DatabaseLike = { prepare(sql: string): D1Statement };

type ApprovalStateRow = {
  authorization_id: string;
  owner_decision_id: string;
  owner_actor_id: string;
  owner_decision: string;
  owner_reauthenticated_at: string;
  tenant_id: string;
  profile_id: string;
  profile_revision_digest: string;
  device_credential_id: string;
  device_fingerprint: string;
  run_intent_id: string;
  status: string;
  grant_json: string;
  delegation_json: string;
};

const LOAD_EXACT_STATE = `
SELECT authorization_id, owner_decision_id, owner_actor_id, owner_decision,
       owner_reauthenticated_at, tenant_id, profile_id, profile_revision_digest,
       device_credential_id, device_fingerprint, run_intent_id, status,
       grant_json, delegation_json
  FROM broker_approval_states
 WHERE authorization_id = ? AND owner_decision_id = ?
   AND tenant_id = ? AND profile_id = ? AND profile_revision_digest = ?
   AND device_credential_id = ? AND device_fingerprint = ?
   AND run_intent_id = ? AND grant_id = ?
   AND owner_decision = 'approved' AND status = 'approved'
 LIMIT 1`;

const CONSUME_EXACT_APPROVAL = `
INSERT OR IGNORE INTO broker_approval_consumptions
       (approval_id, authorization_id, owner_decision_id, run_intent_id, consumed_at)
SELECT ?, authorization_id, owner_decision_id, run_intent_id, ?
  FROM broker_approval_states
 WHERE authorization_id = ? AND owner_decision_id = ? AND run_intent_id = ?
   AND owner_decision = 'approved' AND status = 'approved'`;

/** D1 adapter whose reads and one-use mutation are both bound to exact durable authority. */
export function createBrokerApprovalD1Store(
  db: D1DatabaseLike,
  options: { readonly now?: () => Date } = {},
): BrokerApprovalStateStore {
  return Object.freeze({
    async loadExactState(request: BrokerApprovalRequestValue): Promise<unknown> {
      const row = await db.prepare(LOAD_EXACT_STATE).bind(
        request.authorizationId,
        request.ownerDecisionId,
        request.tenantId,
        request.profileId,
        request.profileRevisionDigest,
        request.deviceCredentialId,
        request.deviceFingerprint,
        request.runIntentId,
        request.grantId,
      ).first<ApprovalStateRow>();
      if (!row) return null;
      return {
        schemaVersion: 1,
        authorizationId: row.authorization_id,
        ownerDecisionId: row.owner_decision_id,
        ownerActorId: row.owner_actor_id,
        ownerDecision: row.owner_decision,
        ownerReauthenticatedAt: row.owner_reauthenticated_at,
        tenantId: row.tenant_id,
        profileId: row.profile_id,
        profileRevisionDigest: row.profile_revision_digest,
        deviceCredentialId: row.device_credential_id,
        deviceFingerprint: row.device_fingerprint,
        runIntentId: row.run_intent_id,
        status: row.status,
        grant: JSON.parse(row.grant_json),
        delegation: JSON.parse(row.delegation_json),
      };
    },

    async consumeApproval(input: { readonly approvalId: string; readonly authorizationId: string;
      readonly ownerDecisionId: string; readonly runIntentId: string }): Promise<boolean> {
      const consumedAt = (options.now ?? (() => new Date()))().toISOString();
      const result = await db.prepare(CONSUME_EXACT_APPROVAL).bind(
        input.approvalId,
        consumedAt,
        input.authorizationId,
        input.ownerDecisionId,
        input.runIntentId,
      ).run();
      return result.meta?.changes === 1;
    },
  });
}
