import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';
import { sqliteD1Fixture } from './helpers/sqlite-d1-fixture.mjs';
import {
  BrokerExactPlanAuthorityRecord,
  createBrokerExactPlanD1Authority,
} from '../src/broker-exact-plan-d1-authority.ts';

/** @param {string} character */
const hex = character => character.repeat(64);
const now = new Date('2026-11-09T12:00:00.000Z');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0015_broker_exact_plan_authority.sql', import.meta.url), 'utf8'));
  const database = sqliteD1Fixture(sqlite);
  const authority = createBrokerExactPlanD1Authority(database, { now: () => now,
    expectedCompiler: { compilerId: 'server-plan-compiler-1', compilerDigest: hex('4') } });
  const record = BrokerExactPlanAuthorityRecord.parse({
    schemaVersion: 1, tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: hex('a'),
    deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), releaseId: 'release-1',
    facts: { hostId: 'host-1', runId: 'run-1', planDigest: hex('c'), enrolledUid: 1000,
      brokerExecutableDigest: hex('d'), runtimeDigest: hex('e'), workerDigest: hex('f'),
      operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
      descriptorDigest: hex('1'), closureDigest: hex('2'), consentDigest: hex('3') },
    compilerId: 'server-plan-compiler-1', compilerDigest: hex('4'),
    compiledAt: '2026-11-09T11:59:00.000Z', expiresAt: '2026-11-09T12:20:00.000Z',
  });
  /** @type {Parameters<typeof authority.reconstruct>[0]} */
  const context = {
    request: {
      ...record.facts, schemaVersion: 1, runIntentId: 'intent-1', authorizationId: 'authorization-1',
      tenantId: record.tenantId, profileId: record.profileId, profileRevisionDigest: record.profileRevisionDigest,
      deviceCredentialId: record.deviceCredentialId, deviceFingerprint: record.deviceFingerprint,
      releaseId: record.releaseId, grantId: 'grant-1', requestedAt: record.compiledAt, grantExpiresAt: record.expiresAt,
    },
    device: { deviceCredentialId: record.deviceCredentialId, deviceFingerprint: record.deviceFingerprint,
      tenantId: record.tenantId, profileId: record.profileId, profileRevisionDigest: record.profileRevisionDigest, active: true },
    profile: { profileId: record.profileId, tenantId: record.tenantId, revision: 'revision-1',
      digest: record.profileRevisionDigest, visibility: 'public-bootstrap', enabled: true },
    release: { product: 'desktop-tools', channel: 'stable', releaseId: record.releaseId,
      notBefore: '2026-11-09T11:00:00.000Z', expiresAt: '2026-11-09T14:00:00.000Z' },
  };
  return { sqlite, authority, record, context };
}

test('admits trusted exact-plan facts idempotently and reconstructs them from bound durable state', async () => {
  const setup = fixture();
  assert.equal(await setup.authority.admit(setup.record), true);
  assert.equal(await setup.authority.admit(setup.record), false);
  assert.deepEqual(await setup.authority.reconstruct(setup.context), setup.record.facts);
  assert.throws(() => setup.sqlite.prepare(
    "UPDATE broker_exact_plan_authority SET host_id='other' WHERE run_id='run-1'",
  ).run(), /immutable/);
});

test('never resolves across device, profile, tenant, release, digest, or run bindings', async () => {
  const setup = fixture();
  await setup.authority.admit(setup.record);
  /** @type {((context: typeof setup.context) => void)[]} */
  const changes = [
    context => { context.device.tenantId = 'tenant-2'; },
    context => { context.device.deviceCredentialId = 'device-2'; },
    context => { context.device.deviceFingerprint = hex('9'); },
    context => { context.profile.profileId = 'profile-2'; },
    context => { context.profile.digest = hex('8'); },
    context => { context.release.releaseId = 'release-2'; },
    context => { context.request.runId = 'run-2'; },
  ];
  for (const mutate of changes) {
    const context = structuredClone(setup.context);
    mutate(context);
    assert.equal(await setup.authority.reconstruct(context), null);
  }
});

test('rejects collision, stale/future authority, overlong lifetime, and unknown fields', async () => {
  const setup = fixture();
  await setup.authority.admit(setup.record);
  await assert.rejects(setup.authority.admit({ ...setup.record,
    facts: { ...setup.record.facts, hostId: 'host-2' } }), /collision/);
  assert.throws(() => BrokerExactPlanAuthorityRecord.parse({ ...setup.record, echoedRequest: true }), /unrecognized/i);
  await assert.rejects(fixture().authority.admit({ ...setup.record,
    compilerDigest: hex('5') }), /configured authority/);
  const future = fixture();
  await assert.rejects(future.authority.admit({ ...future.record,
    compiledAt: '2026-11-09T12:05:00.001Z', expiresAt: '2026-11-09T12:20:00.000Z' }), /future/);
  await assert.rejects(fixture().authority.admit({ ...setup.record,
    compiledAt: '2026-11-09T11:00:00.000Z', expiresAt: '2026-11-09T12:01:00.001Z' }), /exceeds policy/);
  await assert.rejects(fixture().authority.admit({ ...setup.record,
    compiledAt: '2026-11-09T11:50:00.000Z', expiresAt: now.toISOString() }), /expired/);
});
