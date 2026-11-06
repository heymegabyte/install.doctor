import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createTerminalController } from '../dist/terminal-controller.js';

class FakeInput extends EventEmitter {
  constructor({ tty = true, raw = false, paused = true, flowing = false } = {}) {
    super(); this.isTTY = tty; this.isRaw = raw; this.paused = paused; this.readableFlowing = flowing; this.rawCalls = [];
  }
  isPaused() { return this.paused; }
  setRawMode(value) { this.isRaw = value; this.rawCalls.push(value); }
  resume() { this.paused = false; this.readableFlowing = true; return this; }
  pause() { this.paused = true; this.readableFlowing = false; return this; }
}

class FakeOutput { constructor({ tty = true, columns = 80, rows = 24 } = {}) { this.isTTY = tty; this.columns = columns; this.rows = rows; } }

function setup(overrides = {}) {
  const input = overrides.input ?? new FakeInput();
  const output = overrides.output ?? new FakeOutput();
  const signals = overrides.signals ?? new EventEmitter();
  const intents = []; const widths = []; const heights = []; const filters = []; let cancels = 0;
  const controller = createTerminalController({
    input, output, signals, environment: overrides.environment ?? { TERM: 'xterm-256color' },
    onIntent: overrides.onIntent ?? (intent => intents.push(intent)),
    onCancel: overrides.onCancel ?? (() => { cancels += 1; }),
    onWidth: overrides.onWidth ?? (width => widths.push(width)),
    onHeight: overrides.onHeight ?? (height => heights.push(height)),
    onFilter: overrides.onFilter ?? (filter => filters.push(filter)),
  });
  return { controller, input, output, signals, intents, widths, heights, filters, cancels: () => cancels };
}

test('TTY controller enables raw input, reports width, decodes keys, and restores state', () => {
  const state = setup();
  assert.equal(state.controller.active, true);
  assert.deepEqual(state.input.rawCalls, [true]);
  assert.deepEqual(state.widths, [80]);
  assert.deepEqual(state.heights, [24]);
  state.input.emit('data', Buffer.from('f'));
  state.input.emit('data', '\u001b[A');
  state.input.emit('data', '\r');
  state.input.emit('data', '\u001b');
  assert.deepEqual(state.intents, ['toggle-follow', 'move-up', 'inspect', 'cancel']);
  assert.equal(state.cancels(), 0, 'escape is a renderer intent, not a process interrupt');
  state.controller.close();
  state.controller.close();
  assert.deepEqual(state.input.rawCalls, [true, false]);
  assert.equal(state.input.paused, true);
  assert.equal(state.input.listenerCount('data'), 0);
  assert.equal(state.signals.listenerCount('SIGWINCH'), 0);
});

test('Ctrl+C emits cancel intent and invokes cancellation exactly once', () => {
  const state = setup();
  state.input.emit('data', '\u0003');
  assert.deepEqual(state.intents, ['cancel']);
  assert.equal(state.cancels(), 1);
  state.controller.close();
});

test('filter editing is bounded and does not reinterpret text as commands', () => {
  const state = setup();
  state.input.emit('data', '/');
  state.input.emit('data', 'failure');
  state.input.emit('data', '\u007f');
  state.input.emit('data', 'e');
  state.input.emit('data', '\r');
  assert.deepEqual(state.intents, ['begin-filter']);
  assert.deepEqual(state.filters, ['failure', 'failur', 'failure']);
  state.input.emit('data', '\u007f');
  assert.deepEqual(state.intents, ['begin-filter', 'clear-filter']);
  assert.equal(state.filters.at(-1), '');
  state.controller.close();
});

test('SIGWINCH reports clamped current width', () => {
  const state = setup({ output: new FakeOutput({ columns: 10, rows: 2 }) });
  assert.deepEqual(state.widths, [20]);
  assert.deepEqual(state.heights, [4]);
  state.output.columns = 900;
  state.output.rows = 900;
  state.signals.emit('SIGWINCH');
  assert.deepEqual(state.widths, [20, 500]);
  assert.deepEqual(state.heights, [4, 500]);
  state.controller.close();
});

test('non-TTY and TERM=dumb remain inert and do not mutate input', () => {
  for (const options of [
    { input: new FakeInput({ tty: false }) },
    { output: new FakeOutput({ tty: false }) },
    { environment: { TERM: 'dumb' } },
  ]) {
    const state = setup(options);
    assert.equal(state.controller.active, false);
    assert.deepEqual(state.input.rawCalls, []);
    assert.equal(state.input.listenerCount('data'), 0);
    assert.deepEqual(state.widths, []);
  }
});

test('callback failures are isolated and counted without losing restoration', () => {
  const state = setup({
    onIntent() { throw new Error('renderer unavailable'); },
    onWidth() { throw new Error('renderer unavailable'); },
    onCancel() { throw new Error('engine unavailable'); },
  });
  state.input.emit('data', '\u0003');
  assert.equal(state.controller.failureCount, 3);
  state.controller.close();
  assert.deepEqual(state.input.rawCalls, [true, false]);
});

test('pre-existing raw and flowing state is preserved', () => {
  const input = new FakeInput({ raw: true, paused: false, flowing: true });
  const state = setup({ input });
  state.controller.close();
  assert.deepEqual(input.rawCalls, [true, true]);
  assert.equal(input.paused, false);
});

test('TTY controller releases stdin it started when initial flow state was neutral', () => {
  const input = new FakeInput({ paused: false, flowing: null });
  const state = setup({ input });
  assert.equal(input.readableFlowing, true);
  state.controller.close();
  assert.equal(input.readableFlowing, false);
  assert.equal(input.paused, true);
});
