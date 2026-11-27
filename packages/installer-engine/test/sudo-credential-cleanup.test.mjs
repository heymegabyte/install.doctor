import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSudoCredentialCleanup } from '../dist/sudo-credential-cleanup.js';

/** @typedef {Parameters<typeof executeSudoCredentialCleanup>[0]['runExact']} RunExact */

test('cleanup preserves preexisting authority without invoking sudo', async () => {
  let calls = 0;
  assert.equal(await executeSudoCredentialCleanup({ action: 'apply', sudoPreexisting: true, runExact: async () => { calls++; return 0; } }), 0);
  assert.equal(calls, 0);
});

test('cleanup uses only fixed argv and bounded environment and is idempotent', async () => {
  let active = true;
  /** @type {{ argv: ReadonlyArray<string>, environment: Parameters<RunExact>[1] }[]} */
  const calls = [];
  /** @type {RunExact} */
  const runExact = async (argv, environment) => {
    calls.push({ argv: [...argv], environment: { ...environment } });
    if (argv[0] === '-K') { active = false; return 0; }
    return active ? 0 : 1;
  };
  assert.equal(await executeSudoCredentialCleanup({ action: 'apply', sudoPreexisting: false, runExact }), 0);
  assert.equal(await executeSudoCredentialCleanup({ action: 'apply', sudoPreexisting: false, runExact }), 0);
  assert.deepEqual(calls.map(call => call.argv), [['-n', 'true'], ['-K'], ['-n', 'true'], ['-n', 'true']]);
  for (const call of calls) assert.deepEqual(call.environment, { PATH: '/usr/bin:/bin', LANG: 'C' });
});

test('postcondition reconciles after interruption following invalidation', async () => {
  let active = true; let invalidations = 0;
  /** @type {RunExact} */
  const runExact = async argv => {
    if (argv[0] === '-K') { active = false; invalidations++; return 130; }
    return active ? 0 : 1;
  };
  assert.equal(await executeSudoCredentialCleanup({ action: 'apply', sudoPreexisting: false, runExact }), 130);
  assert.equal(await executeSudoCredentialCleanup({ action: 'apply', sudoPreexisting: false, runExact }), 0);
  assert.equal(invalidations, 1);
});
