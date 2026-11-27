import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSystemdTransaction } from '../dist/index.js';

/** @typedef {Parameters<typeof createNativeSystemdTransaction>[0]} TransactionOptions */
/** @typedef {import('../dist/native-systemd-transaction.js').NativeSystemdTransactionRecord} TransactionRecord */

const identity = { runId: 'run-one', hostId: 'host-one', planDigest: 'a'.repeat(64) };
function fixture(initial = { enabled: false, running: false }) {
  let state = { ...initial };
  /** @type {Map<string, TransactionRecord>} */
  const records = new Map();
  let restores = 0;
  /** @type {TransactionOptions['adapter']} */
  const adapter = {
    manager: 'systemd',
    async capture() { return { ...state }; },
    async restore(_unit, desired) {
      assert.ok('enabled' in desired, 'expected systemd service state');
      restores += 1;
      state = { ...desired };
    },
  };
  /** @type {TransactionOptions['persistence']} */
  const persistence = {
    async load(id) { return structuredClone(records.get(id)); },
    async save(record) { records.set(record.transactionId, structuredClone(record)); },
  };
  const transaction = () => createNativeSystemdTransaction({ identity, unit: 'alloy.service',
    desiredState: { enabled: true, running: true }, adapter, persistence, now: () => '2026-11-09T12:00:00.000Z' });
  return { transaction, records, get state() { return state; }, set state(value) { state = { ...value }; }, get restores() { return restores; }, adapter };
}

test('captures pre-state before mutation, verifies, rolls back, and preserves unchanged reruns', async () => {
  const value = fixture();
  const runtime = value.transaction();
  assert.deepEqual(await runtime.check(), { status: 'needed', previousState: { enabled: false, running: false } });
  await runtime.apply();
  assert.deepEqual(value.state, { enabled: true, running: true });
  assert.equal(await runtime.verify(), 'verified');
  assert.equal(value.restores, 1);
  await value.transaction().apply();
  assert.equal(value.restores, 1, 'unchanged rerun must not repeat mutation');
  await runtime.rollback();
  assert.deepEqual(value.state, { enabled: false, running: false });
  await runtime.rollback();
  assert.equal(value.restores, 2, 'restored rollback retry must be a no-op');
});

test('reconciles interruption after mutation and refuses unrelated live-state drift', async () => {
  const landed = fixture();
  const runtime = landed.transaction();
  const id = runtime.transactionId;
  landed.records.set(id, {
    schemaVersion: 1, kind: 'desktop-tools-native-systemd-transaction-record', transactionId: id,
    ...identity, authorityDigest: runtime.authorityDigest, unit: 'alloy.service', desiredState: { enabled: true, running: true },
    previousState: { enabled: false, running: false }, phase: 'applying', failure: null,
    createdAt: '2026-11-09T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z',
  });
  landed.state = { enabled: true, running: true };
  await runtime.apply();
  assert.equal(landed.restores, 0, 'landed mutation is reconciled without replay');
  const completed = landed.records.get(id);
  assert.ok(completed);
  assert.equal(completed.phase, 'completed');

  const drifted = fixture();
  const driftRuntime = drifted.transaction();
  drifted.records.set(driftRuntime.transactionId, { ...completed, transactionId: driftRuntime.transactionId,
    authorityDigest: driftRuntime.authorityDigest, phase: 'prepared' });
  drifted.state = { enabled: false, running: true };
  await assert.rejects(driftRuntime.apply(), /changed outside/);
  assert.deepEqual(drifted.state, { enabled: false, running: true });
  assert.equal(drifted.restores, 0);
});

test('failed activation restores captured state and records non-success evidence', async () => {
  const value = fixture({ enabled: false, running: true });
  let first = true;
  value.adapter.restore = async (_unit, desired) => {
    if (first) { first = false; throw new Error('activation failed'); }
    assert.ok('enabled' in desired, 'expected systemd service state');
    value.state = desired;
  };
  const runtime = value.transaction();
  await assert.rejects(runtime.apply(), /activation failed/);
  assert.deepEqual(value.state, { enabled: false, running: true });
  assert.equal(value.records.get(runtime.transactionId)?.phase, 'restored');
  assert.notEqual(await runtime.verify(), 'verified');
});
