import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateRelease, activateSamePayloadRenewal, inspectActiveReleaseFreshness, inspectPublishedRelease, prepareSamePayloadRenewal,
  publishRelease, reconcileActivationReceipt, RELEASE_FILES,
} from '../scripts/release-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, releaseId = 'release-1', timing = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-publication-'));
  const now = timing.now ?? Math.floor(Date.now() / 1_000);
  const expiresAt = timing.expiresAt ?? now + 500_000;
  const bodies = new Map(RELEASE_FILES.filter(name => !['manifest', 'manifest.sig'].includes(name)).map(name => [name, Buffer.from(`${name}\n`)]));
  bodies.set('start', Buffer.from(`readonly MANIFEST_URL='https://app.install.doctor/releases/${releaseId}/manifest'\nreadonly SIGNATURE_URL='https://app.install.doctor/releases/${releaseId}/manifest.sig'\nreadonly EXPECTED_RELEASE_ID='${releaseId}'\n`));
  const lines = [
    'schema_version=5', `release_id=${releaseId}`, `source_commit=${'a'.repeat(40)}`,
    `created_at=${now - 60}`, `expires_at=${expiresAt}`, 'key_id=test-signer',
    `artifact_url=https://app.install.doctor/releases/${releaseId}/provision.sh`,
    `artifact_sha256=${digest(bodies.get('provision.sh'))}`, `artifact_size=${bodies.get('provision.sh').byteLength}`,
    `engine_url=https://app.install.doctor/releases/${releaseId}/install-doctor-engine.mjs`,
    `engine_sha256=${digest(bodies.get('install-doctor-engine.mjs'))}`, `engine_size=${bodies.get('install-doctor-engine.mjs').byteLength}`,
    'engine_node_min=22', 'runtime_node_version=24.11.0',
    `catalog_url=https://app.install.doctor/releases/${releaseId}/catalog.json`,
    `catalog_sha256=${digest(bodies.get('catalog.json'))}`, `catalog_size=${bodies.get('catalog.json').byteLength}`,
    `launcher_url=https://app.install.doctor/releases/${releaseId}/start`,
    `launcher_sha256=${digest(bodies.get('start'))}`, `launcher_size=${bodies.get('start').byteLength}`,
  ];
  for (const platform of ['macos_x64', 'macos_arm64', 'linux_x64', 'linux_arm64']) {
    const filename = `node-${platform.replaceAll('_', '-')}.tar.gz`;
    lines.push(`runtime_${platform}_url=https://app.install.doctor/releases/${releaseId}/${filename}`);
    lines.push(`runtime_${platform}_sha256=${digest(bodies.get(filename))}`);
    lines.push(`runtime_${platform}_size=${bodies.get(filename).byteLength}`);
  }
  bodies.set('manifest', Buffer.from(`${lines.join('\n')}\n`));
  bodies.set('manifest.sig', Buffer.from('test detached signature\n'));
  for (const [name, bytes] of bodies) await writeFile(join(directory, name), bytes, { mode: 0o600 });
  return { directory, releaseId, bodies };
}

function memoryStorage() {
  const objects = new Map();
  const calls = [];
  return {
    calls, objects,
    async create(key, bytes, metadata) {
      calls.push(['create', key, metadata]);
      if (objects.has(key)) return false;
      objects.set(key, { bytes: Buffer.from(bytes), etag: `etag-${objects.size + 1}` });
      return true;
    },
    async read(key) { calls.push(['read', key]); return objects.get(key) ?? null; },
    async compareAndSwap(key, bytes, expectedEtag) {
      calls.push(['cas', key, expectedEtag]);
      const current = objects.get(key);
      if ((current?.etag ?? undefined) !== expectedEtag) return { ok: false };
      const etag = `etag-${objects.size + 1}-${randomUUID()}`;
      objects.set(key, { bytes: Buffer.from(bytes), etag });
      return { ok: true, etag };
    },
  };
}

test('publishes an exact verified release create-only with manifest last and supports idempotent retry', async t => {
  const release = await fixture(t);
  const storage = memoryStorage();
  let verified = 0;
  const verifySignature = async input => { verified += 1; assert.equal(input.signerId, 'test-signer'); };
  const first = await publishRelease({ ...release, expectedReleaseId: release.releaseId, storage, verifySignature });
  assert.equal(first.outcomes.every(item => item.outcome === 'created'), true);
  assert.equal(storage.calls.filter(([operation]) => operation === 'create').at(-1)[1], `bootstrap/${release.releaseId}/manifest`);
  assert.equal(storage.calls.find(([operation, key]) => operation === 'create' && key.endsWith('/catalog.json'))[2].contentType, 'application/json; charset=utf-8');
  const second = await publishRelease({ ...release, expectedReleaseId: release.releaseId, storage, verifySignature });
  assert.equal(second.outcomes.every(item => item.outcome === 'already-present'), true);
  const inspected = await inspectPublishedRelease({ expectedReleaseId: release.releaseId, storage, verifySignature });
  assert.equal(inspected.manifestSha256, first.manifestSha256);
  assert.equal(verified, 3);
});

test('fails closed on surplus files, altered artifact bindings, and immutable collisions', async t => {
  const release = await fixture(t);
  const storage = memoryStorage();
  const verifySignature = async () => {};
  await writeFile(join(release.directory, 'surplus'), 'x');
  await assert.rejects(publishRelease({ ...release, expectedReleaseId: release.releaseId, storage, verifySignature }), /exact file allowlist/);
  const catalogTamper = await fixture(t, 'release-catalog-tamper');
  await writeFile(join(catalogTamper.directory, 'catalog.json'), '{"tampered":true}\n');
  await assert.rejects(publishRelease({ ...catalogTamper, expectedReleaseId: catalogTamper.releaseId, storage, verifySignature }), /artifact binding mismatch: catalog\.json/);
  const legacy = await fixture(t, 'release-legacy');
  await writeFile(join(legacy.directory, 'manifest'), legacy.bodies.get('manifest').toString('utf8').replace('schema_version=5', 'schema_version=3'));
  await assert.rejects(publishRelease({ ...legacy, expectedReleaseId: legacy.releaseId, storage, verifySignature }), /manifest release identity mismatch/);
  const clean = await fixture(t, 'release-2');
  await publishRelease({ ...clean, expectedReleaseId: clean.releaseId, storage, verifySignature });
  storage.objects.get(`bootstrap/${clean.releaseId}/provision.sh`).bytes = Buffer.from('collision');
  await assert.rejects(publishRelease({ ...clean, expectedReleaseId: clean.releaseId, storage, verifySignature }), /read-back mismatch|collision/);
});

test('activation is intent-first, compare-and-swap guarded, and read-back verified', async () => {
  const storage = memoryStorage();
  const now = Math.floor(Date.now() / 1000);
  const release = { releaseId: 'release-1', signerId: 'test-signer', manifestSha256: 'b'.repeat(64), expiresAt: now + 500_000 };
  const activation = await activateRelease({
    channel: 'stable', release, storage, expectedEtag: undefined,
    activationId: '8dc2b35c-58d6-4de8-8237-d93833f66075', activatedAt: '2026-11-06T09:00:00.000Z', now,
  });
  assert.equal(activation.pointer.releaseId, release.releaseId);
  assert.deepEqual(storage.calls.filter(([operation]) => operation === 'create').map(([, key]) => key), [
    'bootstrap/activations/stable/8dc2b35c-58d6-4de8-8237-d93833f66075.json',
    'bootstrap/activation-receipts/stable/000000000001-8dc2b35c-58d6-4de8-8237-d93833f66075.json',
  ]);
  await assert.rejects(activateRelease({
    channel: 'stable', release: { ...release, releaseId: 'release-2' }, storage, expectedEtag: 'stale',
    activationId: '98f40f6d-b6ce-4514-9872-06e6a74140cf', activatedAt: '2026-11-06T09:01:00.000Z', now,
  }), /expected etag is stale|compare-and-swap failed/);
  const pointer = JSON.parse(storage.objects.get('bootstrap/channels/stable.json').bytes);
  assert.equal(pointer.releaseId, 'release-1');
  assert.equal(pointer.generation, 1);

  const promotedRelease = { ...release, releaseId: 'release-2', manifestSha256: 'c'.repeat(64) };
  const promoted = await activateRelease({
    channel: 'stable', release: promotedRelease, storage, expectedEtag: activation.etag,
    activationId: '98f40f6d-b6ce-4514-9872-06e6a74140cf', activatedAt: '2026-11-06T09:01:00.000Z', now,
  });
  const rollback = await activateRelease({
    channel: 'stable', release, storage, expectedEtag: promoted.etag, kind: 'rollback',
    rollbackOfActivationId: promoted.pointer.activationId,
    activationId: 'a5b6587a-227f-4fb3-82e9-c8ab0ea4ce10', activatedAt: '2026-11-06T09:02:00.000Z', now,
  });
  assert.equal(rollback.pointer.generation, 3);
  assert.equal(rollback.pointer.previous.releaseId, 'release-2');
  assert.equal(rollback.pointer.kind, 'rollback');
});

test('post-CAS receipt failure reports activated receipt pending without repeating activation', async () => {
  const storage = memoryStorage();
  const originalCreate = storage.create;
  storage.create = async (key, bytes, metadata) => {
    if (key.startsWith('bootstrap/activation-receipts/')) throw new Error('injected receipt outage');
    return originalCreate(key, bytes, metadata);
  };
  const result = await activateRelease({
    channel: 'stable', release: { releaseId: 'release-1', signerId: 'test-signer', manifestSha256: 'd'.repeat(64), expiresAt: Math.floor(Date.now() / 1000) + 500_000 },
    storage, expectedEtag: undefined, activationId: 'd382c28c-a73e-4ff7-b252-3b52bf600ab0', activatedAt: '2026-11-06T09:03:00.000Z',
  });
  assert.equal(result.status, 'activated_receipt_pending');
  assert.equal(JSON.parse(storage.objects.get('bootstrap/channels/stable.json').bytes).releaseId, 'release-1');
});

test('active release freshness is signature-verified, bounded, and nonmutating', async t => {
  const now = Math.floor(Date.now() / 1000);
  const release = await fixture(t, 'release-freshness', { now, expiresAt: now + 86_400 });
  const releaseStorage = memoryStorage();
  const channelStorage = memoryStorage();
  const verifySignature = async () => {};
  await publishRelease({ ...release, expectedReleaseId: release.releaseId, storage: releaseStorage, verifySignature });
  const inspected = await inspectPublishedRelease({ expectedReleaseId: release.releaseId, storage: releaseStorage, verifySignature });
  await activateRelease({
    channel: 'stable', release: inspected, storage: channelStorage, expectedEtag: undefined,
    activationId: '230b9ff8-7a39-41df-a9bf-291d896b9f77', activatedAt: '2026-11-06T12:00:00.000Z', now,
    minimumPromotionRemainingSeconds: 3_600,
  });
  const callsBefore = channelStorage.calls.length;
  const result = await inspectActiveReleaseFreshness({
    channel: 'stable', channelStorage, releaseStorage, verifySignature, now, renewalWindowSeconds: 172_800,
  });
  assert.equal(result.status, 'renewal-required');
  assert.equal(result.remainingSeconds, 86_400);
  assert.equal(result.releaseId, release.releaseId);
  assert.equal(result.sourceCommit, 'a'.repeat(40));
  assert.equal(channelStorage.calls.slice(callsBefore).every(([operation]) => operation === 'read'), true);
});

test('active release freshness rejects pointer tampering and reports expiry', async t => {
  const now = Math.floor(Date.now() / 1000);
  const release = await fixture(t, 'release-expiry', { now, expiresAt: now + 3_600 });
  const releaseStorage = memoryStorage();
  const channelStorage = memoryStorage();
  const verifySignature = async () => {};
  await publishRelease({ ...release, expectedReleaseId: release.releaseId, storage: releaseStorage, verifySignature });
  const inspected = await inspectPublishedRelease({ expectedReleaseId: release.releaseId, storage: releaseStorage, verifySignature });
  await activateRelease({
    channel: 'stable', release: inspected, storage: channelStorage, expectedEtag: undefined,
    activationId: 'c39d7a2e-8cdd-4c64-adb1-e0e9e05691b2', activatedAt: '2026-11-06T12:00:00.000Z', now,
    minimumPromotionRemainingSeconds: 3_600,
  });
  const pointerKey = 'bootstrap/channels/stable.json';
  const stored = channelStorage.objects.get(pointerKey);
  const pointer = JSON.parse(stored.bytes);
  channelStorage.objects.set(pointerKey, { ...stored, bytes: Buffer.from(`${JSON.stringify({ ...pointer, manifestSha256: 'f'.repeat(64) })}\n`) });
  await assert.rejects(inspectActiveReleaseFreshness({
    channel: 'stable', channelStorage, releaseStorage, verifySignature, now,
  }), /manifest digest mismatch/);
  channelStorage.objects.set(pointerKey, { ...stored, bytes: Buffer.from(`${JSON.stringify(pointer)}\n`) });
  const expired = await inspectActiveReleaseFreshness({
    channel: 'stable', channelStorage, releaseStorage, verifySignature, now: now + 3_601,
  });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.remainingSeconds, -1);
});

test('activation rejects stale promotion and underconstrained rollback', async () => {
  const now = Math.floor(Date.now() / 1000);
  const storage = memoryStorage();
  const release = { releaseId: 'release-1', signerId: 'test-signer', manifestSha256: 'a'.repeat(64), expiresAt: now + 345_599 };
  await assert.rejects(activateRelease({
    channel: 'stable', release, storage, expectedEtag: undefined,
    activationId: 'fc4388fa-e0a5-44d6-ac7b-f0b1a63af032', activatedAt: '2026-11-06T12:00:00.000Z', now,
  }), /insufficient remaining validity/);
  const current = await activateRelease({
    channel: 'stable', release: { ...release, expiresAt: now + 500_000 }, storage, expectedEtag: undefined,
    activationId: '6ae8dbd6-0abf-40ce-86b8-15cb5f796a2c', activatedAt: '2026-11-06T12:01:00.000Z', now,
  });
  await assert.rejects(activateRelease({
    channel: 'stable', release: { ...release, releaseId: 'not-the-prior-release', expiresAt: now + 500_000 },
    storage, expectedEtag: current.etag, kind: 'rollback', rollbackOfActivationId: current.pointer.activationId,
    activationId: '0b290bbb-7da2-4ef5-8f1d-91c448a7bd74', activatedAt: '2026-11-06T12:02:00.000Z', now,
  }), /exact prior activated release/);
});

test('same-payload renewal changes only envelope identity, URLs, and validity', async t => {
  const now = Math.floor(Date.now() / 1000);
  const renewalEpoch = Math.floor(now / 86_400) * 86_400;
  const source = await fixture(t, 'release-source', { now, expiresAt: now + 86_400 });
  const releaseStorage = memoryStorage();
  const channelStorage = memoryStorage();
  const verifySignature = async () => {};
  await publishRelease({ ...source, expectedReleaseId: source.releaseId, storage: releaseStorage, verifySignature });
  const inspected = await inspectPublishedRelease({ expectedReleaseId: source.releaseId, storage: releaseStorage, verifySignature });
  await activateRelease({
    channel: 'stable', release: inspected, storage: channelStorage, expectedEtag: undefined,
    activationId: 'b78df8f2-9388-4fc3-b285-01f9206e9bc6', activatedAt: '2026-11-06T13:00:00.000Z', now,
    minimumPromotionRemainingSeconds: 3_600,
  });
  const renewalId = `renew-v1-${new Date(renewalEpoch * 1000).toISOString().slice(0, 10).replaceAll('-', '')}-${digest(source.bodies.get('manifest')).slice(0, 16)}`;
  const renewal = await prepareSamePayloadRenewal({
    channel: 'stable', channelStorage, releaseStorage, verifySignature,
    newReleaseId: renewalId, createdAt: renewalEpoch, expiresAt: renewalEpoch + 604_800, now,
  });
  assert.equal(renewal.sourceReleaseId, source.releaseId);
  assert.equal(renewal.sourceCommit, 'a'.repeat(40));
  assert.equal(renewal.files.has('manifest.sig'), false);
  for (const name of RELEASE_FILES.filter(name => !['manifest', 'manifest.sig', 'start'].includes(name))) {
    assert.deepEqual(renewal.files.get(name), source.bodies.get(name), `${name} payload must be byte-identical`);
  }
  const renewedManifest = renewal.files.get('manifest').toString('utf8');
  assert.match(renewedManifest, new RegExp(`^release_id=${renewalId}$`, 'm'));
  assert.match(renewedManifest, new RegExp(`^source_commit=${'a'.repeat(40)}$`, 'm'));
  assert.equal(renewedManifest.includes('/releases/release-source/'), false);
  assert.ok(renewedManifest.includes(`/releases/${renewalId}/provision.sh`));
  assert.ok(renewal.files.get('start').toString('utf8').includes(`/releases/${renewalId}/manifest`));
  const retry = await prepareSamePayloadRenewal({
    channel: 'stable', channelStorage, releaseStorage, verifySignature,
    newReleaseId: renewalId, createdAt: renewalEpoch, expiresAt: renewalEpoch + 604_800, now,
  });
  assert.deepEqual(retry.files.get('manifest'), renewal.files.get('manifest'));
  await assert.rejects(prepareSamePayloadRenewal({
    channel: 'stable', channelStorage, releaseStorage, verifySignature,
    newReleaseId: 'renew-v1-wrong', createdAt: renewalEpoch, expiresAt: renewalEpoch + 604_800, now,
  }), /identity does not match/);
  await assert.rejects(prepareSamePayloadRenewal({
    channel: 'stable', channelStorage, releaseStorage, verifySignature,
    newReleaseId: renewalId, createdAt: renewalEpoch + 1, expiresAt: renewalEpoch + 604_801, now,
  }), /canonical UTC-day/);

  const originalProvisioner = Buffer.from(releaseStorage.objects.get('bootstrap/release-source/provision.sh').bytes);
  releaseStorage.objects.get('bootstrap/release-source/provision.sh').bytes = Buffer.from('tampered');
  await assert.rejects(prepareSamePayloadRenewal({
    channel: 'stable', channelStorage, releaseStorage, verifySignature,
    newReleaseId: renewalId, createdAt: renewalEpoch, expiresAt: renewalEpoch + 604_800, now,
  }), /artifact binding mismatch|digest mismatch/);
  releaseStorage.objects.get('bootstrap/release-source/provision.sh').bytes = originalProvisioner;

  for (const name of RELEASE_FILES) {
    const bytes = name === 'manifest.sig' ? source.bodies.get(name) : renewal.files.get(name);
    await releaseStorage.create(`bootstrap/${renewalId}/${name}`, bytes);
  }
  const { sourceFiles: _sourceFiles, files: _files, ...renewalPlan } = renewal;
  const createChannelObject = channelStorage.create;
  let failRenewalReceipt = true;
  channelStorage.create = async (key, bytes, metadata) => {
    if (failRenewalReceipt && key.startsWith('bootstrap/activation-receipts/')) throw new Error('injected renewal receipt outage');
    return createChannelObject(key, bytes, metadata);
  };
  const activatedRenewal = await activateSamePayloadRenewal({
    renewalPlan, channelStorage, releaseStorage, verifySignature,
    activationId: '4d013119-bb76-4c77-9c1f-58d7a9f750d0', activatedAt: '2026-11-06T13:05:00.000Z', now,
  });
  assert.equal(activatedRenewal.status, 'activated_receipt_pending');
  assert.equal(activatedRenewal.pointer.releaseId, renewalId);
  assert.equal(activatedRenewal.pointer.previous.releaseId, source.releaseId);
  failRenewalReceipt = false;
  const recoveredRenewal = await activateSamePayloadRenewal({
    renewalPlan, channelStorage, releaseStorage, verifySignature,
    activationId: '4d013119-bb76-4c77-9c1f-58d7a9f750d0', activatedAt: '2026-11-06T13:05:00.000Z', now,
  });
  assert.equal(recoveredRenewal.status, 'already-activated');
  assert.equal(JSON.parse(channelStorage.objects.get('bootstrap/channels/stable.json').bytes).generation, 2);
  await assert.rejects(activateSamePayloadRenewal({
    renewalPlan, channelStorage, releaseStorage, verifySignature,
    activationId: 'd6054c46-bfe1-4fbd-98c0-33a372754e8f', activatedAt: '2026-11-06T13:06:00.000Z', now,
  }), /no longer the exact active release/);

});

test('receipt reconciliation is idempotent and requires exact current authoritative intent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const storage = memoryStorage();
  const originalCreate = storage.create;
  let injectReceiptFailure = true;
  storage.create = async (key, bytes, metadata) => {
    if (injectReceiptFailure && key.startsWith('bootstrap/activation-receipts/')) throw new Error('injected receipt outage');
    return originalCreate(key, bytes, metadata);
  };
  const activationId = '0e1648fc-7b0c-4e14-983b-170dba102692';
  const result = await activateRelease({
    channel: 'stable',
    release: { releaseId: 'release-1', signerId: 'test-signer', manifestSha256: 'e'.repeat(64), expiresAt: now + 500_000 },
    storage, expectedEtag: undefined, activationId, activatedAt: '2026-11-06T13:01:00.000Z', now,
  });
  assert.equal(result.status, 'activated_receipt_pending');
  injectReceiptFailure = false;
  const reconciled = await reconcileActivationReceipt({ channel: 'stable', activationId, storage });
  assert.equal(reconciled.status, 'reconciled');
  assert.equal((await reconcileActivationReceipt({ channel: 'stable', activationId, storage })).status, 'already-present');
  const intent = storage.objects.get(`bootstrap/activations/stable/${activationId}.json`);
  storage.objects.set(`bootstrap/activations/stable/${activationId}.json`, { ...intent, bytes: Buffer.from('{}\n') });
  await assert.rejects(reconcileActivationReceipt({ channel: 'stable', activationId, storage }), /intent.*match|invalid|parse/i);
});
