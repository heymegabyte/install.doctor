import { z } from 'zod';
import {
  BrokerApprovalSignerDelegation,
  brokerApprovalSemanticDigest,
} from '../../aid-core/src/broker-approval-contracts.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_DELEGATION_BYTES = 64 * 1024;

const ActiveV9ReleaseAuthority = z.object({
  product: z.literal('desktop-tools'),
  schemaVersion: z.literal(9),
  channel: z.literal('stable'),
  releaseId: id,
  createdAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
  brokerApproval: z.object({
    delegationUrl: z.string().url(),
    delegationSha256: digest,
    delegationSize: z.number().int().positive().max(MAX_DELEGATION_BYTES),
    minimumRevocationEpoch: z.number().int().nonnegative().safe(),
  }).strict(),
}).passthrough().superRefine((value, context) => {
  if (value.brokerApproval.delegationUrl
    !== `https://desktop.tools/releases/${value.releaseId}/broker-approval-signer-delegation.json`) {
    context.addIssue({ code: 'custom', message: 'broker delegation URL differs from immutable release identity' });
  }
});

type Bucket = { get(key: string): Promise<unknown> };
const BucketSchema = z.custom<Bucket>(value => typeof value === 'object' && value !== null
  && 'get' in value && typeof value.get === 'function');
const StoredObject = z.object({
  body: z.custom<ReadableStream<Uint8Array>>(value => typeof ReadableStream !== 'undefined'
    && value instanceof ReadableStream),
  size: z.number().int().nonnegative().optional(),
}).passthrough();

export type ActiveV9ReleaseAuthorityValue = z.infer<typeof ActiveV9ReleaseAuthority>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
  return value;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(canonicalValue(value))}\n`);
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readExact(storedValue: unknown, declaredSize: number): Promise<Uint8Array> {
  const stored = StoredObject.parse(storedValue);
  if (stored.size !== undefined && stored.size !== declaredSize) throw new Error('broker delegation stored size differs from release authority');
  const reader = stored.body.getReader();
  const result = new Uint8Array(declaredSize);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > declaredSize) {
      await reader.cancel();
      throw new Error('broker delegation exceeds declared size');
    }
    result.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== declaredSize) throw new Error('broker delegation is truncated');
  return result;
}

function base64UrlBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const canonical = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  if (canonical !== value) throw new Error('broker delegation public key is not canonical base64url');
  return bytes;
}

async function requireEd25519PublicKey(value: string): Promise<void> {
  try {
    const key = await crypto.subtle.importKey('spki', base64UrlBytes(value), { name: 'Ed25519' }, false, ['verify']);
    if (key.algorithm.name !== 'Ed25519' || key.type !== 'public' || key.extractable) throw new Error('wrong key');
  } catch {
    throw new Error('broker delegation public key is not Ed25519 SPKI');
  }
}

/** Load one immutable, manifest-declared signer delegation from its exact release-root R2 key. */
export async function loadImmutableBrokerReleaseDelegation(input: Readonly<{
  bucket: unknown;
  release: unknown;
  now?: Date;
}>) {
  const bucket = BucketSchema.parse(input.bucket);
  const release = ActiveV9ReleaseAuthority.parse(input.release);
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(now) || now >= release.expiresAt * 1000) throw new Error('Desktop Tools release authority is expired');
  const key = `desktop-tools/bootstrap/${release.releaseId}/broker-approval-signer-delegation.json`;
  const stored = await bucket.get(key);
  if (!stored) throw new Error('broker delegation release object is unavailable');
  const bytes = await readExact(stored, release.brokerApproval.delegationSize);
  if (await sha256(bytes) !== release.brokerApproval.delegationSha256) {
    throw new Error('broker delegation digest differs from release authority');
  }
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('broker delegation is not canonical UTF-8 JSON'); }
  const delegation = BrokerApprovalSignerDelegation.parse(decoded);
  if (!same(bytes, canonicalBytes(delegation))) throw new Error('broker delegation is not canonical JSON');
  if (delegation.product !== release.product || delegation.releaseId !== release.releaseId
    || delegation.channel !== release.channel
    || delegation.revocationEpoch < release.brokerApproval.minimumRevocationEpoch) {
    throw new Error('broker delegation identity or revocation policy differs from release authority');
  }
  const { delegationDigest, ...projection } = delegation;
  if (delegationDigest !== await brokerApprovalSemanticDigest(
    'desktop-tools:broker-approval-signer-delegation:v1', projection,
  )) throw new Error('broker delegation semantic digest is invalid');
  const startsAt = Date.parse(delegation.notBefore);
  const endsAt = Date.parse(delegation.notAfter);
  if (now < startsAt || now >= endsAt || startsAt > release.createdAt * 1000
    || endsAt < release.expiresAt * 1000 || startsAt >= endsAt) {
    throw new Error('broker delegation is outside the exact release validity window');
  }
  await requireEd25519PublicKey(delegation.publicKeySpki);
  return Object.freeze({ delegation, minimumRevocationEpoch: release.brokerApproval.minimumRevocationEpoch,
    releaseId: release.releaseId, objectKey: key, sha256: release.brokerApproval.delegationSha256,
    size: release.brokerApproval.delegationSize });
}

/** Compose the authorization service's release lookup without exposing a mutable fallback. */
export function createImmutableBrokerDelegationResolver(input: Readonly<{
  bucket: unknown;
  resolveActiveRelease(): Promise<unknown>;
  now?: () => Date;
}>) {
  return Object.freeze({
    async delegationForRelease(releaseIdValue: string) {
      const releaseId = id.parse(releaseIdValue);
      const release = ActiveV9ReleaseAuthority.parse(await input.resolveActiveRelease());
      if (release.releaseId !== releaseId) return null;
      return (await loadImmutableBrokerReleaseDelegation({ bucket: input.bucket, release,
        ...(input.now ? { now: input.now() } : {}) })).delegation;
    },
  });
}
