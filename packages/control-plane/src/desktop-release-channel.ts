import { z } from 'zod';

const Id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Pointer = z.object({
  schemaVersion: z.literal(2), product: z.literal('desktop-tools'), channel: Id,
  generation: z.number().int().positive(), kind: z.enum(['promote', 'rollback']),
  releaseId: Id, signerId: Id, manifestSha256: Sha256,
  activatedAt: z.string().datetime({ offset: true }), activationId: z.string().uuid(),
  previous: z.object({ generation: z.number().int().positive(), activationId: z.string().uuid(),
    releaseId: Id, manifestSha256: Sha256, etag: z.string().min(1) }).strict().nullable(),
  rollbackOfActivationId: z.string().uuid().nullable()
}).strict();
type Bucket = { get(key: string): Promise<unknown> };
const Bucket = z.custom<Bucket>(value => typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function');
const Stored = z.object({ body: z.custom<ReadableStream<Uint8Array>>(value =>
  typeof ReadableStream !== 'undefined' && value instanceof ReadableStream), size: z.number().int().nonnegative().optional() }).passthrough();

async function bytes(value: unknown, limit: number): Promise<Uint8Array> {
  const stored = Stored.parse(value);
  if (stored.size !== undefined && stored.size > limit) throw new Error('Desktop Tools release object is oversized');
  const result = new Uint8Array(await new Response(stored.body).arrayBuffer());
  if (result.byteLength > limit) throw new Error('Desktop Tools release object is oversized');
  return result;
}
const canonical = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const same = (left: Uint8Array, right: Uint8Array) => left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
async function digest(value: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Resolve only the product-qualified v2 pointer and a supported exact Desktop Tools manifest. */
export async function resolveActiveDesktopRelease(channelBinding: unknown, releaseBinding: unknown, channelInput: unknown,
  now = Math.floor(Date.now() / 1_000)) {
  const channels = Bucket.parse(channelBinding);
  const releases = Bucket.parse(releaseBinding);
  const channel = Id.parse(channelInput);
  const pointerObject = await channels.get(`desktop-tools/channels/${channel}.json`);
  if (!pointerObject) throw new Error('Desktop Tools release channel is missing');
  const pointerBytes = await bytes(pointerObject, 16_384);
  const pointer = Pointer.parse(JSON.parse(new TextDecoder().decode(pointerBytes)));
  if (!same(pointerBytes, canonical(pointer)) || pointer.channel !== channel
    || (pointer.kind === 'rollback') !== (pointer.rollbackOfActivationId !== null)) {
    throw new Error('Desktop Tools release pointer identity is invalid');
  }
  const manifestObject = await releases.get(`desktop-tools/bootstrap/${pointer.releaseId}/manifest`);
  if (!manifestObject) throw new Error('Desktop Tools active manifest is missing');
  const manifest = await bytes(manifestObject, 16_384);
  if (await digest(manifest) !== pointer.manifestSha256) throw new Error('Desktop Tools active manifest digest mismatch');
  const values = new Map<string, string>();
  for (const line of new TextDecoder().decode(manifest).split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    if (separator < 1 || !/^[a-z0-9_]+$/.test(key) || values.has(key)) throw new Error('Desktop Tools active manifest is malformed');
    values.set(key, line.slice(separator + 1));
  }
  const integer = z.string().regex(/^[1-9][0-9]*$/).transform(Number).refine(Number.isSafeInteger);
  const createdAt = integer.parse(values.get('created_at'));
  const expiresAt = integer.parse(values.get('expires_at'));
  if (!['7', '8', '9'].includes(values.get('schema_version') ?? '') || values.get('product_id') !== 'desktop-tools'
    || values.get('release_id') !== pointer.releaseId || values.get('key_id') !== pointer.signerId
    || !/^desktop-[a-z0-9._-]+$/.test(pointer.signerId)
    || !/^[a-f0-9]{40}$/.test(values.get('source_commit') ?? '')
    || !Number.isSafeInteger(now) || createdAt > now + 300 || expiresAt <= now
    || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new Error('Desktop Tools active manifest identity or validity is invalid');
  }
  return Object.freeze({ ...pointer, sourceCommit: values.get('source_commit'), createdAt, expiresAt });
}
