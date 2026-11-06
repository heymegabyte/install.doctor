import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

/**
 * One host-wide mutation owner contract shared by install/resume and rollback.
 * The operation-specific journals remain separate; this schema only fences
 * concurrent host mutation ownership without claiming either operation ran.
 */
export const HostMutationOwnerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: identifier,
  planDigest: digest,
  hostId: identifier,
  pid: z.number().int().positive(),
  bootId: z.string().min(1).max(256),
  processStart: z.string().min(1).max(256),
  token: z.string().uuid(),
  claimedAt: timestamp,
  heartbeatAt: timestamp,
  leaseUntil: timestamp,
});
export type HostMutationOwner = z.infer<typeof HostMutationOwnerSchema>;
