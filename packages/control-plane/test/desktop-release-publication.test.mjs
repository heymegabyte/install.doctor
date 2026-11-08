import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DESKTOP_RELEASE_FILES, publishDesktopRelease } from '../scripts/desktop-release-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, mutate = value => value) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-release-test-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(directory, { recursive: true, force: true }); });
  const releaseId = `desktop-${randomUUID()}`;
  const bodies = new Map();
  for (const name of DESKTOP_RELEASE_FILES.filter(name => !['manifest', 'manifest.sig'].includes(name))) bodies.set(name, Buffer.from(`${name}\n`));
  const now = Math.floor(Date.now() / 1_000);
  const entries = [
    'schema_version=6', 'product_id=desktop-tools', `release_id=${releaseId}`, `source_commit=${'a'.repeat(40)}`,
    `created_at=${now - 1}`, `expires_at=${now + 86_400}`, 'key_id=desktop-production-1',
    'engine_node_min=22', 'runtime_node_version=24.11.0'
  ];
  const artifacts = [
    ['artifact','provision.sh'], ['engine','desktop-tools-engine.mjs'], ['catalog','catalog.json'], ['launcher','start'],
    ['runtime_macos_x64','node-macos-x64.tar.gz'], ['runtime_macos_arm64','node-macos-arm64.tar.gz'],
    ['runtime_linux_x64','node-linux-x64.tar.gz'], ['runtime_linux_arm64','node-linux-arm64.tar.gz']
  ];
  for (const [prefix, name] of artifacts) entries.push(
    `${prefix}_url=https://desktop.tools/releases/${releaseId}/${name}`,
    `${prefix}_sha256=${digest(bodies.get(name))}`,
    `${prefix}_size=${bodies.get(name).byteLength}`
  );
  bodies.set('manifest', Buffer.from(`${mutate(entries).join('\n')}\n`));
  bodies.set('manifest.sig', Buffer.from('signature\n'));
  for (const [name, bytes] of bodies) await writeFile(join(directory, name), bytes, { mode: 0o600 });
  return { directory, releaseId };
}

function storage() {
  const objects = new Map();
  const creates = [];
  return { objects, creates,
    async create(key, bytes, metadata) { creates.push([key, metadata]); if (objects.has(key)) return false; objects.set(key, { bytes: Buffer.from(bytes) }); return true; },
    async read(key) { return objects.get(key) ?? null; }
  };
}

test('publishes an exact Desktop Tools v6 release in a product-qualified immutable keyspace', async t => {
  const release = await fixture(t);
  const target = storage();
  let verified;
  const result = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target,
    verifySignature: async input => { verified = input; } });
  assert.equal(result.product, 'desktop-tools');
  assert.equal(verified.namespace, 'desktop.tools.release');
  assert.equal(target.creates.at(-1)[0], `desktop-tools/bootstrap/${release.releaseId}/manifest`);
  assert.equal(target.creates.some(([key]) => key.startsWith('bootstrap/')), false);
  const retry = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target, verifySignature: async () => {} });
  assert.equal(retry.outcomes.every(item => item.outcome === 'already-present'), true);
});

test('rejects legacy identity, origin substitution, surplus files, and altered payloads', async t => {
  const target = storage();
  const verifySignature = async () => {};
  const legacy = await fixture(t, entries => entries.map(line => line === 'product_id=desktop-tools' ? 'product_id=install-doctor' : line));
  await assert.rejects(publishDesktopRelease({ ...legacy, expectedReleaseId: legacy.releaseId, storage: target, verifySignature }), /identity mismatch/);
  const origin = await fixture(t, entries => entries.map(line => line.startsWith('catalog_url=') ? line.replace('https://desktop.tools', 'https://app.install.doctor') : line));
  await assert.rejects(publishDesktopRelease({ ...origin, expectedReleaseId: origin.releaseId, storage: target, verifySignature }), /URL binding mismatch/);
  const altered = await fixture(t);
  await writeFile(join(altered.directory, 'catalog.json'), 'altered\n');
  await assert.rejects(publishDesktopRelease({ ...altered, expectedReleaseId: altered.releaseId, storage: target, verifySignature }), /artifact binding mismatch/);
  const surplus = await fixture(t);
  await writeFile(join(surplus.directory, 'unexpected'), 'x');
  await assert.rejects(publishDesktopRelease({ ...surplus, expectedReleaseId: surplus.releaseId, storage: target, verifySignature }), /exact allowlist/);
});
