import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function isPreconditionFailure(error) {
  return error && typeof error === 'object' && ('$metadata' in error)
    && error.$metadata?.httpStatusCode === 412;
}

async function bodyBytes(body) {
  if (!body || typeof body.transformToByteArray !== 'function') throw new Error('R2 returned an unreadable object body');
  return Buffer.from(await body.transformToByteArray());
}

export function createR2PublicationStorage({ endpoint, bucket, accessKeyId, secretAccessKey }, injectedClient) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/.test(url.hostname) || url.pathname !== '/') {
    throw new Error('R2 endpoint must be an account-scoped HTTPS cloudflarestorage.com origin');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket)) throw new Error('R2 bucket name is invalid');
  if (typeof accessKeyId !== 'string' || accessKeyId.length < 16 || typeof secretAccessKey !== 'string' || secretAccessKey.length < 32) {
    throw new Error('scoped R2 S3 credentials are required');
  }
  const client = injectedClient ?? new S3Client({ region: 'auto', endpoint: url.origin, credentials: { accessKeyId, secretAccessKey } });
  return {
    async create(key, bytes, metadata) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
          ContentType: metadata.contentType, Metadata: { sha256: metadata.sha256, schema: '1' },
          IfNoneMatch: '*',
        }));
        return true;
      } catch (error) {
        if (isPreconditionFailure(error)) return false;
        throw error;
      }
    },
    async read(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: await bodyBytes(response.Body), etag: response.ETag ?? '' };
      } catch (error) {
        if (error && typeof error === 'object' && ('$metadata' in error) && error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async compareAndSwap(key, bytes, expectedEtag) {
      try {
        const response = await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
          ContentType: 'application/json', Metadata: { schema: '1' },
          ...(expectedEtag === undefined ? { IfNoneMatch: '*' } : { IfMatch: expectedEtag }),
        }));
        return { ok: true, etag: response.ETag ?? '' };
      } catch (error) {
        if (isPreconditionFailure(error)) return { ok: false };
        throw error;
      }
    },
  };
}
