import assert from 'node:assert/strict';
import test from 'node:test';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2PublicationStorage } from '../scripts/r2-publication-storage.mjs';

const config = {
  endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'install-doctor-releases', accessKeyId: 'a'.repeat(20), secretAccessKey: 'b'.repeat(40),
};

test('R2 adapter uses atomic create-only and compare-and-swap conditions', async () => {
  const commands = [];
  const client = { async send(command) {
    commands.push(command);
    if (command instanceof GetObjectCommand) {
      return { ETag: '"etag-1"', Body: { async transformToByteArray() { return new TextEncoder().encode('stored'); } } };
    }
    return { ETag: '"etag-2"' };
  } };
  const storage = createR2PublicationStorage(config, client);
  assert.equal(await storage.create('bootstrap/r/file', Buffer.from('body'), { contentType: 'text/plain', sha256: 'c'.repeat(64) }), true);
  assert.equal(commands[0].input.IfNoneMatch, '*');
  assert.equal(commands[0].input.ContentLength, 4);
  assert.deepEqual(await storage.read('bootstrap/r/file'), { bytes: Buffer.from('stored'), etag: '"etag-1"' });
  assert.deepEqual(await storage.compareAndSwap('bootstrap/channels/stable.json', Buffer.from('{}'), '"etag-1"'), { ok: true, etag: '"etag-2"' });
  assert.equal(commands[2].input.IfMatch, '"etag-1"');
  assert.equal(commands[2].input.IfNoneMatch, undefined);
  await storage.compareAndSwap('bootstrap/channels/new.json', Buffer.from('{}'), undefined);
  assert.equal(commands[3].input.IfNoneMatch, '*');
});

test('R2 adapter converts only 412 responses into conditional conflicts', async () => {
  const client = { async send() {
    const error = new Error('precondition failed');
    error.$metadata = { httpStatusCode: 412 };
    throw error;
  } };
  const storage = createR2PublicationStorage(config, client);
  assert.equal(await storage.create('bootstrap/r/file', Buffer.from('x'), { contentType: 'text/plain', sha256: 'd'.repeat(64) }), false);
  assert.deepEqual(await storage.compareAndSwap('bootstrap/channels/stable.json', Buffer.from('{}'), '"etag"'), { ok: false });
  await assert.rejects(storage.read('bootstrap/r/file'), /precondition failed/);
});

test('R2 adapter rejects non-account endpoints and weak credentials before creating a client', () => {
  assert.throws(() => createR2PublicationStorage({ ...config, endpoint: 'https://example.com' }, {}), /account-scoped/);
  assert.throws(() => createR2PublicationStorage({ ...config, accessKeyId: 'short' }, {}), /credentials/);
});
