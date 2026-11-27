import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const broker = join(root, 'home/dot_local/bin/executable_mcp-singleton-broker.mjs');
const temp = await mkdtemp(join(tmpdir(), 'mcp-singleton-test-'));
const worker = join(temp, 'worker.mjs');
const socket = join(temp, 'runtime', 'fixture.sock');
const config = join(temp, 'config.json');
const journalSentinel = 'MCP_BACKEND_SECRET_SENTINEL_DO_NOT_LOG';
await writeFile(worker, `import readline from 'node:readline'; process.stderr.write('${journalSentinel}\\n'); for await (const line of readline.createInterface({input:process.stdin})) { const m=JSON.parse(line); if(m.id!=null) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{method:m.method}})+'\\n'); }\n`);
await chmod(worker, 0o700);
await writeFile(config, JSON.stringify({ version: 1, runtimeDir: join(temp, 'runtime'), services: { fixture: { socket, command: [process.execPath, worker] } } }));
const child = spawn(process.execPath, [broker, '--config', config], { stdio: ['ignore', 'inherit', 'pipe'] });
let brokerStderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { brokerStderr += chunk; });

async function request(id, method) {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await new Promise((resolveRequest, reject) => {
        const client = connect(socket);
        let buffer = '';
        client.setEncoding('utf8');
        client.on('connect', () => client.write(`${JSON.stringify({jsonrpc:'2.0',id,method})}\n`));
        client.on('data', (chunk) => { buffer += chunk; if (buffer.includes('\n')) { client.end(); resolveRequest(JSON.parse(buffer.trim())); } });
        client.on('error', reject);
      });
    } catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 20)); }
  }
  throw new Error('broker socket did not become ready');
}

try {
  const [one, two] = await Promise.all([request(1, 'alpha'), request(1, 'beta')]);
  assert.deepEqual(one, { jsonrpc: '2.0', id: 1, result: { method: 'alpha' } });
  assert.deepEqual(two, { jsonrpc: '2.0', id: 1, result: { method: 'beta' } });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  assert.equal(brokerStderr.includes(journalSentinel), false, 'backend stderr leaked through broker journal boundary');
  console.log('mcp singleton broker isolation: ok');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  await rm(temp, { recursive: true, force: true });
}

