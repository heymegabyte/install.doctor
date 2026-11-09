import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { applyConfigurationTransaction, createInstallerEngine, createJournalStore } from '../dist/index.js';

const execute = promisify(execFile);
const digest = character => character.repeat(64);

test('real headless CLI uses strict argv operations and emits canonical NDJSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-'));
  const marker = join(directory, 'installed');
  const invocationPath = join(directory, 'invocation.json');
  const task = {
    schemaVersion: 1, id: 'fixture.install', inputDigest: digest('a'), dependencies: [], predicate: 'supported',
    operations: { check: 'fixture-check', apply: 'fixture-apply', verify: 'fixture-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: [], cleanup: 'always', compensation: 'none',
  };
  const nodeCheck = `const fs=require('node:fs');process.exit(fs.existsSync(${JSON.stringify(marker)})?0:10)`;
  const nodeApply = `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x');console.log('fixture-output');console.error('token=supersecretvalue')`;
  const invocation = {
    schemaVersion: 1,
    command: 'run',
    runId: 'cli-run-1',
    releaseId: 'release-1',
    approvedPlanDigest: digest('0'),
    renderer: 'ndjson',
    stateRoot: join(directory, 'state'),
    telemetry: {
      schemaVersion: 1, consent: true, endpoint: 'https://127.0.0.1:9/installer', timeoutMs: 100,
      labels: { platform: 'darwin', environment: 'native', service: 'install-doctor' },
    },
    facts: {
      schemaVersion: 1, hostId: 'cli-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'darwin', osVersion: '15.7',
      arch: 'arm64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [],
    },
    desiredState: { schemaVersion: 1, revision: 'revision-1', hostId: 'cli-host', packages: [], services: [], consents: ['telemetry'], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'fixture-check': { argv: [process.execPath, '-e', nodeCheck] },
      'fixture-apply': { argv: [process.execPath, '-e', nodeApply] },
      'fixture-verify': { argv: [process.execPath, '-e', nodeCheck] },
    },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const { renderer: _renderer, stateRoot: _stateRoot, approvedPlanDigest: _approval, telemetry: _telemetry, ...planInvocation } = invocation;
  await writeFile(invocationPath, `${JSON.stringify({ ...planInvocation, command: 'plan' })}\n`, { mode: 0o600 });
  const planned = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  const executableSha256 = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  const verifiedPlanInvocation = structuredClone({ ...planInvocation, command: 'plan' });
  for (const operation of Object.values(verifiedPlanInvocation.operations)) {
    operation.verifiedExecutable = { argvIndex: 0, sha256: executableSha256 };
  }
  await writeFile(invocationPath, `${JSON.stringify(verifiedPlanInvocation)}\n`, { mode: 0o600 });
  const verifiedPlan = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  for (const operation of Object.values(verifiedPlanInvocation.operations)) operation.argv[0] = '/a/different/private/stage/node';
  await writeFile(invocationPath, `${JSON.stringify(verifiedPlanInvocation)}\n`, { mode: 0o600 });
  const relocatedPlan = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.equal(JSON.parse(relocatedPlan.stdout).digest, JSON.parse(verifiedPlan.stdout).digest,
    'approval identity must bind verified bytes rather than a private staging path');
  const substitutedExecutable = join(directory, 'substituted-node');
  await writeFile(substitutedExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  for (const operation of Object.values(verifiedPlanInvocation.operations)) operation.argv[0] = substitutedExecutable;
  const digestMismatchInvocation = {
    ...verifiedPlanInvocation, command: 'run', runId: 'cli-run-digest-mismatch',
    approvedPlanDigest: JSON.parse(verifiedPlan.stdout).digest, renderer: 'ndjson',
    stateRoot: join(directory, 'digest-mismatch-state'),
  };
  await writeFile(invocationPath, `${JSON.stringify(digestMismatchInvocation)}\n`, { mode: 0o600 });
  await assert.rejects(execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  }), error => error.code === 7 && error.stdout.includes('"status":"failed"'));
  invocation.approvedPlanDigest = JSON.parse(planned.stdout).digest;
  const tamperedInvocation = structuredClone(invocation);
  tamperedInvocation.runId = 'cli-run-tampered-operation';
  tamperedInvocation.operations['fixture-apply'].argv = [process.execPath, '-e', `${nodeApply};console.log('changed-after-approval')`];
  await writeFile(invocationPath, `${JSON.stringify(tamperedInvocation)}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], {
      env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
    }),
    error => error.code === 3
      && error.stderr === ''
      && error.stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1)?.status === 'rejected',
  );
  await assert.rejects(readFile(marker, 'utf8'), { code: 'ENOENT' }, 'changed operation argv must not execute under an earlier approval');
  await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const { stdout, stderr } = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.equal(stderr, '');
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.length > 5);
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index));
  assert.equal(events.at(-1).kind, 'run-status');
  assert.equal(events.at(-1).status, 'success');
  assert.ok(events.some(event => event.kind === 'output' && event.taskId === task.id && event.stream === 'stdout' && event.line === 'fixture-output'));
  assert.ok(events.some(event => event.kind === 'output' && event.taskId === task.id && event.stream === 'stderr' && event.line === 'token=[REDACTED]'));
  assert.equal(stdout.includes('supersecretvalue'), false);
  assert.equal(await readFile(marker, 'utf8'), 'x');
  const [committedPlanDigest] = await readdir(join(invocation.stateRoot, 'runs'));
  assert.match(committedPlanDigest, /^[a-f0-9]{64}$/);
  const evidenceInvocationPath = join(directory, 'evidence.json');
  await writeFile(evidenceInvocationPath, `${JSON.stringify({
    schemaVersion: 1, command: 'evidence-verify', runId: invocation.runId,
    planDigest: committedPlanDigest, stateRoot: invocation.stateRoot,
  })}\n`, { mode: 0o600 });
  const evidenceResult = await execute(process.execPath, [cli, '--input', evidenceInvocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  const inspection = JSON.parse(evidenceResult.stdout);
  assert.equal(inspection.authority, 'committed');
  assert.equal(inspection.receipt.status, 'success');

  invocation.runId = 'cli-run-2';
  await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const second = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, input: '', timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.equal(second.stderr, '');
  assert.equal(await readFile(marker, 'utf8'), 'x', 'unchanged CLI reapply must not duplicate mutation');
  const evidence = await readdir(invocation.stateRoot, { recursive: true });
  assert.ok(evidence.some(path => path.includes('objects/sha256/') && path.endsWith('.json')));
  assert.ok(evidence.some(path => path.includes('heads/') && path.endsWith('.json')));
  assert.ok(evidence.some(path => path.endsWith('receipt.json')));
  const spillAttempts = await readdir(join(invocation.stateRoot, 'renderer-spill'));
  assert.equal(spillAttempts.length, 3, 'each mutating presentation attempt gets an exclusive spill artifact');
  for (const attempt of spillAttempts) {
    assert.match(attempt, /^cli-run-(?:1|2|tampered-operation)\.[a-f0-9-]{36}$/);
    const spillMetadata = await lstat(join(invocation.stateRoot, 'renderer-spill', attempt, 'output.log'));
    assert.equal(spillMetadata.isFile(), true);
    if (process.platform !== 'win32') assert.equal(spillMetadata.mode & 0o777, 0o600);
  }
});

test('CLI rejects unknown fields before spawning an operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-invalid-'));
  const invocationPath = join(directory, 'invocation.json');
  await writeFile(invocationPath, '{"schemaVersion":1,"unknown":true}\n', { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 5_000 }),
    error => error.code === 2 && /^invalid invocation \[unknown\/parse\]:/i.test(error.stderr)
      && error.stderr.trimEnd().split('\n').length === 1,
  );
});

test('CLI enforces the exact plan-bound execution concurrency policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-policy-'));
  const invocationPath = join(directory, 'invocation.json');
  const lock = join(directory, 'exclusive-apply');
  const completed = join(directory, 'completed');
  const task = id => ({
    schemaVersion: 1, id, inputDigest: createHash('sha256').update(id).digest('hex'), dependencies: [], predicate: 'supported',
    operations: { check: `${id}-check`, apply: `${id}-apply`, verify: `${id}-verify` }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
  });
  const tasks = [task('policy.first'), task('policy.second')];
  const operations = {};
  for (const item of tasks) {
    const check = `const fs=require('node:fs');const value=fs.existsSync(${JSON.stringify(completed)})?fs.readFileSync(${JSON.stringify(completed)},'utf8'):'';process.exit(value.includes(${JSON.stringify(item.id)})?0:10)`;
    const apply = `const fs=require('node:fs');try{fs.mkdirSync(${JSON.stringify(lock)})}catch{process.exit(97)};setTimeout(()=>{fs.appendFileSync(${JSON.stringify(completed)},${JSON.stringify(`${item.id}\n`)});fs.rmdirSync(${JSON.stringify(lock)})},150)`;
    operations[`${item.id}-check`] = { argv: [process.execPath, '-e', check] };
    operations[`${item.id}-apply`] = { argv: [process.execPath, '-e', apply] };
    operations[`${item.id}-verify`] = { argv: [process.execPath, '-e', check] };
  }
  const common = {
    schemaVersion: 1, command: 'plan', runId: 'policy-bound-run', releaseId: 'policy-release',
    facts: { schemaVersion: 1, hostId: 'policy-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'darwin', osVersion: '15.7', arch: 'arm64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'policy-revision', hostId: 'policy-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks, selectedTaskIds: tasks.map(item => item.id), executionPolicy: { maxConcurrency: 1, resourceLimits: { cpu: 2, memoryMiB: 128, networkConcurrency: 0 } } },
    operations,
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  await writeFile(invocationPath, `${JSON.stringify(common)}\n`, { mode: 0o600 });
  const planned = JSON.parse((await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 30_000 })).stdout);
  assert.equal(planned.executionPolicy.maxConcurrency, 1);
  const parallelPolicy = structuredClone(common);
  parallelPolicy.plan.executionPolicy.maxConcurrency = 2;
  await writeFile(invocationPath, `${JSON.stringify(parallelPolicy)}\n`, { mode: 0o600 });
  const parallelPlan = JSON.parse((await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 30_000 })).stdout);
  assert.notEqual(parallelPlan.digest, planned.digest, 'scheduler policy must be part of approval identity');
  await writeFile(invocationPath, `${JSON.stringify({ ...common, command: 'run', approvedPlanDigest: planned.digest, renderer: 'json', stateRoot: join(directory, 'state') })}\n`, { mode: 0o600 });
  const result = JSON.parse((await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 30_000 })).stdout);
  assert.equal(result.receipt.status, 'success');
  assert.deepEqual((await readFile(completed, 'utf8')).trim().split('\n').sort(), tasks.map(item => item.id).sort());
});

test('native managed-file operation records durable compensation and rolls back through the CLI', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-managed-file-cli-')));
  await chmod(directory, 0o700);
  const stateRoot = join(directory, 'state');
  const target = join(directory, 'install.doctor-policy.json');
  const invocationPath = join(directory, 'invocation.json');
  await writeFile(target, '{"schemaVersion":1,"releaseId":"old"}\n', { mode: 0o640 });
  const candidate = Buffer.from('{"schemaVersion":1,"releaseId":"release-2"}\n');
  const task = {
    schemaVersion: 1, id: 'installer.bootstrap-policy', inputDigest: digest('c'), dependencies: [], predicate: 'supported',
    operations: { check: 'policy-check', apply: 'policy-apply', verify: 'policy-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  const managedFile = action => ({
    kind: 'managed-file', action, targetPath: target, candidateBase64: candidate.toString('base64'), candidateMode: 0o600,
  });
  const common = {
    schemaVersion: 1, releaseId: 'release-2',
    facts: {
      schemaVersion: 1, hostId: 'managed-file-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'darwin', osVersion: '15.7',
      arch: 'arm64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [],
    },
    desiredState: { schemaVersion: 1, revision: 'managed-file-revision', hostId: 'managed-file-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'policy-check': managedFile('check'), 'policy-apply': managedFile('apply'), 'policy-verify': managedFile('verify'),
    },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const runCli = async invocation => {
    await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], {
      env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000,
    });
  };
  const unsafeMode = structuredClone({ ...common, command: 'plan', runId: 'managed-file-unsafe-mode' });
  for (const operation of Object.values(unsafeMode.operations)) operation.candidateMode = 0o622;
  await assert.rejects(runCli(unsafeMode), error => error.code === 2 && /owner-readable and not group\/world-writable/.test(error.stderr));
  const phaseMismatch = structuredClone({ ...common, command: 'plan', runId: 'managed-file-phase-mismatch' });
  phaseMismatch.operations['policy-check'].action = 'apply';
  await assert.rejects(runCli(phaseMismatch), error => error.code === 2 && /managed file operation phase mismatch/.test(error.stderr));
  assert.equal(await readFile(target, 'utf8'), '{"schemaVersion":1,"releaseId":"old"}\n');
  const planned = JSON.parse((await runCli({ ...common, command: 'plan', runId: 'managed-file-plan' })).stdout);
  const sourceRunId = 'managed-file-install';
  const installed = await runCli({
    ...common, command: 'run', runId: sourceRunId, approvedPlanDigest: planned.digest, renderer: 'json', stateRoot,
  });
  assert.equal(JSON.parse(installed.stdout).receipt.status, 'success');
  assert.equal(await readFile(target, 'utf8'), candidate.toString('utf8'));
  assert.equal((await lstat(target)).mode & 0o777, 0o600);
  const compensationRoot = join(stateRoot, 'runs', planned.digest, sourceRunId, 'compensations');
  assert.equal((await readdir(compensationRoot)).length, 1);

  const source = { schemaVersion: 1, stateRoot, sourceRunId, sourcePlanDigest: planned.digest };
  const rollbackPlan = JSON.parse((await runCli({ ...source, command: 'rollback-config-plan' })).stdout);
  assert.deepEqual(rollbackPlan.taskOrder, [task.id]);
  const rollback = JSON.parse((await runCli({
    ...source, command: 'rollback-config-execute', rollbackRunId: 'managed-file-rollback', approvedPlanDigest: rollbackPlan.digest,
  })).stdout);
  assert.equal(rollback.receipt.completed, true);
  assert.equal(await readFile(target, 'utf8'), '{"schemaVersion":1,"releaseId":"old"}\n');
  assert.equal((await lstat(target)).mode & 0o777, 0o640);

  const replacementRunId = 'managed-file-reinstall';
  const replacement = await runCli({
    ...common, command: 'run', runId: replacementRunId, approvedPlanDigest: planned.digest, renderer: 'json', stateRoot,
  });
  assert.equal(JSON.parse(replacement.stdout).receipt.status, 'success');
  assert.equal(await readFile(target, 'utf8'), candidate.toString('utf8'));

  await assert.rejects(runCli({
    ...source, command: 'rollback-config-execute', rollbackRunId: 'stale-source-new-rollback', approvedPlanDigest: rollbackPlan.digest,
  }), error => error.code === 3 && /rollback source.*already bound|already consumed/i.test(error.stderr));
  assert.equal(await readFile(target, 'utf8'), candidate.toString('utf8'), 'stale rollback authority must not mutate a newer installation');

  const replacementSource = { schemaVersion: 1, stateRoot, sourceRunId: replacementRunId, sourcePlanDigest: planned.digest };
  const replacementRollbackPlan = JSON.parse((await runCli({ ...replacementSource, command: 'rollback-config-plan' })).stdout);
  const replacementRollback = JSON.parse((await runCli({
    ...replacementSource, command: 'rollback-config-execute', rollbackRunId: 'managed-file-reinstall-rollback',
    approvedPlanDigest: replacementRollbackPlan.digest,
  })).stdout);
  assert.equal(replacementRollback.receipt.completed, true);
  assert.equal(await readFile(target, 'utf8'), '{"schemaVersion":1,"releaseId":"old"}\n');
});

test('managed cask launcher is reversible and an unchanged rerun preserves inode and timestamps', async t => {
  if (process.platform !== 'darwin') { t.skip('macOS cask launcher runtime requires Darwin filesystem semantics'); return; }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'desktop-tools-cask-launcher-')));
  await chmod(directory, 0o700);
  const applications = join(directory, 'Applications');
  const appPath = join(applications, 'Fixture App.app');
  const launcherRoot = join(directory, '.local', 'bin', 'cask');
  const target = join(launcherRoot, 'fixture-app');
  await mkdir(appPath, { recursive: true, mode: 0o700 });
  await mkdir(launcherRoot, { recursive: true, mode: 0o700 });
  const stateRoot = join(directory, 'state');
  const invocationPath = join(directory, 'invocation.json');
  const task = {
    schemaVersion: 1, id: 'installer.cask-launcher.fixture-app', inputDigest: digest('c'), dependencies: [], predicate: 'darwin-native',
    operations: { check: 'cask-check', apply: 'cask-apply', verify: 'cask-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  const operation = action => ({
    kind: 'managed-cask-launcher', action, packageKey: 'fixture-app', appBundle: 'Fixture App.app',
    appPaths: [appPath, '/Applications/Fixture App.app'], targetPath: target, candidateMode: 0o700,
    policy: 'home-applications-before-system-v1',
  });
  const common = {
    schemaVersion: 1, releaseId: 'release-cask',
    facts: { schemaVersion: 1, hostId: 'cask-host', collectedAt: '2026-11-09T00:00:00.000Z', os: 'darwin', osVersion: '26.1',
      arch: process.arch, environment: 'native', roles: ['workstation'], packageManagers: ['brew'], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'cask-revision', hostId: 'cask-host', packages: ['fixture-app'], services: [], consents: [], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: { 'cask-check': operation('check'), 'cask-apply': operation('apply'), 'cask-verify': operation('verify') },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invoke = async input => {
    await writeFile(invocationPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 });
  };
  const planned = JSON.parse((await invoke({ ...common, command: 'plan', runId: 'cask-plan' })).stdout);
  const sourceRunId = 'cask-install';
  const installed = JSON.parse((await invoke({ ...common, command: 'run', runId: sourceRunId,
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot })).stdout);
  assert.equal(installed.receipt.status, 'success');
  assert.equal(await readFile(target, 'utf8'), `#!/usr/bin/env bash\nopen ${JSON.stringify(appPath)} "$@"\n`);
  const first = await lstat(target);
  assert.equal(first.mode & 0o777, 0o700);

  const unchanged = JSON.parse((await invoke({ ...common, command: 'run', runId: 'cask-unchanged',
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot })).stdout);
  assert.equal(unchanged.receipt.status, 'success');
  const second = await lstat(target);
  assert.equal(second.ino, first.ino);
  assert.equal(second.mtimeMs, first.mtimeMs);
  const unchangedCompensation = join(stateRoot, 'runs', planned.digest, 'cask-unchanged', 'compensations');
  assert.deepEqual(await readdir(unchangedCompensation), []);

  const source = { schemaVersion: 1, stateRoot, sourceRunId, sourcePlanDigest: planned.digest };
  const rollbackPlan = JSON.parse((await invoke({ ...source, command: 'rollback-config-plan' })).stdout);
  const rollback = JSON.parse((await invoke({ ...source, command: 'rollback-config-execute', rollbackRunId: 'cask-rollback',
    approvedPlanDigest: rollbackPlan.digest })).stdout);
  assert.equal(rollback.receipt.completed, true);
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');

  await writeFile(target, '#!/bin/sh\necho user-owned\n', { mode: 0o700 });
  await assert.rejects(invoke({ ...common, command: 'run', runId: 'cask-conflict',
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot }));
  assert.equal(await readFile(target, 'utf8'), '#!/bin/sh\necho user-owned\n');
});

test('managed Flatpak launcher verifies the installed app, is reversible, and preserves an unchanged target', async t => {
  if (process.platform !== 'linux') { t.skip('Flatpak launcher runtime requires Linux'); return; }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'desktop-tools-flatpak-launcher-')));
  await chmod(directory, 0o700);
  const executableRoot = join(directory, 'bin');
  const flatpakPath = join(executableRoot, 'flatpak');
  const installedMarker = join(directory, '.fixture-flatpak-installed');
  const launcherRoot = join(directory, '.local', 'bin', 'flatpak');
  const target = join(launcherRoot, 'fixture-app');
  await mkdir(executableRoot, { recursive: true, mode: 0o700 });
  await mkdir(launcherRoot, { recursive: true, mode: 0o700 });
  const flatpakBytes = Buffer.from('#!/bin/sh\n[ "$1" = info ] && [ "$2" = --show-ref ] && [ "$3" = org.example.Fixture ] && [ -f "$HOME/.fixture-flatpak-installed" ]\n', 'utf8');
  await writeFile(flatpakPath, flatpakBytes, { mode: 0o700 });
  await chmod(flatpakPath, 0o700);
  await writeFile(installedMarker, 'installed\n', { mode: 0o600 });
  const flatpakSha256 = createHash('sha256').update(flatpakBytes).digest('hex');
  const stateRoot = join(directory, 'state');
  const invocationPath = join(directory, 'invocation.json');
  const task = {
    schemaVersion: 1, id: 'installer.flatpak-launcher.fixture-app', inputDigest: digest('f'), dependencies: [], predicate: 'linux-native',
    operations: { check: 'flatpak-check', apply: 'flatpak-apply', verify: 'flatpak-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  const operation = action => ({
    kind: 'managed-flatpak-launcher', action, packageKey: 'fixture-app', appId: 'org.example.Fixture',
    flatpakPath, flatpakSha256, homeDirectory: directory, targetPath: target, candidateMode: 0o700,
    policy: 'flatpak-info-all-installations-v1',
  });
  const common = {
    schemaVersion: 1, releaseId: 'release-flatpak',
    facts: { schemaVersion: 1, hostId: 'flatpak-host', collectedAt: '2026-11-09T00:00:00.000Z', os: 'linux', osVersion: '6.1',
      arch: process.arch, environment: 'native', roles: ['workstation'], packageManagers: ['flatpak'], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'flatpak-revision', hostId: 'flatpak-host', packages: ['fixture-app'], services: [], consents: [], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: { 'flatpak-check': operation('check'), 'flatpak-apply': operation('apply'), 'flatpak-verify': operation('verify') },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invoke = async input => {
    await writeFile(invocationPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 });
  };
  const planned = JSON.parse((await invoke({ ...common, command: 'plan', runId: 'flatpak-plan' })).stdout);
  const sourceRunId = 'flatpak-install';
  const installed = JSON.parse((await invoke({ ...common, command: 'run', runId: sourceRunId,
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot })).stdout);
  assert.equal(installed.receipt.status, 'success');
  assert.equal(await readFile(target, 'utf8'), `#!/usr/bin/env bash\nexec ${JSON.stringify(flatpakPath)} run "org.example.Fixture" "$@"\n`);
  const first = await lstat(target);

  const unchanged = JSON.parse((await invoke({ ...common, command: 'run', runId: 'flatpak-unchanged',
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot })).stdout);
  assert.equal(unchanged.receipt.status, 'success');
  const second = await lstat(target);
  assert.equal(second.ino, first.ino);
  assert.equal(second.mtimeMs, first.mtimeMs);
  assert.deepEqual(await readdir(join(stateRoot, 'runs', planned.digest, 'flatpak-unchanged', 'compensations')), []);

  const source = { schemaVersion: 1, stateRoot, sourceRunId, sourcePlanDigest: planned.digest };
  const rollbackPlan = JSON.parse((await invoke({ ...source, command: 'rollback-config-plan' })).stdout);
  const rollback = JSON.parse((await invoke({ ...source, command: 'rollback-config-execute', rollbackRunId: 'flatpak-rollback',
    approvedPlanDigest: rollbackPlan.digest })).stdout);
  assert.equal(rollback.receipt.completed, true);
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');

  await writeFile(target, '#!/bin/sh\necho user-owned\n', { mode: 0o700 });
  await assert.rejects(invoke({ ...common, command: 'run', runId: 'flatpak-conflict',
    approvedPlanDigest: planned.digest, renderer: 'json', stateRoot }));
  assert.equal(await readFile(target, 'utf8'), '#!/bin/sh\necho user-owned\n');
});

test('native managed-directory operation records durable authority and rolls back only its empty directory', async () => {
  if (process.platform === 'win32') return;
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-managed-directory-cli-')));
  await chmod(directory, 0o700);
  const stateRoot = join(directory, 'state');
  const target = join(directory, 'managed');
  const invocationPath = join(directory, 'invocation.json');
  const task = {
    schemaVersion: 1, id: 'installer.managed-directory', inputDigest: digest('d'), dependencies: [], predicate: 'supported',
    operations: { check: 'directory-check', apply: 'directory-apply', verify: 'directory-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  const operation = action => ({ kind: 'managed-directory', action, targetPath: target, candidateMode: 0o700 });
  const common = {
    schemaVersion: 1, releaseId: 'release-directory',
    facts: { schemaVersion: 1, hostId: 'directory-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'darwin', osVersion: '15.7', arch: 'arm64', environment: 'native', roles: [], packageManagers: [], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'directory-revision', hostId: 'directory-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: { 'directory-check': operation('check'), 'directory-apply': operation('apply'), 'directory-verify': operation('verify') },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const runCli = async invocation => {
    await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000 });
  };
  const planned = JSON.parse((await runCli({ ...common, command: 'plan', runId: 'directory-plan' })).stdout);
  const sourceRunId = 'directory-install';
  const installed = JSON.parse((await runCli({ ...common, command: 'run', runId: sourceRunId, approvedPlanDigest: planned.digest, renderer: 'json', stateRoot })).stdout);
  assert.equal(installed.receipt.status, 'success');
  assert.equal((await lstat(target)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(target), ['.install-doctor-directory-authority']);
  const source = { schemaVersion: 1, stateRoot, sourceRunId, sourcePlanDigest: planned.digest };
  const rollbackPlan = JSON.parse((await runCli({ ...source, command: 'rollback-config-plan' })).stdout);
  const rollback = JSON.parse((await runCli({ ...source, command: 'rollback-config-execute', rollbackRunId: 'directory-rollback', approvedPlanDigest: rollbackPlan.digest })).stdout);
  assert.equal(rollback.receipt.completed, true);
  await assert.rejects(lstat(target), error => error.code === 'ENOENT');
});

test('verified artifact operation revalidates exact candidate bytes and activates with durable rollback evidence', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-managed-artifact-cli-')));
  await chmod(directory, 0o700);
  const stateRoot = join(directory, 'state');
  const target = join(directory, 'installed-tool');
  const candidateOne = join(directory, 'candidate-one');
  const candidateTwo = join(directory, 'candidate-two');
  const invocationPath = join(directory, 'invocation.json');
  const previous = Buffer.from('previous-tool\n');
  const candidate = Buffer.from('#!/bin/sh\nprintf artifact-v2\\n\n');
  const candidateSha256 = createHash('sha256').update(candidate).digest('hex');
  await writeFile(target, previous, { mode: 0o700 });
  await writeFile(candidateOne, candidate, { mode: 0o600 });
  await writeFile(candidateTwo, candidate, { mode: 0o600 });
  const task = {
    schemaVersion: 1, id: 'artifact.fixture', inputDigest: digest('e'), dependencies: [], predicate: 'supported',
    operations: { check: 'artifact-check', apply: 'artifact-apply', verify: 'artifact-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  const managedArtifact = (action, candidatePath = candidateOne) => ({
    kind: 'managed-artifact', action, candidatePath, candidateSha256, candidateSizeBytes: candidate.length,
    targetPath: target, candidateMode: 0o700,
    authority: { loadPlanDigest: digest('1'), descriptorDigest: digest('2') },
  });
  const common = {
    schemaVersion: 1, releaseId: 'release-artifact-2',
    facts: {
      schemaVersion: 1, hostId: 'managed-artifact-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'linux', osVersion: '24.04',
      arch: 'x64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [],
    },
    desiredState: { schemaVersion: 1, revision: 'managed-artifact-revision', hostId: 'managed-artifact-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'artifact-check': managedArtifact('check'), 'artifact-apply': managedArtifact('apply'), 'artifact-verify': managedArtifact('verify'),
    },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const runCli = async invocation => {
    await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], {
      env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000,
    });
  };

  const unsafeMode = structuredClone({ ...common, command: 'plan', runId: 'artifact-unsafe-mode' });
  for (const operation of Object.values(unsafeMode.operations)) operation.candidateMode = 0o500;
  await assert.rejects(runCli(unsafeMode), error => error.code === 2);

  const selfReplacing = structuredClone({ ...common, command: 'plan', runId: 'artifact-self-replacing' });
  for (const operation of Object.values(selfReplacing.operations)) operation.targetPath = operation.candidatePath;
  await assert.rejects(runCli(selfReplacing), error => error.code === 2 && /candidate and target must be distinct paths/i.test(error.stderr));

  const windows = structuredClone({ ...common, command: 'plan', runId: 'artifact-windows' });
  windows.facts.os = 'win32';
  await assert.rejects(runCli(windows), error => error.code === 2 && /managed artifact activation is unsupported on win32/i.test(error.stderr));

  const planned = JSON.parse((await runCli({ ...common, command: 'plan', runId: 'artifact-plan-one' })).stdout);
  const relocated = structuredClone(common);
  for (const operation of Object.values(relocated.operations)) operation.candidatePath = candidateTwo;
  const relocatedPlan = JSON.parse((await runCli({ ...relocated, command: 'plan', runId: 'artifact-plan-two' })).stdout);
  assert.equal(relocatedPlan.digest, planned.digest, 'approval identity must bind content, not the private cache pathname');

  await writeFile(candidateOne, Buffer.alloc(candidate.length, 0x78), { mode: 0o600 });
  await assert.rejects(runCli({
    ...common, command: 'run', runId: 'artifact-poisoned', approvedPlanDigest: planned.digest, renderer: 'json', stateRoot,
  }), error => error.code === 7 || error.code === 8);
  assert.equal(await readFile(target, 'utf8'), previous.toString('utf8'), 'candidate revalidation must precede target mutation');

  const installed = await runCli({
    ...relocated, command: 'run', runId: 'artifact-install', approvedPlanDigest: planned.digest, renderer: 'json', stateRoot,
  });
  assert.equal(JSON.parse(installed.stdout).receipt.status, 'success');
  assert.deepEqual(await readFile(target), candidate);
  assert.equal((await lstat(target)).mode & 0o777, 0o700);
  const installedInode = (await lstat(target)).ino;
  const unchanged = await runCli({
    ...relocated, command: 'run', runId: 'artifact-unchanged', approvedPlanDigest: planned.digest, renderer: 'json', stateRoot,
  });
  assert.equal(JSON.parse(unchanged.stdout).receipt.status, 'success');
  assert.equal((await lstat(target)).ino, installedInode, 'unchanged execution must not replace the installed artifact');

  const source = { schemaVersion: 1, stateRoot, sourceRunId: 'artifact-install', sourcePlanDigest: planned.digest };
  const rollbackPlan = JSON.parse((await runCli({ ...source, command: 'rollback-config-plan' })).stdout);
  const rollback = JSON.parse((await runCli({
    ...source, command: 'rollback-config-execute', rollbackRunId: 'artifact-rollback', approvedPlanDigest: rollbackPlan.digest,
  })).stdout);
  assert.equal(rollback.receipt.completed, true);
  assert.deepEqual(await readFile(target), previous);
  assert.equal((await lstat(target)).mode & 0o777, 0o700);
});

test('rollback-config CLI derives an identity-only stable plan, resumes explicitly, and rejects replay', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-rollback-cli-')));
  await chmod(directory, 0o700);
  const stateRoot = join(directory, 'state');
  const target = join(directory, 'managed.conf');
  await writeFile(target, 'old\n', { mode: 0o600 });
  const facts = {
    schemaVersion: 1, hostId: 'rollback-cli-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'darwin', osVersion: '15.7',
    arch: 'arm64', environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [],
  };
  const desiredState = { schemaVersion: 1, revision: 'rollback-cli-revision', hostId: facts.hostId, packages: [], services: [], consents: [], offline: true };
  const rollbackTask = {
    schemaVersion: 1, id: 'config.rollback-cli', inputDigest: digest('4'), dependencies: [], predicate: 'supported',
    operations: { check: 'check', apply: 'apply', verify: 'verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['config.rollback-cli'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run',
  };
  let sourceApplyError;
  const adapter = {
    discover: async () => facts,
    plan: async () => ({ tasks: [rollbackTask], selectedTaskIds: [rollbackTask.id] }),
    check: async () => (await readFile(target, 'utf8')) === 'new\n' ? 'verified' : 'needed',
    apply: async (_task, context) => {
      try { await applyConfigurationTransaction({
        spec: { schemaVersion: 1, taskId: rollbackTask.id, targetPath: target, effect: 'installer-configuration', dependencies: [] },
        candidateBytes: Buffer.from('new\n'),
        hooks: { validateCandidate: async () => {}, verifyPostcondition: async path => (await readFile(path, 'utf8')) === 'new\n' },
        persistence: context.configurationCompensation,
        now: () => '2026-11-06T00:00:01.000Z',
      }); } catch (error) { sourceApplyError = error; throw error; }
    },
    verify: async () => (await readFile(target, 'utf8')) === 'new\n' ? 'verified' : 'pending',
  };
  const sourceStore = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-cli', processStart: 'process-cli', isProcessAlive: async () => false,
  });
  const engine = createInstallerEngine({ adapter, journal: sourceStore });
  const sourcePlan = await engine.plan(facts, desiredState, 'release-rollback-cli');
  const sourceRunId = 'source-rollback-cli';
  const sourceResult = await engine.run({
    runId: sourceRunId, releaseId: sourcePlan.releaseId, desiredState, approvedPlanDigest: sourcePlan.digest,
  });
  assert.equal(sourceResult.receipt.status, 'success', `${sourceApplyError?.stack ?? ''}\n${JSON.stringify(sourceResult)}`);
  assert.equal(await readFile(target, 'utf8'), 'new\n');

  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const invocationPath = join(directory, 'rollback.json');
  const runCli = async invocation => {
    await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
    return execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000 });
  };
  const source = { schemaVersion: 1, stateRoot, sourceRunId, sourcePlanDigest: sourcePlan.digest };
  const rollbackPlan = JSON.parse((await runCli({ ...source, command: 'rollback-config-plan' })).stdout);
  assert.deepEqual(JSON.parse((await runCli({ ...source, command: 'rollback-config-plan' })).stdout), rollbackPlan);
  assert.deepEqual(rollbackPlan.taskOrder, [rollbackTask.id]);
  const executeInvocation = {
    ...source, command: 'rollback-config-execute', rollbackRunId: 'rollback-cli-one',
    approvedPlanDigest: rollbackPlan.digest,
  };
  await assert.rejects(
    runCli({ ...executeInvocation, command: 'rollback-config-resume', rollbackRunId: 'rollback-cli-absent' }),
    error => error.code === 3 && /precondition failed.*resume requires uncommitted evidence; found absent/.test(error.stderr),
  );
  await assert.rejects(runCli({ ...executeInvocation, plan: rollbackPlan }), error => error.code === 2 && /unrecognized key/i.test(error.stderr));
  await assert.rejects(runCli({ ...executeInvocation, compensations: [] }), error => error.code === 2 && /unrecognized key/i.test(error.stderr));
  await assert.rejects(runCli({ ...executeInvocation, approvedPlanDigest: digest('0') }), error => error.code === 2 && /exact derived plan approval/i.test(error.stderr));
  assert.equal(await readFile(target, 'utf8'), 'new\n', 'schema or approval rejection must precede restoration');
  await writeFile(target, 'user-edit\n', { mode: 0o600 });
  const editedBeforeRollback = { bytes: await readFile(target), metadata: await lstat(target) };
  await assert.rejects(
    runCli({ ...executeInvocation, rollbackRunId: 'rollback-cli-drift' }),
    error => error.code === 3 && /precondition failed.*target changed after installation/.test(error.stderr),
  );
  assert.equal(await readFile(target, 'utf8'), 'user-edit\n', 'rollback must preserve post-install user edits');
  let driftInspection;
  await assert.rejects(runCli({
    schemaVersion: 1, command: 'rollback-config-status', stateRoot,
    rollbackRunId: 'rollback-cli-drift', planDigest: rollbackPlan.digest,
  }), error => {
    driftInspection = JSON.parse(error.stdout);
    return error.code === 1;
  });
  assert.equal(driftInspection.authority, 'uncommitted');
  assert.equal(Object.hasOwn(driftInspection, 'receipt'), false);
  const driftEventRoot = join(stateRoot, 'rollback-runs', rollbackPlan.digest, 'rollback-cli-drift', 'events');
  const driftEvents = await Promise.all((await readdir(driftEventRoot)).sort()
    .map(async name => JSON.parse(await readFile(join(driftEventRoot, name), 'utf8'))));
  assert.deepEqual(driftEvents.map(event => event.kind), ['rollback-run-started', 'rollback-plan-approved']);
  assert.equal(driftEvents.some(event => event.kind === 'rollback-task-restored' || event.kind === 'rollback-run-finished'), false,
    'a precondition refusal must not publish restoration or terminal-success evidence');
  await assert.rejects(
    runCli({ ...executeInvocation, command: 'rollback-config-resume', rollbackRunId: 'rollback-cli-drift' }),
    error => error.code === 3 && /precondition failed.*target changed after installation/.test(error.stderr),
  );
  const editedAfterRetry = { bytes: await readFile(target), metadata: await lstat(target) };
  assert.deepEqual(editedAfterRetry.bytes, editedBeforeRollback.bytes);
  assert.equal(editedAfterRetry.metadata.mode & 0o777, editedBeforeRollback.metadata.mode & 0o777);
  assert.equal(editedAfterRetry.metadata.ino, editedBeforeRollback.metadata.ino,
    'rejected rollback and resume must not replace the user-edited file');
  await writeFile(target, 'new\n', { mode: 0o600 });
  const resumed = JSON.parse((await runCli({
    ...executeInvocation, command: 'rollback-config-resume', rollbackRunId: 'rollback-cli-drift',
  })).stdout);
  assert.equal(resumed.receipt.completed, true);
  assert.equal(await readFile(target, 'utf8'), 'old\n');
  await writeFile(target, 'new\n', { mode: 0o600 });
  await assert.rejects(runCli(executeInvocation),
    error => error.code === 3 && /rollback source is already bound/.test(error.stderr));
  assert.equal(await readFile(target, 'utf8'), 'new\n', 'a consumed rollback source must not authorize another run identity');
  const status = JSON.parse((await runCli({
    schemaVersion: 1, command: 'rollback-config-status', stateRoot,
    rollbackRunId: 'rollback-cli-drift', planDigest: rollbackPlan.digest,
  })).stdout);
  assert.equal(status.authority, 'committed');
  await assert.rejects(runCli(executeInvocation), error => error.code === 3 && /execution requires absent evidence; found uncommitted/.test(error.stderr));
  assert.equal(await readFile(target, 'utf8'), 'new\n');
  const compensationRoot = join(stateRoot, 'runs', sourcePlan.digest, sourceRunId, 'compensations');
  await writeFile(join(compensationRoot, `${digest('9')}.json`), '{}\n', { mode: 0o600 });
  await assert.rejects(runCli({ ...source, command: 'rollback-config-plan' }), error => error.code === 4 && /committed install evidence; found corrupt/.test(error.stderr));
});

test('CLI rejects invocation files writable by another user class', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-permissions-'));
  const invocationPath = join(directory, 'invocation.json');
  await writeFile(invocationPath, '{"schemaVersion":1,"unknown":true}\n', { mode: 0o600 });
  await chmod(invocationPath, 0o660);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 5_000 }),
    error => error.code === 2 && /owned by the current user and not writable by group or other/i.test(error.stderr),
  );
});

test('read-only CLI plan mode creates a normalized plan without spawning operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-plan-'));
  const invocationPath = join(directory, 'invocation.json');
  const invocation = {
    schemaVersion: 1, command: 'plan', runId: 'plan-run-1', releaseId: 'release-1',
    facts: {
      schemaVersion: 1, hostId: 'plan-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'linux', osVersion: '24.04',
      arch: 'x64', environment: 'container', roles: ['fixture'], packageManagers: ['apt'], capabilities: [],
    },
    desiredState: { schemaVersion: 1, revision: 'revision-1', hostId: 'plan-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [], selectedTaskIds: [] },
    operations: {},
  };
  await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const { stdout, stderr } = await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 5_000 });
  assert.equal(stderr, '');
  const normalized = JSON.parse(stdout);
  assert.match(normalized.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(normalized.selectedTaskIds, []);
});

test('load-plan CLI emits a stable nonmutating lazy/eager closure report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-load-plan-'));
  const invocationPath = join(directory, 'load-plan.json');
  const catalog = [
    { name: 'resolver', bin: 'resolver', platforms: ['linux'], installMode: 'cli', loadPolicy: 'eager-bootstrap', loadRationale: 'lazy-resolver:hook', deps: [] },
    { name: 'optional', bin: 'optional', platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [] },
  ];
  const invocation = {
    schemaVersion: 1, command: 'load-plan', platform: 'linux', architecture: 'x64', roles: ['workstation'], selectedPackages: [],
    selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: ['resolver'], catalog,
  };
  await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const first = await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 5_000 });
  const second = await execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 5_000 });
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.deepEqual(report.installOrder, ['resolver']);
  assert.equal(report.items.find(item => item.name === 'optional').selectionReason, 'unselected-lazy');
});

test('normal CLI plans native package operations but rejects mutation without the approved privileged broker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-tools-native-cli-authority-'));
  const invocationPath = join(directory, 'invocation.json');
  const operation = action => ({ kind: 'native-package', effectClass: 'native-package', action,
    packageKey: 'tree', payloadArtifactId: 'tree-deb-bookworm-amd64', installedWitnesses: [{
      kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', minimumVersion: '2.34', architecture: 'amd64',
    }] });
  const task = { schemaVersion: 1, id: 'package.native.tree', inputDigest: digest('a'), dependencies: [], predicate: 'host-supported',
    requiredCapabilities: [], operations: { check: 'native-check', apply: 'native-apply', verify: 'native-verify' }, timeoutMs: 300_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 256, network: false },
    privilege: 'admin', network: 'none', consent: 'package-install', lockDomains: ['package-manager.dpkg'], cleanup: 'none',
    compensation: 'none', failurePolicy: 'abort-run' };
  const invocation = { schemaVersion: 1, command: 'plan', runId: 'native-authority-reject', releaseId: 'release-1',
    facts: { schemaVersion: 1, hostId: 'native-host', collectedAt: '2026-11-08T00:00:00.000Z', os: 'linux', osVersion: '12',
      arch: 'x64', environment: 'native', roles: ['workstation'], packageManagers: ['dpkg'], capabilities: [] },
    desiredState: { schemaVersion: 1, revision: 'revision-1', hostId: 'native-host', packages: ['tree'], services: [],
      consents: ['package-install'], offline: false },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: { 'native-check': operation('check'), 'native-apply': operation('apply'), 'native-verify': operation('verify') } };
  await writeFile(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const planned = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 5_000,
  });
  const plan = JSON.parse(planned.stdout);
  assert.match(plan.digest, /^[a-f0-9]{64}$/);
  await writeFile(invocationPath, `${JSON.stringify({ ...invocation, command: 'run', approvedPlanDigest: plan.digest,
    renderer: 'headless', stateRoot: join(directory, 'state') })}\n`, { mode: 0o600 });
  await assert.rejects(execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 5_000,
  }), error => error.code === 4 && /require the approved privileged broker/i.test(error.stderr));
});

test('runs-list is read-only when no run evidence exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-runs-list-'));
  const stateRoot = join(directory, 'state');
  const invocationPath = join(directory, 'runs-list.json');
  await writeFile(invocationPath, `${JSON.stringify({ schemaVersion: 1, command: 'runs-list', stateRoot })}\n`, { mode: 0o600 });
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const { stdout, stderr } = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 5_000,
  });
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { schemaVersion: 1, runs: [] });
  await assert.rejects(lstat(stateRoot), error => error.code === 'ENOENT');
});

test('resume requires exact released-uncommitted evidence and a rebuilt matching operation manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'install-doctor-engine-resume-'));
  const stateRoot = join(directory, 'state');
  const invocationPath = join(directory, 'resume.json');
  const marker = join(directory, 'installed');
  const task = {
    schemaVersion: 1, id: 'resume.install', inputDigest: digest('a'), dependencies: [], predicate: 'supported',
    operations: { check: 'resume-check', apply: 'resume-apply', verify: 'resume-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
  };
  const nodeCheck = `const fs=require('node:fs');process.exit(fs.existsSync(${JSON.stringify(marker)})?0:10)`;
  const nodeApply = `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x')`;
  const base = {
    schemaVersion: 1, runId: 'resume-run', releaseId: 'release-1',
    facts: {
      schemaVersion: 1, hostId: 'resume-host', collectedAt: '2026-11-06T00:00:00.000Z', os: 'linux', osVersion: '24.04',
      arch: 'x64', environment: 'container', roles: ['fixture'], packageManagers: [], capabilities: [],
    },
    desiredState: { schemaVersion: 1, revision: 'revision-1', hostId: 'resume-host', packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [task], selectedTaskIds: [task.id] },
    operations: {
      'resume-check': { argv: [process.execPath, '-e', nodeCheck] },
      'resume-apply': { argv: [process.execPath, '-e', nodeApply] },
      'resume-verify': { argv: [process.execPath, '-e', nodeCheck] },
    },
  };
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  await writeFile(invocationPath, `${JSON.stringify({ ...base, command: 'plan' })}\n`, { mode: 0o600 });
  const planned = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 10_000,
  });
  const normalized = JSON.parse(planned.stdout);
  const store = createJournalStore({
    stateRoot, hostId: base.facts.hostId, bootId: 'fixture-boot', processStart: 'fixture-start', isProcessAlive: async () => true,
  });
  const released = await store.claim(base.runId, normalized);
  await store.release(released.owner);
  const resume = { ...base, command: 'resume', planDigest: normalized.digest, renderer: 'ndjson', stateRoot };
  await writeFile(invocationPath, `${JSON.stringify(resume)}\n`, { mode: 0o600 });
  const resumed = await execute(process.execPath, [cli, '--input', invocationPath], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.equal(resumed.stderr, '');
  assert.equal(await readFile(marker, 'utf8'), 'x');

  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => /found committed/.test(error.stderr),
    'committed evidence must not be resumed',
  );

  const activeRunId = 'resume-active';
  const active = await store.claim(activeRunId, normalized);
  await writeFile(invocationPath, `${JSON.stringify({ ...resume, runId: activeRunId })}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => /found active/.test(error.stderr),
    'active evidence must not be resumed',
  );
  await store.release(active.owner);

  const tamperedRunId = 'resume-tampered';
  const tamperedClaim = await store.claim(tamperedRunId, normalized);
  await store.release(tamperedClaim.owner);
  const changed = structuredClone({ ...resume, runId: tamperedRunId });
  changed.operations['resume-apply'].argv = [process.execPath, '-e', `${nodeApply};throw new Error('changed')`];
  await writeFile(invocationPath, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => /operation manifest/.test(error.stderr),
    'changed operation manifest must invalidate resume before mutation',
  );
  assert.equal(await readFile(marker, 'utf8'), 'x', 'rejected resume must not mutate');

  const objectDirectory = join(stateRoot, 'runs', normalized.digest, tamperedRunId, 'objects', 'sha256');
  const [objectName] = await readdir(objectDirectory);
  await writeFile(join(objectDirectory, objectName), '{}\n', { mode: 0o600 });
  await writeFile(invocationPath, `${JSON.stringify({ ...resume, runId: tamperedRunId })}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => /found corrupt/.test(error.stderr),
    'tampered durable evidence must not be resumed',
  );

  await writeFile(invocationPath, `${JSON.stringify({ ...resume, runId: 'resume-foreign' })}\n`, { mode: 0o600 });
  await assert.rejects(
    execute(process.execPath, [cli, '--input', invocationPath], { env: { PATH: process.env.PATH ?? '' }, timeout: 10_000 }),
    error => /found absent/.test(error.stderr),
    'foreign or absent run identity must not be resumed',
  );
});
