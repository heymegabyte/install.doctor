import { z } from 'zod';
import { validateProfileDirectory } from '../../aid-core/src/profile-resolution.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const authenticationActor = z.string().min(3).max(256).regex(/^better-auth-user:[A-Za-z0-9._~-]+$/);

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};
type D1Database = { prepare(sql: string): D1Statement };

type DeviceRow = {
  device_id: string;
  tenant: string;
  machine_fingerprint: string | null;
  profile_id: string | null;
  profile_revision_digest: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};
type OwnerRow = {
  tenant_id: string;
  owner_actor_id: string;
  better_auth_user_id: string;
  authentication_actor: string;
  status: string;
  revoked_at: string | null;
};

/**
 * D1-backed authority adapters for the production broker composition. They intentionally do not
 * create or mutate authority: enrollment/profile publication and tenant ownership must be handled
 * by separately authenticated administrative workflows.
 */
export function createBrokerProductionAuthorities(input: Readonly<{
  database: D1Database;
  publicProfiles: unknown;
  now?: () => Date;
}>) {
  if (!input.database || typeof input.database.prepare !== 'function') throw new Error('broker authorities require D1');
  const profiles = validateProfileDirectory(input.publicProfiles);
  const profilesById = new Map(profiles.map(profile => [profile.id, profile] as const));
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    device: Object.freeze({
      async resolve(deviceCredentialId: string) {
        const deviceId = id.parse(deviceCredentialId);
        const row = await input.database.prepare(`
          SELECT device_id, tenant, machine_fingerprint, profile_id, profile_revision_digest,
                 revoked_at, expires_at
            FROM devices
           WHERE device_id = ?
        `).bind(deviceId).first<DeviceRow>();
        if (!row || row.revoked_at !== null || (row.expires_at !== null && Date.parse(row.expires_at) <= now().getTime())) return null;
        if (!digest.safeParse(row.machine_fingerprint).success
          || !id.safeParse(row.profile_id).success
          || !digest.safeParse(row.profile_revision_digest).success) return null;
        return Object.freeze({
          deviceCredentialId: row.device_id,
          deviceFingerprint: row.machine_fingerprint,
          tenantId: row.tenant,
          profileId: row.profile_id,
          profileRevisionDigest: row.profile_revision_digest,
          active: true as const,
        });
      },
    }),

    profile: Object.freeze({
      async resolve(profileId: string) {
        const profile = profilesById.get(id.parse(profileId));
        if (!profile || !profile.enabled || profile.visibility !== 'public-bootstrap') return null;
        return Object.freeze({ profileId: profile.id, tenantId: profile.tenantId, revision: profile.revision,
          digest: profile.digest, visibility: profile.visibility, enabled: true as const });
      },
    }),

    owner: Object.freeze({
      async resolveForTenant(tenantId: string) {
        const tenant = id.parse(tenantId);
        const row = await input.database.prepare(`
          SELECT tenant_id, owner_actor_id, better_auth_user_id, authentication_actor, status, revoked_at
            FROM tenant_owner_authority
           WHERE tenant_id = ? AND status = 'active' AND revoked_at IS NULL
        `).bind(tenant).first<OwnerRow>();
        if (!row || row.status !== 'active' || row.revoked_at !== null
          || !id.safeParse(row.owner_actor_id).success
          || !authenticationActor.safeParse(row.authentication_actor).success
          || row.authentication_actor !== `better-auth-user:${row.better_auth_user_id}`) return null;
        return Object.freeze({ authenticationActor: row.authentication_actor, ownerActorId: row.owner_actor_id });
      },
    }),
  });
}

/** Project a Better Auth session into the stable actor used by tenant authority. */
export function authenticatedOwnerFromBetterAuthSession(raw: unknown) {
  const parsed = z.object({
    user: z.object({ id: z.string().min(1).max(200).regex(/^[A-Za-z0-9._~-]+$/) }).passthrough(),
    session: z.object({ createdAt: z.union([timestamp, z.date()]) }).passthrough(),
  }).passthrough().safeParse(raw);
  if (!parsed.success) return null;
  const authenticatedAt = parsed.data.session.createdAt instanceof Date
    ? parsed.data.session.createdAt.toISOString() : parsed.data.session.createdAt;
  return Object.freeze({ actor: `better-auth-user:${parsed.data.user.id}`, authenticatedAt });
}
