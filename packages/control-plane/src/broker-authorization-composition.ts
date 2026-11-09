import { z } from 'zod';
import { createBrokerApprovalD1Store } from './broker-approval-d1-store.ts';
import { createBrokerApprovalManagedSigner } from './broker-approval-managed-signer.ts';
import { createBrokerApprovalSigningBoundary } from './broker-approval-signer.ts';
import { createBrokerAuthorizationApi } from './broker-authorization-api.ts';
import {
  createBrokerAuthorizationService,
  type BrokerDevicePrincipal,
} from './broker-authorization-service.ts';
import { loadImmutableBrokerReleaseDelegation } from './broker-release-delegation-loader.ts';
import {
  createAuthoritativeBrokerRunIntentAdapter,
  type BrokerRunIntentAuthorityResolvers,
} from './broker-run-intent-authority.ts';
import { createBrokerRunIntentD1Store } from './broker-run-intent-d1-store.ts';
import type { AuthenticatedOwner } from './owner-approval.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const ActiveRelease = z.object({
  schemaVersion: z.literal(9), product: z.literal('desktop-tools'), channel: z.literal('stable'),
  releaseId: id, createdAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
  brokerApproval: z.unknown(),
}).passthrough();

type RunStoreDatabase = Parameters<typeof createBrokerRunIntentD1Store>[0];
type ApprovalStoreDatabase = Parameters<typeof createBrokerApprovalD1Store>[0];
type SignerService = Parameters<typeof createBrokerApprovalManagedSigner>[0]['service'];

export interface BrokerAuthorizationCompositionDependencies {
  readonly database: RunStoreDatabase & ApprovalStoreDatabase;
  readonly releaseBucket: unknown;
  readonly resolveActiveRelease: () => Promise<unknown>;
  readonly deviceAuthority: BrokerRunIntentAuthorityResolvers['device'];
  readonly publicProfileAuthority: BrokerRunIntentAuthorityResolvers['profile'];
  readonly planAuthority: BrokerRunIntentAuthorityResolvers['plan'];
  readonly tenantOwnerAuthority: BrokerRunIntentAuthorityResolvers['owner'];
  readonly resolveDevice: (request: Request) => Promise<BrokerDevicePrincipal | null>;
  readonly resolveFreshOwner: (request: Request) => Promise<AuthenticatedOwner | null>;
  readonly signerService: SignerService;
  readonly signerKeyId: string;
  readonly signerTimeoutMs?: number;
  readonly now?: () => Date;
  readonly randomApprovalId?: () => string;
}

function requiredFunction(value: unknown, name: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') throw new Error(`broker authorization composition requires ${name}`);
}

/**
 * Complete but deliberately unmounted broker authorization graph. No environment, global binding,
 * legacy credential, mutable release, or signer-policy fallback is consulted by this factory.
 */
export function createBrokerAuthorizationComposition(input: BrokerAuthorizationCompositionDependencies) {
  if (!input || typeof input !== 'object') throw new Error('broker authorization composition dependencies are required');
  requiredFunction(input.resolveActiveRelease, 'an active release resolver');
  requiredFunction(input.resolveDevice, 'a device resolver');
  requiredFunction(input.resolveFreshOwner, 'a fresh owner resolver');
  requiredFunction(input.deviceAuthority?.resolve, 'a device authority');
  requiredFunction(input.publicProfileAuthority?.resolve, 'a public profile authority');
  requiredFunction(input.planAuthority?.reconstruct, 'an exact plan authority');
  requiredFunction(input.tenantOwnerAuthority?.resolveForTenant, 'a tenant owner authority');
  if (!input.database || typeof input.database.prepare !== 'function') throw new Error('broker authorization composition requires D1');
  if (!input.releaseBucket || typeof (input.releaseBucket as { get?: unknown }).get !== 'function') {
    throw new Error('broker authorization composition requires an immutable release bucket');
  }
  if (!input.signerService || typeof input.signerService.fetch !== 'function') throw new Error('broker authorization composition requires a managed signer service');
  const signerKeyId = id.parse(input.signerKeyId);
  const now = input.now ?? (() => new Date());
  const runStore = createBrokerRunIntentD1Store(input.database, { now });
  const approvalStore = createBrokerApprovalD1Store(input.database, { now });
  const signer = createBrokerApprovalManagedSigner({ keyId: signerKeyId, service: input.signerService,
    ...(input.signerTimeoutMs === undefined ? {} : { timeoutMs: input.signerTimeoutMs }) });

  const activeRelease = async () => ActiveRelease.parse(await input.resolveActiveRelease());
  const releaseAuthority = async (expectedReleaseId: string) => {
    const release = await activeRelease();
    if (release.releaseId !== expectedReleaseId) return null;
    const authority = await loadImmutableBrokerReleaseDelegation({ bucket: input.releaseBucket, release, now: now() });
    if (authority.delegation.keyId !== signer.keyId) {
      throw new Error('managed signer key differs from immutable release delegation');
    }
    return authority;
  };

  const authority = createAuthoritativeBrokerRunIntentAdapter({ now, resolvers: {
    device: input.deviceAuthority,
    profile: input.publicProfileAuthority,
    plan: input.planAuthority,
    owner: input.tenantOwnerAuthority,
    runIntent: { load: runIntentId => runStore.loadRunIntent(runIntentId) },
    release: { async resolveActive(channel) {
      if (channel !== 'stable') throw new Error('only the immutable stable release is authoritative');
      const release = await activeRelease();
      return { product: release.product, channel: release.channel, releaseId: release.releaseId,
        notBefore: new Date(release.createdAt * 1000).toISOString(),
        expiresAt: new Date(release.expiresAt * 1000).toISOString() };
    } },
  } });

  const approval = Object.freeze({
    async delegationForRelease(releaseId: string) {
      return (await releaseAuthority(releaseId))?.delegation ?? null;
    },
    persistApprovedState(value: unknown) {
      return (approvalStore as typeof approvalStore & { persistApprovedState(value: unknown): Promise<boolean> })
        .persistApprovedState(value);
    },
    async approve(request: unknown) {
      const parsed = z.object({ grantId: id }).passthrough().parse(request);
      const state = await approvalStore.loadExactState(request as never) as { grant?: { releaseId?: unknown; grantId?: unknown } } | null;
      const releaseId = id.parse(state?.grant?.releaseId);
      if (state?.grant?.grantId !== parsed.grantId) throw new Error('approval state grant differs from request');
      const immutable = await releaseAuthority(releaseId);
      if (!immutable) throw new Error('approval release is not active');
      return createBrokerApprovalSigningBoundary({ store: approvalStore, signer,
        minimumRevocationEpoch: immutable.minimumRevocationEpoch, now,
        ...(input.randomApprovalId ? { randomId: input.randomApprovalId } : {}) }).approve(request);
    },
  });
  const service = createBrokerAuthorizationService({ store: runStore, authority, approval, now });
  const api = createBrokerAuthorizationApi({ service, resolveDevice: input.resolveDevice,
    resolveFreshOwner: input.resolveFreshOwner });
  return Object.freeze({ api, service, authority, approval, runStore, approvalStore });
}
