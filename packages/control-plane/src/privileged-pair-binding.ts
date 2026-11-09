import { z } from 'zod';
import { validateProfileDirectory } from '../../aid-core/src/profile-resolution.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);

export type PrivilegedPairOwnerAuthority = Readonly<{
  authenticationActor: string;
  ownerActorId: string;
}>;

/**
 * Resolve a privileged enrollment exclusively from immutable profile publication and server-owned
 * tenant ownership. Caller tenant and owner fields are deliberately absent from this interface.
 * The submitted profile ID and digest are exact lookup claims; returned authority is server data.
 */
export async function resolvePrivilegedPairBinding(input: Readonly<{
  requestedPermissions: readonly string[];
  machineFingerprint?: string;
  profileId?: string;
  profileRevisionDigest?: string;
  publicProfiles: unknown;
  resolveOwnerForTenant(tenantId: string): Promise<PrivilegedPairOwnerAuthority | null>;
}>) {
  if (!input.requestedPermissions.includes('authorize-privileged-run')) return null;
  const fingerprint = digest.safeParse(input.machineFingerprint);
  const profileId = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/).safeParse(input.profileId);
  const profileDigest = digest.safeParse(input.profileRevisionDigest);
  if (!fingerprint.success || !profileId.success || !profileDigest.success) {
    throw new Error('privileged_pair_authority_unavailable');
  }
  const profile = validateProfileDirectory(input.publicProfiles).find(candidate => candidate.id === profileId.data);
  if (!profile || !profile.enabled || profile.visibility !== 'public-bootstrap'
    || profile.digest !== profileDigest.data) throw new Error('privileged_pair_authority_unavailable');
  const owner = await input.resolveOwnerForTenant(profile.tenantId);
  if (!owner) throw new Error('privileged_pair_authority_unavailable');
  return Object.freeze({ tenantId: profile.tenantId, profileId: profile.id,
    profileRevision: profile.digest, profileRevisionDigest: profile.digest,
    machineFingerprint: fingerprint.data, ownerActor: owner.authenticationActor,
    ownerActorId: owner.ownerActorId });
}
