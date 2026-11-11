import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTelemetryDeliveryStore } from '../dist/index.js';

const at = Date.parse('2026-11-10T12:00:00.000Z');
const batch = (runId = 'run-1', eventAt = new Date(at).toISOString()) => ({
  schemaVersion: 1,
  labels: { platform: 'linux', environment: 'container', service: 'desktop-tools' },
  retention: { localSpoolMaxBytes: 16_777_216, localSpoolMaxAgeHours: 24, remoteRetentionDays: 30 },
  events: [{ kind: 'run-status', sequence: 0, at: eventAt, runId, status: 'started' }],
  droppedOutputEvents: 0, droppedCapacityEvents: 0,
});

async function fixture(t, overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-tools-telemetry-delivery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { value: at };
  const options = { stateRoot: root, now: () => new Date(clock.value).toISOString(), retryBaseMs: 1_000, retryMaximumMs: 8_000, ...overrides };
  const store = createTelemetryDeliveryStore(options);
  await store.initialize();
  return { root, clock, options, store };
}

test('bounded spool deduplicates, survives restart, retries with backoff, and drains exactly once', async t => {
  const state = await fixture(t);
  const first = await state.store.enqueue(batch());
  assert.equal(first.status, 'enqueued');
  assert.equal((await state.store.enqueue(batch())).status, 'duplicate');
  const restarted = createTelemetryDeliveryStore(state.options);
  await restarted.initialize();
  assert.equal(await restarted.pending(), 1, 'restart lost durable telemetry');
  assert.deepEqual(await restarted.drain(async () => { throw new Error('outage'); }, 'https://logs.example.test'),
    { delivered: 0, failed: 1, deferred: 0, expired: 0 });
  assert.deepEqual(await restarted.drain(async () => {}, 'https://logs.example.test'),
    { delivered: 0, failed: 0, deferred: 1, expired: 0 });
  state.clock.value += 1_000;
  let delivered = 0;
  assert.deepEqual(await restarted.drain(async () => { delivered += 1; }, 'https://logs.example.test'),
    { delivered: 1, failed: 0, deferred: 0, expired: 0 });
  assert.equal(delivered, 1);
  assert.equal(await restarted.pending(), 0);
});

test('timestamps, capacity, and age bounds fail or drop explicitly', async t => {
  const state = await fixture(t, { maxBytes: 4096, maxAgeMs: 1_000 });
  await assert.rejects(state.store.enqueue(batch('future-run', new Date(at + 300_001).toISOString())), /future/);
  const large = { ...batch(), events: Array.from({ length: 256 }, (_, sequence) => ({
    kind: 'run-status', sequence, at: new Date(at).toISOString(), runId: `run-${sequence}`, status: 'started',
  })) };
  assert.equal((await state.store.enqueue(large)).status, 'dropped-capacity');
  assert.equal((await state.store.enqueue(batch())).status, 'enqueued');
  state.clock.value += 1_000;
  assert.deepEqual(await state.store.drain(async () => { throw new Error('expired records must not send'); }, 'https://logs.example.test'),
    { delivered: 0, failed: 0, deferred: 0, expired: 1 });
});

test('collector heartbeat remains unverified until the exact emitted probe is queryable', async t => {
  const state = await fixture(t);
  await state.store.recordHeartbeat('running');
  assert.equal((await state.store.status()).verification, 'unverified');
  await assert.rejects(state.store.recordDeliveryProbe('a'.repeat(64)), /not the exact successfully delivered batch/);
  const probe = (await state.store.enqueue(batch('probe-run'))).id;
  await state.store.drain(async () => {}, 'https://logs.example.test');
  await state.store.recordDeliveryProbe(probe);
  assert.equal((await state.store.status()).verification, 'unverified', 'emission alone was treated as query proof');
  await assert.rejects(state.store.recordQueryableProbe('b'.repeat(64)), /does not match/);
  await state.store.recordQueryableProbe(probe);
  assert.equal((await state.store.status()).verification, 'verified');
  await state.store.recordHeartbeat('stopped');
  assert.equal((await state.store.status()).verification, 'stale');
  await state.store.recordHeartbeat('running');
  state.clock.value += 120_001;
  assert.equal((await state.store.status()).verification, 'stale');
});

test('delivery rejects unsafe heartbeat files and insecure endpoints before transport', async t => {
  const state = await fixture(t);
  await state.store.enqueue(batch());
  let called = false;
  await assert.rejects(state.store.drain(async () => { called = true; }, 'http://logs.example.test'), /credential-free HTTPS/);
  assert.equal(called, false);
  const heartbeat = join(state.root, 'heartbeat.json');
  const outside = join(state.root, 'outside.json');
  await writeFile(outside, '{}\n', { mode: 0o600 });
  await symlink(outside, heartbeat);
  await assert.rejects(state.store.status());
});
