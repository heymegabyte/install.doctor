import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateDesktopRelease, DESKTOP_RELEASE_FILES, inspectPublishedDesktopRelease, publishDesktopRelease,
  reconcileDesktopActivationReceipt
} from '../scripts/desktop-release-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, mutate = value => value) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-release-test-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(directory, { recursive: true, force: true }); });
  const releaseId = `desktop-${randomUUID()}`;
  const bodies = new Map();
  const evidence = ['manifest', 'manifest.sig', 'release.sbom.json', 'release.provenance.json', 'THIRD_PARTY_LICENSES.txt'];
  for (const name of DESKTOP_RELEASE_FILES.filter(name => !evidence.includes(name))) bodies.set(name, Buffer.from(`${name}\n`));
  bodies.set('catalog.json', Buffer.from('[]\n'));
  const now = Math.floor(Date.now() / 1_000);
  const opencodeVersion = '2.2.5';
  const lockedNames = { macos_x64: 'opencode-macos-x64.zip', macos_arm64: 'opencode-macos-arm64.zip',
    linux_x64: 'opencode-linux-x64.tar.gz', linux_arm64: 'opencode-linux-arm64.tar.gz' };
  const lock = { schemaVersion: 1, name: 'opencode', version: opencodeVersion, sourceCommit: 'c'.repeat(40), license: 'MIT',
    sourceVerification: { tagCommit: 'c'.repeat(40), gitHubVerified: false, assetDigestSource: 'github-release-api' }, artifacts: {} };
  for (const [platform, name] of Object.entries(lockedNames)) lock.artifacts[platform] = { releaseFilename: name,
    upstreamUrl: `https://github.com/anomalyco/opencode/releases/download/v${opencodeVersion}/fixture-${name}`,
    sha256: digest(bodies.get(name)), size: bodies.get(name).byteLength };
  bodies.set('opencode.lock.json', Buffer.from(`${JSON.stringify(lock)}\n`));
  const closure = [...bodies.entries()];
  bodies.set('release.sbom.json', Buffer.from(`${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { name: 'desktop-tools-release', version: releaseId, properties: [
      { name: 'desktop.tools:source-commit', value: 'a'.repeat(40) }, { name: 'desktop.tools:opencode-version', value: opencodeVersion }
    ] } }, components: closure.map(([name, bytes]) => ({ name, hashes: [{ alg: 'SHA-256', content: digest(bytes) }] })) })}\n`));
  const provenance = { _type: 'https://in-toto.io/Statement/v1',
    predicateType: 'https://slsa.dev/provenance/v1', subject: closure.map(([name, bytes]) => ({ name, digest: { sha256: digest(bytes) } })),
    predicate: { buildDefinition: { externalParameters: { releaseId, sourceCommit: 'a'.repeat(40), opencodeVersion },
      resolvedDependencies: Object.values(lock.artifacts).map(artifact => ({ uri: artifact.upstreamUrl, digest: { sha256: artifact.sha256 } })) } } };
  bodies.set('release.provenance.json', Buffer.from(`${JSON.stringify(provenance)}\n`));
  bodies.set('THIRD_PARTY_LICENSES.txt', Buffer.from(`OpenCode ${opencodeVersion}\nMIT License\n`));
  const entries = [
    'schema_version=7', 'product_id=desktop-tools', `release_id=${releaseId}`, `source_commit=${'a'.repeat(40)}`,
    `created_at=${now - 1}`, `expires_at=${now + 86_400}`, 'key_id=desktop-production-1',
    'engine_node_min=22', 'runtime_node_version=24.11.0', `opencode_version=${opencodeVersion}`
  ];
  const artifacts = [
    ['artifact','provision.sh'], ['engine','desktop-tools-engine.mjs'], ['catalog','catalog.json'], ['launcher','start'],
    ['runtime_macos_x64','node-macos-x64.tar.gz'], ['runtime_macos_arm64','node-macos-arm64.tar.gz'],
    ['runtime_linux_x64','node-linux-x64.tar.gz'], ['runtime_linux_arm64','node-linux-arm64.tar.gz'],
    ['opencode_macos_x64','opencode-macos-x64.zip'], ['opencode_macos_arm64','opencode-macos-arm64.zip'],
    ['opencode_linux_x64','opencode-linux-x64.tar.gz'], ['opencode_linux_arm64','opencode-linux-arm64.tar.gz'],
    ['supervisor','desktop-tools-supervisor.mjs'], ['tools','desktop-tools-tools.tar.gz'], ['opencode_lock','opencode.lock.json'],
    ['sbom','release.sbom.json'], ['provenance','release.provenance.json'], ['licenses','THIRD_PARTY_LICENSES.txt']
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
    async read(key) { return objects.get(key) ?? null; },
    async compareAndSwap(key, bytes, expectedEtag) {
      const current = objects.get(key);
      if ((current?.etag ?? undefined) !== expectedEtag) return { ok: false };
      const etag = `etag-${objects.size + 1}`;
      objects.set(key, { bytes: Buffer.from(bytes), etag });
      return { ok: true, etag };
    }
  };
}

test('publishes an exact Desktop Tools v7 release in a product-qualified immutable keyspace', async t => {
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

test('activates only inspected Desktop Tools releases with product-qualified CAS and exact rollback', async t => {
  const now = Math.floor(Date.now() / 1_000);
  const target = storage();
  const channels = storage();
  const verifySignature = async () => {};
  const firstFixture = await fixture(t);
  const secondFixture = await fixture(t);
  await publishDesktopRelease({ ...firstFixture, expectedReleaseId: firstFixture.releaseId, storage: target, verifySignature, now });
  await publishDesktopRelease({ ...secondFixture, expectedReleaseId: secondFixture.releaseId, storage: target, verifySignature, now });
  const first = await inspectPublishedDesktopRelease({ expectedReleaseId: firstFixture.releaseId, storage: target, verifySignature, now });
  const second = await inspectPublishedDesktopRelease({ expectedReleaseId: secondFixture.releaseId, storage: target, verifySignature, now });
  const promoted1 = await activateDesktopRelease({ channel: 'stable', release: first, storage: channels,
    expectedEtag: undefined, activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    activatedAt: '2026-11-08T12:00:00.000Z', now, minimumPromotionRemainingSeconds: 3_600 });
  const promoted2 = await activateDesktopRelease({ channel: 'stable', release: second, storage: channels,
    expectedEtag: promoted1.etag, activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    activatedAt: '2026-11-08T12:01:00.000Z', now, minimumPromotionRemainingSeconds: 3_600 });
  const rollback = await activateDesktopRelease({ channel: 'stable', release: first, storage: channels,
    expectedEtag: promoted2.etag, kind: 'rollback', rollbackOfActivationId: promoted2.pointer.activationId,
    activationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedAt: '2026-11-08T12:02:00.000Z', now });
  assert.equal(rollback.pointer.generation, 3);
  assert.equal(JSON.parse(channels.objects.get('desktop-tools/channels/stable.json').bytes).product, 'desktop-tools');
  assert.equal([...channels.objects.keys()].some(key => key.startsWith('bootstrap/')), false);
  await assert.rejects(activateDesktopRelease({ channel: 'stable', release: { ...second, product: 'legacy-install-doctor' }, storage: channels,
    expectedEtag: rollback.etag, activationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', activatedAt: '2026-11-08T12:03:00.000Z', now }), /product mismatch/);
});

test('reconciles a post-CAS receipt failure without repeating activation', async t => {
  const now = Math.floor(Date.now() / 1_000);
  const releaseStorage = storage();
  const channels = storage();
  const releaseFixture = await fixture(t);
  const verifySignature = async () => {};
  await publishDesktopRelease({ ...releaseFixture, expectedReleaseId: releaseFixture.releaseId, storage: releaseStorage, verifySignature, now });
  const release = await inspectPublishedDesktopRelease({ expectedReleaseId: releaseFixture.releaseId, storage: releaseStorage, verifySignature, now });
  const originalCreate = channels.create;
  let failReceipt = true;
  channels.create = async (key, bytes, metadata) => {
    if (failReceipt && key.startsWith('desktop-tools/activation-receipts/')) throw new Error('injected receipt outage');
    return originalCreate(key, bytes, metadata);
  };
  const activationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const activated = await activateDesktopRelease({ channel: 'stable', release, storage: channels,
    expectedEtag: undefined, activationId, activatedAt: '2026-11-08T13:00:00.000Z', now,
    minimumPromotionRemainingSeconds: 3_600 });
  assert.equal(activated.status, 'activated_receipt_pending');
  failReceipt = false;
  const reconciled = await reconcileDesktopActivationReceipt({ channel: 'stable', activationId, storage: channels });
  assert.equal(reconciled.status, 'reconciled');
  assert.equal((await reconcileDesktopActivationReceipt({ channel: 'stable', activationId, storage: channels })).status, 'already-present');
  assert.equal(JSON.parse(channels.objects.get('desktop-tools/channels/stable.json').bytes).generation, 1);
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
