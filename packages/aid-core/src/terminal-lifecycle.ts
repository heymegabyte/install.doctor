/** Pure contracts for a future browser terminal; this does not host or transport a PTY. */
export type TerminalFlow = 'open' | 'paused';
export type TerminalPhase = 'running' | 'stopping' | 'stopped';

export interface TerminalFlowLimits {
  maxBufferedBytes: number;
  highWaterBytes: number;
  lowWaterBytes: number;
  maxBufferedFrames: number;
}
export interface BufferedTerminalFrame { sequence: number; bytes: number }
export interface TerminalLifecycleState {
  phase: TerminalPhase;
  attachment: { connectionId: string; epoch: number } | null;
  connectionEpoch: number;
  flow: TerminalFlow;
  frames: readonly BufferedTerminalFrame[];
  bufferedBytes: number;
  lastSequence: number;
  acknowledgedSequence: number;
  stopAuthorizationId: string | null;
  exit: { code: number | null; signal: string | null } | null;
  limits: Readonly<TerminalFlowLimits>;
}
export type TerminalLifecycleEvent =
  | { type: 'attach'; connectionId: string; acknowledgedSequence: number }
  | { type: 'detach'; connectionId: string; epoch: number }
  | { type: 'output'; bytes: number }
  | { type: 'acknowledge'; connectionId: string; epoch: number; sequence: number }
  | { type: 'request-stop'; authorizationId: string; authorized: boolean }
  | { type: 'exited'; code: number | null; signal: string | null };

const positiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
};
const validSequence = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
};
const identifier = (value: string, label: string): void => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) throw new Error(`${label} must be 1-200 characters`);
};

export function createTerminalLifecycle(limits: TerminalFlowLimits): TerminalLifecycleState {
  positiveInteger(limits.maxBufferedBytes, 'maxBufferedBytes');
  positiveInteger(limits.highWaterBytes, 'highWaterBytes');
  positiveInteger(limits.lowWaterBytes, 'lowWaterBytes');
  positiveInteger(limits.maxBufferedFrames, 'maxBufferedFrames');
  if (limits.lowWaterBytes >= limits.highWaterBytes || limits.highWaterBytes > limits.maxBufferedBytes) {
    throw new Error('flow limits must satisfy lowWaterBytes < highWaterBytes <= maxBufferedBytes');
  }
  return {
    phase: 'running', attachment: null, connectionEpoch: 0, flow: 'open', frames: [], bufferedBytes: 0,
    lastSequence: 0, acknowledgedSequence: 0, stopAuthorizationId: null, exit: null,
    limits: Object.freeze({ ...limits })
  };
}

function acknowledge(state: TerminalLifecycleState, requested: number): TerminalLifecycleState {
  validSequence(requested, 'acknowledged sequence');
  if (requested < state.acknowledgedSequence) throw new Error('acknowledgement cannot move backwards');
  if (requested > state.lastSequence) throw new Error('acknowledgement cannot exceed emitted output');
  const frames = state.frames.filter((frame) => frame.sequence > requested);
  const bufferedBytes = frames.reduce((total, frame) => total + frame.bytes, 0);
  const flow = state.flow === 'paused' && bufferedBytes <= state.limits.lowWaterBytes
    && frames.length < state.limits.maxBufferedFrames ? 'open' : state.flow;
  return { ...state, acknowledgedSequence: requested, frames, bufferedBytes, flow };
}

/**
 * Apply an already-authenticated supervisor/transport observation.
 * `paused` requires the supervisor to stop local PTY reads; output must never be dropped.
 */
export function reduceTerminalLifecycle(state: TerminalLifecycleState, event: TerminalLifecycleEvent): TerminalLifecycleState {
  if (event.type === 'attach') {
    if (state.phase === 'stopped') throw new Error('a stopped terminal cannot be reattached');
    identifier(event.connectionId, 'connectionId');
    if (state.attachment !== null) throw new Error('detach the current connection before attaching another');
    const acknowledged = acknowledge(state, event.acknowledgedSequence);
    const epoch = state.connectionEpoch + 1;
    return { ...acknowledged, connectionEpoch: epoch, attachment: { connectionId: event.connectionId, epoch } };
  }
  if (event.type === 'detach') {
    if (state.attachment?.connectionId !== event.connectionId || state.attachment.epoch !== event.epoch) return state;
    return { ...state, attachment: null };
  }
  if (event.type === 'output') {
    if (state.phase !== 'running') throw new Error('output is accepted only while the terminal is running');
    positiveInteger(event.bytes, 'output bytes');
    if (state.flow === 'paused') throw new Error('output arrived while flow was paused');
    if (state.frames.length >= state.limits.maxBufferedFrames || state.bufferedBytes + event.bytes > state.limits.maxBufferedBytes) {
      throw new Error('output would exceed the bounded replay buffer');
    }
    const nextSequence = state.lastSequence + 1;
    const frames = [...state.frames, { sequence: nextSequence, bytes: event.bytes }];
    const bufferedBytes = state.bufferedBytes + event.bytes;
    return { ...state, frames, bufferedBytes, lastSequence: nextSequence,
      flow: bufferedBytes >= state.limits.highWaterBytes || frames.length >= state.limits.maxBufferedFrames ? 'paused' : 'open' };
  }
  if (event.type === 'acknowledge') {
    if (state.attachment?.connectionId !== event.connectionId || state.attachment.epoch !== event.epoch) {
      throw new Error('stale connection cannot acknowledge output');
    }
    return acknowledge(state, event.sequence);
  }
  if (event.type === 'request-stop') {
    identifier(event.authorizationId, 'authorizationId');
    if (!event.authorized) throw new Error('stop requires an explicit authorized action');
    if (state.phase === 'stopped') return state;
    if (state.phase === 'stopping') {
      if (state.stopAuthorizationId !== event.authorizationId) throw new Error('stop is already authorized by another action');
      return state;
    }
    return { ...state, phase: 'stopping', flow: 'paused', stopAuthorizationId: event.authorizationId };
  }
  if (state.phase === 'stopped') throw new Error('duplicate exit observation');
  if (event.code !== null && (!Number.isSafeInteger(event.code) || event.code < 0 || event.code > 255)) {
    throw new Error('exit code must be null or an integer from 0 through 255');
  }
  if (event.signal !== null) identifier(event.signal, 'exit signal');
  if ((event.code === null) === (event.signal === null)) throw new Error('exit must contain exactly one of code or signal');
  return { ...state, phase: 'stopped', attachment: null, flow: 'paused', exit: { code: event.code, signal: event.signal } };
}
