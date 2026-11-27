import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** @typedef {{ contentType?: string, sha256: string, visibility?: 'private' }} ObjectMetadata */
/** @typedef {Pick<NonNullable<import('@aws-sdk/client-s3').GetObjectCommandOutput['Body']>, 'transformToByteArray'>} ObjectBody */
/** @typedef {{ send: (command: GetObjectCommand | PutObjectCommand) => Promise<{ Body?: ObjectBody, ETag?: string }> }} PublicationClient */

/** @param {unknown} error @param {number} status */
function hasHttpStatus(error, status) {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) return false;
  const metadata = error.$metadata;
  return metadata !== null && typeof metadata === 'object'
    && 'httpStatusCode' in metadata && metadata.httpStatusCode === status;
}

/** @param {ObjectBody | undefined} body */
async function bodyBytes(body) {
  if (!body || typeof body.transformToByteArray !== 'function') throw new Error('R2 returned an unreadable object body');
  return Buffer.from(await body.transformToByteArray());
}

/**
 * @param {{ endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string }} options
 * @param {PublicationClient} [injectedClient]
 */
export function createR2PublicationStorage({ endpoint, bucket, accessKeyId, secretAccessKey }, injectedClient) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/.test(url.hostname) || url.pathname !== '/') {
    throw new Error('R2 endpoint must be an account-scoped HTTPS cloudflarestorage.com origin');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket)) throw new Error('R2 bucket name is invalid');
  if (typeof accessKeyId !== 'string' || accessKeyId.length < 16 || typeof secretAccessKey !== 'string' || secretAccessKey.length < 32) {
    throw new Error('scoped R2 S3 credentials are required');
  }
  /** @type {PublicationClient} */
  const client = injectedClient ?? new S3Client({ region: 'auto', endpoint: url.origin, credentials: { accessKeyId, secretAccessKey } });
  return {
    /** @param {string} key @param {Uint8Array} bytes @param {ObjectMetadata} metadata */
    async create(key, bytes, metadata) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
          ContentType: metadata.contentType, Metadata: { sha256: metadata.sha256, schema: '1' },
          IfNoneMatch: '*',
        }));
        return true;
      } catch (error) {
        if (hasHttpStatus(error, 412)) return false;
        throw error;
      }
    },
    /** @param {string} key */
    async read(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: await bodyBytes(response.Body), etag: response.ETag ?? '' };
      } catch (error) {
        if (hasHttpStatus(error, 404)) return null;
        throw error;
      }
    },
    /** @param {string} key @param {Uint8Array} bytes @param {string} [expectedEtag] */
    async compareAndSwap(key, bytes, expectedEtag) {
      try {
        const response = await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
          ContentType: 'application/json', Metadata: { schema: '1' },
          ...(expectedEtag === undefined ? { IfNoneMatch: '*' } : { IfMatch: expectedEtag }),
        }));
        return { ok: true, etag: response.ETag ?? '' };
      } catch (error) {
        if (hasHttpStatus(error, 412)) return { ok: false };
        throw error;
      }
    },
  };
}

/** Read adapter input defensively for callers that bypass TypeScript.
 * @param {unknown} value
 * @param {string} name
 * @returns {unknown}
 */
export function publicationField(value, name) {
  if (value === null || value === undefined) return undefined;
  return Reflect.get(Object(value), name);
}

/** @param {unknown} value @returns {value is { ok: true, etag: string }} */
export function isPublicationCommit(value) {
  return publicationField(value, 'ok') === true && typeof publicationField(value, 'etag') === 'string';
}
