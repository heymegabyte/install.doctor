#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { createDesktopToolsToolAdapters, DESKTOP_TOOLS_TYPED_TOOL_NAMES } from './typed-tool-adapters.js';
import type { ConsentBroker, DesktopToolsTypedToolName, EngineInvoker } from './typed-tool-adapters.js';
import { createProvisioningSessionEventJournal } from './session-events.js';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolutePath = z.string().min(1).max(4096).refine(isAbsolute, 'path must be absolute');
const ToolContextSchema = z.strictObject({
  schemaVersion: z.literal(1), sessionId: identifier, runId: identifier, authorizationId: identifier,
  releaseId: identifier, releaseDigest: digest,
  profileRevision: identifier, profileDigest: digest,
  facts: z.unknown(), desiredState: z.unknown(), plan: z.unknown(), operations: z.unknown(),
});
const ConsentReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), operation: z.enum(['apply', 'rollback-config']),
  sessionRunId: identifier, planDigest: digest, sourceRunId: identifier.nullable(),
  approved: z.literal(true), actorId: identifier, approvedAt: z.string().datetime({ offset: true }),
});
const ServerOptionsSchema = z.strictObject({
  engine: absolutePath, engineSha256: digest, context: absolutePath, stateRoot: absolutePath, consentDirectory: absolutePath,
});
type ServerOptions = z.infer<typeof ServerOptionsSchema>;

const noArgumentsSchema = { type: 'object', additionalProperties: false, required: ['schemaVersion'], properties: { schemaVersion: { const: 1 } } };
const planReferenceSchema = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'planDigest'], properties: {
  schemaVersion: { const: 1 }, planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
} };
const approvalReferenceSchema = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'approvalId'], properties: {
  schemaVersion: { const: 1 }, approvalId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
} };
const runReferenceSchema = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'runId', 'planDigest'], properties: {
  schemaVersion: { const: 1 }, runId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
  planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
} };
const toolDescriptions: Readonly<Record<DesktopToolsTypedToolName, { readonly description: string; readonly inputSchema: object }>> = Object.freeze({
  desktop_tools_discover: { description: 'Read trusted host facts without mutation.', inputSchema: noArgumentsSchema },
  desktop_tools_validate: { description: 'Validate the immutable desired-state closure without mutation.', inputSchema: noArgumentsSchema },
  desktop_tools_plan: { description: 'Derive the exact normalized installer plan.', inputSchema: noArgumentsSchema },
  desktop_tools_approve: { description: 'Consume an out-of-band operator consent receipt for an exact plan.', inputSchema: planReferenceSchema },
  desktop_tools_apply: { description: 'Apply an exactly approved plan through engine locks and journaling.', inputSchema: approvalReferenceSchema },
  desktop_tools_verify: { description: 'Verify durable committed engine evidence.', inputSchema: runReferenceSchema },
  desktop_tools_status: { description: 'Inspect current plan status without mutation.', inputSchema: runReferenceSchema },
  desktop_tools_resume: { description: 'Resume released uncommitted evidence under its existing approval.', inputSchema: approvalReferenceSchema },
  desktop_tools_rollback_config: { description: 'Plan, approve, execute, resume, or inspect configuration-only rollback.', inputSchema: {
    type: 'object', additionalProperties: false, required: ['schemaVersion', 'action'], properties: {
      schemaVersion: { const: 1 }, action: { enum: ['plan', 'approve', 'execute', 'resume', 'status'] },
      sourceRunId: { type: 'string' }, sourcePlanDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      rollbackPlanDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, approvalId: { type: 'string' },
      rollbackRunId: { type: 'string' }, planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  } },
  desktop_tools_deprovision_preview: { description: 'Build a permanently non-executable ownership-aware deprovision preview.', inputSchema: {
    type: 'object', additionalProperties: false, required: ['schemaVersion', 'sourceRunId', 'sourcePlanDigest', 'resources'], properties: {
      schemaVersion: { const: 1 }, sourceRunId: { type: 'string' }, sourcePlanDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      policy: { type: 'object' }, resources: { type: 'array', maxItems: 10000 },
    },
  } },
});

function parseOptions(argv: readonly string[]): ServerOptions {
  const values: Record<string, string> = {};
  const names: Readonly<Record<string, keyof ServerOptions>> = {
    '--engine': 'engine', '--engine-sha256': 'engineSha256', '--context': 'context',
    '--state-root': 'stateRoot', '--consent-dir': 'consentDirectory',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; const value = argv[index + 1]; const key = name ? names[name] : undefined;
    if (!key || value === undefined || value.startsWith('--') || values[key] !== undefined) throw new Error(`unsupported or repeated MCP server option: ${name ?? ''}`);
    values[key] = value;
  }
  return ServerOptionsSchema.parse(values);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256'); const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
  } finally { await handle.close(); }
  return hash.digest('hex');
}

async function validateOpenEngine(path: string, expectedDigest: string) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 64 * 1024 * 1024
      || (info.mode & 0o022) !== 0 || (typeof info.uid === 'number' && info.uid !== process.getuid?.())) {
      throw new Error('installer engine is not a protected bounded regular file');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    if (hash.digest('hex') !== expectedDigest) throw new Error('installer engine digest does not match the signed runtime');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function executeOpenedEngine(engine: Awaited<ReturnType<typeof open>>, invocation: Awaited<ReturnType<typeof open>>) {
  const descriptorRoot = process.platform === 'linux' ? '/proc/self/fd' : process.platform === 'darwin' ? '/dev/fd' : null;
  if (!descriptorRoot) throw new Error(`descriptor-bound engine execution is unsupported on ${process.platform}`);
  return new Promise<{ stdout: string }>((resolvePromise, reject) => {
    const enginePath = `${descriptorRoot}/3`; const inputPath = `${descriptorRoot}/4`;
    const loader = `process.argv.splice(1,0,${JSON.stringify(enginePath)});await import(${JSON.stringify(`file://${enginePath}`)})`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', loader, '--', '--input', inputPath], {
      shell: false, windowsHide: true,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe', engine.fd, invocation.fd],
    });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let stdoutBytes = 0; let stderrBytes = 0; let overflow = false;
    const limit = 16 * 1024 * 1024;
    const timer = setTimeout(() => child.kill('SIGKILL'), 86_400_000);
    const collect = (chunks: Buffer[], kind: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const bytes = kind === 'stdout' ? (stdoutBytes += chunk.length) : (stderrBytes += chunk.length);
      if (bytes > limit) { overflow = true; child.kill('SIGKILL'); return; }
      chunks.push(chunk);
    };
    child.stdout!.on('data', collect(stdout, 'stdout')); child.stderr!.on('data', collect(stderr, 'stderr'));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (overflow) return reject(Object.assign(new Error('installer engine output exceeded the bounded buffer'), { code: 7 }));
      if (signal || code !== 0) return reject(Object.assign(new Error(Buffer.concat(stderr).toString('utf8').slice(0, 1024)
        || `installer engine exited with ${signal ?? code}`), { code: Number.isSafeInteger(code) ? code : 7 }));
      resolvePromise({ stdout: Buffer.concat(stdout).toString('utf8') });
    });
  });
}

async function safeFile(path: string, label: string, maximumBytes: number): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximumBytes
    || (info.mode & 0o022) !== 0 || (typeof info.uid === 'number' && info.uid !== process.getuid?.())) {
    throw new Error(`${label} is not a protected bounded regular file`);
  }
}

async function protectedDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (typeof info.uid === 'number' && info.uid !== process.getuid?.())) throw new Error(`${label} is not a protected owned directory`);
}

function parseEngineOutput(stdout: string): unknown {
  const lines = stdout.split('\n').filter(Boolean);
  if (lines.length === 0) return Object.freeze({ schemaVersion: 1, events: Object.freeze([]) });
  const parsed = lines.map(line => JSON.parse(line) as unknown);
  return parsed.length === 1 ? parsed[0] : Object.freeze({ schemaVersion: 1, events: Object.freeze(parsed) });
}

async function createEngineInvoker(options: ServerOptions): Promise<EngineInvoker> {
  await safeFile(options.engine, 'installer engine', 64 * 1024 * 1024);
  if (await sha256(options.engine) !== options.engineSha256) throw new Error('installer engine digest does not match the signed runtime');
  const invocationDirectory = join(options.stateRoot, 'run', 'mcp-invocations');
  await mkdir(invocationDirectory, { recursive: true, mode: 0o700 }); await chmod(invocationDirectory, 0o700);
  await protectedDirectory(invocationDirectory, 'MCP invocation directory');
  return async invocation => {
    const path = join(invocationDirectory, `${randomUUID()}.json`);
    const engine = await validateOpenEngine(options.engine, options.engineSha256);
    let input;
    try {
      input = await open(path, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      const bytes = Buffer.from(`${JSON.stringify(invocation)}\n`, 'utf8');
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await input.write(bytes, offset, bytes.length - offset, offset);
        if (!bytesWritten) throw new Error('installer invocation could not be persisted');
        offset += bytesWritten;
      }
      await input.sync();
      try {
        const result = await executeOpenedEngine(engine, input);
        return parseEngineOutput(result.stdout);
      } catch (error) {
        const candidate = error as { code?: number; message?: string };
        const exitClass = Number.isSafeInteger(candidate.code) && Number(candidate.code) >= 2 && Number(candidate.code) <= 8
          ? Number(candidate.code) : 7;
        const parseDiagnostic = exitClass === 2 && typeof candidate.message === 'string'
          ? `: ${candidate.message.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 1_024)}` : '';
        throw new Error(`installer engine rejected the typed operation (class ${exitClass})${parseDiagnostic}`);
      }
    } finally {
      await Promise.allSettled([engine?.close(), input?.close()]);
      await rm(path, { force: true });
    }
  };
}

function consentFilename(operation: 'apply' | 'rollback-config', planDigest: string): string {
  return `${operation}.${planDigest}.json`;
}

async function createConsentBroker(options: ServerOptions, sessionRunId: string): Promise<ConsentBroker> {
  await protectedDirectory(options.consentDirectory, 'consent directory');
  return async request => {
    const path = join(options.consentDirectory, consentFilename(request.operation, request.planDigest));
    await safeFile(path, 'consent receipt', 16 * 1024).catch(error => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new Error('operator consent is pending outside the model session');
      throw error;
    });
    const consumed = join(options.consentDirectory, `.consumed-${randomUUID()}`);
    try {
      await rename(path, consumed);
      const receipt = ConsentReceiptSchema.parse(JSON.parse(await readFile(consumed, 'utf8')));
      if (receipt.operation !== request.operation || receipt.sessionRunId !== sessionRunId || receipt.planDigest !== request.planDigest
        || receipt.sourceRunId !== (request.sourceRunId ?? null)) throw new Error('operator consent receipt is not bound to this exact operation');
      return Object.freeze({ approved: true, actorId: receipt.actorId, approvedAt: receipt.approvedAt });
    } finally { await rm(consumed, { force: true }); }
  };
}

export async function createDesktopToolsMcpRuntime(optionsInput: unknown) {
  const options = ServerOptionsSchema.parse(optionsInput);
  await safeFile(options.context, 'tool context', 4 * 1024 * 1024);
  await protectedDirectory(options.stateRoot, 'state root');
  const context = ToolContextSchema.parse(JSON.parse(await readFile(options.context, 'utf8')));
  const events = createProvisioningSessionEventJournal(join(options.stateRoot, 'history', `${context.sessionId}.events.ndjson`), {
    sessionId: context.sessionId, runId: context.runId, authorizationId: context.authorizationId,
  });
  const invokeEngine = await createEngineInvoker(options);
  const requestConsent = await createConsentBroker(options, context.runId);
  const adapters = createDesktopToolsToolAdapters({
    operation: Object.freeze({ facts: context.facts, desiredState: context.desiredState, plan: context.plan, operations: context.operations }),
    runId: context.runId, releaseId: context.releaseId, stateRoot: options.stateRoot, invokeEngine, requestConsent,
  });
  return Object.freeze({
    tools: Object.freeze(DESKTOP_TOOLS_TYPED_TOOL_NAMES.map(name => Object.freeze({ name, ...toolDescriptions[name] }))),
    async call(nameInput: unknown, argumentsInput: unknown): Promise<unknown> {
      const name = z.enum(DESKTOP_TOOLS_TYPED_TOOL_NAMES).parse(nameInput);
      const at = () => new Date().toISOString();
      const supervisor = { kind: 'supervisor' as const, id: 'desktop-tools-supervisor', parentId: null };
      if (name === 'desktop_tools_approve') {
        const planDigest = z.string().regex(/^[a-f0-9]{64}$/).parse((argumentsInput as { planDigest?: unknown })?.planDigest);
        const approvalId = `approval-request-${randomUUID()}`;
        await events.append({ at: at(), producer: supervisor, kind: 'approval', approvalId, planDigest,
          status: 'requested', actorId: null });
        try {
          const result = await adapters[name](argumentsInput) as { actorId: string };
          await events.append({ at: at(), producer: supervisor, kind: 'approval', approvalId, planDigest,
            status: 'approved', actorId: result.actorId });
          return result;
        } catch (error) {
          await events.append({ at: at(), producer: supervisor, kind: 'approval', approvalId, planDigest,
            status: 'expired', actorId: null });
          throw error;
        }
      }
      if (name === 'desktop_tools_verify') {
        const planDigest = z.string().regex(/^[a-f0-9]{64}$/).parse((argumentsInput as { planDigest?: unknown })?.planDigest);
        await events.append({ at: at(), producer: supervisor, kind: 'verification', planDigest, status: 'started', evidenceDigest: null });
        try {
          const result = await adapters[name](argumentsInput);
          const evidenceDigest = createHash('sha256').update(JSON.stringify(result)).digest('hex');
          await events.append({ at: at(), producer: supervisor, kind: 'verification', planDigest, status: 'passed', evidenceDigest });
          await events.append({ at: at(), producer: supervisor, kind: 'terminal', status: 'verified-success', planDigest,
            evidenceDigest, nextAction: null });
          return result;
        } catch (error) {
          await events.append({ at: at(), producer: supervisor, kind: 'verification', planDigest, status: 'failed', evidenceDigest: null });
          throw error;
        }
      }
      const result = await adapters[name](argumentsInput);
      if (name === 'desktop_tools_plan') {
        const plan = result as { digest?: unknown; tasks?: unknown };
        const planDigest = z.string().regex(/^[a-f0-9]{64}$/).parse(plan.digest);
        const diffDigest = createHash('sha256').update(JSON.stringify(result)).digest('hex');
        const additions = Array.isArray(plan.tasks) ? plan.tasks.length : 0;
        const prior = await events.events();
        if (!prior.some(event => event.kind === 'plan' && event.planDigest === planDigest)) {
          await events.append({ at: at(), producer: supervisor, kind: 'plan', planDigest,
            profileRevision: context.profileRevision, diffDigest });
          await events.append({ at: at(), producer: supervisor, kind: 'diff', planDigest, diffDigest,
            additions, changes: 0, removals: 0 });
        }
      }
      if (['desktop_tools_apply', 'desktop_tools_resume', 'desktop_tools_rollback_config'].includes(name)) {
        const candidates = (result as { events?: unknown })?.events;
        if (Array.isArray(candidates)) for (const event of candidates) {
          await events.append({ at: at(), producer: { kind: 'engine', id: 'installer-engine', parentId: context.sessionId },
            kind: 'engine-event', event });
        }
      }
      return result;
    },
  });
}

type JsonRpcId = string | number | null;
function response(id: JsonRpcId, result: unknown): void { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function errorResponse(id: JsonRpcId, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: message.replace(/[\0\r\n]+/g, ' ').slice(0, 1024) } })}\n`);
}

export async function serveDesktopToolsMcp(argv: readonly string[], input = process.stdin): Promise<void> {
  const runtime = await createDesktopToolsMcpRuntime(parseOptions(argv));
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) { errorResponse(null, -32600, 'request exceeds one MiB'); continue; }
    let request: any;
    try { request = JSON.parse(line); } catch { errorResponse(null, -32700, 'invalid JSON'); continue; }
    if (request?.jsonrpc !== '2.0' || typeof request?.method !== 'string') { errorResponse(request?.id ?? null, -32600, 'invalid JSON-RPC request'); continue; }
    if (request.id === undefined) continue;
    const id = (typeof request.id === 'string' || typeof request.id === 'number' || request.id === null) ? request.id : null;
    try {
      if (request.method === 'initialize') {
        response(id, { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'desktop-tools', version: '1.0.0' } });
      } else if (request.method === 'ping') response(id, {});
      else if (request.method === 'tools/list') response(id, { tools: runtime.tools });
      else if (request.method === 'tools/call') {
        const params = z.strictObject({ name: z.enum(DESKTOP_TOOLS_TYPED_TOOL_NAMES), arguments: z.unknown() }).parse(request.params);
        try {
          const result = await runtime.call(params.name, params.arguments);
          response(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
        } catch (error) {
          response(id, { content: [{ type: 'text', text: error instanceof Error ? error.message.slice(0, 1024) : 'tool call failed' }], isError: true });
        }
      } else errorResponse(id, -32601, 'method not found');
    } catch (error) { errorResponse(id, -32602, error instanceof Error ? error.message : 'invalid request'); }
  }
}

async function finalizeSessionEvents(argv: readonly string[]): Promise<void> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key || !['--context', '--state-root', '--status'].includes(key) || !value || values[key] !== undefined) {
      throw new Error('invalid session finalization options');
    }
    values[key] = value;
  }
  const contextPath = absolutePath.parse(values['--context']);
  const stateRoot = absolutePath.parse(values['--state-root']);
  const status = z.enum(['failure', 'cancellation']).parse(values['--status']);
  await safeFile(contextPath, 'tool context', 4 * 1024 * 1024); await protectedDirectory(stateRoot, 'state root');
  const context = ToolContextSchema.parse(JSON.parse(await readFile(contextPath, 'utf8')));
  const journal = createProvisioningSessionEventJournal(join(stateRoot, 'history', `${context.sessionId}.events.ndjson`), {
    sessionId: context.sessionId, runId: context.runId, authorizationId: context.authorizationId,
  });
  const prior = await journal.events();
  if (prior.some(event => event.kind === 'terminal')) return;
  const producer = { kind: 'supervisor' as const, id: 'desktop-tools-supervisor', parentId: null };
  const at = new Date().toISOString();
  if (status === 'cancellation') {
    for (const phase of ['requested', 'acknowledged', 'completed'] as const) await journal.append({
      at, producer, kind: 'cancellation', requestedBy: context.authorizationId, status: phase, reason: 'supervisor signal',
    });
  }
  const plan = [...prior].reverse().find(event => event.kind === 'plan');
  await journal.append({ at, producer, kind: 'terminal', status, planDigest: plan?.kind === 'plan' ? plan.planDigest : null,
    evidenceDigest: null, nextAction: status === 'cancellation' ? 'restart the authorized session' : 'inspect session evidence' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  (argv[0] === '--finalize-events' ? finalizeSessionEvents(argv.slice(1)) : serveDesktopToolsMcp(argv)).catch(error => {
    process.stderr.write(`desktop-tools-mcp: ${error instanceof Error ? error.message : 'startup failed'}\n`); process.exitCode = 1;
  });
}
