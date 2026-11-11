import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OPENCODE_HOST_COMPATIBILITY, assertOpenCodeCompatibility, createDesktopToolsOpenCodeHost } from '../src/opencode-host.mjs';

function fixture(overrides = {}) {
  const calls = { starts: [], clients: [], closes: 0 };
  const sdk = {
    async createServer(options) {
      calls.starts.push(options);
      return {
        url: overrides.url ?? `http://${options.hostname === '::1' ? '[::1]' : options.hostname}:${options.port}/`,
        async close() { calls.closes += 1; },
      };
    },
    createClient(options) { calls.clients.push(options); return Object.freeze({ kind: 'fixture-client' }); },
  };
  const host = createDesktopToolsOpenCodeHost({
    runtimeVersion: '2.2.5', sdkVersion: '1.19.5', hostname: '127.0.0.1', port: 4321,
    directory: '/workspace', config: { logLevel: 'WARN' }, sdk,
  });
  return { host, calls };
}

test('uses the exact reviewed SDK pin and explicit runtime compatibility window', () => {
  assert.deepEqual(assertOpenCodeCompatibility({ sdkVersion: '1.19.5', runtimeVersion: '2.2.5' }), {
    sdkVersion: '1.19.5', runtimeVersion: '2.2.5', hostProtocolVersion: 1,
  });
  assert.equal(OPENCODE_HOST_COMPATIBILITY.sdk.package, '@opencode-ai/sdk');
  assert.throws(() => assertOpenCodeCompatibility({ sdkVersion: '1.19.6', runtimeVersion: '2.2.5' }), /reviewed pin/);
  assert.throws(() => assertOpenCodeCompatibility({ sdkVersion: '1.19.5', runtimeVersion: '2.2.4' }), /compatibility window/);
  assert.throws(() => assertOpenCodeCompatibility({ sdkVersion: '1.19.5', runtimeVersion: '3.0.0' }), /compatibility window/);
  assert.throws(() => assertOpenCodeCompatibility({ sdkVersion: '1.19.5', runtimeVersion: 'latest' }), /exact semantic version/);
});

test('package dependency and signed compatibility contract retain the exact SDK pin', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const contract = JSON.parse(await readFile(new URL('../contracts/opencode-host-compatibility.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.dependencies[contract.sdk.package], contract.sdk.version);
  assert.deepEqual(contract, OPENCODE_HOST_COMPATIBILITY);
});

test('owns deterministic idempotent startup and shutdown', async () => {
  const { host, calls } = fixture();
  assert.deepEqual(host.status(), { state: 'idle', compatibility: assertOpenCodeCompatibility({ sdkVersion: '1.19.5', runtimeVersion: '2.2.5' }), endpoint: null });
  const [first, second] = await Promise.all([host.start(), host.start()]);
  assert.equal(first, second);
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0].hostname, '127.0.0.1');
  assert.equal(calls.starts[0].port, 4321);
  assert.equal(calls.starts[0].signal instanceof AbortSignal, true);
  assert.deepEqual(calls.clients, [{ baseUrl: 'http://127.0.0.1:4321/', directory: '/workspace' }]);
  assert.equal(host.status().state, 'running');
  await Promise.all([host.stop(), host.stop()]);
  assert.equal(calls.closes, 1);
  assert.deepEqual(host.status().endpoint, null);
  assert.equal(host.status().state, 'stopped');
  await assert.rejects(host.start(), /cannot start after shutdown/);
});

test('rejects every public, ambiguous, privileged, or substituted listener binding', async () => {
  for (const hostname of ['0.0.0.0', 'localhost', '192.168.1.10', 'example.com']) {
    assert.throws(() => createDesktopToolsOpenCodeHost({ runtimeVersion: '2.2.5', sdkVersion: '1.19.5', hostname, port: 4321 }), /loopback/);
  }
  assert.throws(() => createDesktopToolsOpenCodeHost({ runtimeVersion: '2.2.5', sdkVersion: '1.19.5', hostname: '127.0.0.1', port: 80 }), /unprivileged/);
  for (const url of ['http://0.0.0.0:4321/', 'http://127.0.0.1:5432/', 'https://127.0.0.1:4321/', 'http://127.0.0.1:4321/api', 'http://user@127.0.0.1:4321/']) {
    const { host, calls } = fixture({ url });
    await assert.rejects(host.start(), /private loopback/);
    assert.equal(calls.closes, 1);
    assert.equal(host.status().state, 'failed');
  }
});

test('shutdown during startup aborts ownership and closes a late server exactly once', async () => {
  let release;
  let closes = 0;
  const sdk = {
    createServer: () => new Promise(resolve => { release = () => resolve({ url: 'http://127.0.0.1:4567/', close() { closes += 1; } }); }),
    createClient: () => ({}),
  };
  const host = createDesktopToolsOpenCodeHost({ runtimeVersion: '2.2.5', sdkVersion: '1.19.5', hostname: '127.0.0.1', port: 4567, sdk });
  const starting = host.start();
  const stopping = host.stop();
  release();
  await assert.rejects(starting, /cancelled/);
  await stopping;
  assert.equal(closes, 1);
  assert.equal(host.status().state, 'stopped');
});

test('replaceable adapters must implement both server and client boundaries', () => {
  assert.throws(() => createDesktopToolsOpenCodeHost({ runtimeVersion: '2.2.5', sdkVersion: '1.19.5', sdk: { createServer() {} } }), /host interface/);
});

test('supports an explicit IPv6 loopback binding without broadening listener authority', async () => {
  let closes = 0;
  const sdk = {
    async createServer() { return { url: 'http://[::1]:4789/', close() { closes += 1; } }; },
    createClient(options) { return { options }; },
  };
  const host = createDesktopToolsOpenCodeHost({ runtimeVersion: '2.2.5', sdkVersion: '1.19.5', hostname: '::1', port: 4789, sdk });
  assert.equal((await host.start()).url, 'http://[::1]:4789/');
  await host.stop();
  assert.equal(closes, 1);
});
