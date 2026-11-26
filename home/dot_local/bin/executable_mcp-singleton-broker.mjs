#!/usr/bin/env node
import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const MAX_LINE_BYTES = 4 * 1024 * 1024;
const configIndex = process.argv.indexOf('--config');
if (configIndex < 0 || !process.argv[configIndex + 1]) throw new Error('usage: mcp-singleton-broker --config <path>');
const configPath = resolve(process.argv[configIndex + 1]);
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!config || config.version !== 1 || !config.services || typeof config.services !== 'object') throw new Error('invalid broker config');

const clients = new Map();
const workers = new Map();
let nextConnection = 1;
let stopping = false;

function safeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`invalid service id: ${value}`);
  return value;
}

function writeLine(stream, message) {
  if (!stream.destroyed) stream.write(`${JSON.stringify(message)}\n`);
}

function failPending(worker, message) {
  for (const [wireId, pending] of worker.pending) {
    const client = clients.get(pending.connectionId);
    if (client) writeLine(client.socket, { jsonrpc: '2.0', id: pending.originalId, error: { code: -32603, message } });
    worker.pending.delete(wireId);
  }
}

function startWorker(serviceId, service) {
  const command = service.command;
  if (!Array.isArray(command) || command.length < 1 || command.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new Error(`invalid command for ${serviceId}`);
  }
  const child = spawn(command[0], command.slice(1), {
    cwd: typeof service.cwd === 'string' ? service.cwd : homedir(),
    env: Object.fromEntries((service.envAllowlist ?? ['HOME', 'PATH', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME']).flatMap((key) =>
      typeof process.env[key] === 'string' ? [[key, process.env[key]]] : [])),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const worker = { child, buffer: '', pending: new Map(), sequence: 1, restartTimer: null };
  workers.set(serviceId, worker);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    worker.buffer += chunk;
    while (true) {
      const newline = worker.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = worker.buffer.slice(0, newline).trim();
      worker.buffer = worker.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const pending = message.id == null ? null : worker.pending.get(String(message.id));
        if (!pending) continue;
        worker.pending.delete(String(message.id));
        message.id = pending.originalId;
        const client = clients.get(pending.connectionId);
        if (client) writeLine(client.socket, message);
      } catch {
        // Malformed backend output is isolated from clients and recovered by health checks.
      }
    }
  });
  child.on('exit', () => {
    failPending(worker, `${serviceId} backend restarted`);
    if (!stopping) worker.restartTimer = setTimeout(() => startWorker(serviceId, service), 1000);
  });
  return worker;
}

function routeClientLine(client, line) {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('MCP frame exceeds byte limit');
  const message = JSON.parse(line);
  if (!message || message.jsonrpc !== '2.0') throw new Error('invalid JSON-RPC message');
  const worker = workers.get(client.serviceId);
  if (!worker || worker.child.killed || !worker.child.stdin.writable) throw new Error('backend unavailable');
  if (message.id != null) {
    const wireId = `${client.connectionId}:${worker.sequence++}`;
    worker.pending.set(wireId, { connectionId: client.connectionId, originalId: message.id });
    message.id = wireId;
  }
  worker.child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function prepareSocket(socketPath) {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(socketPath), 0o700);
  try {
    const current = await lstat(socketPath);
    if (!current.isSocket()) throw new Error(`refusing non-socket path: ${socketPath}`);
    await rm(socketPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const servers = [];
for (const [rawId, service] of Object.entries(config.services)) {
  const serviceId = safeId(rawId);
  const socketPath = resolve(service.socket);
  if (!socketPath.startsWith(`${resolve(config.runtimeDir)}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error(`socket escapes runtime dir: ${serviceId}`);
  await prepareSocket(socketPath);
  startWorker(serviceId, service);
  const server = createServer((socket) => {
    const connectionId = `c${nextConnection++}`;
    const client = { connectionId, serviceId, socket, buffer: '' };
    clients.set(connectionId, client);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      client.buffer += chunk;
      if (Buffer.byteLength(client.buffer) > MAX_LINE_BYTES) return socket.destroy(new Error('buffer limit exceeded'));
      while (true) {
        const newline = client.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = client.buffer.slice(0, newline).trim();
        client.buffer = client.buffer.slice(newline + 1);
        if (!line) continue;
        try { routeClientLine(client, line); }
        catch (error) { writeLine(socket, { jsonrpc: '2.0', id: null, error: { code: -32600, message: String(error.message ?? error) } }); }
      }
    });
    socket.on('close', () => {
      clients.delete(connectionId);
      const worker = workers.get(serviceId);
      if (worker) for (const [wireId, pending] of worker.pending) if (pending.connectionId === connectionId) worker.pending.delete(wireId);
    });
  });
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(socketPath, resolveListen));
  await chmod(socketPath, 0o600);
  servers.push({ server, socketPath });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const { server } of servers) server.close();
  for (const worker of workers.values()) {
    if (worker.restartTimer) clearTimeout(worker.restartTimer);
    worker.child.kill('SIGTERM');
  }
  await Promise.all(servers.map(({ socketPath }) => rm(socketPath, { force: true })));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

