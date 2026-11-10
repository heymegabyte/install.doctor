import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTuiIntent,
  createTuiModel,
  createRendererSession,
  parseRendererKeyboardIntent,
  projectInstallerEvent,
  reduceTuiEvent,
  renderTuiFrame,
  resolveRendererProjectionOptions,
  sanitizeTerminalText,
} from '../dist/index.js';

const base = {
  schemaVersion: 1,
  sequence: 0,
  at: '2026-11-06T00:00:00.000Z',
  runId: 'renderer-fixture',
};

test('human projection makes retry, critical-path, and lock state explicit', () => {
  const retry = { ...base, kind: 'task-status', taskId: 'package.git', status: 'retrying', attempt: 2 };
  const lock = { ...base, kind: 'lock', taskId: 'package.git', domain: 'package-manager.brew', state: 'waiting' };
  assert.equal(projectInstallerEvent(retry, { criticalTaskIds: ['package.git'] }), 'package.git: retrying (attempt 2) [critical path]');
  assert.equal(projectInstallerEvent(lock), 'package.git: lock package-manager.brew waiting');
});

test('log follow and filter semantics are bounded and do not buffer hidden output', () => {
  const output = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'Downloading package metadata' };
  assert.equal(projectInstallerEvent(output, { follow: false }), null);
  assert.equal(projectInstallerEvent(output, { logFilter: 'ERROR' }), null);
  assert.equal(projectInstallerEvent(output, { logFilter: 'package' }), 'package.git stdout: Downloading package metadata');

  let writes = 0;
  const session = createRendererSession('plain', () => { writes += 1; return true; }, { follow: false });
  for (let sequence = 0; sequence < 1_000; sequence += 1) session.onEvent({ ...output, sequence });
  assert.equal(writes, 0, 'hidden logs must not create a renderer queue');
  assert.equal(session.detached, false);
});

test('narrow projections are code-point safe and environment preferences are deterministic', () => {
  const output = { ...base, kind: 'output', taskId: 'p', stream: 'stdout', line: '📦'.repeat(100) };
  const projected = projectInstallerEvent(output, { width: 20 });
  assert.equal(projected, 'p stdout: 📦📦📦📦…', 'double-width emoji must not overflow terminal cells');
  assert.ok(projected.endsWith('…'));

  const cjk = projectInstallerEvent({ ...output, line: '界'.repeat(100) }, { width: 20 });
  assert.equal(cjk, 'p stdout: 界界界界…');
  const combining = projectInstallerEvent({ ...output, line: 'e\u0301'.repeat(100) }, { width: 20 });
  assert.ok(combining.endsWith('…'));
  assert.equal(combining.normalize('NFC').includes('\u0301'), false, 'combining marks remain attached before normalization');

  const preferences = resolveRendererProjectionOptions(
    { color: true, reducedMotion: false, criticalTaskIds: ['z.task', 'a.task', 'z.task'] },
    { NO_COLOR: '1', INSTALL_DOCTOR_REDUCED_MOTION: '1' },
  );
  assert.equal(preferences.color, false);
  assert.equal(preferences.reducedMotion, true);
  assert.deepEqual(preferences.criticalTaskIds, ['a.task', 'z.task']);
  assert.throws(() => projectInstallerEvent(output, { width: 19 }), />=20/);
  assert.throws(() => projectInstallerEvent(output, { logFilter: 'x'.repeat(129) }), /Too big|too_big/);
});

test('keyboard parsing exposes intent without owning terminal input', () => {
  assert.equal(parseRendererKeyboardIntent('q'), 'cancel');
  assert.equal(parseRendererKeyboardIntent('\u0003'), 'cancel');
  assert.equal(parseRendererKeyboardIntent('f'), 'toggle-follow');
  assert.equal(parseRendererKeyboardIntent('/'), 'begin-filter');
  assert.equal(parseRendererKeyboardIntent('ArrowUp'), 'move-up');
  assert.equal(parseRendererKeyboardIntent('j'), 'move-down');
  assert.equal(parseRendererKeyboardIntent('Enter'), 'inspect');
  assert.equal(parseRendererKeyboardIntent('unknown'), 'none');
  assert.equal(parseRendererKeyboardIntent('x'.repeat(17)), 'none');
});

test('live projection controls change only future presentation', () => {
  const chunks = [];
  const session = createRendererSession('tui', chunk => { chunks.push(chunk); return true; }, { width: 40 });
  const output = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'visible package output' };
  session.onEvent(output);
  session.updateProjectionOptions({ follow: false, width: 20 });
  session.onEvent({ ...output, sequence: 1 });
  assert.equal(chunks.length, 1, 'paused follow must not buffer or replay hidden output');
  assert.equal(session.projectionOptions.follow, false);
  assert.equal(session.projectionOptions.width, 20);
  session.updateProjectionOptions({ follow: true, logFilter: 'missing' });
  session.onEvent({ ...output, sequence: 2 });
  assert.equal(chunks.length, 1);
  session.updateProjectionOptions({ logFilter: 'package' });
  session.onEvent({ ...output, sequence: 3 });
  assert.equal(chunks.length, 2);
  session.updateProjectionOptions({ width: 19 });
  assert.equal(session.failureCount, 1, 'invalid controls stay presentation-local');
  assert.equal(session.projectionOptions.width, 20);
});

test('sink and projection failures detach only their renderer session', () => {
  const event = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'safe output' };
  const healthy = []; const failed = createRendererSession('ndjson', () => { throw new Error('sink failed'); });
  const sibling = createRendererSession('ndjson', chunk => { healthy.push(chunk); return true; });
  assert.doesNotThrow(() => failed.onEvent(event)); sibling.onEvent(event);
  assert.equal(failed.detached, true); assert.equal(failed.failureCount, 1);
  assert.equal(healthy.length, 1, 'a failed renderer must not disrupt a sibling renderer');
  assert.doesNotThrow(() => failed.onEvent({ ...event, sequence: 1 }));
  const invalid = createRendererSession('plain', () => true);
  assert.doesNotThrow(() => invalid.onEvent({ ...event, sequence: 0, line: 42 }));
  assert.equal(invalid.detached, true); assert.equal(invalid.failureCount, 1);
  assert.doesNotThrow(() => invalid.finish({}), 'finish-time projection errors must remain presentation-local');
});

test('backpressure spills synchronously within hard byte and chunk bounds', () => {
  const event = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'bounded output' };
  const spilled = [];
  const session = createRendererSession('ndjson', () => false, {}, { maxSpillBytes: 10_000, maxSpillChunks: 2 }, chunk => {
    spilled.push(chunk); return true;
  });
  session.onEvent(event); session.onEvent({ ...event, sequence: 1 }); session.onEvent({ ...event, sequence: 2 });
  assert.equal(session.detached, true);
  assert.equal(session.spilledChunks, 2);
  assert.equal(spilled.length, 2);
  assert.equal(session.spilledBytes, spilled.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0));
  assert.equal(session.spillExhausted, true, 'the third chunk must close the bounded spill path');
  session.onEvent({ ...event, sequence: 3 });
  assert.equal(spilled.length, 2, 'closed spill delivery must never grow an in-memory queue');
});

test('stdout drain resumes future delivery after bounded backpressure spill', () => {
  const event = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'bounded output' };
  const delivered = []; const spilled = []; let ready = false;
  const session = createRendererSession('ndjson', chunk => {
    if (!ready) return false;
    delivered.push(chunk); return true;
  }, {}, { maxSpillBytes: 10_000, maxSpillChunks: 10 }, chunk => { spilled.push(chunk); return true; });
  session.onEvent(event);
  assert.equal(session.detached, true);
  assert.equal(spilled.length, 1);
  ready = true;
  session.resumeDelivery();
  session.onEvent({ ...event, sequence: 1, line: 'after drain' });
  assert.equal(session.detached, false);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0], /after drain/);
});

test('spill rejection and invalid delivery bounds fail closed without throwing', () => {
  const event = { ...base, kind: 'output', taskId: 'package.git', stream: 'stdout', line: 'output' };
  const session = createRendererSession('plain', () => false, {}, { maxSpillBytes: 1, maxSpillChunks: 1 }, () => true);
  assert.doesNotThrow(() => session.onEvent(event));
  assert.equal(session.spilledChunks, 0); assert.equal(session.spillExhausted, true);
  assert.throws(() => createRendererSession('plain', () => true, {}, { maxSpillBytes: 0 }), />=1/);
  assert.throws(() => createRendererSession('plain', () => true, {}, { maxSpillChunks: 100_001 }), /<=100000/);
});

test('TUI model deterministically attributes interleaved task, lock, retry, and output events', () => {
  const bodies = [
    { kind: 'run-status', status: 'started' },
    { kind: 'phase-status', phase: 'apply', status: 'started' },
    { kind: 'task-status', taskId: 'a', status: 'queued', attempt: 0 },
    { kind: 'task-status', taskId: 'b', status: 'queued', attempt: 0 },
    { kind: 'task-status', taskId: 'a', status: 'running', attempt: 1 },
    { kind: 'task-status', taskId: 'b', status: 'running', attempt: 1 },
    { kind: 'output', taskId: 'a', stream: 'stdout', line: 'alpha' },
    { kind: 'lock', taskId: 'b', domain: 'package-manager', state: 'waiting' },
    { kind: 'output', taskId: 'b', stream: 'stderr', line: '界 beta' },
    { kind: 'task-status', taskId: 'a', status: 'retrying', attempt: 2 },
    { kind: 'lock', taskId: 'a', domain: 'filesystem', state: 'acquired' },
    { kind: 'lock', taskId: 'b', domain: 'package-manager', state: 'acquired' },
    { kind: 'output', taskId: 'a', stream: 'stdout', line: 'again' },
    { kind: 'output', taskId: 'b', stream: 'stdout', line: 'done' },
    { kind: 'task-status', taskId: 'b', status: 'verified', attempt: 1 },
    { kind: 'lock', taskId: 'b', domain: 'package-manager', state: 'released' },
    { kind: 'task-status', taskId: 'a', status: 'verified', attempt: 2 },
    { kind: 'phase-status', phase: 'apply', status: 'succeeded' },
    { kind: 'run-status', status: 'success' },
  ];
  const model = bodies.reduce((state, body, sequence) => reduceTuiEvent(state, { ...base, ...body, sequence }), createTuiModel());
  assert.equal(model.runStatus, 'success');
  assert.equal(model.phase, 'apply:succeeded');
  assert.equal(model.tasks.a.status, 'verified');
  assert.equal(model.tasks.a.attempt, 2);
  assert.deepEqual(model.tasks.a.heldLocks, ['filesystem']);
  assert.deepEqual(model.tasks.a.output, ['stdout: alpha', 'stdout: again']);
  assert.equal(model.tasks.b.status, 'verified');
  assert.deepEqual(model.tasks.b.waitingLocks, []);
  assert.deepEqual(model.tasks.b.heldLocks, []);
  assert.match(model.tasks.b.output[0], /界 beta/);

  const moved = applyTuiIntent(model, 'move-down', ['b']);
  assert.equal(moved.selectedTaskId, 'b');
  assert.equal(applyTuiIntent(moved, 'inspect').inspect, true);
  const critical = applyTuiIntent(moved, 'toggle-critical', ['b']);
  assert.equal(critical.criticalOnly, true);
  assert.equal(critical.selectedTaskId, 'b');
  for (const width of [20, 40, 120, 500]) {
    const frame = renderTuiFrame(model, { width, color: false });
    assert.ok(frame.split('\n').every(line => [...line].length <= width));
  }
});

test('TUI retains bounded attributable histories for concurrent tasks and reports evictions', () => {
  const events = [];
  for (let index = 0; index < 160; index += 1) {
    events.push({ kind: 'output', taskId: 'agent.alpha', stream: 'stdout', line: `alpha-${index}` });
    events.push({ kind: 'output', taskId: 'agent.beta', stream: 'stderr', line: `beta-${index}` });
  }
  const model = events.reduce(
    (state, body, sequence) => reduceTuiEvent(state, { ...base, ...body, sequence }),
    createTuiModel(),
  );

  assert.equal(model.tasks['agent.alpha'].output.length, 128);
  assert.equal(model.tasks['agent.beta'].output.length, 128);
  assert.equal(model.tasks['agent.alpha'].outputDropped, 32);
  assert.equal(model.tasks['agent.beta'].outputDropped, 32);
  assert.equal(model.tasks['agent.alpha'].output[0], 'stdout: alpha-32');
  assert.equal(model.tasks['agent.beta'].output[0], 'stderr: beta-32');
  assert.ok(model.retainedOutputBytes <= 1024 * 1024);

  const inspected = applyTuiIntent({ ...model, selectedTaskId: 'agent.alpha' }, 'inspect');
  const frame = renderTuiFrame(inspected, { width: 80, color: false });
  assert.match(frame, /32 earlier output lines omitted from the live view/);
  assert.match(frame, /stdout: alpha-159/);
  assert.doesNotMatch(frame, /beta-159/, 'inspection must not mix concurrent task output');
});

test('TUI bounds task and inspected-output viewports to terminal height while keeping selection visible', () => {
  const events = [];
  for (let index = 0; index < 30; index += 1) {
    events.push({ kind: 'task-status', taskId: `agent.${String(index).padStart(2, '0')}`, status: 'running', attempt: 1 });
  }
  for (let index = 0; index < 20; index += 1) {
    events.push({ kind: 'output', taskId: 'agent.29', stream: 'stdout', line: `line-${index}` });
  }
  let model = events.reduce(
    (state, body, sequence) => reduceTuiEvent(state, { ...base, ...body, sequence }),
    createTuiModel(),
  );
  for (let index = 0; index < 29; index += 1) model = applyTuiIntent(model, 'move-down');

  const tasks = renderTuiFrame(model, { width: 80, height: 7, color: false });
  assert.equal(tasks.split('\n').length, 7);
  assert.match(tasks, /agent\.29/);
  assert.doesNotMatch(tasks, /agent\.00/);
  assert.match(tasks, /view 27-30 of 30/);

  const inspected = renderTuiFrame(applyTuiIntent(model, 'inspect'), { width: 80, height: 6, color: false });
  assert.equal(inspected.split('\n').length, 6);
  assert.match(inspected, /Task agent\.29/);
  assert.match(inspected, /line-19/);
  assert.doesNotMatch(inspected, /line-0(?:\D|$)/);

  const tiny = renderTuiFrame(model, { width: 20, height: 4, color: false });
  assert.equal(tiny.split('\n').length, 4);
  assert.match(tiny, /agent\.29/);
  assert.throws(() => renderTuiFrame(model, { height: 3 }), />=4/);
});

test('renderer resize updates height without changing semantic model or noninteractive behavior', () => {
  const chunks = [];
  const session = createRendererSession('tui', chunk => { chunks.push(chunk); return true; },
    { width: 80, height: 12, color: false }, { interactiveTui: true });
  for (let sequence = 0; sequence < 10; sequence += 1) {
    session.onEvent({ ...base, sequence, kind: 'task-status', taskId: `task.${sequence}`, status: 'running', attempt: 1 });
  }
  session.updateProjectionOptions({ height: 5 });
  assert.equal(session.projectionOptions.height, 5);
  const lastFrame = chunks.at(-1).replace(/^\u001b\[H\u001b\[J/u, '').trimEnd();
  assert.equal(lastFrame.split('\n').length, 5);
  session.close();
});

test('TUI global output budget evicts the oldest lines across tasks without exceeding memory bounds', () => {
  const payload = 'x'.repeat(900);
  let model = createTuiModel();
  for (let sequence = 0; sequence < 1_500; sequence += 1) {
    const taskId = `agent.${sequence % 20}`;
    model = reduceTuiEvent(model, { ...base, sequence, kind: 'output', taskId, stream: 'stdout', line: `${sequence}:${payload}` });
  }
  const retainedLines = Object.values(model.tasks).reduce((total, task) => total + task.output.length, 0);
  const droppedLines = Object.values(model.tasks).reduce((total, task) => total + task.outputDropped, 0);
  assert.ok(model.retainedOutputBytes <= 1024 * 1024);
  assert.ok(retainedLines <= 2_048);
  assert.equal(retainedLines + droppedLines, 1_500);
  assert.ok(droppedLines > 0);
});

test('interactive TUI owns full-screen lifecycle while noninteractive TUI remains ANSI-free', () => {
  const event = { ...base, kind: 'run-status', status: 'started' };
  const interactive = [];
  const session = createRendererSession('tui', chunk => { interactive.push(chunk); return true; }, { color: false }, { interactiveTui: true });
  session.onEvent(event);
  session.close();
  const transcript = interactive.join('');
  assert.match(transcript, /\u001b\[\?1049h/);
  assert.match(transcript, /DESKTOP TOOLS/);
  assert.ok(transcript.endsWith('\u001b[?25h\u001b[?1049l'));

  const noninteractive = [];
  createRendererSession('tui', chunk => { noninteractive.push(chunk); return true; }, { color: false }).onEvent(event);
  assert.equal(noninteractive.join('').includes('\u001b'), false);
});

test('interactive TUI coalesces output bursts but immediately flushes lifecycle state', () => {
  const chunks = [];
  const session = createRendererSession('tui', chunk => { chunks.push(chunk); return true; },
    { width: 80, height: 12, color: false }, { interactiveTui: true });
  session.onEvent({ ...base, sequence: 0, kind: 'run-status', status: 'started' });
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    session.onEvent({ ...base, sequence, kind: 'output', taskId: 'agent.parallel', stream: 'stdout', line: `line-${sequence}` });
  }
  const chunksBeforeStatus = chunks.length;
  assert.ok(chunksBeforeStatus <= 15, `expected bounded output repainting, observed ${chunksBeforeStatus} frames`);
  session.onEvent({ ...base, sequence: 101, kind: 'task-status', taskId: 'agent.parallel', status: 'verified', attempt: 1 });
  assert.equal(chunks.length, chunksBeforeStatus + 1);
  assert.match(chunks.at(-1), /verified/);
  session.handleIntent('inspect');
  assert.match(chunks.at(-1), /line-100/);
  session.close();
});

test('human terminal projections neutralize untrusted control sequences', () => {
  const hostile = 'safe\u001b]52;c;ZXhmaWw=\u0007\u001b[2J\rspoof\nnext\tend\u202eRTL\u2028line\u200b';
  const safe = sanitizeTerminalText(hostile);
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(safe), false);
  assert.match(safe, /\^\[]52;c;ZXhmaWw=\\x07\^\[\[2J\\rspoof\\nnext\\tend/);
  const projected = projectInstallerEvent({ ...base, kind: 'output', taskId: 'p', stream: 'stdout', line: hostile }, { width: 120 });
  assert.equal(projected.includes('\u001b'), false);
  assert.equal(projected.includes('\r'), false);
  assert.equal(projected.includes('\n'), false);
  assert.equal(projected.includes('\u202e'), false);
  assert.match(safe, /\\u\{202e\}RTL\\u\{2028\}line\\u\{200b\}/);
});
