import assert from 'node:assert/strict';
import { createSecretKey, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deleteRecording, EncryptedCastWriter, exportRecording, previewRetention } from '../src/encrypted-recording.mjs';

const key = () => createSecretKey(randomBytes(32));
const consent = { actorId: 'owner-1', approvedAt: '2026-11-08T12:00:00.000Z', recordOutput: true, recordInput: false };
const policy = { retainUntil: '2026-12-08T12:00:00.000Z', maxBytes: 1_048_576, allowExport: true, allowDelete: true };
const exportAuthorization = { actorId: 'owner-1', approvedAt: '2026-11-08T12:01:00.000Z', purpose: 'support-review' };

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-recording-'));
  const path = join(root, 'session-1.cast.enc');
  const encryptionKey = key();
  const writer = await EncryptedCastWriter.create({
    path,
    sessionId: 'session-1',
    createdAt: '2026-11-08T12:00:00.000Z',
    cols: 80,
    rows: 24,
    consent,
    policy,
    key: encryptionKey,
    sanitizeOutput: value => value.replaceAll(/token=[^\s]+/g, 'token=[REDACTED]'),
    ...overrides,
  });
  return { root, path, encryptionKey, writer };
}

test('stores sanitized asciicast v3 output, resize, marker, and exit as authenticated ciphertext', async () => {
  const value = await fixture();
  await value.writer.output(1, 'ready token=secret-value');
  await value.writer.resize(2, 100, 30);
  await value.writer.marker(3, 'plan-approved');
  await value.writer.finish(4, 0);
  const stored = await readFile(value.path, 'utf8');
  assert.doesNotMatch(stored, /secret-value|ready/);
  const plaintext = await exportRecording({ path: value.path, key: value.encryptionKey, authorization: exportAuthorization });
  const lines = plaintext.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines[0], { version: 3, term: { cols: 80, rows: 24 }, timestamp: 1794139200 });
  assert.deepEqual(lines.slice(1), [[1, 'o', 'ready token=[REDACTED]'], [1, 'r', '100x30'], [1, 'm', 'plan-approved'], [1, 'x', '0']]);
  const status = JSON.parse(await readFile(value.writer.statusPath, 'utf8'));
  assert.deepEqual(status, { schemaVersion: 1, sessionId: 'session-1', state: 'complete', captureComplete: true, reason: null });
  assert.equal((await stat(value.path)).mode & 0o777, 0o600);
  assert.equal(value.writer.input, undefined);
});

test('requires output-only consent, a sanitizer, and an in-memory encryption key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-recording-denied-'));
  const base = { path: join(root, 'denied.cast.enc'), sessionId: 'session-1', createdAt: '2026-11-08T12:00:00.000Z', cols: 80, rows: 24, policy, key: key(), sanitizeOutput: value => value };
  await assert.rejects(EncryptedCastWriter.create({ ...base, consent: { ...consent, recordOutput: false } }), /output-only consent/);
  await assert.rejects(EncryptedCastWriter.create({ ...base, consent, path: join(root, 'no-sanitizer.cast.enc'), sanitizeOutput: null }), /sanitizer/);
  await assert.rejects(EncryptedCastWriter.create({ ...base, consent, path: join(root, 'no-key.cast.enc'), key: 'environment-key' }), /KeyObject/);
});

test('keeps interrupted or failed capture visibly incomplete', async () => {
  const value = await fixture();
  await value.writer.output(1, 'partial');
  await value.writer.markIncomplete('storage-backpressure');
  const status = JSON.parse(await readFile(value.writer.statusPath, 'utf8'));
  assert.deepEqual(status, { schemaVersion: 1, sessionId: 'session-1', state: 'incomplete', captureComplete: false, reason: 'storage-backpressure' });
  await assert.rejects(value.writer.finish(2, 0), /closed/);
});

test('enforces encryption authentication and actor-bound export authorization', async () => {
  const value = await fixture();
  await value.writer.finish(1, 0);
  await assert.rejects(exportRecording({ path: value.path, key: key(), authorization: exportAuthorization }), /authentication failed/);
  await assert.rejects(exportRecording({ path: value.path, key: value.encryptionKey, authorization: { ...exportAuthorization, actorId: 'other' } }), /not authorized/);
});

test('retention is preview-only and deletion requires a separate actor-bound authorization', async () => {
  const value = await fixture();
  await value.writer.finish(1, 0);
  assert.deepEqual(await previewRetention({ path: value.path, now: '2027-01-01T00:00:00.000Z' }), {
    sessionId: 'session-1', expired: true, retainUntil: policy.retainUntil, action: 'preview-only',
  });
  await assert.rejects(deleteRecording({ path: value.path, authorization: { actorId: 'other', approvedAt: '2026-11-08T12:02:00.000Z', reason: 'owner-request' } }), /not authorized/);
  assert.equal((await stat(value.path)).isFile(), true);
  assert.deepEqual(await deleteRecording({ path: value.path, authorization: { actorId: 'owner-1', approvedAt: '2026-11-08T12:02:00.000Z', reason: 'owner-request' } }), { sessionId: 'session-1', deleted: true });
  await assert.rejects(stat(value.path), /ENOENT/);
});
