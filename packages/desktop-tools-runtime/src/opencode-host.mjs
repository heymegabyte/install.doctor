import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';

export const OPENCODE_HOST_COMPATIBILITY = Object.freeze({
  schemaVersion: 1,
  hostProtocolVersion: 1,
  sdk: Object.freeze({ package: '@opencode-ai/sdk', version: '1.19.5', api: 'v2' }),
  runtime: Object.freeze({ minimum: '2.2.5', maximumExclusive: '3.0.0' }),
  transport: Object.freeze({ protocol: 'http:', hostnames: Object.freeze(['127.0.0.1', '::1']) }),
});

function fail(message) {
  const error = new Error(message);
  error.code = 'DESKTOP_TOOLS_OPENCODE_HOST';
  throw error;
}

function parseVersion(value, label) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.exec(value ?? '');
  if (!match) fail(`${label} is not an exact semantic version`);
  return match.slice(1, 4).map(Number);
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function assertOpenCodeCompatibility({ sdkVersion, runtimeVersion }) {
  if (sdkVersion !== OPENCODE_HOST_COMPATIBILITY.sdk.version) {
    fail(`OpenCode SDK ${sdkVersion ?? '<missing>'} differs from the reviewed pin ${OPENCODE_HOST_COMPATIBILITY.sdk.version}`);
  }
  const runtime = parseVersion(runtimeVersion, 'OpenCode runtime version');
  const minimum = parseVersion(OPENCODE_HOST_COMPATIBILITY.runtime.minimum, 'minimum OpenCode runtime version');
  const maximum = parseVersion(OPENCODE_HOST_COMPATIBILITY.runtime.maximumExclusive, 'maximum OpenCode runtime version');
  if (compareVersion(runtime, minimum) < 0 || compareVersion(runtime, maximum) >= 0) {
    fail(`OpenCode runtime ${runtimeVersion} is outside the reviewed compatibility window`);
  }
  return Object.freeze({
    sdkVersion,
    runtimeVersion,
    hostProtocolVersion: OPENCODE_HOST_COMPATIBILITY.hostProtocolVersion,
  });
}

function privateEndpoint(value, expectedHostname, expectedPort) {
  let endpoint;
  try { endpoint = new URL(value); } catch { fail('OpenCode SDK returned an invalid endpoint'); }
  const hostname = endpoint.hostname === '[::1]' ? '::1' : endpoint.hostname;
  if (endpoint.protocol !== OPENCODE_HOST_COMPATIBILITY.transport.protocol
    || !OPENCODE_HOST_COMPATIBILITY.transport.hostnames.includes(hostname)
    || hostname !== expectedHostname || Number(endpoint.port) !== expectedPort
    || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    || !endpoint.port || Number(endpoint.port) < 1024 || Number(endpoint.port) > 65_535) {
    fail('OpenCode SDK endpoint is not an unprivileged private loopback binding');
  }
  return endpoint.href;
}

function exactOptions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('OpenCode host options must be an object');
  const allowed = ['runtimeVersion', 'sdkVersion', 'hostname', 'port', 'timeout', 'config', 'directory', 'sdk'];
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail(`unsupported OpenCode host option: ${unknown[0]}`);
  const hostname = value.hostname ?? '127.0.0.1';
  if (!OPENCODE_HOST_COMPATIBILITY.transport.hostnames.includes(hostname)) fail('OpenCode host must bind to an explicit loopback address');
  const port = value.port ?? 4096;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) fail('OpenCode host port must be unprivileged');
  const timeout = value.timeout ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) fail('OpenCode host startup timeout is invalid');
  if (value.config !== undefined && (value.config === null || typeof value.config !== 'object' || Array.isArray(value.config))) fail('OpenCode host config must be an object');
  if (value.directory !== undefined && (typeof value.directory !== 'string' || !value.directory.startsWith('/'))) fail('OpenCode client directory must be absolute');
  return { ...value, hostname, port, timeout };
}

const upstreamSdk = Object.freeze({
  createServer: createOpencodeServer,
  createClient: createOpencodeClient,
});

/**
 * Creates the narrow, replaceable OpenCode execution substrate owned by Desktop Tools.
 * The returned host is one-shot: start and stop are idempotent, while restart requires a
 * new host so an old session can never silently adopt a new server process.
 */
export function createDesktopToolsOpenCodeHost(input) {
  const options = exactOptions(input);
  const compatibility = assertOpenCodeCompatibility(options);
  const sdk = options.sdk ?? upstreamSdk;
  if (sdk === null || typeof sdk !== 'object' || typeof sdk.createServer !== 'function' || typeof sdk.createClient !== 'function') {
    fail('OpenCode SDK adapter does not implement the Desktop Tools host interface');
  }

  const abort = new AbortController();
  let state = 'idle';
  let startPromise;
  let stopPromise;
  let server;
  let session;

  async function start() {
    if (state === 'stopping' || state === 'stopped') fail('OpenCode host cannot start after shutdown');
    if (state === 'failed') fail('failed OpenCode host cannot be reused');
    if (startPromise) return startPromise;
    state = 'starting';
    startPromise = (async () => {
      try {
        const candidate = await sdk.createServer({
          hostname: options.hostname,
          port: options.port,
          timeout: options.timeout,
          signal: abort.signal,
          config: options.config ?? {},
        });
        if (candidate === null || typeof candidate !== 'object' || typeof candidate.close !== 'function') {
          fail('OpenCode SDK returned an invalid server handle');
        }
        server = candidate;
        const url = privateEndpoint(candidate.url, options.hostname, options.port);
        if (abort.signal.aborted) {
          fail('OpenCode host startup was cancelled');
        }
        const client = sdk.createClient({ baseUrl: url, directory: options.directory });
        if (client === null || typeof client !== 'object') fail('OpenCode SDK returned an invalid client');
        session = Object.freeze({ url, client, compatibility });
        state = 'running';
        return session;
      } catch (error) {
        state = abort.signal.aborted ? 'stopped' : 'failed';
        if (server) await server.close();
        server = undefined;
        throw error;
      }
    })();
    return startPromise;
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    state = state === 'idle' ? 'stopped' : 'stopping';
    abort.abort(new Error('Desktop Tools owns OpenCode host shutdown'));
    stopPromise = (async () => {
      if (startPromise) await startPromise.catch(() => {});
      if (server) await server.close();
      server = undefined;
      session = undefined;
      state = 'stopped';
    })();
    return stopPromise;
  }

  return Object.freeze({
    start,
    stop,
    status: () => Object.freeze({ state, compatibility, endpoint: session?.url ?? null }),
  });
}
