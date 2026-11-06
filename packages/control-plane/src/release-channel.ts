import { z } from 'zod';

const Id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Pointer = z.object({
  schemaVersion: z.literal(1),
  channel: Id,
  generation: z.number().int().positive(),
  kind: z.enum(['promote', 'rollback']),
  releaseId: Id,
  signerId: Id,
  manifestSha256: Sha256,
  activatedAt: z.string().datetime({ offset: true }),
  activationId: z.string().uuid(),
  previous: z.object({
    generation: z.number().int().positive(), activationId: z.string().uuid(), releaseId: Id,
    manifestSha256: Sha256, etag: z.string().min(1),
  }).strict().nullable(),
  rollbackOfActivationId: z.string().uuid().nullable(),
}).strict();

type Bucket = { get(key: string): Promise<unknown> };
const Bucket = z.custom<Bucket>((value) =>
  typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function');
const Stored = z.object({
  body: z.custom<ReadableStream<Uint8Array>>((value) =>
    typeof ReadableStream !== 'undefined' && value instanceof ReadableStream),
  size: z.number().int().nonnegative().max(64 * 1024).optional(),
}).passthrough();

async function boundedBytes(value: unknown, limit: number): Promise<Uint8Array> {
  const stored = Stored.parse(value);
  if (stored.size !== undefined && stored.size > limit) throw new Error('release channel object is oversized');
  const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
  if (bytes.byteLength > limit) throw new Error('release channel object is oversized');
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type ActiveRelease = z.infer<typeof Pointer>;

function parseManifestMetadata(bytes: Uint8Array, now: number): {
  readonly releaseId: string; readonly signerId: string; readonly sourceCommit: string;
  readonly createdAt: number; readonly expiresAt: number;
} {
  const values = new Map<string, string>();
  for (const line of new TextDecoder().decode(bytes).split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('active release manifest is malformed');
    const key = line.slice(0, separator);
    if (!/^[a-z0-9_]+$/.test(key) || values.has(key)) throw new Error('active release manifest contains an invalid or duplicate key');
    values.set(key, line.slice(separator + 1));
  }
  const releaseId = Id.parse(values.get('release_id'));
  const signerId = Id.parse(values.get('key_id'));
  const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/).parse(values.get('source_commit'));
  const timestamp = z.string().regex(/^[1-9][0-9]*$/).transform(Number).refine(Number.isSafeInteger);
  const createdAt = timestamp.parse(values.get('created_at'));
  const expiresAt = timestamp.parse(values.get('expires_at'));
  if (values.get('schema_version') !== '5' || createdAt > now + 300 || createdAt >= expiresAt || expiresAt - createdAt > 604_800) {
    throw new Error('active release manifest validity window is invalid');
  }
  if (expiresAt <= now) throw new Error('active release manifest is expired');
  return Object.freeze({ releaseId, signerId, sourceCommit, createdAt, expiresAt });
}

/** Resolve a channel only through its CAS-published pointer and digest-bound immutable manifest. */
export async function resolveActiveRelease(
  channelBinding: unknown, releaseBinding: unknown, channelValue: unknown,
  now = Math.floor(Date.now() / 1_000),
): Promise<ActiveRelease & { readonly sourceCommit: string; readonly createdAt: number; readonly expiresAt: number }> {
  const channelBucket = Bucket.parse(channelBinding);
  const releaseBucket = Bucket.parse(releaseBinding);
  const channel = Id.parse(channelValue);
  const pointerObject = await channelBucket.get(`bootstrap/channels/${channel}.json`);
  if (!pointerObject) throw new Error('release channel is missing');
  const pointerBytes = await boundedBytes(pointerObject, 16 * 1024);
  const pointer = Pointer.parse(JSON.parse(new TextDecoder().decode(pointerBytes)));
  if (pointer.channel !== channel) throw new Error('release channel identity mismatch');
  if ((pointer.kind === 'rollback') !== (pointer.rollbackOfActivationId !== null)) {
    throw new Error('release rollback identity mismatch');
  }
  const manifestObject = await releaseBucket.get(`bootstrap/${pointer.releaseId}/manifest`);
  if (!manifestObject) throw new Error('active release manifest is missing');
  const manifest = await boundedBytes(manifestObject, 64 * 1024);
  if (await sha256(manifest) !== pointer.manifestSha256) throw new Error('active release manifest digest mismatch');
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('active release clock is invalid');
  const metadata = parseManifestMetadata(manifest, now);
  if (metadata.releaseId !== pointer.releaseId || metadata.signerId !== pointer.signerId) {
    throw new Error('active release pointer does not match signed manifest identity');
  }
  return Object.freeze({ ...pointer, ...metadata });
}
