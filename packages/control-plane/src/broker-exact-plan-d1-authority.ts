import { z } from 'zod';
import {
  AuthoritativeBrokerPlanFacts,
  type AuthoritativeBrokerDeviceValue,
  type AuthoritativeBrokerPlanFactsValue,
  type AuthoritativeDesktopReleaseValue,
  type AuthoritativePublicProfileValue,
} from './broker-run-intent-authority.ts';
import type { BrokerRunIntentValue } from './broker-run-intent-d1-store.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const BrokerExactPlanAuthorityRecord = z.object({
  schemaVersion: z.literal(1),
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  releaseId: id,
  facts: AuthoritativeBrokerPlanFacts,
  compilerId: id,
  compilerDigest: digest,
  compiledAt: timestamp,
  expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.compiledAt)) {
    context.addIssue({ code: 'custom', message: 'exact plan authority lifetime must be positive' });
  }
});

export type BrokerExactPlanAuthorityRecordValue = z.infer<typeof BrokerExactPlanAuthorityRecord>;

type D1Result = { meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1Database = { prepare(sql: string): D1Statement };

type PlanRow = {
  run_id: string;
  tenant_id: string;
  profile_id: string;
  profile_revision_digest: string;
  device_credential_id: string;
  device_fingerprint: string;
  release_id: string;
  host_id: string;
  plan_digest: string;
  enrolled_uid: number;
  broker_executable_digest: string;
  runtime_digest: string;
  worker_digest: string;
  operations_json: string;
  descriptor_digest: string;
  closure_digest: string;
  consent_digest: string;
  compiler_id: string;
  compiler_digest: string;
  compiled_at: string;
  expires_at: string;
};

const INSERT = `INSERT OR IGNORE INTO broker_exact_plan_authority (
  run_id, tenant_id, profile_id, profile_revision_digest, device_credential_id,
  device_fingerprint, release_id, host_id, plan_digest, enrolled_uid,
  broker_executable_digest, runtime_digest, worker_digest, operations_json,
  descriptor_digest, closure_digest, consent_digest, compiler_id, compiler_digest,
  compiled_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const LOAD = `SELECT * FROM broker_exact_plan_authority
 WHERE tenant_id = ? AND profile_id = ? AND profile_revision_digest = ?
   AND device_credential_id = ? AND device_fingerprint = ?
   AND release_id = ? AND run_id = ? LIMIT 1`;

function factsFromRow(row: PlanRow): AuthoritativeBrokerPlanFactsValue {
  return AuthoritativeBrokerPlanFacts.parse({
    hostId: row.host_id,
    runId: row.run_id,
    planDigest: row.plan_digest,
    enrolledUid: row.enrolled_uid,
    brokerExecutableDigest: row.broker_executable_digest,
    runtimeDigest: row.runtime_digest,
    workerDigest: row.worker_digest,
    operations: JSON.parse(row.operations_json),
    descriptorDigest: row.descriptor_digest,
    closureDigest: row.closure_digest,
    consentDigest: row.consent_digest,
  });
}

function recordFromRow(row: PlanRow): BrokerExactPlanAuthorityRecordValue {
  return BrokerExactPlanAuthorityRecord.parse({
    schemaVersion: 1,
    tenantId: row.tenant_id,
    profileId: row.profile_id,
    profileRevisionDigest: row.profile_revision_digest,
    deviceCredentialId: row.device_credential_id,
    deviceFingerprint: row.device_fingerprint,
    releaseId: row.release_id,
    facts: factsFromRow(row),
    compilerId: row.compiler_id,
    compilerDigest: row.compiler_digest,
    compiledAt: row.compiled_at,
    expiresAt: row.expires_at,
  });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Append-only exact-plan authority. `admit` is intentionally not exposed through an HTTP API;
 * only a trusted server-side plan compiler may call it. Device requests can merely resolve an
 * existing record under independently established identity/profile/release bindings.
 */
export function createBrokerExactPlanD1Authority(database: D1Database, input: Readonly<{
  expectedCompiler: Readonly<{ compilerId: string; compilerDigest: string }>;
  now?: () => Date;
  maximumAuthorityLifetimeMs?: number;
  maximumClockSkewMs?: number;
}>) {
  const expectedCompiler = z.object({ compilerId: id, compilerDigest: digest }).strict().parse(input.expectedCompiler);
  const now = input.now ?? (() => new Date());
  const maximumAuthorityLifetimeMs = input.maximumAuthorityLifetimeMs ?? 30 * 60 * 1000;
  const maximumClockSkewMs = input.maximumClockSkewMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(maximumAuthorityLifetimeMs) || maximumAuthorityLifetimeMs <= 0
    || maximumAuthorityLifetimeMs > 24 * 60 * 60 * 1000) {
    throw new Error('invalid exact plan authority maximum lifetime');
  }
  if (!Number.isSafeInteger(maximumClockSkewMs) || maximumClockSkewMs < 0 || maximumClockSkewMs > 5 * 60 * 1000) {
    throw new Error('invalid exact plan authority clock skew');
  }

  const loadBound = async (binding: Readonly<{
    tenantId: string;
    profileId: string;
    profileRevisionDigest: string;
    deviceCredentialId: string;
    deviceFingerprint: string;
    releaseId: string;
    runId: string;
  }>) => database.prepare(LOAD).bind(
    binding.tenantId, binding.profileId, binding.profileRevisionDigest,
    binding.deviceCredentialId, binding.deviceFingerprint, binding.releaseId, binding.runId,
  ).first<PlanRow>();

  return Object.freeze({
    async admit(raw: unknown): Promise<boolean> {
      const value = BrokerExactPlanAuthorityRecord.parse(raw);
      if (value.compilerId !== expectedCompiler.compilerId
        || value.compilerDigest !== expectedCompiler.compilerDigest) {
        throw new Error('exact plan authority compiler differs from configured authority');
      }
      if (Date.parse(value.expiresAt) - Date.parse(value.compiledAt) > maximumAuthorityLifetimeMs) {
        throw new Error('exact plan authority lifetime exceeds policy');
      }
      const current = now().getTime();
      if (Date.parse(value.compiledAt) > current + maximumClockSkewMs) {
        throw new Error('exact plan authority compilation time is in the future');
      }
      if (Date.parse(value.expiresAt) <= current) throw new Error('exact plan authority is already expired');
      const facts = value.facts;
      const result = await database.prepare(INSERT).bind(
        facts.runId, value.tenantId, value.profileId, value.profileRevisionDigest,
        value.deviceCredentialId, value.deviceFingerprint, value.releaseId, facts.hostId,
        facts.planDigest, facts.enrolledUid, facts.brokerExecutableDigest, facts.runtimeDigest,
        facts.workerDigest, JSON.stringify(facts.operations), facts.descriptorDigest,
        facts.closureDigest, facts.consentDigest, value.compilerId, value.compilerDigest,
        value.compiledAt, value.expiresAt,
      ).run();
      if ((result.meta?.changes ?? 0) > 0) return true;
      const row = await loadBound({ ...value, runId: facts.runId });
      if (!row || !same(recordFromRow(row), value)) throw new Error('exact plan authority identifier collision');
      return false;
    },

    async reconstruct(context: Readonly<{
      request: BrokerRunIntentValue;
      device: AuthoritativeBrokerDeviceValue;
      profile: AuthoritativePublicProfileValue;
      release: AuthoritativeDesktopReleaseValue;
    }>): Promise<AuthoritativeBrokerPlanFactsValue | null> {
      const row = await loadBound({
        tenantId: context.device.tenantId,
        profileId: context.profile.profileId,
        profileRevisionDigest: context.profile.digest,
        deviceCredentialId: context.device.deviceCredentialId,
        deviceFingerprint: context.device.deviceFingerprint,
        releaseId: context.release.releaseId,
        // runId is a correlation locator only. Every authoritative fact returned below comes from
        // the immutable row and must still match the complete caller projection upstream.
        runId: id.parse(context.request.runId),
      });
      if (!row || Date.parse(row.compiled_at) > now().getTime() || Date.parse(row.expires_at) <= now().getTime()) return null;
      return factsFromRow(row);
    },
  });
}
