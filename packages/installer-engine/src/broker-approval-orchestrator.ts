import { SignedBrokerApproval } from '@install-doctor/aid-core/broker-approval-contracts';
import { z } from 'zod';
import {
  BrokerApprovalDeviceIdentitySchema,
  BrokerApprovalTargetBindingSchema,
  BrokerApprovalTargetStatusSchema,
  type BrokerApprovalTargetBinding,
} from './broker-approval-transport.js';
import { PrivilegedBrokerGrantSchema } from './privileged-broker-protocol.js';

export const BrokerApprovalPollPolicySchema = z.strictObject({
  timeoutMs: z.number().int().min(1_000).max(15 * 60_000).default(5 * 60_000),
  initialDelayMs: z.number().int().min(100).max(30_000).default(500),
  maximumDelayMs: z.number().int().min(100).max(30_000).default(5_000),
  backoffFactor: z.number().min(1).max(4).default(1.5),
}).superRefine((value, context) => {
  if (value.maximumDelayMs < value.initialDelayMs) {
    context.addIssue({ code: 'custom', path: ['maximumDelayMs'], message: 'maximum delay must not precede initial delay' });
  }
});

export const BrokerApprovalBootstrapBindingSchema = z.strictObject({
  profileId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  profileRevisionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  runIntentId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  authorizationId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
});

export interface BrokerApprovalOrchestrationTransport {
  identity(): Promise<unknown>;
  request(grant: unknown, binding: unknown): Promise<unknown>;
  status(grant: unknown, binding: unknown): Promise<unknown>;
  claim(grant: unknown, binding: unknown, locator: unknown): Promise<unknown>;
}

export interface BrokerApprovalOrchestrationOptions {
  readonly transport: BrokerApprovalOrchestrationTransport;
  readonly grant: unknown;
  readonly bootstrapBinding: unknown;
  readonly poll?: unknown;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function bindingFromAuthenticatedIdentity(identityValue: unknown, bootstrapValue: unknown): BrokerApprovalTargetBinding {
  const identity = BrokerApprovalDeviceIdentitySchema.parse(identityValue);
  const bootstrap = BrokerApprovalBootstrapBindingSchema.parse(bootstrapValue);
  if (identity.profileRevision !== bootstrap.profileRevisionDigest) {
    throw new Error('authenticated device profile revision differs from the signed bootstrap profile');
  }
  return BrokerApprovalTargetBindingSchema.parse({
    tenantId: identity.tenant,
    profileId: bootstrap.profileId,
    profileRevisionDigest: bootstrap.profileRevisionDigest,
    deviceCredentialId: identity.deviceId,
    deviceFingerprint: identity.machineFingerprint,
    runIntentId: bootstrap.runIntentId,
    authorizationId: bootstrap.authorizationId,
  });
}

/**
 * Requests and claims one exact privileged-run approval. All timing and transport
 * dependencies are injectable so the state machine can be tested without network access.
 */
export async function orchestrateBrokerApproval(options: BrokerApprovalOrchestrationOptions) {
  const grant = PrivilegedBrokerGrantSchema.parse(options.grant);
  const bootstrapBinding = BrokerApprovalBootstrapBindingSchema.parse(options.bootstrapBinding);
  const poll = BrokerApprovalPollPolicySchema.parse(options.poll ?? {});
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) throw new Error('broker approval clock is invalid');

  const binding = bindingFromAuthenticatedIdentity(await options.transport.identity(), bootstrapBinding);
  await options.transport.request(grant, binding);

  let delay = poll.initialDelayMs;
  while (true) {
    const beforePoll = now() - startedAt;
    if (!Number.isSafeInteger(beforePoll) || beforePoll < 0) throw new Error('broker approval clock moved backwards');
    if (beforePoll >= poll.timeoutMs) throw new Error('broker approval polling timed out');
    const status = BrokerApprovalTargetStatusSchema.parse(await options.transport.status(grant, binding));
    const elapsed = now() - startedAt;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) throw new Error('broker approval clock moved backwards');
    if (elapsed >= poll.timeoutMs) throw new Error('broker approval polling timed out');
    if (status.status === 'approved') {
      return SignedBrokerApproval.parse(await options.transport.claim(grant, binding, {
        ownerDecisionId: status.ownerDecisionId,
      }));
    }
    if (status.status === 'denied' || status.status === 'expired' || status.status === 'not-found') {
      throw new Error(`broker approval reached terminal status: ${status.status}`);
    }
    const remaining = poll.timeoutMs - elapsed;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(poll.maximumDelayMs, Math.ceil(delay * poll.backoffFactor));
  }
}
