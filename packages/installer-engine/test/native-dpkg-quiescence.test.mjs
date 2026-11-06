import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDpkgDatabaseInventory,
  proveNativeDpkgQuiescence,
} from '../dist/native-dpkg-quiescence.js';

const record = ({ name = 'base-files', version = '13.8', architecture = 'amd64', want = 'install', error = 'ok', status = 'installed' } = {}) =>
  `${name}\x1f${version}\x1f${architecture}\x1f${want}\x1f${error}\x1f${status}\n`;

function adapter(overrides = {}) {
  let lockCalls = 0;
  let processCalls = 0;
  return {
    assertProductionGate: async () => undefined,
    probeLocks: async () => { lockCalls += 1; return { state: 'clear', evidence: `lock-${lockCalls}` }; },
    probeMutationProcesses: async () => { processCalls += 1; return { state: 'clear', evidence: `process-${processCalls}` }; },
    queryDatabase: async () => ({ code: 0, stdout: record(), stderr: '' }),
    ...overrides,
  };
}

test('parses a bounded machine-readable inventory and rejects duplicate or malformed records', () => {
  assert.deepEqual(parseDpkgDatabaseInventory(record()), [{
    packageName: 'base-files', version: '13.8', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed',
  }]);
  assert.throws(() => parseDpkgDatabaseInventory(`${record()}${record()}`), /duplicate/);
  assert.throws(() => parseDpkgDatabaseInventory(record({ status: 'invented' })), /inventory/);
  assert.throws(() => parseDpkgDatabaseInventory(record().replace('\n', '\r\n')), /control/);
});

test('proves quiescence only after clear process and lock observations on both sides of a healthy query', async () => {
  const result = await proveNativeDpkgQuiescence({ adapter: adapter() });
  assert.equal(result.state, 'quiescent');
  assert.equal(result.packageCount, 1);
  assert.match(result.limitation, /point-in-time/);
  assert.equal(result.observations.length, 4);
});

test('classifies an external package manager or held dpkg lock as busy', async () => {
  assert.deepEqual((await proveNativeDpkgQuiescence({ adapter: adapter({
    probeMutationProcesses: async () => ({ state: 'busy', evidence: 'pid 41 /usr/bin/apt-get' }),
  }) })).state, 'busy');
  assert.deepEqual((await proveNativeDpkgQuiescence({ adapter: adapter({
    probeLocks: async () => ({ state: 'busy', evidence: '/var/lib/dpkg/lock held by pid 41' }),
  }) })).state, 'busy');
});

test('classifies unreadable or malformed process and lock evidence as ambiguous', async () => {
  const result = await proveNativeDpkgQuiescence({ adapter: adapter({
    probeLocks: async () => ({ state: 'ambiguous', evidence: '/proc/locks was truncated' }),
  }) });
  assert.equal(result.state, 'corrupt-or-ambiguous');
  assert.match(result.reason, /truncated/);
});

test('classifies query failure, malformed records, and unhealthy package states as database-unhealthy', async () => {
  for (const queryDatabase of [
    async () => { throw new Error('spawn failed'); },
    async () => ({ code: 2, stdout: '', stderr: 'database error' }),
    async () => ({ code: 0, stdout: 'bad', stderr: '' }),
    async () => ({ code: 0, stdout: record({ status: 'half-configured' }), stderr: '' }),
    async () => ({ code: 0, stdout: record({ status: 'unpacked' }), stderr: '' }),
    async () => ({ code: 0, stdout: record({ status: 'triggers-pending' }), stderr: '' }),
    async () => ({ code: 0, stdout: record({ error: 'reinstreq' }), stderr: '' }),
    async () => ({ code: 0, stdout: record({ want: 'deinstall' }), stderr: '' }),
  ]) {
    const result = await proveNativeDpkgQuiescence({ adapter: adapter({ queryDatabase }) });
    assert.equal(result.state, 'database-unhealthy');
  }
});

test('aborts without converting cancellation into a health result', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(proveNativeDpkgQuiescence({ adapter: adapter(), signal: controller.signal }), /cancelled|aborted/i);
});
