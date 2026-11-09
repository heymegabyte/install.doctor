import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SignedBrokerApproval, brokerApprovalSemanticDigest } from '@install-doctor/aid-core/broker-approval-contracts';
import { z } from 'zod';
import { PrivilegedBrokerGrantSchema } from './privileged-broker-protocol.js';
import { ProtectedDeviceCredentialStore } from './target-device-credential.js';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_TOKEN_BYTES = 4096;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

export const BrokerApprovalTargetBindingSchema = z.strictObject({
  tenantId: id,
  profileId: id,
  profileRevisionDigest: digest,
  deviceCredentialId: id,
  deviceFingerprint: digest,
  runIntentId: id,
  authorizationId: id,
});

export const BrokerApprovalDeviceIdentitySchema = z.strictObject({
  deviceId: id,
  tenant: id,
  label: z.string().max(200).nullable(),
  enrolledAt: z.string().datetime({ offset: true }),
  grantedPermissions: z.array(z.string().min(1).max(64)).max(32),
  profileRevision: digest,
  machineFingerprint: digest,
}).superRefine((value, context) => {
  if (!value.grantedPermissions.some(scope => scope === 'authorize-privileged-run' || scope === 'run:authorize')) {
    context.addIssue({ code: 'custom', path: ['grantedPermissions'], message: 'device lacks privileged-run authority' });
  }
});

export const BrokerApprovalClaimLocatorSchema = z.strictObject({
  ownerDecisionId: id,
});

export const BrokerApprovalTargetStatusSchema = z.discriminatedUnion('status', [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('not-found') }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('pending') }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('denied') }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('expired') }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('approved'), ownerDecisionId: id }),
]);

export type BrokerApprovalTargetBinding = z.infer<typeof BrokerApprovalTargetBindingSchema>;
export type BrokerApprovalClaimLocator = z.infer<typeof BrokerApprovalClaimLocatorSchema>;

export interface BrokerApprovalTransportOptions {
  readonly origin: string;
  readonly tokenPath: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('broker approval response is too large');
  if (!response.body) throw new Error('broker approval response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('broker approval response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/**
 * Reads the opaque enrollment credential only from an owner-only, non-linked regular file.
 * New enrollments use the structured credential store; the raw form remains readable only for
 * the additive legacy migration window and is never written by Desktop Tools.
 */
export async function readPrivateDeviceToken(pathValue: string): Promise<string> {
  const path = resolve(pathValue);
  const before = await lstat(path, { bigint: true });
  const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : before.uid;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== uid
    || (process.platform !== 'win32' && (before.mode & 0o777n) !== 0o600n)
    || before.size < 16n || before.size > BigInt(MAX_TOKEN_BYTES)) {
    throw new Error('device token is not an owner-only regular file');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error('device token changed while opening');
    }
    const token = (await handle.readFile('utf8')).trim();
    if (token.length < 16 || token.length > MAX_TOKEN_BYTES || /[\r\n\0]/.test(token)) {
      throw new Error('device token has an invalid format');
    }
    if (token.startsWith('{')) {
      const stored = await new ProtectedDeviceCredentialStore(path).load();
      if (!stored) throw new Error('structured device credential is unavailable');
      return stored.credential;
    }
    return token;
  } finally { await handle.close(); }
}

function runIntent(grantValue: unknown, bindingValue: unknown) {
  const grant = PrivilegedBrokerGrantSchema.parse(grantValue);
  const binding = BrokerApprovalTargetBindingSchema.parse(bindingValue);
  return Object.freeze({
    schemaVersion: 1 as const,
    runIntentId: binding.runIntentId,
    authorizationId: binding.authorizationId,
    tenantId: binding.tenantId,
    profileId: binding.profileId,
    profileRevisionDigest: binding.profileRevisionDigest,
    deviceCredentialId: binding.deviceCredentialId,
    deviceFingerprint: binding.deviceFingerprint,
    grantId: grant.grantId,
    hostId: grant.hostId,
    releaseId: grant.releaseId,
    runId: grant.runId,
    planDigest: grant.planDigest,
    enrolledUid: grant.enrolledUid,
    brokerExecutableDigest: grant.brokerExecutableDigest,
    runtimeDigest: grant.runtimeDigest,
    workerDigest: grant.workerDigest,
    operations: grant.operations,
    descriptorDigest: grant.descriptorDigest,
    closureDigest: grant.closureDigest,
    consentDigest: grant.consentDigest,
    requestedAt: grant.issuedAt,
    grantExpiresAt: grant.expiresAt,
  });
}

/**
 * Fail-closed target client for the broker authorization API. It deliberately requires an
 * explicit server-issued owner-decision locator: the target must never guess that identifier.
 */
export function createBrokerApprovalTransport(options: BrokerApprovalTransportOptions) {
  const origin = new URL(options.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('broker approval origin must be an HTTPS origin');
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error('invalid broker approval timeout');

  const request = async (path: string, init: { method: 'GET' } | { method: 'POST'; body: unknown }): Promise<unknown> => {
    const token = await readPrivateDeviceToken(options.tokenPath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(new URL(path, origin), {
        method: init.method, signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        ...('body' in init ? { body: JSON.stringify(init.body) } : {}),
      });
      if (!response.ok) throw new Error(`broker approval request failed with HTTP ${response.status}`);
      return await boundedJson(response);
    } finally { clearTimeout(timer); }
  };
  const post = (path: string, body: unknown) => request(path, { method: 'POST', body });

  return Object.freeze({
    async identity() {
      return BrokerApprovalDeviceIdentitySchema.parse(await request('/api/devices/me', { method: 'GET' }));
    },

    async request(grantValue: unknown, bindingValue: unknown) {
      const intent = runIntent(grantValue, bindingValue);
      const response = z.strictObject({ created: z.boolean(), runIntent: z.unknown() }).parse(
        await post('/api/devices/broker-authorizations', intent),
      );
      if (!exact(response.runIntent, intent)) throw new Error('broker authorization response changed the exact run intent');
      return intent;
    },

    async status(grantValue: unknown, bindingValue: unknown) {
      const grant = PrivilegedBrokerGrantSchema.parse(grantValue);
      const binding = BrokerApprovalTargetBindingSchema.parse(bindingValue);
      return BrokerApprovalTargetStatusSchema.parse(await post('/api/devices/broker-authorizations/status', {
        schemaVersion: 1, authorizationId: binding.authorizationId,
        runIntentId: binding.runIntentId, grantId: grant.grantId,
      }));
    },

    async claim(grantValue: unknown, bindingValue: unknown, locatorValue: unknown) {
      const grant = PrivilegedBrokerGrantSchema.parse(grantValue);
      const binding = BrokerApprovalTargetBindingSchema.parse(bindingValue);
      const locator = BrokerApprovalClaimLocatorSchema.parse(locatorValue);
      const lookup = { schemaVersion: 1 as const, authorizationId: binding.authorizationId,
        ownerDecisionId: locator.ownerDecisionId, tenantId: binding.tenantId, profileId: binding.profileId,
        profileRevisionDigest: binding.profileRevisionDigest, deviceCredentialId: binding.deviceCredentialId,
        deviceFingerprint: binding.deviceFingerprint, runIntentId: binding.runIntentId, grantId: grant.grantId };
      const raw = await post('/api/devices/broker-approvals/claim', lookup);
      const approval = SignedBrokerApproval.parse(
        z.strictObject({ approval: z.unknown() }).parse(raw).approval,
      );
      const expectedGrantDigest = await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', grant);
      if (approval.authorizationId !== binding.authorizationId || approval.ownerDecisionId !== locator.ownerDecisionId
        || approval.tenantId !== binding.tenantId || approval.profileId !== binding.profileId
        || approval.profileRevisionDigest !== binding.profileRevisionDigest
        || approval.deviceCredentialId !== binding.deviceCredentialId || approval.deviceFingerprint !== binding.deviceFingerprint
        || approval.runIntentId !== binding.runIntentId || approval.grant.grantId !== grant.grantId
        || approval.grantDigest !== expectedGrantDigest || !exact(approval.grant, grant)) {
        throw new Error('signed broker approval differs from the exact target binding');
      }
      return approval;
    },
  });
}
