import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_MESSAGE_BYTES = 16 * 1024;

function fail(message, code = 65) {
  throw Object.assign(new Error(message), { exitCode: code });
}

function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains unknown or missing fields`);
  }
}

function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label} is invalid`);
  return value;
}

function instant(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}

function tokenDigest(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) fail('resume token is invalid', 77);
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalizeLimits(input) {
  exact(input, ['maxRetainedBytes', 'highWaterBytes', 'lowWaterBytes', 'maxFrames'], 'session limits');
  const limits = {
    maxRetainedBytes: integer(input.maxRetainedBytes, 'maxRetainedBytes', 1),
    highWaterBytes: integer(input.highWaterBytes, 'highWaterBytes', 1),
    lowWaterBytes: integer(input.lowWaterBytes, 'lowWaterBytes'),
    maxFrames: integer(input.maxFrames, 'maxFrames', 1),
  };
  if (limits.lowWaterBytes >= limits.highWaterBytes || limits.highWaterBytes > limits.maxRetainedBytes) {
    fail('session limits must satisfy lowWaterBytes < highWaterBytes <= maxRetainedBytes');
  }
  return limits;
}

function safeRoot(root) {
  if (typeof root !== 'string' || !root.startsWith('/')) fail('stateRoot must be an absolute path');
  return resolve(root);
}

function statePath(root, sessionId) {
  id(sessionId, 'sessionId');
  const path = resolve(root, 'sessions', `${sessionId}.json`);
  const parent = `${resolve(root, 'sessions')}${sep}`;
  if (!path.startsWith(parent) || basename(path) !== `${sessionId}.json`) fail('session path escapes the state root');
  return path;
}

function retainedBytes(frames) {
  return frames.reduce((total, frame) => total + frame.bytes, 0);
}

function validateState(value) {
  exact(value, ['schemaVersion', 'sessionId', 'runId', 'resumeTokenSha256', 'createdAt', 'expiresAt', 'phase', 'flow', 'lastSequence', 'acknowledgedSequence', 'connectionEpoch', 'attachment', 'terminal', 'frames', 'limits', 'cancellation'], 'durable session');
  if (value.schemaVersion !== VERSION) fail('unsupported durable session schema');
  id(value.sessionId, 'sessionId');
  id(value.runId, 'runId');
  if (!/^[a-f0-9]{64}$/.test(value.resumeTokenSha256)) fail('resume token digest is invalid');
  instant(value.createdAt, 'createdAt');
  instant(value.expiresAt, 'expiresAt');
  if (!['starting', 'running', 'cancelling', 'cancelled', 'completed', 'expired', 'failed'].includes(value.phase)) fail('session phase is invalid');
  if (!['open', 'paused'].includes(value.flow)) fail('session flow state is invalid');
  integer(value.lastSequence, 'lastSequence');
  integer(value.acknowledgedSequence, 'acknowledgedSequence');
  integer(value.connectionEpoch, 'connectionEpoch');
  if (value.acknowledgedSequence > value.lastSequence) fail('acknowledgement exceeds output');
  if (value.attachment !== null) {
    exact(value.attachment, ['connectionId', 'epoch', 'attachedAt'], 'session attachment');
    id(value.attachment.connectionId, 'connectionId');
    integer(value.attachment.epoch, 'attachment epoch', 1);
    instant(value.attachment.attachedAt, 'attachedAt');
  }
  exact(value.terminal, ['cols', 'rows'], 'terminal size');
  integer(value.terminal.cols, 'terminal cols', 1);
  integer(value.terminal.rows, 'terminal rows', 1);
  const limits = normalizeLimits(value.limits);
  if (!Array.isArray(value.frames) || value.frames.length > limits.maxFrames) fail('session frames are invalid');
  let expected = value.acknowledgedSequence + 1;
  for (const frame of value.frames) {
    exact(frame, ['sequence', 'payload', 'bytes'], 'session frame');
    if (integer(frame.sequence, 'frame sequence', 1) !== expected++) fail('session replay sequence is not contiguous');
    if (typeof frame.payload !== 'string') fail('frame payload is invalid');
    const bytes = Buffer.byteLength(frame.payload, 'utf8');
    if (integer(frame.bytes, 'frame bytes', 1) !== bytes) fail('frame byte count is invalid');
  }
  if (value.frames.length > 0 && value.frames.at(-1).sequence !== value.lastSequence) fail('last sequence does not match replay tail');
  if (value.frames.length === 0 && value.lastSequence !== value.acknowledgedSequence) fail('empty replay window has unacknowledged output');
  if (retainedBytes(value.frames) > limits.maxRetainedBytes) fail('session replay bytes exceed their bound');
  if (value.cancellation !== null) {
    exact(value.cancellation, ['authorizationId', 'requestedAt'], 'session cancellation');
    id(value.cancellation.authorizationId, 'cancellation authorizationId');
    instant(value.cancellation.requestedAt, 'cancellation requestedAt');
  }
  return value;
}

async function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function load(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) fail('session state must be a private regular file', 77);
  const bytes = await readFile(path, 'utf8');
  if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) fail('session state exceeds its byte bound');
  try { return validateState(JSON.parse(bytes)); } catch (error) {
    if (error?.exitCode) throw error;
    fail('session state is not valid JSON');
  }
}

function wire(type, body) {
  return JSON.stringify({ schemaVersion: VERSION, type, ...body });
}

function assertSocket(socket) {
  if (socket === null || typeof socket !== 'object' || typeof socket.send !== 'function' || typeof socket.close !== 'function') {
    fail('transport must implement the WebSocket send/close interface');
  }
  if (socket.addEventListener !== undefined && typeof socket.addEventListener !== 'function') fail('WebSocket event interface is invalid');
  return socket;
}

export class DurableSessionCoordinator {
  #root;
  #clock;
  #startRun;
  #cancelRun;
  #resizeRun;
  #setFlow;
  #authorizeCancellation;
  #connections = new Map();
  #queues = new Map();

  constructor(input) {
    exact(input, ['stateRoot', 'startRun', 'cancelRun', 'resizeRun', 'setFlow', 'authorizeCancellation', 'clock'], 'coordinator options');
    this.#root = safeRoot(input.stateRoot);
    if (typeof input.startRun !== 'function' || typeof input.cancelRun !== 'function' || typeof input.resizeRun !== 'function'
      || typeof input.setFlow !== 'function' || typeof input.authorizeCancellation !== 'function') fail('coordinator callbacks are required');
    if (typeof input.clock !== 'function') fail('coordinator clock is required');
    this.#startRun = input.startRun;
    this.#cancelRun = input.cancelRun;
    this.#resizeRun = input.resizeRun;
    this.#setFlow = input.setFlow;
    this.#authorizeCancellation = input.authorizeCancellation;
    this.#clock = input.clock;
  }

  async initialize() {
    const root = join(this.#root, 'sessions');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
  }

  #serialize(sessionId, operation) {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#queues.set(sessionId, current);
    return current.finally(() => { if (this.#queues.get(sessionId) === current) this.#queues.delete(sessionId); });
  }

  async create(input) {
    exact(input, ['sessionId', 'runId', 'createdAt', 'expiresAt', 'cols', 'rows', 'limits'], 'session creation');
    const sessionId = id(input.sessionId, 'sessionId');
    const runId = id(input.runId, 'runId');
    const createdAt = instant(input.createdAt, 'createdAt');
    const expiresAt = instant(input.expiresAt, 'expiresAt');
    if (Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(expiresAt) <= this.#clock()) fail('session expiry must be in the future');
    integer(input.cols, 'terminal cols', 1);
    integer(input.rows, 'terminal rows', 1);
    const limits = normalizeLimits(input.limits);
    await this.initialize();
    const token = randomBytes(32).toString('base64url');
    const state = validateState({ schemaVersion: VERSION, sessionId, runId, resumeTokenSha256: tokenDigest(token), createdAt, expiresAt,
      phase: 'starting', flow: 'open', lastSequence: 0, acknowledgedSequence: 0, connectionEpoch: 0, attachment: null,
      terminal: { cols: input.cols, rows: input.rows }, frames: [], limits, cancellation: null });
    const path = statePath(this.#root, sessionId);
    const reservation = await open(path, 'wx', 0o600);
    await reservation.close();
    try {
      await atomicWrite(path, state);
      await this.#startRun(Object.freeze({ sessionId, runId, cols: input.cols, rows: input.rows }));
      state.phase = 'running';
      await atomicWrite(path, state);
    } catch (error) {
      state.phase = 'failed';
      await atomicWrite(path, state).catch(() => {});
      // The reserved terminal state intentionally remains: a failed start cannot be silently retried as a new run.
      throw error;
    }
    return Object.freeze({ sessionId, runId, resumeToken: token, expiresAt });
  }

  async #admit(sessionId, runId, token) {
    const state = await load(statePath(this.#root, id(sessionId, 'sessionId')));
    if (state.runId !== id(runId, 'runId') || state.resumeTokenSha256 !== tokenDigest(token)) fail('session resume authority is invalid', 77);
    if (this.#clock() >= Date.parse(state.expiresAt)) {
      if (!['completed', 'cancelled', 'expired'].includes(state.phase)) {
        state.phase = 'expired';
        state.attachment = null;
        await atomicWrite(statePath(this.#root, state.sessionId), state);
        await this.#cancelRun(Object.freeze({ sessionId: state.sessionId, runId: state.runId, reason: 'session-expired' }));
      }
      fail('session has expired', 77);
    }
    return state;
  }

  async attach(input) {
    exact(input, ['sessionId', 'runId', 'resumeToken', 'connectionId', 'acknowledgedSequence', 'socket'], 'session attachment');
    const socket = assertSocket(input.socket);
    return this.#serialize(input.sessionId, async () => {
      const state = await this.#admit(input.sessionId, input.runId, input.resumeToken);
      if (state.phase !== 'running') fail(`session cannot attach while ${state.phase}`);
      integer(input.acknowledgedSequence, 'acknowledgedSequence');
      if (input.acknowledgedSequence < state.acknowledgedSequence || input.acknowledgedSequence > state.lastSequence) fail('resume acknowledgement is outside the retained sequence window');
      state.frames = state.frames.filter(frame => frame.sequence > input.acknowledgedSequence);
      state.acknowledgedSequence = input.acknowledgedSequence;
      const connectionId = id(input.connectionId, 'connectionId');
      const previous = this.#connections.get(state.sessionId);
      if (previous) previous.socket.close(4001, 'session resumed elsewhere');
      const epoch = state.connectionEpoch + 1;
      state.connectionEpoch = epoch;
      state.attachment = { connectionId, epoch, attachedAt: new Date(this.#clock()).toISOString() };
      await atomicWrite(statePath(this.#root, state.sessionId), state);
      const connection = { socket, connectionId, epoch, paused: state.flow === 'paused' };
      this.#connections.set(state.sessionId, connection);
      socket.send(wire('attached', { sessionId: state.sessionId, runId: state.runId, epoch, nextSequence: state.acknowledgedSequence + 1, terminal: state.terminal }));
      for (const frame of state.frames) socket.send(wire('output', { sequence: frame.sequence, payload: frame.payload, replay: true }));
      if (state.flow === 'paused') {
        await this.#setFlow(Object.freeze({ sessionId: state.sessionId, runId: state.runId, state: 'paused' }));
        socket.send(wire('flow', { state: 'paused', retainedBytes: retainedBytes(state.frames) }));
      }
      const message = event => { void this.receive(state.sessionId, connectionId, epoch, event?.data ?? event).catch(() => socket.close(4002, 'invalid session message')); };
      const close = () => { void this.detach(state.sessionId, connectionId, epoch); };
      socket.addEventListener?.('message', message);
      socket.addEventListener?.('close', close);
      return Object.freeze({ sessionId: state.sessionId, runId: state.runId, epoch, replayed: state.frames.length });
    });
  }

  async detach(sessionId, connectionId, epoch) {
    return this.#serialize(sessionId, async () => {
      const state = await load(statePath(this.#root, sessionId));
      if (state.attachment?.connectionId !== connectionId || state.attachment.epoch !== epoch) return false;
      state.attachment = null;
      await atomicWrite(statePath(this.#root, sessionId), state);
      const active = this.#connections.get(sessionId);
      if (active?.connectionId === connectionId && active.epoch === epoch) this.#connections.delete(sessionId);
      return true;
    });
  }

  async emit(sessionId, payload) {
    if (typeof payload !== 'string' || payload.length === 0) fail('output payload is invalid');
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > MAX_MESSAGE_BYTES) fail('output frame exceeds its byte bound');
    return this.#serialize(sessionId, async () => {
      const state = await load(statePath(this.#root, sessionId));
      if (state.phase !== 'running') fail('output is accepted only for a running session');
      if (state.flow === 'paused') fail('output arrived while durable flow was paused');
      const currentBytes = retainedBytes(state.frames);
      if (state.frames.length >= state.limits.maxFrames || currentBytes + bytes > state.limits.maxRetainedBytes) fail('output would exceed the durable replay bound', 75);
      const sequence = state.lastSequence + 1;
      state.lastSequence = sequence;
      state.frames.push({ sequence, payload, bytes });
      const connection = this.#connections.get(sessionId);
      const pressure = currentBytes + bytes + integer(connection?.socket.bufferedAmount ?? 0, 'WebSocket bufferedAmount');
      const shouldPause = state.flow === 'open' && (pressure >= state.limits.highWaterBytes || state.frames.length >= state.limits.maxFrames);
      if (shouldPause) state.flow = 'paused';
      await atomicWrite(statePath(this.#root, sessionId), state);
      if (shouldPause) await this.#setFlow(Object.freeze({ sessionId, runId: state.runId, state: 'paused' }));
      if (connection && state.attachment?.epoch === connection.epoch) {
        connection.socket.send(wire('output', { sequence, payload, replay: false }));
        if (shouldPause) {
          connection.paused = true;
          connection.socket.send(wire('flow', { state: 'paused', retainedBytes: currentBytes + bytes }));
        }
      }
      return Object.freeze({ sequence, paused: state.flow === 'paused' });
    });
  }

  async receive(sessionId, connectionId, epoch, encoded) {
    const bytes = typeof encoded === 'string' ? Buffer.byteLength(encoded) : encoded?.byteLength;
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_MESSAGE_BYTES) fail('session message exceeds its byte bound');
    let message;
    try { message = JSON.parse(typeof encoded === 'string' ? encoded : Buffer.from(encoded).toString('utf8')); } catch { fail('session message is not valid JSON'); }
    if (message?.schemaVersion !== VERSION || typeof message.type !== 'string') fail('session message schema is invalid');
    if (message.type === 'ack') {
      exact(message, ['schemaVersion', 'type', 'sequence'], 'ack message');
      return this.#acknowledge(sessionId, connectionId, epoch, message.sequence);
    }
    if (message.type === 'resize') {
      exact(message, ['schemaVersion', 'type', 'cols', 'rows'], 'resize message');
      return this.#resize(sessionId, connectionId, epoch, message.cols, message.rows);
    }
    if (message.type === 'cancel') {
      exact(message, ['schemaVersion', 'type', 'authorizationId'], 'cancel message');
      return this.#cancel(sessionId, connectionId, epoch, message.authorizationId);
    }
    fail('unknown session message type');
  }

  async #withConnection(sessionId, connectionId, epoch, operation) {
    return this.#serialize(sessionId, async () => {
      const state = await load(statePath(this.#root, sessionId));
      if (state.attachment?.connectionId !== connectionId || state.attachment.epoch !== epoch) fail('stale connection has no session authority', 77);
      return operation(state);
    });
  }

  #acknowledge(sessionId, connectionId, epoch, sequence) {
    return this.#withConnection(sessionId, connectionId, epoch, async state => {
      integer(sequence, 'acknowledgement sequence');
      if (sequence < state.acknowledgedSequence || sequence > state.lastSequence) fail('acknowledgement is outside the emitted sequence range');
      state.acknowledgedSequence = sequence;
      state.frames = state.frames.filter(frame => frame.sequence > sequence);
      const connection = this.#connections.get(sessionId);
      const bytes = retainedBytes(state.frames);
      const shouldOpen = state.flow === 'paused' && bytes <= state.limits.lowWaterBytes && state.frames.length < state.limits.maxFrames;
      if (shouldOpen) state.flow = 'open';
      await atomicWrite(statePath(this.#root, sessionId), state);
      if (connection?.epoch === epoch && shouldOpen) {
        await this.#setFlow(Object.freeze({ sessionId, runId: state.runId, state: 'open' }));
        connection.paused = false;
        connection.socket.send(wire('flow', { state: 'open', retainedBytes: bytes }));
      }
      return Object.freeze({ acknowledgedSequence: sequence, retainedBytes: bytes, paused: state.flow === 'paused' });
    });
  }

  #resize(sessionId, connectionId, epoch, cols, rows) {
    return this.#withConnection(sessionId, connectionId, epoch, async state => {
      integer(cols, 'terminal cols', 1);
      integer(rows, 'terminal rows', 1);
      if (cols > 1000 || rows > 1000) fail('terminal dimensions exceed their bound');
      state.terminal = { cols, rows };
      await atomicWrite(statePath(this.#root, sessionId), state);
      await this.#resizeRun(Object.freeze({ sessionId, runId: state.runId, cols, rows }));
      return Object.freeze(state.terminal);
    });
  }

  #cancel(sessionId, connectionId, epoch, authorizationId) {
    return this.#withConnection(sessionId, connectionId, epoch, async state => {
      id(authorizationId, 'cancellation authorizationId');
      if (await this.#authorizeCancellation(Object.freeze({ sessionId, runId: state.runId, connectionId, authorizationId })) !== true) {
        fail('cancellation requires explicit trusted authorization', 77);
      }
      if (state.cancellation !== null) {
        if (state.cancellation.authorizationId !== authorizationId) fail('session cancellation already has another authority', 77);
        if (state.phase !== 'cancelling') return Object.freeze({ phase: state.phase, duplicate: true });
      } else {
        if (state.phase !== 'running') fail(`session cannot be cancelled while ${state.phase}`);
        state.phase = 'cancelling';
        state.cancellation = { authorizationId, requestedAt: new Date(this.#clock()).toISOString() };
        await atomicWrite(statePath(this.#root, sessionId), state);
      }
      await this.#cancelRun(Object.freeze({ sessionId, runId: state.runId, reason: 'authorized-session-cancellation', authorizationId }));
      state.phase = 'cancelled';
      state.attachment = null;
      await atomicWrite(statePath(this.#root, sessionId), state);
      this.#connections.delete(sessionId);
      return Object.freeze({ phase: 'cancelled', duplicate: false });
    });
  }

  async status(sessionId) {
    const state = await load(statePath(this.#root, sessionId));
    return Object.freeze({ sessionId: state.sessionId, runId: state.runId, phase: state.phase, expiresAt: state.expiresAt,
      terminal: Object.freeze({ ...state.terminal }), lastSequence: state.lastSequence, acknowledgedSequence: state.acknowledgedSequence,
      retainedFrames: state.frames.length, retainedBytes: retainedBytes(state.frames), flow: state.flow, attached: state.attachment !== null });
  }
}
