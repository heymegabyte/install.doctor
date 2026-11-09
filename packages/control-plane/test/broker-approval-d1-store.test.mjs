import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBrokerApprovalD1Store } from '../src/broker-approval-d1-store.ts';

const migration = fs.readFileSync(
  new URL('../migrations/0013_broker_approval_state.sql', import.meta.url),
  'utf8',
);
const hex = character => character.repeat(64);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(migration);
  const grant = {
    schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1',
    runId: 'run-1', planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: 1000,
    brokerExecutableDigest: hex('b'), runtimeDigest: hex('c'), workerDigest: hex('d'),
    operations: [{ taskId: 'package.tree', operationId: 'package.tree.apply', phase: 'apply' }],
    descriptorDigest: hex('e'), closureDigest: hex('f'), consentDigest: hex('1'),
    issuedAt: '2026-11-09T11:59:00.000Z', expiresAt: '2026-11-09T12:20:00.000Z',
  };
  const delegation = {
    schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId: 'key-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools', releaseId: 'release-1', channel: 'stable', publicKeySpki: 'A'.repeat(44),
    notBefore: '2026-11-09T11:00:00.000Z', notAfter: '2026-11-09T13:00:00.000Z',
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 1, delegationDigest: hex('2'),
  };
  sqlite.prepare(`INSERT INTO broker_approval_states (
    authorization_id, owner_decision_id, owner_actor_id, owner_decision,
    owner_reauthenticated_at, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id, grant_id, status,
    grant_json, delegation_json, created_at
  ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`)
    .run('authorization-1', 'decision-1', 'owner-1', '2026-11-09T11:58:00.000Z',
      'tenant-1', 'profile-1', hex('3'), 'credential-1', hex('4'), 'intent-1', 'grant-1',
      JSON.stringify(grant), JSON.stringify(delegation), '2026-11-09T11:58:30.000Z');

  const db = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) { values = bound; return statement; },
        async first() {
          const row = sqlite.prepare(sql).get(...values);
          return row ? { ...row } : null;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
  const store = createBrokerApprovalD1Store(db, {
    now: () => new Date('2026-11-09T12:00:00.000Z'),
  });
  const request = {
    schemaVersion: 1, authorizationId: 'authorization-1', ownerDecisionId: 'decision-1',
    tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: hex('3'),
    deviceCredentialId: 'credential-1', deviceFingerprint: hex('4'),
    runIntentId: 'intent-1', grantId: 'grant-1',
  };
  return { sqlite, store, request, grant, delegation };
}

test('loads only the exact authority binding and reconstructs immutable JSON state', async () => {
  const setup = fixture();
  const state = await setup.store.loadExactState(setup.request);
  assert.deepEqual(state.grant, setup.grant);
  assert.deepEqual(state.delegation, setup.delegation);
  assert.equal(state.ownerActorId, 'owner-1');
  assert.equal(state.status, 'approved');

  for (const changed of [
    { authorizationId: 'authorization-2' }, { ownerDecisionId: 'decision-2' },
    { tenantId: 'tenant-2' }, { profileId: 'profile-2' },
    { profileRevisionDigest: hex('5') }, { deviceCredentialId: 'credential-2' },
    { deviceFingerprint: hex('6') }, { runIntentId: 'intent-2' }, { grantId: 'grant-2' },
  ]) assert.equal(await setup.store.loadExactState({ ...setup.request, ...changed }), null);
});

test('atomically consumes one approval and rejects replay, mismatched state, and id collision', async () => {
  const setup = fixture();
  const exact = {
    approvalId: 'approval-1', authorizationId: 'authorization-1',
    ownerDecisionId: 'decision-1', runIntentId: 'intent-1',
  };
  const outcomes = await Promise.all([
    setup.store.consumeApproval(exact), setup.store.consumeApproval({ ...exact, approvalId: 'approval-2' }),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(await setup.store.consumeApproval(exact), false);

  const second = fixture();
  assert.equal(await second.store.consumeApproval({ ...exact, ownerDecisionId: 'decision-2' }), false);
  assert.equal(await second.store.consumeApproval({ ...exact, runIntentId: 'intent-2' }), false);
  assert.equal(await second.store.consumeApproval({ ...exact, authorizationId: 'authorization-2' }), false);
  assert.equal(second.sqlite.prepare('SELECT count(*) AS n FROM broker_approval_consumptions').get().n, 0);
});

test('migration makes authority state and consumption receipts append-only', async () => {
  const setup = fixture();
  assert.throws(() => setup.sqlite.prepare(
    "UPDATE broker_approval_states SET tenant_id='tenant-2' WHERE authorization_id='authorization-1'",
  ).run(), /immutable/);
  assert.throws(() => setup.sqlite.prepare(
    "DELETE FROM broker_approval_states WHERE authorization_id='authorization-1'",
  ).run(), /immutable/);

  assert.equal(await setup.store.consumeApproval({
    approvalId: 'approval-1', authorizationId: 'authorization-1',
    ownerDecisionId: 'decision-1', runIntentId: 'intent-1',
  }), true);
  assert.throws(() => setup.sqlite.prepare(
    "UPDATE broker_approval_consumptions SET run_intent_id='intent-2' WHERE approval_id='approval-1'",
  ).run(), /immutable/);
  assert.throws(() => setup.sqlite.prepare(
    "DELETE FROM broker_approval_consumptions WHERE approval_id='approval-1'",
  ).run(), /immutable/);
});
