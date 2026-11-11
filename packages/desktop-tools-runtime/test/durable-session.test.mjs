import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DurableSessionCoordinator } from '../src/durable-session.mjs';

class FakeSocket {
  sent = [];
  closed = [];
  bufferedAmount = 0;
  listeners = new Map();
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.closed.push({ code, reason }); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, data) { this.listeners.get(type)?.({ data }); }
}

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'desktop-tools-session-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  let now = Date.parse('2030-01-01T00:00:00.000Z');
  const calls = { start: [], cancel: [], resize: [], flow: [], authorize: [], allowCancellation: true };
  const options = { stateRoot, clock: () => now,
    startRun: async value => calls.start.push(value), cancelRun: async value => calls.cancel.push(value), resizeRun: async value => calls.resize.push(value),
    setFlow: async value => calls.flow.push(value), authorizeCancellation: async value => { calls.authorize.push(value); return calls.allowCancellation; } };
  const coordinator = new DurableSessionCoordinator(options);
  const created = await coordinator.create({ sessionId: 'session-1', runId: 'run-1', createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(), cols: 80, rows: 24,
    limits: { maxRetainedBytes: 100, highWaterBytes: 10, lowWaterBytes: 3, maxFrames: 10 } });
  return { coordinator, created, calls, options, advance: milliseconds => { now += milliseconds; }, stateRoot };
}

function attachment(created, connectionId, acknowledgedSequence, socket) {
  return { sessionId: created.sessionId, runId: created.runId, resumeToken: created.resumeToken, connectionId, acknowledgedSequence, socket };
}

test('reconnect resumes the same durable run and replays only unacknowledged output', async t => {
  const f = await fixture(t);
  const first = new FakeSocket();
  const attached = await f.coordinator.attach(attachment(f.created, 'connection-1', 0, first));
  await f.coordinator.emit('session-1', 'one');
  await f.coordinator.emit('session-1', 'two');
  await f.coordinator.receive('session-1', 'connection-1', attached.epoch, JSON.stringify({ schemaVersion: 1, type: 'ack', sequence: 1 }));
  await f.coordinator.detach('session-1', 'connection-1', attached.epoch);

  // A new coordinator proves replay and identity survive process replacement.
  const restarted = new DurableSessionCoordinator(f.options);
  const second = new FakeSocket();
  const resumed = await restarted.attach(attachment(f.created, 'connection-2', 1, second));
  assert.equal(resumed.runId, 'run-1');
  assert.equal(resumed.replayed, 1);
  assert.deepEqual(second.sent.filter(event => event.type === 'output').map(event => [event.sequence, event.payload, event.replay]), [[2, 'two', true]]);
  assert.equal(f.calls.start.length, 1, 'reattachment must not create another run');
});

test('acknowledgement applies durable backpressure and resumes below the low-water mark', async t => {
  const f = await fixture(t);
  const socket = new FakeSocket();
  const attached = await f.coordinator.attach(attachment(f.created, 'connection-1', 0, socket));
  await f.coordinator.emit('session-1', '123456');
  const pressure = await f.coordinator.emit('session-1', 'abcdef');
  assert.equal(pressure.paused, true);
  assert.deepEqual(f.calls.flow.at(-1), { sessionId: 'session-1', runId: 'run-1', state: 'paused' });
  assert.equal(socket.sent.at(-1).type, 'flow');
  assert.equal(socket.sent.at(-1).state, 'paused');
  const acknowledged = await f.coordinator.receive('session-1', 'connection-1', attached.epoch, JSON.stringify({ schemaVersion: 1, type: 'ack', sequence: 2 }));
  assert.equal(acknowledged.paused, false);
  assert.deepEqual(f.calls.flow.at(-1), { sessionId: 'session-1', runId: 'run-1', state: 'open' });
  assert.equal(socket.sent.at(-1).state, 'open');
  assert.equal((await f.coordinator.status('session-1')).retainedBytes, 0);
});

test('resize is persisted and forwarded only by the current attachment', async t => {
  const f = await fixture(t);
  const socket = new FakeSocket();
  const attached = await f.coordinator.attach(attachment(f.created, 'connection-1', 0, socket));
  await f.coordinator.receive('session-1', 'connection-1', attached.epoch, JSON.stringify({ schemaVersion: 1, type: 'resize', cols: 132, rows: 44 }));
  assert.deepEqual(f.calls.resize, [{ sessionId: 'session-1', runId: 'run-1', cols: 132, rows: 44 }]);
  assert.deepEqual((await new DurableSessionCoordinator(f.options).status('session-1')).terminal, { cols: 132, rows: 44 });
  await assert.rejects(() => f.coordinator.receive('session-1', 'connection-1', attached.epoch - 1,
    JSON.stringify({ schemaVersion: 1, type: 'resize', cols: 1, rows: 1 })), /stale connection/);
});

test('authorized cancellation is durable and idempotent for one authority', async t => {
  const f = await fixture(t);
  const socket = new FakeSocket();
  const attached = await f.coordinator.attach(attachment(f.created, 'connection-1', 0, socket));
  const cancel = JSON.stringify({ schemaVersion: 1, type: 'cancel', authorizationId: 'approval-1' });
  assert.deepEqual(await f.coordinator.receive('session-1', 'connection-1', attached.epoch, cancel), { phase: 'cancelled', duplicate: false });
  assert.equal(f.calls.cancel.length, 1);
  assert.equal((await new DurableSessionCoordinator(f.options).status('session-1')).phase, 'cancelled');
  await assert.rejects(() => f.coordinator.attach(attachment(f.created, 'connection-2', 0, new FakeSocket())), /cannot attach/);
});

test('a WebSocket client cannot self-authorize cancellation', async t => {
  const f = await fixture(t);
  const socket = new FakeSocket();
  const attached = await f.coordinator.attach(attachment(f.created, 'connection-1', 0, socket));
  f.calls.allowCancellation = false;
  await assert.rejects(() => f.coordinator.receive('session-1', 'connection-1', attached.epoch,
    JSON.stringify({ schemaVersion: 1, type: 'cancel', authorizationId: 'untrusted-claim' })), /trusted authorization/);
  assert.equal(f.calls.cancel.length, 0);
  assert.equal((await f.coordinator.status('session-1')).phase, 'running');
});

test('expiry durably cancels the existing run and never starts a replacement', async t => {
  const f = await fixture(t);
  f.advance(60_001);
  await assert.rejects(() => f.coordinator.attach(attachment(f.created, 'late', 0, new FakeSocket())), /expired/);
  assert.deepEqual(f.calls.cancel, [{ sessionId: 'session-1', runId: 'run-1', reason: 'session-expired' }]);
  assert.equal(f.calls.start.length, 1);
  assert.equal((await f.coordinator.status('session-1')).phase, 'expired');
});

test('wrong run, token, stale connection, oversized frame, and corrupt durable state fail closed', async t => {
  const f = await fixture(t);
  const socket = new FakeSocket();
  await assert.rejects(() => f.coordinator.attach({ ...attachment(f.created, 'bad', 0, socket), runId: 'run-2' }), /authority/);
  await assert.rejects(() => f.coordinator.attach({ ...attachment(f.created, 'bad', 0, socket), resumeToken: 'x'.repeat(32) }), /authority/);
  const attached = await f.coordinator.attach(attachment(f.created, 'good', 0, socket));
  await assert.rejects(() => f.coordinator.receive('session-1', 'good', attached.epoch + 1, JSON.stringify({ schemaVersion: 1, type: 'ack', sequence: 0 })), /stale connection/);
  await assert.rejects(() => f.coordinator.emit('session-1', 'x'.repeat(16 * 1024 + 1)), /byte bound/);
  const path = join(f.stateRoot, 'sessions', 'session-1.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.lastSequence = 5;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path, JSON.stringify(state), { mode: 0o600 }));
  await assert.rejects(() => f.coordinator.status('session-1'), /empty replay window/);
});

test('failed run creation remains terminal and cannot be adopted by reconnect', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'desktop-tools-session-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const coordinator = new DurableSessionCoordinator({ stateRoot, clock: () => Date.parse('2030-01-01T00:00:00Z'),
    startRun: async () => { throw new Error('spawn failed'); }, cancelRun: async () => {}, resizeRun: async () => {}, setFlow: async () => {},
    authorizeCancellation: async () => true });
  await assert.rejects(() => coordinator.create({ sessionId: 'failed-session', runId: 'failed-run', createdAt: '2030-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:01:00Z', cols: 80, rows: 24,
    limits: { maxRetainedBytes: 100, highWaterBytes: 10, lowWaterBytes: 3, maxFrames: 10 } }), /spawn failed/);
  assert.equal((await coordinator.status('failed-session')).phase, 'failed');
  await assert.rejects(() => coordinator.create({ sessionId: 'failed-session', runId: 'replacement-run', createdAt: '2030-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:01:00Z', cols: 80, rows: 24,
    limits: { maxRetainedBytes: 100, highWaterBytes: 10, lowWaterBytes: 3, maxFrames: 10 } }), /EEXIST/);
});
