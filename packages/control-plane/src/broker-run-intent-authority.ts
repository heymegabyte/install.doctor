import { z } from 'zod';
import type { BrokerDevicePrincipal } from './broker-authorization-service.ts';
import { BrokerRunIntent, type BrokerRunIntentValue } from './broker-run-intent-d1-store.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const operation = z.object({ taskId: id, operationId: id, phase: z.enum(['check', 'apply', 'verify']) }).strict();

export const AuthoritativeBrokerDevice = z.object({
  deviceCredentialId: id,
  deviceFingerprint: digest,
  tenantId: id,
  active: z.literal(true),
}).strict();

export const AuthoritativePublicProfile = z.object({
  profileId: id,
  tenantId: id,
  revision: id,
  digest,
  visibility: z.literal('public-bootstrap'),
  enabled: z.literal(true),
}).strict();

export const AuthoritativeDesktopRelease = z.object({
  product: z.literal('desktop-tools'),
  channel: z.literal('stable'),
  releaseId: id,
  notBefore: timestamp,
  expiresAt: timestamp,
}).strict();

/**
 * Fields that cannot be inferred from device, public-profile, or release-channel state. The
 * injected exact-plan resolver must independently reconstruct every field in this schema from
 * server-owned desired state and release artifacts. Echoing caller values is not authoritative.
 */
export const AuthoritativeBrokerPlanFacts = z.object({
  hostId: id,
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
}).strict();

export type AuthoritativeBrokerDeviceValue = z.infer<typeof AuthoritativeBrokerDevice>;
export type AuthoritativePublicProfileValue = z.infer<typeof AuthoritativePublicProfile>;
export type AuthoritativeDesktopReleaseValue = z.infer<typeof AuthoritativeDesktopRelease>;
export type AuthoritativeBrokerPlanFactsValue = z.infer<typeof AuthoritativeBrokerPlanFacts>;

export interface BrokerRunIntentAuthorityResolvers {
  readonly device: {
    resolve(deviceCredentialId: string): Promise<unknown>;
  };
  readonly profile: {
    resolve(profileId: string): Promise<unknown>;
  };
  readonly release: {
    resolveActive(channel: 'stable'): Promise<unknown>;
  };
  readonly plan: {
    reconstruct(input: Readonly<{
      request: BrokerRunIntentValue;
      device: AuthoritativeBrokerDeviceValue;
      profile: AuthoritativePublicProfileValue;
      release: AuthoritativeDesktopReleaseValue;
    }>): Promise<unknown>;
  };
  readonly owner: {
    resolveForTenant(tenantId: string): Promise<Readonly<{
      authenticationActor: string;
      ownerActorId: string;
    }> | null>;
  };
  readonly runIntent: {
    load(runIntentId: string): Promise<BrokerRunIntentValue | null>;
  };
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function planProjection(request: BrokerRunIntentValue): AuthoritativeBrokerPlanFactsValue {
  return AuthoritativeBrokerPlanFacts.parse({
    hostId: request.hostId, runId: request.runId, planDigest: request.planDigest,
    enrolledUid: request.enrolledUid, brokerExecutableDigest: request.brokerExecutableDigest,
    runtimeDigest: request.runtimeDigest, workerDigest: request.workerDigest,
    operations: request.operations, descriptorDigest: request.descriptorDigest,
    closureDigest: request.closureDigest, consentDigest: request.consentDigest,
  });
}

/**
 * Validates a caller intent against independent server-owned identity/profile/release/plan state.
 * Correlation identifiers (authorizationId, runIntentId, grantId) remain caller-generated opaque
 * identifiers; they carry no authority and become immutable only when the D1 store accepts them.
 */
export function createAuthoritativeBrokerRunIntentAdapter(input: Readonly<{
  resolvers: BrokerRunIntentAuthorityResolvers;
  now?: () => Date;
  maximumClockSkewMs?: number;
}>) {
  const now = input.now ?? (() => new Date());
  const maximumClockSkewMs = input.maximumClockSkewMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(maximumClockSkewMs) || maximumClockSkewMs < 0 || maximumClockSkewMs > 5 * 60 * 1000) {
    throw new Error('invalid broker authority clock skew');
  }
  return Object.freeze({
    async reconstructRunIntent(rawRequest: BrokerRunIntentValue, rawPrincipal: BrokerDevicePrincipal) {
      const request = BrokerRunIntent.parse(rawRequest);
      const principal = z.object({ deviceCredentialId: id, deviceFingerprint: digest, tenantId: id }).passthrough()
        .parse(rawPrincipal);
      const device = AuthoritativeBrokerDevice.parse(await input.resolvers.device.resolve(principal.deviceCredentialId));
      if (device.deviceCredentialId !== principal.deviceCredentialId
        || device.deviceFingerprint !== principal.deviceFingerprint || device.tenantId !== principal.tenantId
        || request.deviceCredentialId !== device.deviceCredentialId
        || request.deviceFingerprint !== device.deviceFingerprint || request.tenantId !== device.tenantId) return null;

      const profile = AuthoritativePublicProfile.parse(await input.resolvers.profile.resolve(request.profileId));
      // BrokerRunIntent intentionally carries the immutable profile digest, not the human-facing
      // revision label. The resolver proves that a canonical revision label exists for this public
      // record, but the request can only be cryptographically bound to its digest until the shared
      // contract adds a separate profileRevision field.
      if (profile.profileId !== request.profileId || profile.tenantId !== device.tenantId
        || profile.digest !== request.profileRevisionDigest) return null;

      const release = AuthoritativeDesktopRelease.parse(await input.resolvers.release.resolveActive('stable'));
      const current = now().getTime();
      if (release.releaseId !== request.releaseId || current < Date.parse(release.notBefore)
        || current >= Date.parse(release.expiresAt)) return null;
      const requestedAt = Date.parse(request.requestedAt);
      const grantExpiresAt = Date.parse(request.grantExpiresAt);
      if (requestedAt > current + maximumClockSkewMs || grantExpiresAt <= current
        || grantExpiresAt - requestedAt > 30 * 60 * 1000) return null;

      const owner = await input.resolvers.owner.resolveForTenant(device.tenantId);
      if (!owner || !id.safeParse(owner.ownerActorId).success
        || typeof owner.authenticationActor !== 'string' || owner.authenticationActor.length < 3) return null;

      const facts = AuthoritativeBrokerPlanFacts.parse(await input.resolvers.plan.reconstruct({
        request, device, profile, release,
      }));
      if (!exact(facts, planProjection(request))) return null;
      return request;
    },

    loadRunIntent(runIntentId: string) {
      return input.resolvers.runIntent.load(id.parse(runIntentId));
    },

    async ownerForTenant(tenantId: string) {
      const canonicalTenant = id.parse(tenantId);
      const owner = await input.resolvers.owner.resolveForTenant(canonicalTenant);
      if (!owner || !id.safeParse(owner.ownerActorId).success
        || typeof owner.authenticationActor !== 'string' || owner.authenticationActor.length < 3) return null;
      return Object.freeze({ authenticationActor: owner.authenticationActor, ownerActorId: owner.ownerActorId });
    },
  });
}
