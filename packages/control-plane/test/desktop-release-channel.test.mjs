import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveActiveDesktopRelease } from '../src/desktop-release-channel.ts';
import { lookupDesktopReleaseObject } from '../src/release-store.ts';

const body = bytes => ({ body: new Blob([bytes]).stream(), size: bytes.byteLength });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(overrides = {}) {
  const now = Math.floor(Date.now() / 1_000);
  const releaseId = 'desktop-release-1';
  const signerId = 'desktop-production-1';
  const manifest = Buffer.from([
    'schema_version=7', 'product_id=desktop-tools', `release_id=${releaseId}`,
    `source_commit=${'a'.repeat(40)}`, `created_at=${now - 1}`, `expires_at=${now + 86_400}`,
    `key_id=${signerId}`
  ].join('\n') + '\n');
  const pointer = {
    schemaVersion: 2, product: 'desktop-tools', channel: 'stable', generation: 1, kind: 'promote',
    releaseId, signerId, manifestSha256: digest(manifest), activatedAt: new Date().toISOString(),
    activationId: randomUUID(), previous: null, rollbackOfActivationId: null, ...overrides
  };
  const pointerBytes = Buffer.from(`${JSON.stringify(pointer)}\n`);
  return { now, releaseId, manifest, pointer, pointerBytes };
}

test('resolves only a canonical product-qualified pointer and digest-bound v7 manifest', async () => {
  const value = fixture();
  const requested = [];
  const channels = { async get(key) { requested.push(key); return key === 'desktop-tools/channels/stable.json' ? body(value.pointerBytes) : null; } };
  const releases = { async get(key) { requested.push(key); return key === `desktop-tools/bootstrap/${value.releaseId}/manifest` ? body(value.manifest) : null; } };
  const result = await resolveActiveDesktopRelease(channels, releases, 'stable', value.now);
  assert.equal(result.product, 'desktop-tools');
  assert.deepEqual(requested, ['desktop-tools/channels/stable.json', `desktop-tools/bootstrap/${value.releaseId}/manifest`]);
});

test('rejects legacy prefixes, noncanonical pointers, wrong products, and manifest substitution', async () => {
  const value = fixture();
  await assert.rejects(resolveActiveDesktopRelease({ async get() { return null; } }, { async get() { return null; } }, 'stable', value.now), /channel is missing/);
  const noncanonical = Buffer.from(JSON.stringify(value.pointer));
  await assert.rejects(resolveActiveDesktopRelease({ async get() { return body(noncanonical); } }, { async get() { return body(value.manifest); } }, 'stable', value.now), /pointer identity/);
  const wrongProduct = Buffer.from(`${JSON.stringify({ ...value.pointer, product: 'install-doctor' })}\n`);
  await assert.rejects(resolveActiveDesktopRelease({ async get() { return body(wrongProduct); } }, { async get() { return body(value.manifest); } }, 'stable', value.now), /invalid|literal|product/i);
  await assert.rejects(resolveActiveDesktopRelease({ async get() { return body(value.pointerBytes); } }, { async get() { return body(Buffer.from('tampered\n')); } }, 'stable', value.now), /digest mismatch/);
});

test('serves only Desktop Tools release filenames from its isolated prefix', async () => {
  const requested = [];
  const bucket = { async get(key) { requested.push(key); return body(Buffer.from('engine\n')); } };
  const found = await lookupDesktopReleaseObject(bucket, 'desktop-release-1', 'desktop-tools-engine.mjs');
  assert.equal(found.status, 'found');
  assert.equal(found.contentType, 'text/javascript; charset=utf-8');
  assert.deepEqual(requested, ['desktop-tools/bootstrap/desktop-release-1/desktop-tools-engine.mjs']);
  for (const [filename, contentType] of [
    ['opencode-linux-arm64.tar.gz', 'application/gzip'],
    ['opencode-macos-arm64.zip', 'application/zip'],
    ['desktop-tools-supervisor.mjs', 'text/javascript; charset=utf-8'],
    ['release.sbom.json', 'application/json; charset=utf-8'],
    ['release.provenance.json', 'application/json; charset=utf-8'],
    ['opencode.lock.json', 'application/json; charset=utf-8'],
    ['THIRD_PARTY_LICENSES.txt', 'text/plain; charset=utf-8'],
  ]) {
    const closure = await lookupDesktopReleaseObject(bucket, 'desktop-release-1', filename);
    assert.equal(closure.status, 'found');
    assert.equal(closure.contentType, contentType);
  }
  assert.equal((await lookupDesktopReleaseObject(bucket, 'desktop-release-1', 'install-doctor-engine.mjs')).status, 'invalid');
  assert.equal(requested.length, 8);
});
