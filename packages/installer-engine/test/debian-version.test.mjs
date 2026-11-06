import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DebianVersionError,
  createTrustedDebianVersionComparator,
} from '../dist/debian-version.js';

const trusted = async executable => assert.equal(executable, '/usr/bin/dpkg');

test('trusted comparator uses only fixed dpkg compare invocations and returns ordering', async () => {
  const calls = [];
  const outcomes = new Map([
    ['1.0\u001flt\u001f2:1.0-1', 0],
    ['2:1.0-1\u001flt\u001f1.0', 1],
    ['2:1.0-1\u001fgt\u001f1.0', 0],
    ['1.0-1\u001flt\u001f1.0-1', 1],
    ['1.0-1\u001fgt\u001f1.0-1', 1],
  ]);
  const compare = await createTrustedDebianVersionComparator({
    assertTrustedExecutable: trusted,
    run: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: outcomes.get(`${args[1]}\u001f${args[2]}\u001f${args[3]}`) };
    },
  });

  assert.equal(compare('1.0', '2:1.0-1'), -1);
  assert.equal(compare('2:1.0-1', '1.0'), 1);
  assert.equal(compare('1.0-1', '1.0-1'), 0);
  assert.deepEqual(calls.map(call => [call.executable, call.args]), [
    ['/usr/bin/dpkg', ['--compare-versions', '1.0', 'lt', '2:1.0-1']],
    ['/usr/bin/dpkg', ['--compare-versions', '2:1.0-1', 'lt', '1.0']],
    ['/usr/bin/dpkg', ['--compare-versions', '2:1.0-1', 'gt', '1.0']],
    ['/usr/bin/dpkg', ['--compare-versions', '1.0-1', 'lt', '1.0-1']],
    ['/usr/bin/dpkg', ['--compare-versions', '1.0-1', 'gt', '1.0-1']],
  ]);
  for (const call of calls) {
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, 5_000);
    assert.equal(call.options.maxBuffer, 16_384);
    assert.deepEqual(call.options.env, { LANG: 'C', LC_ALL: 'C' });
  }
});

test('factory verifies the one fixed executable before exposing a comparator', async () => {
  const seen = [];
  await assert.rejects(createTrustedDebianVersionComparator({
    assertTrustedExecutable: async executable => {
      seen.push(executable);
      throw new Error('untrusted');
    },
    run: () => ({ status: 0 }),
  }), /not a trusted fixed root-owned executable/);
  assert.deepEqual(seen, ['/usr/bin/dpkg']);
});

test('comparator rejects malformed and oversized versions before invoking dpkg', async () => {
  let calls = 0;
  const compare = await createTrustedDebianVersionComparator({
    assertTrustedExecutable: trusted,
    run: () => { calls += 1; return { status: 0 }; },
  });
  for (const value of ['', 'version', '1.0\n2', '1.0/2', `1${'a'.repeat(128)}`]) {
    assert.throws(() => compare(value, '1'), DebianVersionError);
  }
  assert.equal(calls, 0);
});

test('dpkg exit 2, signals, spawn errors, timeout, and impossible statuses fail closed', async () => {
  const outcomes = [
    { status: 2, stderr: Buffer.from('bad relation') },
    { status: null, signal: 'SIGTERM' },
    { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) },
    { status: null, error: new Error('spawn failed') },
    { status: 3 },
  ];
  for (const outcome of outcomes) {
    const compare = await createTrustedDebianVersionComparator({
      assertTrustedExecutable: trusted,
      run: () => outcome,
    });
    assert.throws(() => compare('1', '2'), DebianVersionError);
  }
});

test('non-boolean result from the second comparison fails closed', async () => {
  let invocation = 0;
  const compare = await createTrustedDebianVersionComparator({
    assertTrustedExecutable: trusted,
    run: () => invocation++ === 0 ? { status: 1 } : { status: 2 },
  });
  assert.throws(() => compare('1', '1'), /reported an invocation error/);
});
