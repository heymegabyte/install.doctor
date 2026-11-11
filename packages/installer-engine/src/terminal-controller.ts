import type { RendererKeyboardIntent } from './renderers.js';
import { parseRendererKeyboardIntent } from './renderers.js';

export interface TerminalInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  readonly readableFlowing?: boolean | null;
  isPaused?(): boolean;
  setRawMode?(enabled: boolean): void;
  resume(): this;
  pause(): this;
  on(event: 'data', listener: (chunk: Buffer | string) => void): this;
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): this;
}

export interface TerminalOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
}

export interface TerminalSignals {
  on(event: 'SIGWINCH', listener: () => void): this;
  removeListener(event: 'SIGWINCH', listener: () => void): this;
}

export interface TerminalControllerOptions {
  readonly input?: TerminalInput;
  readonly output?: TerminalOutput;
  readonly signals?: TerminalSignals;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly onIntent: (intent: RendererKeyboardIntent) => void;
  readonly onCancel: () => void;
  readonly onWidth: (width: number) => void;
  readonly onHeight: (height: number) => void;
  readonly onFilter?: (filter: string) => void;
}

export interface TerminalController {
  readonly active: boolean;
  readonly failureCount: number;
  close(): void;
}

function terminalWidth(columns: number | undefined): number {
  if (!Number.isSafeInteger(columns)) return 120;
  return Math.max(20, Math.min(500, columns as number));
}

function terminalHeight(rows: number | undefined): number {
  if (!Number.isSafeInteger(rows)) return 24;
  return Math.max(4, Math.min(500, rows as number));
}

function decodeKey(chunk: Buffer | string): string {
  const key = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  if (key === '\u001b[A') return 'arrowup';
  if (key === '\u001b[B') return 'arrowdown';
  if (key === '\u001b') return 'escape';
  if (key === '\u007f' || key === '\b') return 'backspace';
  return key;
}

/**
 * Owns terminal input only for an interactive TTY. Callback and terminal API
 * failures are isolated from the installer engine, and close is idempotent.
 */
export function createTerminalController(options: TerminalControllerOptions): TerminalController {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const signals = options.signals ?? process;
  const environment = options.environment ?? process.env;
  let failures = 0;
  let closed = false;
  let editingFilter = false;
  let filter = '';

  if (input.isTTY !== true || output.isTTY !== true || environment.TERM === 'dumb'
    || environment.INSTALL_DOCTOR_SCREEN_READER === '1') {
    return Object.freeze({ active: false, failureCount: 0, close() {} });
  }

  const wasRaw = input.isRaw === true;
  const wasFlowing = input.readableFlowing === true;
  const safely = (callback: () => void): void => {
    try { callback(); } catch { failures += 1; }
  };
  const emitViewport = (): void => {
    safely(() => options.onWidth(terminalWidth(output.columns)));
    safely(() => options.onHeight(terminalHeight(output.rows)));
  };
  const onData = (chunk: Buffer | string): void => {
    if (closed) return;
    const key = decodeKey(chunk);
    if (editingFilter) {
      if (key === '\u0003') {
        safely(() => options.onIntent('cancel'));
        safely(options.onCancel);
        return;
      }
      if (key === 'escape' || key === '\r' || key === '\n') { editingFilter = false; return; }
      if (key === 'backspace') {
        filter = [...filter].slice(0, -1).join('');
        safely(() => options.onFilter?.(filter));
        return;
      }
      if (!key.includes('\u001b') && !/[\u0000-\u001f\u007f]/u.test(key)) {
        filter = [...`${filter}${key}`].slice(0, 128).join('');
        safely(() => options.onFilter?.(filter));
      }
      return;
    }
    const intent = parseRendererKeyboardIntent(key);
    if (intent === 'none') return;
    safely(() => options.onIntent(intent));
    if (intent === 'begin-filter') editingFilter = true;
    if (intent === 'clear-filter') {
      filter = '';
      safely(() => options.onFilter?.(filter));
    }
    if (key === '\u0003') safely(options.onCancel);
  };

  try {
    input.setRawMode?.(true);
    input.on('data', onData);
    signals.on('SIGWINCH', emitViewport);
    input.resume();
    emitViewport();
  } catch {
    failures += 1;
    safely(() => input.removeListener('data', onData));
    safely(() => signals.removeListener('SIGWINCH', emitViewport));
    safely(() => input.setRawMode?.(wasRaw));
    if (!wasFlowing) safely(() => { input.pause(); });
    closed = true;
  }

  return {
    get active() { return !closed; },
    get failureCount() { return failures; },
    close() {
      if (closed) return;
      closed = true;
      safely(() => input.removeListener('data', onData));
      safely(() => signals.removeListener('SIGWINCH', emitViewport));
      safely(() => input.setRawMode?.(wasRaw));
      if (!wasFlowing) safely(() => { input.pause(); });
    },
  };
}
