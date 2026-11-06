import { z } from 'zod';
import { InstallerEventSchema, TerminalReceiptSchema } from './contracts.js';
import type { InstallerEvent, TerminalReceipt } from './contracts.js';
import type { InstallerRunResult, TaskTerminalStatus } from './engine.js';

export const RendererModeSchema = z.enum(['plain', 'json', 'ndjson', 'headless', 'ci', 'tui']);
export type RendererMode = z.infer<typeof RendererModeSchema>;

const rendererTaskId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const RendererProjectionOptionsSchema = z.object({
  width: z.number().int().min(20).max(500).default(120),
  height: z.number().int().min(4).max(500).default(24),
  color: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  follow: z.boolean().default(true),
  logFilter: z.string().max(128).default(''),
  criticalTaskIds: z.array(rendererTaskId).max(10_000).default([]),
}).strict();
export type RendererProjectionOptions = z.infer<typeof RendererProjectionOptionsSchema>;

export const RendererKeyboardIntentSchema = z.enum([
  'cancel', 'toggle-follow', 'begin-filter', 'clear-filter', 'toggle-critical',
  'move-up', 'move-down', 'inspect', 'none',
]);
export type RendererKeyboardIntent = z.infer<typeof RendererKeyboardIntentSchema>;

export function parseRendererKeyboardIntent(input: unknown): RendererKeyboardIntent {
  if (typeof input !== 'string' || input.length > 16) return 'none';
  const key = input.toLowerCase();
  if (key === 'q' || key === 'escape' || key === '\u0003') return 'cancel';
  if (key === 'f') return 'toggle-follow';
  if (key === '/') return 'begin-filter';
  if (key === 'c') return 'toggle-critical';
  if (key === 'arrowup' || key === 'k') return 'move-up';
  if (key === 'arrowdown' || key === 'j') return 'move-down';
  if (key === 'enter' || key === '\r') return 'inspect';
  if (key === 'backspace' || key === 'delete') return 'clear-filter';
  return 'none';
}

export function resolveRendererProjectionOptions(
  input: unknown = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RendererProjectionOptions {
  const candidate = typeof input === 'object' && input !== null ? input : {};
  const parsed = RendererProjectionOptionsSchema.parse(candidate);
  return Object.freeze({
    ...parsed,
    color: environment.NO_COLOR === undefined && environment.TERM !== 'dumb' && parsed.color,
    reducedMotion: environment.INSTALL_DOCTOR_REDUCED_MOTION === '1' || parsed.reducedMotion,
    criticalTaskIds: [...new Set(parsed.criticalTaskIds)].sort(),
  });
}

export interface InstallerSemanticResult {
  readonly planDigest: string;
  readonly selectedTaskIds: readonly string[];
  readonly taskStatuses: Readonly<Record<string, TaskTerminalStatus>>;
  readonly receiptStatus: TerminalReceipt['status'];
  readonly taskCounts: TerminalReceipt['taskCounts'];
  readonly nextAction: string | null;
  readonly exitCode: number;
}

export interface RenderedInstallerResult {
  readonly mode: RendererMode;
  readonly output: string;
  readonly semantic: InstallerSemanticResult;
  readonly exitCode: number;
}

export interface RendererSession {
  readonly mode: RendererMode;
  readonly detached: boolean;
  readonly failureCount: number;
  readonly spilledBytes: number;
  readonly spilledChunks: number;
  readonly spillExhausted: boolean;
  readonly projectionOptions: RendererProjectionOptions;
  resumeDelivery(): void;
  onEvent(event: InstallerEvent): void;
  updateProjectionOptions(patch: RendererProjectionOptionsPatch): void;
  handleIntent(intent: RendererKeyboardIntent): void;
  finish(result: InstallerRunResult): void;
  close(): void;
}

export type RendererSink = (chunk: string) => boolean;
export type RendererSpillSink = (chunk: string) => boolean;
export const RendererDeliveryOptionsSchema = z.object({
  maxSpillBytes: z.number().int().min(1).max(16 * 1024 * 1024).default(1024 * 1024),
  maxSpillChunks: z.number().int().min(1).max(100_000).default(10_000),
  interactiveTui: z.boolean().default(false),
}).strict();
export type RendererDeliveryOptions = z.infer<typeof RendererDeliveryOptionsSchema>;
const RendererProjectionOptionsPatchSchema = RendererProjectionOptionsSchema.partial().strict();
export type RendererProjectionOptionsPatch = z.infer<typeof RendererProjectionOptionsPatchSchema>;

const terminalRunStatuses = new Set(['redirected', 'success', 'failed', 'cancelled', 'rejected']);
const terminalTaskStatuses = new Set<TaskTerminalStatus>(['verified', 'inapplicable', 'pending', 'pending-reboot', 'interrupted', 'blocked', 'failed']);

export type TuiTaskStatus = 'queued' | 'running' | 'retrying' | TaskTerminalStatus;
export interface TuiTaskView {
  readonly taskId: string;
  readonly status: TuiTaskStatus;
  readonly attempt: number;
  readonly waitingLocks: readonly string[];
  readonly heldLocks: readonly string[];
  readonly output: readonly string[];
  readonly outputSequences: readonly number[];
  readonly outputDropped: number;
}
export interface TuiModel {
  readonly runStatus: string;
  readonly phase: string;
  readonly tasks: Readonly<Record<string, TuiTaskView>>;
  readonly selectedTaskId: string | null;
  readonly inspect: boolean;
  readonly criticalOnly: boolean;
  readonly lastSequence: number;
  readonly retainedOutputBytes: number;
  readonly retainedOutputLines: number;
}

const TUI_OUTPUT_LINES_PER_TASK = 128;
const TUI_OUTPUT_BYTES_PER_TASK = 64 * 1024;
const TUI_OUTPUT_LINES_GLOBAL = 2_048;
const TUI_OUTPUT_BYTES_GLOBAL = 1024 * 1024;

export function createTuiModel(): TuiModel {
  return Object.freeze({
    runStatus: 'starting', phase: 'discover', tasks: Object.freeze({}), selectedTaskId: null,
    inspect: false, criticalOnly: false, lastSequence: -1, retainedOutputBytes: 0, retainedOutputLines: 0,
  });
}

function updateTask(model: TuiModel, taskId: string, update: (task: TuiTaskView) => TuiTaskView): TuiModel {
  const current = model.tasks[taskId] ?? Object.freeze({
    taskId, status: 'queued' as const, attempt: 0, waitingLocks: Object.freeze([]), heldLocks: Object.freeze([]),
    output: Object.freeze([]), outputSequences: Object.freeze([]), outputDropped: 0,
  });
  const tasks = Object.freeze({ ...model.tasks, [taskId]: Object.freeze(update(current)) });
  const selectedTaskId = model.selectedTaskId ?? Object.keys(tasks).sort()[0] ?? null;
  return Object.freeze({ ...model, tasks, selectedTaskId });
}

function outputBytes(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + Buffer.byteLength(line, 'utf8'), 0);
}

function appendTuiOutput(model: TuiModel, taskId: string, sequence: number, line: string): TuiModel {
  const previousTask = model.tasks[taskId];
  const previousBytes = previousTask ? outputBytes(previousTask.output) : 0;
  const previousLines = previousTask?.output.length ?? 0;
  let next = updateTask(model, taskId, task => {
    const output = [...task.output, line];
    const outputSequences = [...task.outputSequences, sequence];
    let dropped = task.outputDropped;
    let bytes = outputBytes(output);
    while (output.length > TUI_OUTPUT_LINES_PER_TASK || bytes > TUI_OUTPUT_BYTES_PER_TASK) {
      const removed = output.shift();
      outputSequences.shift();
      if (removed !== undefined) bytes -= Buffer.byteLength(removed, 'utf8');
      dropped += 1;
    }
    return {
      ...task,
      output: Object.freeze(output),
      outputSequences: Object.freeze(outputSequences),
      outputDropped: dropped,
    };
  });

  const nextTask = next.tasks[taskId];
  if (!nextTask) throw new Error(`TUI output task disappeared: ${taskId}`);
  let retainedOutputLines = model.retainedOutputLines - previousLines + nextTask.output.length;
  let retainedOutputBytes = model.retainedOutputBytes - previousBytes + outputBytes(nextTask.output);
  let tasks = next.tasks;
  while (retainedOutputLines > TUI_OUTPUT_LINES_GLOBAL || retainedOutputBytes > TUI_OUTPUT_BYTES_GLOBAL) {
    let oldest: TuiTaskView | undefined;
    for (const task of Object.values(tasks)) {
      if (task.outputSequences.length === 0) continue;
      if (!oldest || (task.outputSequences[0] ?? Number.MAX_SAFE_INTEGER) < (oldest.outputSequences[0] ?? Number.MAX_SAFE_INTEGER)) oldest = task;
    }
    if (!oldest) break;
    const removed = oldest.output[0];
    const updated = Object.freeze({
      ...oldest,
      output: Object.freeze(oldest.output.slice(1)),
      outputSequences: Object.freeze(oldest.outputSequences.slice(1)),
      outputDropped: oldest.outputDropped + 1,
    });
    tasks = Object.freeze({ ...tasks, [oldest.taskId]: updated });
    retainedOutputLines -= 1;
    if (removed !== undefined) retainedOutputBytes -= Buffer.byteLength(removed, 'utf8');
  }
  next = Object.freeze({ ...next, tasks, retainedOutputLines, retainedOutputBytes });
  return next;
}

export function reduceTuiEvent(modelInput: TuiModel, eventInput: unknown): TuiModel {
  const event = InstallerEventSchema.parse(eventInput);
  if (event.sequence !== modelInput.lastSequence + 1) throw new Error(`TUI event sequence gap at ${event.sequence}`);
  let model: TuiModel = Object.freeze({ ...modelInput, lastSequence: event.sequence });
  if (event.kind === 'run-status') return Object.freeze({ ...model, runStatus: event.status });
  if (event.kind === 'phase-status') return Object.freeze({ ...model, phase: `${event.phase}:${event.status}` });
  if (event.kind === 'task-status') {
    return updateTask(model, event.taskId, task => ({ ...task, status: event.status as TuiTaskStatus, attempt: event.attempt }));
  }
  if (event.kind === 'lock') {
    return updateTask(model, event.taskId, task => {
      const waiting = new Set(task.waitingLocks); const held = new Set(task.heldLocks);
      if (event.state === 'waiting') waiting.add(event.domain);
      if (event.state === 'acquired') { waiting.delete(event.domain); held.add(event.domain); }
      if (event.state === 'released') { waiting.delete(event.domain); held.delete(event.domain); }
      return { ...task, waitingLocks: Object.freeze([...waiting].sort()), heldLocks: Object.freeze([...held].sort()) };
    });
  }
  return appendTuiOutput(model, event.taskId, event.sequence, `${event.stream}: ${sanitizeTerminalText(event.line)}`);
}

export function applyTuiIntent(model: TuiModel, intent: RendererKeyboardIntent, criticalTaskIds: readonly string[] = []): TuiModel {
  const critical = new Set(criticalTaskIds);
  const visible = Object.keys(model.tasks).sort().filter(taskId => !model.criticalOnly || critical.has(taskId));
  const current = Math.max(0, visible.indexOf(model.selectedTaskId ?? ''));
  if (intent === 'move-up' && visible.length > 0) return Object.freeze({ ...model, selectedTaskId: visible[Math.max(0, current - 1)] ?? null });
  if (intent === 'move-down' && visible.length > 0) return Object.freeze({ ...model, selectedTaskId: visible[Math.min(visible.length - 1, current + 1)] ?? null });
  if (intent === 'inspect') return Object.freeze({ ...model, inspect: !model.inspect });
  if (intent === 'toggle-critical') {
    const criticalOnly = !model.criticalOnly;
    const nextVisible = Object.keys(model.tasks).sort().filter(taskId => !criticalOnly || critical.has(taskId));
    return Object.freeze({ ...model, criticalOnly, selectedTaskId: nextVisible.includes(model.selectedTaskId ?? '') ? model.selectedTaskId : nextVisible[0] ?? null });
  }
  return model;
}

export function reduceInstallerEvents(result: InstallerRunResult): InstallerSemanticResult {
  const taskStatuses: Record<string, TaskTerminalStatus> = {};
  let terminalRuns = 0;
  let terminated = false;
  result.events.forEach((eventInput, index) => {
    const event = InstallerEventSchema.parse(eventInput);
    if (event.sequence !== index) throw new Error(`installer event sequence gap at ${index}`);
    if (terminated) throw new Error('installer event follows the terminal run event');
    if (event.kind === 'task-status' && terminalTaskStatuses.has(event.status as TaskTerminalStatus)) {
      taskStatuses[event.taskId] = event.status as TaskTerminalStatus;
    }
    if (event.kind === 'run-status' && terminalRunStatuses.has(event.status)) {
      terminalRuns += 1;
      terminated = true;
    }
  });
  if (terminalRuns !== 1) throw new Error('installer event stream must contain exactly one terminal run event');
  for (const taskId of result.plan.selectedTaskIds) {
    if (!taskStatuses[taskId]) throw new Error(`selected task has no terminal event: ${taskId}`);
  }
  const receipt = TerminalReceiptSchema.parse(result.receipt);
  return Object.freeze({
    planDigest: result.plan.digest,
    selectedTaskIds: Object.freeze([...result.plan.selectedTaskIds]),
    taskStatuses: Object.freeze(taskStatuses),
    receiptStatus: receipt.status,
    taskCounts: Object.freeze({ ...receipt.taskCounts }),
    nextAction: receipt.nextAction,
    exitCode: result.exitCode,
  });
}

export function semanticInstallerResult(result: InstallerRunResult): InstallerSemanticResult {
  const reduced = reduceInstallerEvents(result);
  if (JSON.stringify(reduced.taskStatuses) !== JSON.stringify(result.taskStatuses)) {
    throw new Error('event-derived task statuses disagree with engine state');
  }
  return reduced;
}

function eventLine(event: InstallerEvent, criticalTaskIds: ReadonlySet<string>): string {
  if (event.kind === 'phase-status') return `${event.phase}: ${event.status}`;
  if (event.kind === 'task-status') {
    const critical = criticalTaskIds.has(event.taskId) ? ' [critical path]' : '';
    const attempt = event.status === 'retrying' ? ` (attempt ${event.attempt})` : '';
    return `${event.taskId}: ${event.status}${attempt}${critical}`;
  }
  if (event.kind === 'run-status') return `run: ${event.status}`;
  if (event.kind === 'lock') return `${event.taskId}: lock ${event.domain} ${event.state}`;
  return `${event.taskId} ${event.stream}: ${sanitizeTerminalText(event.line)}`;
}

export function sanitizeTerminalText(value: string): string {
  let safe = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '\n') safe += '\\n';
    else if (character === '\r') safe += '\\r';
    else if (character === '\t') safe += '\\t';
    else if (codePoint === 0x1b) safe += '^[';
    else if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) safe += `\\x${codePoint.toString(16).padStart(2, '0')}`;
    else if (/[\p{Cf}\p{Zl}\p{Zp}]/u.test(character)) safe += `\\u{${codePoint.toString(16)}}`;
    else safe += character;
  }
  return safe;
}

function terminalCellWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f || /\p{Mark}/u.test(character)) return 0;
  if (/\p{Extended_Pictographic}/u.test(character)) return 2;
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

function fitTerminalWidth(line: string, width: number): string {
  const characters = [...line];
  const totalWidth = characters.reduce((total, character) => total + terminalCellWidth(character), 0);
  if (totalWidth <= width) return line;
  const visible: string[] = [];
  let used = 0;
  for (const character of characters) {
    const cells = terminalCellWidth(character);
    if (used + cells > width - 1) break;
    visible.push(character);
    used += cells;
  }
  return `${visible.join('')}…`;
}

function tuiColor(value: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function tuiStatusIcon(status: TuiTaskStatus, reducedMotion: boolean): string {
  if (status === 'verified') return '✓';
  if (status === 'failed' || status === 'blocked') return '✕';
  if (status === 'running') return reducedMotion ? '•' : '◆';
  if (status === 'retrying') return '↻';
  if (status === 'pending-reboot') return '↯';
  if (status === 'queued') return '·';
  return '○';
}

export function renderTuiFrame(model: TuiModel, optionsInput: unknown = {}): string {
  const options = resolveRendererProjectionOptions(optionsInput);
  const critical = new Set(options.criticalTaskIds);
  const taskIds = Object.keys(model.tasks).sort().filter(taskId => !model.criticalOnly || critical.has(taskId));
  const tasks = taskIds.map(taskId => model.tasks[taskId]).filter((task): task is TuiTaskView => task !== undefined);
  const active = tasks.filter(task => task.status === 'running' || task.status === 'retrying').length;
  const done = tasks.filter(task => terminalTaskStatuses.has(task.status as TaskTerminalStatus)).length;
  const waiting = tasks.length - active - done;
  const phase = model.phase.replace(':', ' · ');
  const selectedIndex = Math.max(0, taskIds.indexOf(model.selectedTaskId ?? ''));
  const taskCapacity = Math.max(0, options.height - 3);
  const taskStart = Math.max(0, Math.min(
    selectedIndex - Math.floor(taskCapacity / 2),
    Math.max(0, tasks.length - taskCapacity),
  ));
  const visibleTasks = tasks.slice(taskStart, taskStart + taskCapacity);
  const viewport = tasks.length > taskCapacity
    ? `  view ${taskStart + 1}-${taskStart + visibleTasks.length} of ${tasks.length}`
    : '';
  const lines = [
    tuiColor(fitTerminalWidth(`INSTALL DOCTOR  ${phase}  ${model.runStatus}`, options.width), '1;36', options.color),
    fitTerminalWidth(`Workers  ${active} active  ${waiting} waiting  ${done}/${tasks.length} done${viewport}   [j/k] select  [enter] inspect  [c] critical  [f] follow  [/] filter  [q] cancel`, options.width),
    fitTerminalWidth('─'.repeat(Math.max(1, options.width)), options.width),
  ];
  if (tasks.length === 0) {
    lines.push(fitTerminalWidth('  Discovering selected work…', options.width));
    return lines.slice(0, options.height).join('\n');
  }
  if (!model.inspect) for (const task of visibleTasks) {
    const selected = task.taskId === model.selectedTaskId ? '›' : ' ';
    const criticalLabel = critical.has(task.taskId) ? '  critical' : '';
    const lock = task.waitingLocks.length > 0 ? `  waiting:${task.waitingLocks.join(',')}` : task.heldLocks.length > 0 ? `  lock:${task.heldLocks.join(',')}` : '';
    const attempt = task.status === 'retrying' ? `  attempt:${task.attempt}` : '';
    const status = `${tuiStatusIcon(task.status, options.reducedMotion)} ${task.status}`;
    const row = options.width < 40
      ? `${selected} ${tuiStatusIcon(task.status, options.reducedMotion)} ${task.taskId}  ${status.slice(2)}${attempt}${lock}${criticalLabel}`
      : `${selected} ${status.padEnd(18)} ${task.taskId}${attempt}${lock}${criticalLabel}`;
    lines.push(fitTerminalWidth(row, options.width));
  }
  if (model.inspect && model.selectedTaskId) {
    const selected = model.tasks[model.selectedTaskId];
    if (selected) {
      lines.push(fitTerminalWidth(`Task ${selected.taskId} · ${selected.status} · attempt ${selected.attempt}`, options.width));
      const output = selected.output.filter(line => options.logFilter === '' || line.toLocaleLowerCase('en-US').includes(options.logFilter.toLocaleLowerCase('en-US')));
      const outputCapacity = Math.max(0, options.height - lines.length);
      if (!options.follow && outputCapacity > 0) lines.push(fitTerminalWidth('  Output paused', options.width));
      else if (output.length === 0 && outputCapacity > 0) lines.push(fitTerminalWidth('  No matching output', options.width));
      else {
        const needsSummary = selected.outputDropped > 0 || output.length > outputCapacity;
        const visibleCapacity = needsSummary && outputCapacity > 1 ? outputCapacity - 1 : outputCapacity;
        const visibleOutput = visibleCapacity === 0 ? [] : output.slice(-visibleCapacity);
        const retainedEarlier = output.length - visibleOutput.length;
        if (needsSummary && outputCapacity > 1) {
          const dropped = selected.outputDropped > 0 ? `${selected.outputDropped} earlier output lines omitted from the live view; ` : '';
          lines.push(fitTerminalWidth(`  ${dropped}showing ${visibleOutput.length} of ${output.length} retained`, options.width));
        }
        for (const line of visibleOutput) lines.push(fitTerminalWidth(`  ${line}`, options.width));
      }
    }
  }
  return lines.slice(0, options.height).join('\n');
}

export function projectInstallerEvent(eventInput: unknown, optionsInput: unknown = {}): string | null {
  const event = InstallerEventSchema.parse(eventInput);
  const options = resolveRendererProjectionOptions(optionsInput, {});
  if (event.kind === 'output') {
    if (!options.follow) return null;
    if (options.logFilter !== '' && !event.line.toLocaleLowerCase('en-US').includes(options.logFilter.toLocaleLowerCase('en-US'))) return null;
  }
  return fitTerminalWidth(eventLine(event, new Set(options.criticalTaskIds)), options.width);
}

export function createRendererSession(
  modeInput: unknown,
  sink: RendererSink,
  optionsInput: unknown = {},
  deliveryInput: unknown = {},
  spill?: RendererSpillSink,
): RendererSession {
  const mode = RendererModeSchema.parse(modeInput);
  let options = resolveRendererProjectionOptions(optionsInput);
  const delivery = RendererDeliveryOptionsSchema.parse(deliveryInput);
  let detached = false;
  let detachedForBackpressure = false;
  let closed = false;
  let failures = 0;
  let spilledBytes = 0;
  let spilledChunks = 0;
  let spillExhausted = false;
  let lastSequence = -1;
  let tuiModel = createTuiModel();
  let tuiStarted = false;
  let terminalRestored = false;
  const streaming = mode !== 'json';
  const spillChunk = (chunk: string): void => {
    if (spill === undefined || closed) { closed = true; return; }
    const bytes = Buffer.byteLength(chunk, 'utf8');
    if (spilledChunks + 1 > delivery.maxSpillChunks || spilledBytes + bytes > delivery.maxSpillBytes) {
      spillExhausted = true; closed = true; return;
    }
    try {
      if (!spill(chunk)) { spillExhausted = true; closed = true; return; }
      spilledChunks += 1; spilledBytes += bytes;
    } catch { failures += 1; spillExhausted = true; closed = true; }
  };
  const write = (chunk: string): void => {
    if (closed) return;
    if (!detached) {
      try {
        if (sink(chunk)) return;
        detached = true;
        detachedForBackpressure = true;
      } catch { failures += 1; detached = true; detachedForBackpressure = false; }
    }
    spillChunk(chunk);
  };
  const writeTuiFrame = (): void => {
    if (mode !== 'tui' || !delivery.interactiveTui || closed) return;
    const prefix = tuiStarted ? '\u001b[H\u001b[J' : '\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H';
    tuiStarted = true;
    write(`${prefix}${renderTuiFrame(tuiModel, options)}\n`);
  };
  return {
    mode,
    get detached() { return detached; },
    get failureCount() { return failures; },
    get spilledBytes() { return spilledBytes; },
    get spilledChunks() { return spilledChunks; },
    get spillExhausted() { return spillExhausted; },
    get projectionOptions() { return options; },
    resumeDelivery() {
      if (closed || spillExhausted || !detachedForBackpressure) return;
      detached = false;
      detachedForBackpressure = false;
    },
    updateProjectionOptions(patchInput) {
      if (closed) return;
      try {
        const patch = RendererProjectionOptionsPatchSchema.parse(patchInput);
        const suppliedKeys = Object.keys(patchInput) as (keyof RendererProjectionOptionsPatch)[];
        const supplied = Object.fromEntries(suppliedKeys.map(key => [key, patch[key]]));
        options = resolveRendererProjectionOptions({ ...options, ...supplied });
        writeTuiFrame();
      } catch {
        failures += 1;
      }
    },
    handleIntent(intentInput) {
      if (closed || mode !== 'tui') return;
      try {
        const intent = RendererKeyboardIntentSchema.parse(intentInput);
        tuiModel = applyTuiIntent(tuiModel, intent, options.criticalTaskIds);
        writeTuiFrame();
      } catch { failures += 1; }
    },
    onEvent(eventInput) {
      if (!streaming || closed) return;
      try {
        const event = InstallerEventSchema.parse(eventInput);
        if (event.sequence !== lastSequence + 1) { failures += 1; detached = true; detachedForBackpressure = false; closed = true; return; }
        lastSequence = event.sequence;
        if (mode === 'tui' && delivery.interactiveTui) {
          tuiModel = reduceTuiEvent(tuiModel, event);
          writeTuiFrame();
          return;
        }
        const line = mode === 'ndjson' || mode === 'headless' || mode === 'ci'
          ? JSON.stringify(event)
          : projectInstallerEvent(event, options);
        if (line === null) return;
        write(`${line}\n`);
      } catch { failures += 1; detached = true; detachedForBackpressure = false; closed = true; }
    },
    finish(result) {
      if (closed) return;
      try {
        const semantic = semanticInstallerResult(result);
        if (mode === 'json') {
          write(`${JSON.stringify({ schemaVersion: 1, semantic, receipt: result.receipt })}\n`);
          return;
        }
        if (lastSequence !== result.events.length - 1) { failures += 1; detached = true; detachedForBackpressure = false; closed = true; return; }
        if (mode === 'plain' || mode === 'tui') {
          const commit = result.receipt.evidencePaths.find(path => path.endsWith('.commit.json'));
          if (mode === 'tui' && delivery.interactiveTui) {
            writeTuiFrame();
            if (commit) write(`\u001b[H\u001b[J${renderTuiFrame(tuiModel, options)}\n${fitTerminalWidth(`Evidence ${sanitizeTerminalText(commit)}`, options.width)}\n`);
          } else if (commit) write(`evidence: ${commit}\n`);
        }
      } catch { failures += 1; detached = true; detachedForBackpressure = false; closed = true; }
    },
    close() {
      if (tuiStarted && !terminalRestored) {
        terminalRestored = true;
        try { sink('\u001b[?25h\u001b[?1049l'); } catch { failures += 1; }
      }
      closed = true;
    },
  };
}

export function renderInstallerResult(result: InstallerRunResult, modeInput: unknown, optionsInput: unknown = {}): RenderedInstallerResult {
  const mode = RendererModeSchema.parse(modeInput);
  const options = resolveRendererProjectionOptions(optionsInput);
  const semantic = semanticInstallerResult(result);
  let output: string;
  if (mode === 'json') {
    output = `${JSON.stringify({ schemaVersion: 1, semantic, receipt: result.receipt })}\n`;
  } else if (mode === 'ndjson' || mode === 'headless' || mode === 'ci') {
    output = `${result.events.map(event => JSON.stringify(event)).join('\n')}\n`;
  } else {
    output = `${result.events.map(event => projectInstallerEvent(event, options)).filter((line): line is string => line !== null).join('\n')}\n`;
  }
  return Object.freeze({ mode, output, semantic, exitCode: result.exitCode });
}
