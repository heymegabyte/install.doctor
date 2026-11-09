import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import { createDesktopToolsMcpRuntime } from '../dist/mcp-server.js';
import { DESKTOP_TOOLS_TYPED_TOOL_NAMES } from '../dist/typed-tool-adapters.js';

const digest = character => character.repeat(64);
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const availablePort = () => new Promise((resolvePromise, reject) => {
  const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
    const address = server.address(); server.close(error => error ? reject(error) : resolvePromise(address.port));
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-mcp-'));
  const stateRoot = join(root, 'state'); const consentDirectory = join(stateRoot, 'run', 'consents');
  await mkdir(consentDirectory, { recursive: true, mode: 0o700 }); await chmod(stateRoot, 0o700); await chmod(join(stateRoot, 'run'), 0o700); await chmod(consentDirectory, 0o700);
  const marker = join(root, 'installed');
  const task = {
    schemaVersion: 1, id: 'fixture.install', inputDigest: digest('a'), dependencies: [], predicate: 'supported',
    operations: { check: 'fixture-check', apply: 'fixture-apply', verify: 'fixture-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['fixture.lock'], cleanup: 'none', compensation: 'none',
  };
  const nodeCheck = `const fs=require('node:fs');process.exit(fs.existsSync(${JSON.stringify(marker)})?0:10)`;
  const nodeApply = `setTimeout(()=>require('node:fs').appendFileSync(${JSON.stringify(marker)},'x'),800)`;
  const context = {
    schemaVersion: 1, sessionId: 'session-one', runId: 'mcp-run-one', authorizationId: 'authorization-one',
    releaseId: 'release-one', releaseDigest: digest('1'),
    profileRevision: 'revision-one', profileDigest: digest('2'),
    facts: { schemaVersion: 1, hostId: 'mcp-host', collectedAt: '2026-11-08T00:00:00.000Z',
      os: process.platform === 'win32' ? 'windows' : process.platform, osVersion: 'fixture',
      arch: process.arch, environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'revision-one', hostId: 'mcp-host', packages: [], services: [], consents: [], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'fixture-check': { argv: [process.execPath, '-e', nodeCheck] },
      'fixture-apply': { argv: [process.execPath, '-e', nodeApply] },
      'fixture-verify': { argv: [process.execPath, '-e', nodeCheck] },
    },
  };
  const contextPath = join(root, 'tool-context.json'); await writeFile(contextPath, `${JSON.stringify(context)}\n`, { mode: 0o600 });
  await mkdir(join(stateRoot, 'history'), { mode: 0o700 });
  await writeFile(join(stateRoot, 'history', `${context.sessionId}.events.ndjson`), `${JSON.stringify({
    schemaVersion: 1, sequence: 0, at: '2026-11-08T12:00:00.000Z', sessionId: context.sessionId, runId: context.runId,
    authorizationId: context.authorizationId, producer: { kind: 'supervisor', id: 'desktop-tools-supervisor', parentId: null },
    kind: 'session-status', status: 'started',
  })}\n`, { mode: 0o600 });
  const engine = join(root, 'install-doctor-engine.mjs');
  await copyFile(resolve(import.meta.dirname, '../dist/install-doctor-engine.mjs'), engine);
  await chmod(engine, 0o700);
  const server = resolve(import.meta.dirname, '../dist/desktop-tools-mcp-server.mjs');
  const options = { engine, engineSha256: await sha256(engine), context: contextPath, stateRoot, consentDirectory };
  return { root, stateRoot, consentDirectory, marker, context, contextPath, engine, server, options };
}

async function writeConsent(item, operation, planDigest, sourceRunId = null) {
  const path = join(item.consentDirectory, `${operation}.${planDigest}.json`);
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, operation, sessionRunId: item.context.runId, planDigest,
    sourceRunId, approved: true, actorId: 'owner-one', approvedAt: '2026-11-08T12:00:00.000Z' })}\n`, { mode: 0o600 });
}

test('stdio MCP lists only the ten tools and strict calls reject model-supplied shell authority', async () => {
  const item = await fixture();
  const args = ['--engine', item.options.engine, '--engine-sha256', item.options.engineSha256, '--context', item.contextPath,
    '--state-root', item.stateRoot, '--consent-dir', item.consentDirectory];
  const child = spawn(process.execPath, [item.server, ...args], { shell: false, env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'desktop_tools_discover', arguments: { schemaVersion: 1, shell: 'touch /tmp/pwned' } } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const exit = await new Promise((resolvePromise, reject) => { child.once('error', reject); child.once('exit', code => resolvePromise(code)); });
  assert.equal(exit, 0); assert.equal(stderr, '');
  const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.find(value => value.id === 2).result.tools.map(tool => tool.name), [...DESKTOP_TOOLS_TYPED_TOOL_NAMES]);
  const rejected = responses.find(value => value.id === 3).result;
  assert.equal(rejected.isError, true); assert.match(rejected.content[0].text, /unrecognized_keys/i);
  assert.equal(stdout.includes('/tmp/pwned'), false);
});

test('real MCP plan/apply requires out-of-band consent and engine journal ownership excludes a competitor', async () => {
  const item = await fixture();
  const first = await createDesktopToolsMcpRuntime(item.options);
  const second = await createDesktopToolsMcpRuntime(item.options);
  const firstPlan = await first.call('desktop_tools_plan', { schemaVersion: 1 });
  const secondPlan = await second.call('desktop_tools_plan', { schemaVersion: 1 });
  assert.equal(firstPlan.digest, secondPlan.digest);
  await assert.rejects(first.call('desktop_tools_approve', { schemaVersion: 1, planDigest: firstPlan.digest }), /consent is pending/);
  await writeConsent(item, 'apply', firstPlan.digest);
  const firstApproval = await first.call('desktop_tools_approve', { schemaVersion: 1, planDigest: firstPlan.digest });
  await assert.rejects(second.call('desktop_tools_approve', { schemaVersion: 1, planDigest: secondPlan.digest }), /consent is pending/);
  await writeConsent(item, 'apply', secondPlan.digest);
  const secondApproval = await second.call('desktop_tools_approve', { schemaVersion: 1, planDigest: secondPlan.digest });
  const applying = first.call('desktop_tools_apply', { schemaVersion: 1, approvalId: firstApproval.approvalId });
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const activeRuns = await readdir(join(item.stateRoot, 'runs')).catch(() => []);
    if (activeRuns.length > 0) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  await assert.rejects(second.call('desktop_tools_apply', { schemaVersion: 1, approvalId: secondApproval.approvalId }), /engine rejected.*class [34]/);
  const result = await applying;
  assert.ok(result.events.some(event => event.kind === 'run-status' && event.status === 'success'));
  assert.equal(await readFile(item.marker, 'utf8'), 'x');
  const runs = await readdir(join(item.stateRoot, 'runs'));
  assert.equal(runs.length, 1);
  const verified = await first.call('desktop_tools_verify', { schemaVersion: 1, runId: item.context.runId, planDigest: firstPlan.digest });
  assert.equal(verified.authority, 'committed');
});

test('MCP startup rejects permissive context/consent state and a substituted engine', async () => {
  const item = await fixture();
  await chmod(item.contextPath, 0o666);
  await assert.rejects(createDesktopToolsMcpRuntime(item.options), /tool context is not a protected/);
  await chmod(item.contextPath, 0o600); await chmod(item.consentDirectory, 0o755);
  await assert.rejects(createDesktopToolsMcpRuntime(item.options), /consent directory is not a protected/);
  await chmod(item.consentDirectory, 0o700);
  await assert.rejects(createDesktopToolsMcpRuntime({ ...item.options, engineSha256: digest('f') }), /digest does not match/);
});

test('typed calls never reopen an engine pathname that changed after startup verification', async () => {
  const item = await fixture();
  const runtime = await createDesktopToolsMcpRuntime(item.options);
  const marker = join(item.root, 'substituted-engine-ran');
  const replacement = join(item.root, 'replacement-engine.mjs');
  await writeFile(replacement, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bypass')\n`, { mode: 0o700 });
  await rename(replacement, item.engine);
  await assert.rejects(runtime.call('desktop_tools_plan', { schemaVersion: 1 }), /digest does not match/);
  await assert.rejects(readFile(marker), /ENOENT/);
});

test('pinned OpenCode discovers the signed local Desktop Tools MCP server', {
  skip: process.env.OPENCODE_PINNED_BINARY ? false : 'requires OPENCODE_PINNED_BINARY',
}, async () => {
  const item = await fixture();
  const configRoot = join(item.root, 'opencode-config'); await mkdir(configRoot, { mode: 0o700 });
  const configPath = join(configRoot, 'opencode.json');
  const config = {
    permissions: [
      { action: '*', resource: '*', effect: 'deny' },
      ...DESKTOP_TOOLS_TYPED_TOOL_NAMES.map(action => ({ action, resource: '*', effect: 'allow' })),
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'execute', resource: '*', effect: 'deny' },
      { action: 'external_directory', resource: '*', effect: 'deny' },
    ],
    policies: [
      { action: 'tool.use', resource: '*', effect: 'deny' },
      ...DESKTOP_TOOLS_TYPED_TOOL_NAMES.map(name => ({ action: 'tool.use', resource: `${name}:*`, effect: 'allow' })),
    ],
    mcp: { servers: { 'desktop-tools': { type: 'local', enabled: true, command: [
    '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'LANG=C.UTF-8', process.execPath,
    item.server, '--engine', item.engine, '--engine-sha256', item.options.engineSha256, '--context', item.contextPath,
    '--state-root', item.stateRoot, '--consent-dir', item.consentDirectory,
  ] } } },
  };
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  const port = await availablePort();
  const child = spawn(process.env.OPENCODE_PINNED_BINARY, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: item.root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_CONFIG_DIR: configRoot, OPENCODE_CONFIG: configPath,
      XDG_CONFIG_HOME: configRoot, XDG_DATA_HOME: join(item.root, 'data'), XDG_CACHE_HOME: join(item.root, 'cache'),
      OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_SERVER_PASSWORD: 'test-password' },
  });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      for (const endpoint of ['/api/mcp', '/mcp']) try {
        const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
          headers: { authorization: `Basic ${Buffer.from('opencode:test-password').toString('base64')}` },
        }); if (response.ok) { status = await response.json(); break; }
      } catch {}
      const serialized = JSON.stringify(status) || '';
      if (serialized.includes('desktop-tools') && /connected/i.test(serialized)) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
    }
    assert.match(JSON.stringify(status) || diagnostics, /desktop-tools/);
    assert.match(JSON.stringify(status) || diagnostics, /connected/i);
    const configResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { authorization: `Basic ${Buffer.from('opencode:test-password').toString('base64')}` },
    });
    assert.equal(configResponse.ok, true);
    const loaded = JSON.stringify(await configResponse.json());
    for (const action of ['shell', 'edit', 'execute', 'external_directory']) {
      assert.match(loaded, new RegExp(`(?:permissions|permission).*${action}`));
    }
    for (const tool of DESKTOP_TOOLS_TYPED_TOOL_NAMES) assert.match(loaded, new RegExp(tool));
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await new Promise(resolvePromise => child.once('exit', resolvePromise));
  }
});
