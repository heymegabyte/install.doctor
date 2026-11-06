import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const digest = character => character.repeat(64);

function task(id, suffix) {
  return {
    schemaVersion: 1,
    id,
    inputDigest: digest(suffix),
    dependencies: [],
    predicate: 'supported',
    operations: { check: `check-${suffix}`, apply: `apply-${suffix}`, verify: `verify-${suffix}` },
    timeoutMs: 15_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 16, network: false },
    privilege: 'user',
    network: 'none',
    consent: 'none',
    lockDomains: [],
    cleanup: 'always',
    compensation: 'none',
  };
}

test('shipped TUI renders concurrent work and restores its PTY after SIGINT', {
  skip: process.platform === 'win32' ? 'POSIX PTY acceptance; Windows requires ConPTY coverage' : false,
  timeout: 40_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-tui-pty-'));
  const stateRoot = join(directory, 'state');
  const barrier = join(directory, 'barrier');
  await mkdir(barrier, { mode: 0o700 });
  const invocationPath = join(directory, 'invocation.json');
  const bundle = new URL('../dist/install-doctor-engine.mjs', import.meta.url).pathname;
  const helper = new URL('./fixtures/pty_acceptance.py', import.meta.url).pathname;
  const tasks = [task('fixture.concurrent-one', 'a'), task('fixture.concurrent-two', 'b')];
  const operations = {};
  const readyFiles = [];
  const installedFiles = [];
  for (const [index, selected] of tasks.entries()) {
    const suffix = index === 0 ? 'a' : 'b';
    const ready = join(barrier, `${suffix}.started`);
    const installed = join(barrier, `${suffix}.installed`);
    readyFiles.push(ready);
    installedFiles.push(installed);
    const check = `const fs=require('node:fs');process.exit(fs.existsSync(${JSON.stringify(installed)})?0:10)`;
    const apply = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'started',{mode:0o600});console.log(${JSON.stringify(`${selected.id} reached barrier`)});setInterval(()=>{},1000)`;
    operations[`check-${suffix}`] = { argv: [process.execPath, '-e', check] };
    operations[`apply-${suffix}`] = { argv: [process.execPath, '-e', apply] };
    operations[`verify-${suffix}`] = { argv: [process.execPath, '-e', check] };
  }
  const common = {
    schemaVersion: 1,
    runId: 'tui-pty-concurrency',
    releaseId: 'tui-pty-release',
    facts: {
      schemaVersion: 1,
      hostId: 'tui-pty-host',
      collectedAt: '2026-11-06T00:00:00.000Z',
      os: process.platform === 'darwin' ? 'darwin' : 'linux',
      osVersion: 'acceptance-fixture',
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      environment: 'native',
      roles: ['fixture'],
      packageManagers: [],
      capabilities: [],
    },
    desiredState: {
      schemaVersion: 1,
      revision: 'tui-pty-revision',
      hostId: 'tui-pty-host',
      packages: [],
      services: [],
      consents: [],
      offline: true,
    },
    plan: { tasks, selectedTaskIds: tasks.map(selected => selected.id) },
    operations,
  };
  await writeFile(invocationPath, `${JSON.stringify({ ...common, command: 'plan' })}\n`, { mode: 0o600 });
  const planned = await execute(process.execPath, [bundle, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000,
  });
  const plan = JSON.parse(planned.stdout);
  const runInvocation = {
    ...common,
    command: 'run',
    approvedPlanDigest: plan.digest,
    renderer: 'tui',
    stateRoot,
  };
  await writeFile(invocationPath, `${JSON.stringify(runInvocation)}\n`, { mode: 0o600 });

  await execute('python3', ['--version'], { timeout: 5_000 });
  const helperResult = await execute('python3', [
    helper,
    '--pattern', 'Workers  2 active',
    '--ready-file', readyFiles[0],
    '--ready-file', readyFiles[1],
    '--timeout', '20',
    '--max-bytes', '1048576',
    '--columns', '100',
    '--rows', '30',
    '--', process.execPath, bundle, '--input', invocationPath,
  ], { env: { ...process.env, NO_COLOR: '1' }, timeout: 25_000, maxBuffer: 2_000_000 });
  const result = JSON.parse(helperResult.stdout);
  const transcript = Buffer.from(result.transcriptBase64, 'base64').toString('utf8');
  assert.equal(result.failure, null);
  assert.equal(result.exitCode, 130);
  assert.equal(result.interrupted, true);
  assert.equal(result.patternObserved, true);
  assert.equal(result.readyFilesObserved, true, 'both operation processes must reach the barrier before interruption');
  assert.equal(result.terminalRestored, true, `terminal attributes changed:\n${JSON.stringify(result.terminalBefore)}\n${JSON.stringify(result.terminalAfter)}`);
  assert.ok(result.transcriptBytes > 0 && result.transcriptBytes <= 1_048_576);
  assert.match(transcript, /\u001b\[\?1049h\u001b\[\?25l/, 'interactive TUI must enter alternate screen and hide the cursor');
  assert.ok(transcript.endsWith('\u001b[?25h\u001b[?1049l'), 'cancellation must restore cursor and alternate-screen state last');
  const frames = transcript.split('\u001b[H\u001b[J');
  const concurrentFrame = frames.find(frame => frame.includes('Workers  2 active'));
  assert.ok(concurrentFrame, 'one complete redraw must report both workers active');
  assert.match(concurrentFrame, /running\s+fixture\.concurrent-one/);
  assert.match(concurrentFrame, /running\s+fixture\.concurrent-two/);

  const listPath = join(directory, 'runs-list.json');
  await writeFile(listPath, `${JSON.stringify({ schemaVersion: 1, command: 'runs-list', stateRoot })}\n`, { mode: 0o600 });
  const listed = JSON.parse((await execute(process.execPath, [bundle, '--input', listPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000,
  })).stdout);
  const interrupted = listed.runs.find(candidate => candidate.runId === common.runId && candidate.planDigest === plan.digest);
  assert.equal(interrupted?.authority, 'uncommitted');
  assert.equal(interrupted?.resumeCandidate, true);
  await assert.rejects(
    readFile(join(stateRoot, 'runs', plan.digest, common.runId, 'owner.json'), 'utf8'),
    { code: 'ENOENT' },
    'cancelled run must release its ownership lease before advertising resumability',
  );

  for (const installed of installedFiles) await writeFile(installed, 'installed', { mode: 0o600 });
  const { approvedPlanDigest: _approved, ...withoutApproval } = runInvocation;
  await writeFile(invocationPath, `${JSON.stringify({
    ...withoutApproval,
    command: 'resume',
    planDigest: plan.digest,
    renderer: 'ndjson',
  })}\n`, { mode: 0o600 });
  const resumed = await execute(process.execPath, [bundle, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 15_000, maxBuffer: 1_000_000,
  });
  assert.equal(resumed.stderr, '');
  const resumedEvents = resumed.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(resumedEvents.at(-1)?.kind, 'run-status');
  assert.equal(resumedEvents.at(-1)?.status, 'success');
  assert.ok(resumedEvents.some(event => event.kind === 'task-status' && event.taskId === tasks[0].id && event.status === 'verified'));
  assert.ok(resumedEvents.some(event => event.kind === 'task-status' && event.taskId === tasks[1].id && event.status === 'verified'));
  assert.equal((await readFile(installedFiles[0], 'utf8')), 'installed');
});
