import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import {
  activateDesktopRelease, DESKTOP_RELEASE_FILES, DESKTOP_RELEASE_V8_FILES, DESKTOP_RELEASE_V9_FILES,
  inspectActiveDesktopReleaseFreshness, inspectPublishedDesktopRelease, publishDesktopRelease,
  reconcileDesktopActivationReceipt
} from '../scripts/desktop-release-publication.mjs';

import { createSignatureVerifier } from '../scripts/publish-release-to-r2.mjs';

const jsonObject = z.record(z.string(), z.unknown());
const sbomSchema = z.looseObject({ components: z.array(z.looseObject({ name: z.string() })) });

void test('CLI verifier uses the signed promotion payload and rejects different bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-promotion-signature-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'signer');
  const evidence = join(directory, 'evidence.json');
  const namespace = 'desktop.tools.promotion-health';
  const payload = Buffer.from('{"result":"passed"}\n');
  await writeFile(evidence, payload);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', key, '-n', namespace, evidence]);
  const verify = await createSignatureVerifier('desktop-tools', {
    DESKTOP_TOOLS_RELEASE_SIGNER_ID: 'test-signer',
    DESKTOP_TOOLS_RELEASE_PUBLIC_KEY: key + '.pub',
  });
  const claim = { namespace, signerId: 'test-signer', signature: await readFile(evidence + '.sig') };
  await verify({ ...claim, payload });
  await assert.rejects(verify({ ...claim, payload: Buffer.from('different bytes') }), /signature verification failed/);
});

/** @param {Uint8Array} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value @returns {unknown} */
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)])) : value;
/** @param {string} domain @param {unknown} value */
const semanticDigest = (domain, value) => digest(Buffer.from(`${domain}\0${JSON.stringify(canonicalValue(value))}`));

/** @param {import('node:test').TestContext} t @param {(value: string[]) => string[]} [mutate] */
async function fixture(t, mutate = value => value, schemaVersion = 7) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const releaseId = `desktop-${randomUUID()}`;
  /** @type {Map<string, Buffer>} */
  const bodies = new Map();
  /** @param {string} name */
  const artifactBytes = name => {
    const body = bodies.get(name);
    assert.ok(body, `missing fixture payload: ${name}`);
    return body;
  };
  const evidence = ['manifest', 'manifest.sig', 'release.sbom.json', 'release.provenance.json', 'THIRD_PARTY_LICENSES.txt'];
  const releaseFiles = schemaVersion === 9 ? DESKTOP_RELEASE_V9_FILES
    : schemaVersion === 8 ? DESKTOP_RELEASE_V8_FILES : DESKTOP_RELEASE_FILES;
  for (const name of releaseFiles.filter(name => !evidence.includes(name))) bodies.set(name, Buffer.from(`${name}\n`));
  bodies.set('catalog.json', Buffer.from('[]\n'));
  const now = Math.floor(Date.now() / 1_000);
  if (schemaVersion === 9) {
    const { publicKey } = generateKeyPairSync('ed25519');
    const projection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
      keyId: 'broker-approval-production-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
      product: 'desktop-tools', releaseId, channel: 'stable',
      publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      notBefore: new Date((now - 60) * 1_000).toISOString(), notAfter: new Date((now + 172_800) * 1_000).toISOString(),
      maximumApprovalLifetimeSeconds: 600, revocationEpoch: 7 };
    const delegation = { ...projection, delegationDigest:
      semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', projection) };
    bodies.set('broker-approval-signer-delegation.json', Buffer.from(`${JSON.stringify(canonicalValue(delegation))}\n`));
  }
  const opencodeVersion = '2.2.5';
  const lockedNames = { macos_x64: 'opencode-macos-x64.zip', macos_arm64: 'opencode-macos-arm64.zip',
    linux_x64: 'opencode-linux-x64.tar.gz', linux_arm64: 'opencode-linux-arm64.tar.gz' };
  /** @type {Record<string, {releaseFilename: string, upstreamUrl: string, sha256: string, size: number}>} */
  const lockedArtifacts = {};
  const lock = { schemaVersion: 1, name: 'opencode', version: opencodeVersion, sourceCommit: 'c'.repeat(40), license: 'MIT',
    sourceVerification: { tagCommit: 'c'.repeat(40), gitHubVerified: false, assetDigestSource: 'github-release-api' }, artifacts: lockedArtifacts };
  for (const [platform, name] of Object.entries(lockedNames)) lock.artifacts[platform] = { releaseFilename: name,
    upstreamUrl: `https://github.com/anomalyco/opencode/releases/download/v${opencodeVersion}/fixture-${name}`,
    sha256: digest(artifactBytes(name)), size: artifactBytes(name).byteLength };
  bodies.set('opencode.lock.json', Buffer.from(`${JSON.stringify(lock)}\n`));
  const closure = [...bodies.entries()];
  bodies.set('release.sbom.json', Buffer.from(`${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { name: 'desktop-tools-release', version: releaseId, properties: [
      { name: 'desktop.tools:source-commit', value: 'a'.repeat(40) }, { name: 'desktop.tools:opencode-version', value: opencodeVersion }
    ] } }, components: closure.map(([name, bytes]) => ({ name, hashes: [{ alg: 'SHA-256', content: digest(bytes) }] })) })}\n`));
  const provenance = { _type: 'https://in-toto.io/Statement/v1',
    predicateType: 'https://slsa.dev/provenance/v1', subject: closure.map(([name, bytes]) => ({ name, digest: { sha256: digest(bytes) } })),
    predicate: { buildDefinition: { externalParameters: { releaseId, sourceCommit: 'a'.repeat(40), opencodeVersion,
      ...(schemaVersion >= 8 && { debianTrustPolicySha256: 'd'.repeat(64), debianCompositionSha256: 'e'.repeat(64) }) },
      resolvedDependencies: Object.values(lock.artifacts).map(artifact => ({ uri: artifact.upstreamUrl, digest: { sha256: artifact.sha256 } })) } } };
  if (schemaVersion >= 8) {
    const parameters = provenance.predicate.buildDefinition.externalParameters;
    assert.ok(parameters.debianTrustPolicySha256 && parameters.debianCompositionSha256);
    for (const [name, bytes] of [...bodies.entries()].filter(([name]) => name.startsWith('debian-') || name.endsWith('_amd64.deb'))) {
      provenance.predicate.buildDefinition.resolvedDependencies.push({ uri: `https://deb.debian.org/${name}`, digest: { sha256: digest(bytes) } });
    }
    provenance.predicate.buildDefinition.resolvedDependencies.push(
      { uri: 'source:fixture:debian-trust-policy', digest: { sha256: parameters.debianTrustPolicySha256 } },
      { uri: 'composition:tree:2.1.0-1', digest: { sha256: parameters.debianCompositionSha256 } }
    );
  }
  bodies.set('release.provenance.json', Buffer.from(`${JSON.stringify(provenance)}\n`));
  bodies.set('THIRD_PARTY_LICENSES.txt', Buffer.from(`OpenCode ${opencodeVersion}\nMIT License\n`));
  const entries = [
    `schema_version=${String(schemaVersion)}`, 'product_id=desktop-tools', `release_id=${releaseId}`, `source_commit=${'a'.repeat(40)}`,
    `created_at=${String(now - 1)}`, `expires_at=${String(now + 86_400)}`, 'key_id=desktop-production-1',
    'engine_node_min=22', 'runtime_node_version=24.11.0', `opencode_version=${opencodeVersion}`
  ];
  if (schemaVersion === 9) entries.push('broker_approval_minimum_revocation_epoch=7');
  /** @type {[string, string][]} */
  const artifacts = [
    ['artifact','provision.sh'], ['engine','desktop-tools-engine.mjs'], ['catalog','catalog.json'], ['launcher','start'],
    ['runtime_macos_x64','node-macos-x64.tar.gz'], ['runtime_macos_arm64','node-macos-arm64.tar.gz'],
    ['runtime_linux_x64','node-linux-x64.tar.gz'], ['runtime_linux_arm64','node-linux-arm64.tar.gz'],
    ['opencode_macos_x64','opencode-macos-x64.zip'], ['opencode_macos_arm64','opencode-macos-arm64.zip'],
    ['opencode_linux_x64','opencode-linux-x64.tar.gz'], ['opencode_linux_arm64','opencode-linux-arm64.tar.gz'],
    ['supervisor','desktop-tools-supervisor.mjs'], ['tools','desktop-tools-tools.tar.gz'], ['opencode_lock','opencode.lock.json'],
    ['sbom','release.sbom.json'], ['provenance','release.provenance.json'], ['licenses','THIRD_PARTY_LICENSES.txt']
  ];
  if (schemaVersion >= 8) artifacts.push(
    ['debian_inrelease','debian-bookworm-inrelease'], ['debian_keyring','debian-bookworm-archive-keyring.gpg'],
    ['debian_packages','debian-bookworm-main-amd64-Packages.xz'], ['debian_tree','tree_2.1.0-1_amd64.deb']
  );
  if (schemaVersion === 9) artifacts.push(
    ['broker_approval_delegation','broker-approval-signer-delegation.json']
  );
  for (const [prefix, name] of artifacts) entries.push(
    `${prefix}_url=https://desktop.tools/releases/${releaseId}/${name}`,
    `${prefix}_sha256=${digest(artifactBytes(name))}`,
    `${prefix}_size=${String(artifactBytes(name).byteLength)}`
  );
  bodies.set('manifest', Buffer.from(`${mutate(entries).join('\n')}\n`));
  bodies.set('manifest.sig', Buffer.from('signature\n'));
  for (const [name, bytes] of bodies) await writeFile(join(directory, name), bytes, { mode: 0o600 });
  return { directory, releaseId };
}

/** @typedef {ReturnType<typeof import('../scripts/r2-publication-storage.mjs').createR2PublicationStorage>} Storage */
/** @typedef {{ bytes: Buffer, etag: string }} StoredObject */
/** @typedef {[string, Parameters<Storage['create']>[2]]} CreateCall */
/** @returns {Storage & { objects: Map<string, StoredObject>, creates: CreateCall[] }} */
function storage() {
  /** @type {Map<string, StoredObject>} */
  const objects = new Map();
  /** @type {CreateCall[]} */
  const creates = [];
  return { objects, creates,
    create: (key, bytes, metadata) => {
      creates.push([key, metadata]);
      if (objects.has(key)) return Promise.resolve(false);
      objects.set(key, { bytes: Buffer.from(bytes), etag: `created-${String(objects.size + 1)}` });
      return Promise.resolve(true);
    },
    read: key => Promise.resolve(objects.get(key) ?? null),
    compareAndSwap: (key, bytes, expectedEtag) => {
      const current = objects.get(key);
      if (current?.etag !== expectedEtag) return Promise.resolve({ ok: false });
      const etag = `etag-${String(objects.size + 1)}`;
      objects.set(key, { bytes: Buffer.from(bytes), etag });
      return Promise.resolve({ ok: true, etag });
    }
  };
}

void test('publishes an exact Desktop Tools v7 release in a product-qualified immutable keyspace', async t => {
  const release = await fixture(t);
  const target = storage();
  /** @type {Parameters<Parameters<typeof publishDesktopRelease>[0]['verifySignature']>[0] | undefined} */
  let verified;
  const result = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target,
    verifySignature: input => { verified = input; } });
  assert.equal(result.product, 'desktop-tools');
  assert.equal(verified?.namespace, 'desktop.tools.release');
  assert.equal(target.creates.at(-1)?.[0], `desktop-tools/bootstrap/${release.releaseId}/manifest`);
  assert.equal(target.creates.some(([key]) => key.startsWith('bootstrap/')), false);
  const retry = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target, verifySignature: async () => {} });
  assert.equal(retry.outcomes.every(item => item.outcome === 'already-present'), true);
});

void test('publishes and reinspects an exact Desktop Tools v8 release with four Debian payloads and manifest last', async t => {
  const release = await fixture(t, value => value, 8);
  const target = storage();
  const result = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target,
    verifySignature: async () => {} });
  assert.equal(result.product, 'desktop-tools');
  assert.equal(target.creates.at(-1)?.[0], `desktop-tools/bootstrap/${release.releaseId}/manifest`);
  for (const name of ['debian-bookworm-inrelease', 'debian-bookworm-archive-keyring.gpg',
    'debian-bookworm-main-amd64-Packages.xz', 'tree_2.1.0-1_amd64.deb']) {
    assert.equal(target.objects.has(`desktop-tools/bootstrap/${release.releaseId}/${name}`), true);
  }
  const inspected = await inspectPublishedDesktopRelease({ expectedReleaseId: release.releaseId, storage: target,
    verifySignature: async () => {} });
  assert.equal(inspected.schemaVersion, 8);

  const unbound = await fixture(t, value => value, 8);
  const sbomPath = join(unbound.directory, 'release.sbom.json');
  const sbom = sbomSchema.parse(JSON.parse(await readFile(sbomPath, 'utf8')));
  sbom.components = sbom.components.filter(component => component.name !== 'tree_2.1.0-1_amd64.deb');
  const alteredSbom = Buffer.from(`${JSON.stringify(sbom)}\n`);
  await writeFile(sbomPath, alteredSbom);
  const manifestPath = join(unbound.directory, 'manifest');
  const alteredManifest = (await readFile(manifestPath, 'utf8')).split('\n').map(line =>
    line.startsWith('sbom_sha256=') ? `sbom_sha256=${digest(alteredSbom)}`
      : line.startsWith('sbom_size=') ? `sbom_size=${String(alteredSbom.byteLength)}` : line).join('\n');
  await writeFile(manifestPath, alteredManifest);
  await assert.rejects(publishDesktopRelease({ ...unbound, expectedReleaseId: unbound.releaseId, storage: storage(),
    verifySignature: async () => {} }), /SBOM does not bind the exact release payload closure/);
});

void test('publishes and reinspects an exact v9 release with a release-root-bound approval signer delegation', async t => {
  const release = await fixture(t, value => value, 9);
  const target = storage();
  const result = await publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: target,
    verifySignature: async () => {} });
  assert.equal(target.creates.at(-1)?.[0], `desktop-tools/bootstrap/${release.releaseId}/manifest`);
  assert.equal(target.objects.has(`desktop-tools/bootstrap/${release.releaseId}/broker-approval-signer-delegation.json`), true);
  const inspected = await inspectPublishedDesktopRelease({ expectedReleaseId: release.releaseId, storage: target,
    verifySignature: async () => {} });
  assert.equal(inspected.schemaVersion, 9);
  assert.equal(inspected.minimumRevocationEpoch, 7);
  assert.equal(inspected.brokerApprovalDelegation?.releaseId, release.releaseId);
  assert.equal(result.releaseId, release.releaseId);
});

void test('rejects noncanonical, substituted, stale, revoked, wrong-channel, and non-Ed25519 v9 delegations', async t => {
  /** @param {(value: Record<string, unknown>) => Record<string, unknown>} transform @param {RegExp} expected */
  async function alterDelegation(transform, expected) {
    const release = await fixture(t, value => value, 9);
    const path = join(release.directory, 'broker-approval-signer-delegation.json');
    const original = jsonObject.parse(JSON.parse(await readFile(path, 'utf8')));
    const altered = transform(original);
    const bytes = Buffer.from(`${JSON.stringify(altered)}\n`);
    await writeFile(path, bytes);
    const manifestPath = join(release.directory, 'manifest');
    const manifest = (await readFile(manifestPath, 'utf8')).split('\n').map(line =>
      line.startsWith('broker_approval_delegation_sha256=')
        ? `broker_approval_delegation_sha256=${digest(bytes)}`
        : line.startsWith('broker_approval_delegation_size=')
          ? `broker_approval_delegation_size=${String(bytes.byteLength)}` : line).join('\n');
    await writeFile(manifestPath, manifest);
    await assert.rejects(publishDesktopRelease({ ...release, expectedReleaseId: release.releaseId, storage: storage(),
      verifySignature: async () => {} }), expected);
  }
  await alterDelegation(value => Object.fromEntries(Object.entries(value).reverse()), /not canonical JSON/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), releaseId: 'other-release' }), /identity or policy/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), channel: 'beta' }), /identity or policy/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), revocationEpoch: 6 }), /identity or policy/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), notAfter: new Date().toISOString() }), /validity window/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), publicKeySpki: Buffer.from('not-an-ed25519-key').toString('base64url') }), /Ed25519/);
  await alterDelegation(value => ({ .../** @type {Record<string, unknown>} */ (canonicalValue(value)), delegationDigest: 'f'.repeat(64) }), /digest is invalid/);
});

void test('activates only inspected Desktop Tools releases with product-qualified CAS and exact rollback', async t => {
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
  assert.equal(jsonObject.parse(JSON.parse(channels.objects.get('desktop-tools/channels/stable.json')?.bytes.toString('utf8') ?? '')).product, 'desktop-tools');
  assert.equal([...channels.objects.keys()].some(key => key.startsWith('bootstrap/')), false);
  await assert.rejects(activateDesktopRelease({ channel: 'stable', release: { ...second, product: 'legacy-install-doctor' }, storage: channels,
    expectedEtag: rollback.etag, activationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', activatedAt: '2026-11-08T12:03:00.000Z', now }), /product mismatch/);
});

void test('reconciles a post-CAS receipt failure without repeating activation', async t => {
  const now = Math.floor(Date.now() / 1_000);
  const releaseStorage = storage();
  const channels = storage();
  const releaseFixture = await fixture(t);
  const verifySignature = async () => {};
  await publishDesktopRelease({ ...releaseFixture, expectedReleaseId: releaseFixture.releaseId, storage: releaseStorage, verifySignature, now });
  const release = await inspectPublishedDesktopRelease({ expectedReleaseId: releaseFixture.releaseId, storage: releaseStorage, verifySignature, now });
  const originalCreate = channels.create.bind(channels);
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
  assert.equal(jsonObject.parse(JSON.parse(channels.objects.get('desktop-tools/channels/stable.json')?.bytes.toString('utf8') ?? '')).generation, 1);
});

void test('signed cohort health gates suspend failed canaries before CAS and admit only their exact transition', async t => {
  const now = Math.floor(Date.now() / 1_000);
  const releaseStorage = storage();
  const channels = storage();
  const releaseFixture = await fixture(t);
  const verifyRelease = async () => {};
  await publishDesktopRelease({ ...releaseFixture, expectedReleaseId: releaseFixture.releaseId,
    storage: releaseStorage, verifySignature: verifyRelease, now });
  const release = await inspectPublishedDesktopRelease({ expectedReleaseId: releaseFixture.releaseId,
    storage: releaseStorage, verifySignature: verifyRelease, now });
  /** @param {string} result */
  const evidence = result => ({ schemaVersion: 1, product: 'desktop-tools', kind: 'cohort-health',
    releaseId: release.releaseId, sourceCohort: 'build', targetCohort: 'canary', result,
    observedAt: new Date(now * 1_000 - 1_000).toISOString(), expiresAt: new Date(now * 1_000 + 60_000).toISOString(),
    evidenceDigest: 'a'.repeat(64), signerId: 'desktop-health-1', signature: Buffer.alloc(64, 7).toString('base64url') });
  let verified = 0;
  /** @type {NonNullable<Parameters<typeof activateDesktopRelease>[0]['verifyPromotionSignature']>} */
  const verifyPromotionSignature = ({ payload, signature, namespace }) => {
    assert.equal(namespace, 'desktop.tools.promotion-health');
    assert.equal(Buffer.from(payload).includes(Buffer.from(release.releaseId)), true);
    assert.equal(signature.byteLength, 64);
    verified += 1;
  };
  await assert.rejects(activateDesktopRelease({ channel: 'canary', release, storage: channels,
    expectedEtag: undefined, activationId: '11111111-1111-4111-8111-111111111111',
    activatedAt: '2026-11-08T15:00:00.000Z', now, minimumPromotionRemainingSeconds: 3_600,
    promotionEvidence: evidence('failed'), verifyPromotionSignature }), /suspended by failed cohort health/);
  assert.equal(channels.objects.has('desktop-tools/channels/canary.json'), false);
  assert.equal(channels.objects.has(`desktop-tools/promotion-suspensions/${release.releaseId}/canary.json`), true);
  await assert.rejects(activateDesktopRelease({ channel: 'stable', release, storage: channels,
    expectedEtag: undefined, activationId: '22222222-2222-4222-8222-222222222222',
    activatedAt: '2026-11-08T15:01:00.000Z', now, minimumPromotionRemainingSeconds: 3_600,
    promotionEvidence: evidence('passed'), verifyPromotionSignature }), /exact release cohort transition/);
  assert.equal(channels.objects.has('desktop-tools/channels/stable.json'), false);
  const promoted = await activateDesktopRelease({ channel: 'canary', release, storage: channels,
    expectedEtag: undefined, activationId: '33333333-3333-4333-8333-333333333333',
    activatedAt: '2026-11-08T15:02:00.000Z', now, minimumPromotionRemainingSeconds: 3_600,
    promotionEvidence: evidence('passed'), verifyPromotionSignature });
  assert.equal(promoted.status, 'activated');
  assert.ok(promoted.pointer.promotionEvidenceSha256);
  assert.match(promoted.pointer.promotionEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(verified, 2);
});

void test('Desktop Tools freshness is signature-verified, read-only, product-qualified, and expiry-aware', async t => {
  const now = Math.floor(Date.now() / 1_000);
  const releaseStorage = storage();
  const channels = storage();
  const releaseFixture = await fixture(t);
  let verifications = 0;
  const verifySignature = () => { verifications += 1; };
  await publishDesktopRelease({ ...releaseFixture, expectedReleaseId: releaseFixture.releaseId,
    storage: releaseStorage, verifySignature, now });
  const release = await inspectPublishedDesktopRelease({ expectedReleaseId: releaseFixture.releaseId,
    storage: releaseStorage, verifySignature, now });
  await activateDesktopRelease({ channel: 'stable', release, storage: channels, expectedEtag: undefined,
    activationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', activatedAt: '2026-11-08T14:00:00.000Z', now,
    minimumPromotionRemainingSeconds: 3_600 });
  const releaseCreates = releaseStorage.creates.length;
  const channelCreates = channels.creates.length;
  const result = await inspectActiveDesktopReleaseFreshness({ channel: 'stable', channelStorage: channels,
    releaseStorage, verifySignature, now, renewalWindowSeconds: 172_800 });
  assert.equal(result.product, 'desktop-tools');
  assert.equal(result.status, 'renewal-required');
  assert.equal(result.releaseId, releaseFixture.releaseId);
  assert.equal(result.remainingSeconds, 86_400);
  assert.equal(releaseStorage.creates.length, releaseCreates);
  assert.equal(channels.creates.length, channelCreates);
  assert.equal(verifications >= 3, true);

  const pointerKey = 'desktop-tools/channels/stable.json';
  const stored = channels.objects.get(pointerKey);
  assert.ok(stored);
  const pointer = jsonObject.parse(JSON.parse(stored.bytes.toString('utf8')));
  channels.objects.set(pointerKey, { ...stored,
    bytes: Buffer.from(`${JSON.stringify({ ...pointer, manifestSha256: 'f'.repeat(64) })}\n`) });
  await assert.rejects(inspectActiveDesktopReleaseFreshness({ channel: 'stable', channelStorage: channels,
    releaseStorage, verifySignature, now }), /manifest digest mismatch/);
  channels.objects.set(pointerKey, stored);
  const expired = await inspectActiveDesktopReleaseFreshness({ channel: 'stable', channelStorage: channels,
    releaseStorage, verifySignature, now: now + 86_401 });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.remainingSeconds, -1);
});

void test('rejects legacy identity, origin substitution, surplus files, and altered payloads', async t => {
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
