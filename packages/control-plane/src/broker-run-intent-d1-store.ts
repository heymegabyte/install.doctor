import { z } from 'zod';
import { BrokerApprovalGrant } from './broker-approval-signer.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const MAX_GRANT_LIFETIME_MS = 30 * 60 * 1000;
const MAX_OWNER_REAUTH_AGE_MS = 5 * 60 * 1000;
const MAX_DECISION_LIFETIME_MS = 10 * 60 * 1000;

const operation = z.object({
  taskId: id,
  operationId: id,
  phase: z.enum(['check', 'apply', 'verify']),
}).strict();

export const BrokerRunIntent = z.object({
  schemaVersion: z.literal(1),
  runIntentId: id,
  authorizationId: id,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  grantId: id,
  hostId: id,
  releaseId: id,
  runId: id,
  planDigest: digest,
  enrolledUid: z.number().int().nonnegative(),
  brokerExecutableDigest: digest,
  runtimeDigest: digest,
  workerDigest: digest,
  operations: z.array(operation).min(1).max(256),
  descriptorDigest: digest,
  closureDigest: digest,
  consentDigest: digest,
  requestedAt: timestamp,
  grantExpiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (new Set(value.operations.map(entry => entry.operationId)).size !== value.operations.length) {
    context.addIssue({ code: 'custom', message: 'run intent contains duplicate operation identifiers' });
  }
  const lifetime = Date.parse(value.grantExpiresAt) - Date.parse(value.requestedAt);
  if (lifetime <= 0 || lifetime > MAX_GRANT_LIFETIME_MS) {
    context.addIssue({ code: 'custom', message: 'run intent grant lifetime must be positive and no longer than thirty minutes' });
  }
});

export const BrokerOwnerDecision = z.object({
  schemaVersion: z.literal(1),
  ownerDecisionId: id,
  runIntentId: id,
  authorizationId: id,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  approvedPlanDigest: digest,
  consentDigest: digest,
  ownerActorId: id,
  decision: z.enum(['approved', 'denied']),
  ownerReauthenticatedAt: timestamp,
  decidedAt: timestamp,
  expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  const reauthenticatedAt = Date.parse(value.ownerReauthenticatedAt);
  const decidedAt = Date.parse(value.decidedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (reauthenticatedAt > decidedAt || decidedAt - reauthenticatedAt > MAX_OWNER_REAUTH_AGE_MS) {
    context.addIssue({ code: 'custom', message: 'owner decision requires current reauthentication' });
  }
  if (expiresAt <= decidedAt || expiresAt - decidedAt > MAX_DECISION_LIFETIME_MS) {
    context.addIssue({ code: 'custom', message: 'owner decision lifetime must be positive and no longer than ten minutes' });
  }
});

export const BrokerRunApprovalLookup = z.object({
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

export const BrokerAuthorizationStatusLookup = z.object({
  schemaVersion: z.literal(1),
  authorizationId: id,
  runIntentId: id,
  grantId: id,
  tenantId: id,
  deviceCredentialId: id,
  deviceFingerprint: digest,
}).strict();

export const BrokerAuthorizationStatus = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal(1), status: z.literal('not-found') }).strict(),
  z.object({ schemaVersion: z.literal(1), status: z.literal('pending') }).strict(),
  z.object({ schemaVersion: z.literal(1), status: z.literal('denied') }).strict(),
  z.object({ schemaVersion: z.literal(1), status: z.literal('expired') }).strict(),
  z.object({ schemaVersion: z.literal(1), status: z.literal('approved'), ownerDecisionId: id }).strict(),
]);

export const BrokerApprovalReconstruction = z.object({
  schemaVersion: z.literal(1),
  authorizationId: id,
  ownerDecisionId: id,
  ownerActorId: id,
  ownerDecision: z.literal('approved'),
  ownerReauthenticatedAt: timestamp,
  ownerDecidedAt: timestamp,
  ownerDecisionExpiresAt: timestamp,
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  runIntentId: id,
  status: z.literal('approved'),
  grant: BrokerApprovalGrant,
}).strict();

export type BrokerRunIntentValue = z.infer<typeof BrokerRunIntent>;
export type BrokerOwnerDecisionValue = z.infer<typeof BrokerOwnerDecision>;
export type BrokerRunApprovalLookupValue = z.infer<typeof BrokerRunApprovalLookup>;
export type BrokerAuthorizationStatusLookupValue = z.infer<typeof BrokerAuthorizationStatusLookup>;
export type BrokerAuthorizationStatusValue = z.infer<typeof BrokerAuthorizationStatus>;
export type BrokerApprovalReconstructionValue = z.infer<typeof BrokerApprovalReconstruction>;

type D1Result = { readonly meta?: { readonly changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1DatabaseLike = { prepare(sql: string): D1Statement };

type RunIntentRow = {
  run_intent_id: string; authorization_id: string; tenant_id: string; profile_id: string;
  profile_revision_digest: string; device_credential_id: string; device_fingerprint: string;
  grant_id: string; host_id: string; release_id: string; run_id: string; plan_digest: string;
  enrolled_uid: number; broker_executable_digest: string; runtime_digest: string;
  worker_digest: string; operations_json: string; descriptor_digest: string;
  closure_digest: string; consent_digest: string; requested_at: string; grant_expires_at: string;
};

type ReconstructionRow = RunIntentRow & {
  owner_decision_id: string; owner_actor_id: string; decision: string;
  owner_reauthenticated_at: string; decided_at: string; decision_expires_at: string;
  approved_plan_digest: string;
};

type StatusRow = {
  grant_expires_at: string;
  owner_decision_id: string | null;
  decision: string | null;
  decided_at: string | null;
  decision_expires_at: string | null;
};

const INSERT_RUN_INTENT = `INSERT OR IGNORE INTO broker_run_intents (
  run_intent_id, authorization_id, tenant_id, profile_id, profile_revision_digest,
  device_credential_id, device_fingerprint, grant_id, host_id, release_id, run_id,
  plan_digest, enrolled_uid, broker_executable_digest, runtime_digest, worker_digest,
  operations_json, descriptor_digest, closure_digest, consent_digest, requested_at,
  grant_expires_at, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_OWNER_DECISION = `INSERT OR IGNORE INTO broker_owner_decisions (
  owner_decision_id, run_intent_id, authorization_id, tenant_id, profile_id,
  profile_revision_digest, device_credential_id, device_fingerprint, approved_plan_digest,
  consent_digest, owner_actor_id, decision, owner_reauthenticated_at, decided_at,
  expires_at, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const LOAD_RUN_INTENT_BY_ID = `SELECT * FROM broker_run_intents WHERE run_intent_id = ? LIMIT 1`;
const LOAD_OWNER_DECISION_BY_ID = `SELECT * FROM broker_owner_decisions WHERE owner_decision_id = ? LIMIT 1`;

const LOAD_APPROVED_RECONSTRUCTION = `
SELECT i.*, d.owner_decision_id, d.owner_actor_id, d.decision,
       d.owner_reauthenticated_at, d.decided_at, d.expires_at AS decision_expires_at,
       d.approved_plan_digest
  FROM broker_run_intents i
  JOIN broker_owner_decisions d ON d.run_intent_id = i.run_intent_id
   AND d.authorization_id = i.authorization_id
   AND d.tenant_id = i.tenant_id AND d.profile_id = i.profile_id
   AND d.profile_revision_digest = i.profile_revision_digest
   AND d.device_credential_id = i.device_credential_id
   AND d.device_fingerprint = i.device_fingerprint
   AND d.approved_plan_digest = i.plan_digest
   AND d.consent_digest = i.consent_digest
 WHERE i.authorization_id = ? AND d.owner_decision_id = ?
   AND i.tenant_id = ? AND i.profile_id = ? AND i.profile_revision_digest = ?
   AND i.device_credential_id = ? AND i.device_fingerprint = ?
   AND i.run_intent_id = ? AND i.grant_id = ? AND d.decision = 'approved'
 LIMIT 1`;

const LOAD_AUTHORIZATION_STATUS = `
SELECT i.grant_expires_at, d.owner_decision_id, d.decision, d.decided_at,
       d.expires_at AS decision_expires_at
  FROM broker_run_intents i
  LEFT JOIN broker_owner_decisions d ON d.run_intent_id = i.run_intent_id
   AND d.authorization_id = i.authorization_id
   AND d.tenant_id = i.tenant_id
   AND d.profile_id = i.profile_id
   AND d.profile_revision_digest = i.profile_revision_digest
   AND d.device_credential_id = i.device_credential_id
   AND d.device_fingerprint = i.device_fingerprint
   AND d.approved_plan_digest = i.plan_digest
   AND d.consent_digest = i.consent_digest
 WHERE i.authorization_id = ? AND i.run_intent_id = ? AND i.grant_id = ?
   AND i.tenant_id = ? AND i.device_credential_id = ? AND i.device_fingerprint = ?
 LIMIT 1`;

function rowToRunIntent(row: RunIntentRow): BrokerRunIntentValue {
  return BrokerRunIntent.parse({
    schemaVersion: 1, runIntentId: row.run_intent_id, authorizationId: row.authorization_id,
    tenantId: row.tenant_id, profileId: row.profile_id,
    profileRevisionDigest: row.profile_revision_digest,
    deviceCredentialId: row.device_credential_id, deviceFingerprint: row.device_fingerprint,
    grantId: row.grant_id, hostId: row.host_id, releaseId: row.release_id, runId: row.run_id,
    planDigest: row.plan_digest, enrolledUid: row.enrolled_uid,
    brokerExecutableDigest: row.broker_executable_digest, runtimeDigest: row.runtime_digest,
    workerDigest: row.worker_digest, operations: JSON.parse(row.operations_json),
    descriptorDigest: row.descriptor_digest, closureDigest: row.closure_digest,
    consentDigest: row.consent_digest, requestedAt: row.requested_at,
    grantExpiresAt: row.grant_expires_at,
  });
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Append-only reconstruction facts. No method accepts a complete broker grant as input.
 * The authenticated API boundary must validate these facts against authoritative device,
 * immutable profile/release, and exact-plan state before calling either persistence method.
 */
export function createBrokerRunIntentD1Store(
  db: D1DatabaseLike,
  options: { readonly now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async persistRunIntent(raw: unknown): Promise<boolean> {
      const value = BrokerRunIntent.parse(raw);
      const result = await db.prepare(INSERT_RUN_INTENT).bind(
        value.runIntentId, value.authorizationId, value.tenantId, value.profileId,
        value.profileRevisionDigest, value.deviceCredentialId, value.deviceFingerprint,
        value.grantId, value.hostId, value.releaseId, value.runId, value.planDigest,
        value.enrolledUid, value.brokerExecutableDigest, value.runtimeDigest, value.workerDigest,
        JSON.stringify(value.operations), value.descriptorDigest, value.closureDigest,
        value.consentDigest, value.requestedAt, value.grantExpiresAt, now().toISOString(),
      ).run();
      if (result.meta?.changes === 1) return true;
      const row = await db.prepare(LOAD_RUN_INTENT_BY_ID).bind(value.runIntentId).first<RunIntentRow>();
      if (!row || !exactJson(rowToRunIntent(row), value)) {
        throw new Error('broker run intent identifier collision');
      }
      return false;
    },

    async persistOwnerDecision(raw: unknown): Promise<boolean> {
      const value = BrokerOwnerDecision.parse(raw);
      const result = await db.prepare(INSERT_OWNER_DECISION).bind(
        value.ownerDecisionId, value.runIntentId, value.authorizationId, value.tenantId,
        value.profileId, value.profileRevisionDigest, value.deviceCredentialId,
        value.deviceFingerprint, value.approvedPlanDigest, value.consentDigest,
        value.ownerActorId, value.decision, value.ownerReauthenticatedAt, value.decidedAt,
        value.expiresAt, now().toISOString(),
      ).run();
      if (result.meta?.changes === 1) return true;
      const row = await db.prepare(LOAD_OWNER_DECISION_BY_ID).bind(value.ownerDecisionId)
        .first<Record<string, unknown>>();
      const existing = row ? BrokerOwnerDecision.parse({
        schemaVersion: 1, ownerDecisionId: row.owner_decision_id,
        runIntentId: row.run_intent_id, authorizationId: row.authorization_id,
        tenantId: row.tenant_id, profileId: row.profile_id,
        profileRevisionDigest: row.profile_revision_digest,
        deviceCredentialId: row.device_credential_id, deviceFingerprint: row.device_fingerprint,
        approvedPlanDigest: row.approved_plan_digest, consentDigest: row.consent_digest,
        ownerActorId: row.owner_actor_id, decision: row.decision,
        ownerReauthenticatedAt: row.owner_reauthenticated_at, decidedAt: row.decided_at,
        expiresAt: row.expires_at,
      }) : null;
      if (!existing || !exactJson(existing, value)) {
        throw new Error('broker owner decision identifier collision');
      }
      return false;
    },

    async loadAuthorizationStatus(rawLookup: unknown): Promise<BrokerAuthorizationStatusValue> {
      const lookup = BrokerAuthorizationStatusLookup.parse(rawLookup);
      const row = await db.prepare(LOAD_AUTHORIZATION_STATUS).bind(
        lookup.authorizationId, lookup.runIntentId, lookup.grantId, lookup.tenantId,
        lookup.deviceCredentialId, lookup.deviceFingerprint,
      ).first<StatusRow>();
      if (!row) return { schemaVersion: 1, status: 'not-found' };
      const current = now().getTime();
      if (current >= Date.parse(row.grant_expires_at)) return { schemaVersion: 1, status: 'expired' };
      if (!row.owner_decision_id) return { schemaVersion: 1, status: 'pending' };
      if (row.decision === 'denied') return { schemaVersion: 1, status: 'denied' };
      if (row.decision !== 'approved' || !row.decided_at || !row.decision_expires_at
        || current < Date.parse(row.decided_at) || current >= Date.parse(row.decision_expires_at)) {
        return { schemaVersion: 1, status: 'expired' };
      }
      return BrokerAuthorizationStatus.parse({ schemaVersion: 1, status: 'approved',
        ownerDecisionId: row.owner_decision_id });
    },

    async loadApprovedReconstruction(rawLookup: unknown): Promise<BrokerApprovalReconstructionValue | null> {
      const lookup = BrokerRunApprovalLookup.parse(rawLookup);
      const row = await db.prepare(LOAD_APPROVED_RECONSTRUCTION).bind(
        lookup.authorizationId, lookup.ownerDecisionId, lookup.tenantId, lookup.profileId,
        lookup.profileRevisionDigest, lookup.deviceCredentialId, lookup.deviceFingerprint,
        lookup.runIntentId, lookup.grantId,
      ).first<ReconstructionRow>();
      if (!row) return null;
      const current = now().getTime();
      if (current < Date.parse(row.decided_at)
        || current >= Date.parse(row.decision_expires_at)
        || current >= Date.parse(row.grant_expires_at)
        || current - Date.parse(row.owner_reauthenticated_at) > MAX_OWNER_REAUTH_AGE_MS) return null;
      return BrokerApprovalReconstruction.parse({
        schemaVersion: 1, authorizationId: row.authorization_id,
        ownerDecisionId: row.owner_decision_id, ownerActorId: row.owner_actor_id,
        ownerDecision: 'approved', ownerReauthenticatedAt: row.owner_reauthenticated_at,
        ownerDecidedAt: row.decided_at, ownerDecisionExpiresAt: row.decision_expires_at,
        tenantId: row.tenant_id, profileId: row.profile_id,
        profileRevisionDigest: row.profile_revision_digest,
        deviceCredentialId: row.device_credential_id, deviceFingerprint: row.device_fingerprint,
        runIntentId: row.run_intent_id, status: 'approved',
        grant: {
          schemaVersion: 1, grantId: row.grant_id, hostId: row.host_id,
          releaseId: row.release_id, runId: row.run_id, planDigest: row.plan_digest,
          approvedPlanDigest: row.approved_plan_digest, enrolledUid: row.enrolled_uid,
          brokerExecutableDigest: row.broker_executable_digest, runtimeDigest: row.runtime_digest,
          workerDigest: row.worker_digest, operations: JSON.parse(row.operations_json),
          descriptorDigest: row.descriptor_digest, closureDigest: row.closure_digest,
          consentDigest: row.consent_digest, issuedAt: row.requested_at,
          expiresAt: row.grant_expires_at,
        },
      });
    },
  });
}
