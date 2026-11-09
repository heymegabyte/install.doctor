import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  BrokerOwnerDecision,
  BrokerRunIntent,
  createBrokerRunIntentD1Store,
} from '../src/broker-run-intent-d1-store.ts';

const migration = fs.readFileSync(
  new URL('../migrations/0014_broker_run_authority.sql', import.meta.url), 'utf8',
);
const hex = character => character.repeat(64);

function fixture(now = '2026-11-09T12:04:00.000Z') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(migration);
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
  const store = createBrokerRunIntentD1Store(db, { now: () => new Date(now) });
  const intent = {
    schemaVersion: 1, runIntentId: 'intent-1', authorizationId: 'authorization-1',
    tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: hex('a'),
    deviceCredentialId: 'credential-1', deviceFingerprint: hex('b'), grantId: 'grant-1',
    hostId: 'host-1', releaseId: 'release-1', runId: 'run-1', planDigest: hex('c'),
    enrolledUid: 1000, brokerExecutableDigest: hex('d'), runtimeDigest: hex('e'),
    workerDigest: hex('f'),
    operations: [{ taskId: 'package.tree', operationId: 'package.tree.apply', phase: 'apply' }],
    descriptorDigest: hex('1'), closureDigest: hex('2'), consentDigest: hex('3'),
    requestedAt: '2026-11-09T12:00:00.000Z', grantExpiresAt: '2026-11-09T12:20:00.000Z',
  };
  const decision = {
    schemaVersion: 1, ownerDecisionId: 'decision-1', runIntentId: intent.runIntentId,
    authorizationId: intent.authorizationId, tenantId: intent.tenantId,
    profileId: intent.profileId, profileRevisionDigest: intent.profileRevisionDigest,
    deviceCredentialId: intent.deviceCredentialId, deviceFingerprint: intent.deviceFingerprint,
    approvedPlanDigest: intent.planDigest, consentDigest: intent.consentDigest,
    ownerActorId: 'owner-1', decision: 'approved',
    ownerReauthenticatedAt: '2026-11-09T12:01:00.000Z',
    decidedAt: '2026-11-09T12:02:00.000Z', expiresAt: '2026-11-09T12:08:00.000Z',
  };
  const lookup = {
    schemaVersion: 1, authorizationId: intent.authorizationId,
    ownerDecisionId: decision.ownerDecisionId, tenantId: intent.tenantId,
    profileId: intent.profileId, profileRevisionDigest: intent.profileRevisionDigest,
    deviceCredentialId: intent.deviceCredentialId, deviceFingerprint: intent.deviceFingerprint,
    runIntentId: intent.runIntentId, grantId: intent.grantId,
  };
  return { sqlite, store, intent, decision, lookup };
}

test('strict schemas reject unknown input, invalid lifetimes, and duplicate operations', () => {
  const { intent, decision } = fixture();
  assert.throws(() => BrokerRunIntent.parse({ ...intent, grant: {} }), /unrecognized/i);
  assert.throws(() => BrokerRunIntent.parse({ ...intent, grantExpiresAt: intent.requestedAt }), /lifetime/);
  assert.throws(() => BrokerRunIntent.parse({
    ...intent, operations: [...intent.operations, { ...intent.operations[0], taskId: 'other' }],
  }), /duplicate/);
  assert.throws(() => BrokerOwnerDecision.parse({ ...decision, arbitraryGrant: {} }), /unrecognized/i);
  assert.throws(() => BrokerOwnerDecision.parse({
    ...decision, ownerReauthenticatedAt: '2026-11-09T11:55:00.000Z',
  }), /reauthentication/);
});

test('persists immutable facts idempotently and rejects identifier collisions', async () => {
  const setup = fixture();
  assert.equal(await setup.store.persistRunIntent(setup.intent), true);
  assert.equal(await setup.store.persistRunIntent(setup.intent), false);
  await assert.rejects(setup.store.persistRunIntent({ ...setup.intent, hostId: 'host-2' }), /collision/);

  assert.equal(await setup.store.persistOwnerDecision(setup.decision), true);
  assert.equal(await setup.store.persistOwnerDecision(setup.decision), false);
  await assert.rejects(setup.store.persistOwnerDecision({
    ...setup.decision, ownerActorId: 'owner-2',
  }), /collision/);
  assert.throws(() => setup.sqlite.prepare(
    "UPDATE broker_run_intents SET host_id='host-2' WHERE run_intent_id='intent-1'",
  ).run(), /immutable/);
  assert.throws(() => setup.sqlite.prepare(
    "DELETE FROM broker_owner_decisions WHERE owner_decision_id='decision-1'",
  ).run(), /immutable/);
});

test('reconstructs the exact grant from joined columns rather than stored grant JSON', async () => {
  const setup = fixture();
  await setup.store.persistRunIntent(setup.intent);
  await setup.store.persistOwnerDecision(setup.decision);
  const result = await setup.store.loadApprovedReconstruction(setup.lookup);
  assert.equal(result.ownerActorId, 'owner-1');
  assert.deepEqual(result.grant, {
    schemaVersion: 1, grantId: setup.intent.grantId, hostId: setup.intent.hostId,
    releaseId: setup.intent.releaseId, runId: setup.intent.runId,
    planDigest: setup.intent.planDigest, approvedPlanDigest: setup.intent.planDigest,
    enrolledUid: setup.intent.enrolledUid,
    brokerExecutableDigest: setup.intent.brokerExecutableDigest,
    runtimeDigest: setup.intent.runtimeDigest, workerDigest: setup.intent.workerDigest,
    operations: setup.intent.operations, descriptorDigest: setup.intent.descriptorDigest,
    closureDigest: setup.intent.closureDigest, consentDigest: setup.intent.consentDigest,
    issuedAt: setup.intent.requestedAt, expiresAt: setup.intent.grantExpiresAt,
  });
  const columns = setup.sqlite.prepare('PRAGMA table_info(broker_run_intents)').all()
    .map(row => row.name);
  assert.equal(columns.includes('grant_json'), false);
});

test('denial, stale decisions, and every cross-binding substitution fail closed', async () => {
  const approved = fixture();
  await approved.store.persistRunIntent(approved.intent);
  await approved.store.persistOwnerDecision(approved.decision);
  for (const substitution of [
    { authorizationId: 'authorization-2' }, { ownerDecisionId: 'decision-2' },
    { tenantId: 'tenant-2' }, { profileId: 'profile-2' },
    { profileRevisionDigest: hex('4') }, { deviceCredentialId: 'credential-2' },
    { deviceFingerprint: hex('5') }, { runIntentId: 'intent-2' }, { grantId: 'grant-2' },
  ]) assert.equal(await approved.store.loadApprovedReconstruction({
    ...approved.lookup, ...substitution,
  }), null);

  const denied = fixture();
  await denied.store.persistRunIntent(denied.intent);
  await denied.store.persistOwnerDecision({ ...denied.decision, decision: 'denied' });
  assert.equal(await denied.store.loadApprovedReconstruction(denied.lookup), null);

  const stale = fixture('2026-11-09T12:08:00.000Z');
  await stale.store.persistRunIntent(stale.intent);
  await stale.store.persistOwnerDecision(stale.decision);
  assert.equal(await stale.store.loadApprovedReconstruction(stale.lookup), null);
});

test('database foreign keys reject plan, consent, device, and run decision substitution', async () => {
  const setup = fixture();
  await setup.store.persistRunIntent(setup.intent);
  let index = 0;
  for (const changed of [
    { approvedPlanDigest: hex('9') }, { consentDigest: hex('8') },
    { deviceFingerprint: hex('7') }, { runIntentId: 'intent-2' },
  ]) await assert.rejects(setup.store.persistOwnerDecision({
    ...setup.decision, ownerDecisionId: `decision-substitution-${index++}`, ...changed,
  }), /FOREIGN KEY constraint failed/);
});
