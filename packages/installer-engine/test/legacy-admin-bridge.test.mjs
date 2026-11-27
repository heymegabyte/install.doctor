import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
/** @param {string} value */
const digest = value => value.repeat(64);

/**
 * @param {string} directory
 * @param {string} taskId
 * @param {'user' | 'admin'} privilege
 * @param {'selected-packages' | undefined} bridge
 */
function invocation(directory, taskId, privilege, bridge) {
  const marker = join(directory, `${taskId.replaceAll('.', '-')}.mutated`);
  /** @param {string[]} argv */
  const operation = (argv) => ({ argv, ...(bridge ? { legacyAdminBridge: bridge } : {}) });
  const task = {
    schemaVersion: 1, id: taskId, inputDigest: digest('a'), dependencies: [], predicate: 'supported',
    operations: { check: 'task-check', apply: 'task-apply', verify: 'task-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege, network: 'none', consent: privilege === 'admin' ? 'privileged' : 'none', lockDomains: [],
    cleanup: 'none', compensation: 'none', failurePolicy: 'abort-run',
  };
  const base = {
    schemaVersion: 1, command: 'plan', runId: `run-${taskId.replaceAll('.', '-')}`, releaseId: 'release-bridge',
    facts: { schemaVersion: 1, hostId: 'bridge-host', collectedAt: '2026-11-09T00:00:00.000Z', os: 'linux',
      osVersion: '12', arch: 'x64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'revision-bridge', hostId: 'bridge-host', packages: [], services: [],
      consents: privilege === 'admin' ? ['privileged'] : [], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'task-check': operation([process.execPath, '-e', 'process.exit(10)']),
      'task-apply': operation([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'mutated')`]),
      'task-verify': operation([process.execPath, '-e', 'process.exit(0)']),
    },
  };
  return { base, marker };
}

/**
 * @param {Parameters<typeof invocation>[0]} directory
 * @param {Parameters<typeof invocation>[1]} taskId
 * @param {Parameters<typeof invocation>[2]} privilege
 * @param {Parameters<typeof invocation>[3]} bridge
 */
async function assertRejectedBeforeMutation(directory, taskId, privilege, bridge) {
  const { base, marker } = invocation(directory, taskId, privilege, bridge);
  const input = join(directory, `${taskId.replaceAll('.', '-')}-${privilege}.json`);
  await writeFile(input, `${JSON.stringify(base)}\n`, { mode: 0o600 });
  await assert.rejects(execute(process.execPath, [cli, '--input', input], {
    env: { PATH: process.env.PATH ?? '' }, maxBuffer: 1_000_000,
  }), error => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 2);
    assert.ok('stderr' in error && typeof error.stderr === 'string');
    assert.match(error.stderr, /admin process task is not an explicitly admitted legacy bridge|legacy admin bridge marker is forbidden on a non-admin task/);
    return true;
  });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
}

test('process operations fail closed unless an exact enumerated legacy admin bridge matches the admin task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-tools-legacy-admin-'));
  await assertRejectedBeforeMutation(directory, 'desired.packages', 'admin', undefined);
  await assertRejectedBeforeMutation(directory, 'fixture.unlisted-admin', 'admin', 'selected-packages');
  await assertRejectedBeforeMutation(directory, 'fixture.user', 'user', 'selected-packages');

  const admitted = invocation(directory, 'desired.packages', 'admin', 'selected-packages');
  const admittedInput = join(directory, 'admitted.json');
  await writeFile(admittedInput, `${JSON.stringify(admitted.base)}\n`, { mode: 0o600 });
  const planned = await execute(process.execPath, [cli, '--input', admittedInput], { env: { PATH: process.env.PATH ?? '' } });
  assert.match(JSON.parse(planned.stdout).digest, /^[a-f0-9]{64}$/);
  await assert.rejects(readFile(admitted.marker), { code: 'ENOENT' });
});
