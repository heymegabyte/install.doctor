#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { createDesktopToolsToolAdapters, DESKTOP_TOOLS_TYPED_TOOL_NAMES } from './typed-tool-adapters.js';
import type { ConsentBroker, DesktopToolsTypedToolName, EngineInvoker } from './typed-tool-adapters.js';

const executeFile = promisify(execFile);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolutePath = z.string().min(1).max(4096).refine(isAbsolute, 'path must be absolute');
const ToolContextSchema = z.strictObject({
  schemaVersion: z.literal(1), sessionId: identifier, runId: identifier, releaseId: identifier, releaseDigest: digest,
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
    await writeFile(path, `${JSON.stringify(invocation)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      const result = await executeFile(process.execPath, [options.engine, '--input', path], {
        env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' },
        timeout: 86_400_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      });
      return parseEngineOutput(result.stdout);
    } catch (error) {
      const candidate = error as { code?: number };
      const exitClass = Number.isSafeInteger(candidate.code) && Number(candidate.code) >= 2 && Number(candidate.code) <= 8
        ? Number(candidate.code) : 7;
      throw new Error(`installer engine rejected the typed operation (class ${exitClass})`);
    } finally { await rm(path, { force: true }); }
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
    const receipt = ConsentReceiptSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (receipt.operation !== request.operation || receipt.sessionRunId !== sessionRunId || receipt.planDigest !== request.planDigest
      || receipt.sourceRunId !== (request.sourceRunId ?? null)) throw new Error('operator consent receipt is not bound to this exact operation');
    return Object.freeze({ approved: true, actorId: receipt.actorId, approvedAt: receipt.approvedAt });
  };
}

export async function createDesktopToolsMcpRuntime(optionsInput: unknown) {
  const options = ServerOptionsSchema.parse(optionsInput);
  await safeFile(options.context, 'tool context', 4 * 1024 * 1024);
  await protectedDirectory(options.stateRoot, 'state root');
  const context = ToolContextSchema.parse(JSON.parse(await readFile(options.context, 'utf8')));
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
      return adapters[name](argumentsInput);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  serveDesktopToolsMcp(process.argv.slice(2)).catch(error => {
    process.stderr.write(`desktop-tools-mcp: ${error instanceof Error ? error.message : 'startup failed'}\n`); process.exitCode = 1;
  });
}
