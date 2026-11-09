import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { brokerApprovalSemanticDigest } from '../../aid-core/dist/broker-approval-contracts.js';
import {
  createImmutableBrokerDelegationResolver,
  loadImmutableBrokerReleaseDelegation,
} from '../src/broker-release-delegation-loader.ts';

const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonicalValue(entry)])) : value;
const bytes = value => new TextEncoder().encode(`${JSON.stringify(canonicalValue(value))}\n`);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

async function fixture(transform = value => value, recompute = false) {
  const { publicKey } = generateKeyPairSync('ed25519');
  const projection = {
    schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation', keyId: 'approval-key-1',
    algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1', product: 'desktop-tools',
    releaseId: 'release-1', channel: 'stable',
    publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    notBefore: '2026-11-09T11:00:00.000Z', notAfter: '2026-11-09T13:00:00.000Z',
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 7,
  };
  let delegation = transform({ ...projection, delegationDigest: await brokerApprovalSemanticDigest(
    'desktop-tools:broker-approval-signer-delegation:v1', projection,
  ) });
  if (recompute) {
    const { delegationDigest: _discarded, ...changedProjection } = delegation;
    delegation = { ...changedProjection, delegationDigest: await brokerApprovalSemanticDigest(
      'desktop-tools:broker-approval-signer-delegation:v1', changedProjection,
    ) };
  }
  const body = bytes(delegation);
  const release = {
    schemaVersion: 9, product: 'desktop-tools', channel: 'stable', releaseId: 'release-1',
    expiresAt: Date.parse('2026-11-09T14:00:00.000Z') / 1000,
    brokerApproval: {
      delegationUrl: 'https://desktop.tools/releases/release-1/broker-approval-signer-delegation.json',
      delegationSha256: await digest(body), delegationSize: body.byteLength, minimumRevocationEpoch: 7,
    },
  };
  const keys = [];
  const bucket = { async get(key) { keys.push(key); return { size: body.byteLength,
    body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }) }; } };
  return { delegation, body, release, bucket, keys };
}

test('loads only the exact immutable release key and composes an active-release resolver', async () => {
  const setup = await fixture();
  const result = await loadImmutableBrokerReleaseDelegation({ bucket: setup.bucket, release: setup.release,
    now: new Date('2026-11-09T12:00:00.000Z') });
  assert.deepEqual(result.delegation, setup.delegation);
  assert.equal(result.minimumRevocationEpoch, 7);
  assert.deepEqual(setup.keys, ['desktop-tools/bootstrap/release-1/broker-approval-signer-delegation.json']);
  const resolver = createImmutableBrokerDelegationResolver({ bucket: setup.bucket,
    resolveActiveRelease: async () => setup.release, now: () => new Date('2026-11-09T12:00:00.000Z') });
  assert.equal((await resolver.delegationForRelease('release-1')).keyId, 'approval-key-1');
  assert.equal(await resolver.delegationForRelease('release-2'), null);
});

test('rejects substituted release, channel, epoch, semantic digest, and public key', async () => {
  const cases = [
    value => ({ ...value, releaseId: 'release-2' }),
    value => ({ ...value, channel: 'beta' }),
    value => ({ ...value, revocationEpoch: 6 }),
    value => ({ ...value, publicKeySpki: Buffer.from('not-ed25519').toString('base64url') }),
  ];
  for (const transform of cases) {
    const setup = await fixture(transform, true);
    await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: setup.bucket, release: setup.release,
      now: new Date('2026-11-09T12:00:00.000Z') }));
  }
  const badDigest = await fixture(value => ({ ...value, delegationDigest: 'f'.repeat(64) }));
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: badDigest.bucket, release: badDigest.release,
    now: new Date('2026-11-09T12:00:00.000Z') }), /semantic digest/);
});

test('rejects size substitution, truncation, excess bytes, digest substitution, and noncanonical JSON', async () => {
  const setup = await fixture();
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: setup.bucket,
    release: { ...setup.release, brokerApproval: { ...setup.release.brokerApproval,
      delegationSize: setup.body.byteLength + 1 } }, now: new Date('2026-11-09T12:00:00.000Z') }), /stored size/);
  const stored = (body, size = body.byteLength) => ({ get: async () => ({ size,
    body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }) }) });
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: stored(setup.body.slice(0, -1), setup.body.byteLength),
    release: setup.release, now: new Date('2026-11-09T12:00:00.000Z') }), /truncated/);
  const excess = new Uint8Array(setup.body.byteLength + 1); excess.set(setup.body); excess.at(-1) === 1;
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: stored(excess, setup.body.byteLength),
    release: setup.release, now: new Date('2026-11-09T12:00:00.000Z') }), /exceeds/);
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: setup.bucket,
    release: { ...setup.release, brokerApproval: { ...setup.release.brokerApproval,
      delegationSha256: '0'.repeat(64) } }, now: new Date('2026-11-09T12:00:00.000Z') }), /digest/);
  const reversed = new TextEncoder().encode(`${JSON.stringify(Object.fromEntries(Object.entries(setup.delegation).reverse()))}\n`);
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: stored(reversed),
    release: { ...setup.release, brokerApproval: { ...setup.release.brokerApproval,
      delegationSize: reversed.byteLength, delegationSha256: await digest(reversed) } },
    now: new Date('2026-11-09T12:00:00.000Z') }), /canonical JSON/);
});

test('rejects expired release, premature or expired delegation, and delegation beyond release lifetime', async () => {
  const setup = await fixture();
  for (const now of ['2026-11-09T10:59:59.000Z', '2026-11-09T13:00:00.000Z', '2026-11-09T14:00:00.000Z']) {
    await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: setup.bucket, release: setup.release,
      now: new Date(now) }), /expired|validity window/);
  }
  const beyond = await fixture(value => ({ ...value, notAfter: '2026-11-09T15:00:00.000Z' }), true);
  await assert.rejects(loadImmutableBrokerReleaseDelegation({ bucket: beyond.bucket, release: beyond.release,
    now: new Date('2026-11-09T12:00:00.000Z') }), /validity window/);
});
