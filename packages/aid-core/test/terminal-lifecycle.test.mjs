import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalLifecycle, reduceTerminalLifecycle } from '../dist/terminal-lifecycle.js';

const limits = { maxBufferedBytes: 100, highWaterBytes: 80, lowWaterBytes: 20, maxBufferedFrames: 4 };
const apply = (state, event) => reduceTerminalLifecycle(state, event);

test('closing a connection detaches without stopping the terminal', () => {
  let state = createTerminalLifecycle(limits);
  state = apply(state, { type: 'attach', connectionId: 'browser-a', acknowledgedSequence: 0 });
  state = apply(state, { type: 'detach', connectionId: 'browser-a', epoch: state.attachment.epoch });
  assert.equal(state.attachment, null);
  assert.equal(state.phase, 'running');
  assert.equal(state.stopAuthorizationId, null);
});

test('reconnect resumes the session and replays only unacknowledged frames', () => {
  let state = createTerminalLifecycle(limits);
  state = apply(state, { type: 'output', bytes: 15 });
  state = apply(state, { type: 'output', bytes: 25 });
  state = apply(state, { type: 'attach', connectionId: 'browser-b', acknowledgedSequence: 1 });
  assert.deepEqual(state.frames, [{ sequence: 2, bytes: 25 }]);
  assert.equal(state.lastSequence, 2);
  assert.equal(state.acknowledgedSequence, 1);
});

test('high water pauses reads and acknowledgement below low water resumes them', () => {
  let state = createTerminalLifecycle(limits);
  state = apply(state, { type: 'attach', connectionId: 'browser-c', acknowledgedSequence: 0 });
  const epoch = state.attachment.epoch;
  state = apply(state, { type: 'output', bytes: 40 });
  state = apply(state, { type: 'output', bytes: 40 });
  assert.equal(state.flow, 'paused');
  assert.throws(() => apply(state, { type: 'output', bytes: 1 }), /flow was paused/);
  state = apply(state, { type: 'acknowledge', connectionId: 'browser-c', epoch, sequence: 1 });
  assert.equal(state.flow, 'paused');
  state = apply(state, { type: 'acknowledge', connectionId: 'browser-c', epoch, sequence: 2 });
  assert.equal(state.flow, 'open');
  assert.equal(state.bufferedBytes, 0);
});

test('frame and byte bounds fail closed instead of dropping output', () => {
  let state = createTerminalLifecycle({ ...limits, maxBufferedFrames: 2 });
  state = apply(state, { type: 'output', bytes: 10 });
  state = apply(state, { type: 'output', bytes: 10 });
  assert.equal(state.flow, 'paused');
  assert.deepEqual(state.frames.map(({ sequence }) => sequence), [1, 2]);
  state = createTerminalLifecycle(limits);
  assert.throws(() => apply(state, { type: 'output', bytes: 101 }), /bounded replay buffer/);
});

test('stale connection epochs cannot detach or acknowledge a newer attachment', () => {
  let state = createTerminalLifecycle(limits);
  state = apply(state, { type: 'output', bytes: 10 });
  state = apply(state, { type: 'attach', connectionId: 'first', acknowledgedSequence: 0 });
  const firstEpoch = state.attachment.epoch;
  state = apply(state, { type: 'detach', connectionId: 'first', epoch: firstEpoch });
  state = apply(state, { type: 'attach', connectionId: 'second', acknowledgedSequence: 0 });
  assert.ok(state.attachment.epoch > firstEpoch);
  assert.equal(apply(state, { type: 'detach', connectionId: 'first', epoch: firstEpoch }).attachment.connectionId, 'second');
  assert.throws(() => apply(state, { type: 'acknowledge', connectionId: 'first', epoch: firstEpoch, sequence: 1 }), /stale connection/);
});

test('stop is a separate authorized and idempotent action', () => {
  let state = createTerminalLifecycle(limits);
  assert.throws(() => apply(state, { type: 'request-stop', authorizationId: 'approval-1', authorized: false }), /explicit authorized action/);
  state = apply(state, { type: 'request-stop', authorizationId: 'approval-1', authorized: true });
  assert.equal(state.phase, 'stopping');
  assert.equal(state.flow, 'paused');
  assert.strictEqual(apply(state, { type: 'request-stop', authorizationId: 'approval-1', authorized: true }), state);
  state = apply(state, { type: 'exited', code: null, signal: 'SIGTERM' });
  assert.equal(state.phase, 'stopped');
  assert.deepEqual(state.exit, { code: null, signal: 'SIGTERM' });
  assert.throws(() => apply(state, { type: 'attach', connectionId: 'late', acknowledgedSequence: 0 }), /cannot be reattached/);
});

test('invalid limits, acknowledgements, and exit evidence are rejected', () => {
  assert.throws(() => createTerminalLifecycle({ ...limits, lowWaterBytes: 80 }), /flow limits/);
  let state = createTerminalLifecycle(limits);
  assert.throws(() => apply(state, { type: 'attach', connectionId: 'browser-e', acknowledgedSequence: 1 }), /exceed emitted/);
  assert.throws(() => apply(state, { type: 'exited', code: null, signal: null }), /exactly one/);
});
