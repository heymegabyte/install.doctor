import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivilegedBrokerStore } from '../dist/privileged-broker-store.js';

const hex = character => character.repeat(64);
const uid = process.getuid();

function grant(overrides = {}) {
  return {
    schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
    planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: uid,
    operations: [{ taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' }],
    descriptorDigest: hex('b'), closureDigest: hex('c'), consentDigest: hex('d'),
    issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z', ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    schemaVersion: 1, approvalId: 'approval-1', method: 'signed-device',
    hostId: 'host-1', runId: 'run-1', planDigest: hex('a'), consentDigest: hex('d'),
    evidenceDigest: hex('9'), approvedAt: '2026-11-08T12:00:00.000Z', ...overrides,
  };
}

test('root-side store publishes idempotent exact grants and durably consumes each nonce once', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'broker-store-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'authority');
  const store = await createPrivilegedBrokerStore({ root, ownerUid: uid, verifyApproval: async evidence => evidence.evidenceDigest === hex('9') });
  const first = await store.publishGrant(grant(), approval());
  const repeated = await store.publishGrant(grant(), approval());
  assert.equal(repeated.digest, first.digest);
  assert.equal((await store.readGrant('grant-1')).digest, first.digest);
  const nonce = 'nonce_nonce_nonce_nonce_nonce_nonce_1';
  assert.equal(await store.consumeNonce('grant-1', nonce, hex('e')), true);
  assert.equal(await store.consumeNonce('grant-1', nonce, hex('e')), false);
  assert.equal(await readFile(join(root, 'nonces', 'grant-1', nonce), 'ascii'), `${hex('e')}\n`);
  await assert.rejects(store.publishGrant(grant({ consentDigest: hex('f') }), approval({ consentDigest: hex('f') })), /identifier collision/);
  await assert.rejects(store.publishGrant(grant({ grantId: 'grant-2' }), approval({ evidenceDigest: hex('8') })), /not independently verified/);
});

test('root-side store rejects writable and tampered authority', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'broker-store-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'authority');
  const store = await createPrivilegedBrokerStore({ root, ownerUid: uid, verifyApproval: async () => true });
  await store.publishGrant(grant(), approval());
  const path = join(root, 'grants', 'grant-1.json');
  await chmod(path, 0o666);
  await assert.rejects(store.readGrant('grant-1'), /protected bounded regular file/);
  await chmod(path, 0o600);
  await writeFile(path, JSON.stringify(grant({ grantId: 'grant-2' })));
  await assert.rejects(store.readGrant('grant-1'), /identity mismatch|grant identity/);
});
