import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildLoadPlan } from '../dist/index.js';

const bytes = Buffer.from('#!/bin/sh\nprintf batch-artifact\\n\n');
const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
const hostOs = process.platform;
const hostArch = process.arch;
const planPlatform = hostOs === 'darwin' ? 'macos' : hostOs === 'win32' ? 'windows' : 'linux';
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, existingRoots = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-artifact-cli-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheRoot = join(root, 'cache');
  const destinationRoot = join(root, 'bin');
  const stateRoot = join(root, 'state');
  await mkdir(stateRoot, { mode: 0o700 });
  if (existingRoots) await Promise.all([cacheRoot, destinationRoot].map(path => mkdir(path, { mode: 0o700 })));
  const descriptor = {
    schemaVersion: 1, id: 'fixture-tool', version: '1.0.0', platform: { os: hostOs, arch: hostArch },
    source: {
      url: 'https://github.com/example/fixture-tool/releases/download/v1.0.0/fixture-tool',
      sha256: artifactSha256, sizeBytes: bytes.length,
    },
    destination: { root: 'user-bin', filename: 'fixture-tool', mode: '0700' },
  };
  const loadPlan = buildLoadPlan({
    schemaVersion: 1, platform: planPlatform, architecture: hostArch, roles: ['workstation'],
    selectedPackages: ['fixture-tool'], selectedServices: [], selectedSupportedPaths: [], lazyResolverRequirements: [],
    catalog: [{
      name: 'fixture-tool', bin: 'fixture-tool', platforms: [planPlatform], installMode: 'cli',
      loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], artifacts: [descriptor],
    }],
  });
  const item = loadPlan.items.find(candidate => candidate.name === 'fixture-tool');
  return { root, cacheRoot, destinationRoot, stateRoot, loadPlan, item };
}

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
async function invoke(root, name, invocation, extraEnv = {}) {
  const input = join(root, `${name}.json`);
  await writeFile(input, `${JSON.stringify(invocation)}\n`, { mode: 0o600 });
  const result = spawnSync(process.execPath, [cli, '--input', input], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, ...extraEnv },
  });
  return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : undefined };
}

test('batch derive, approve, prepare, and run preserve one normalized plan identity', { skip: hostOs === 'win32' }, async t => {
  const state = await fixture(t);
  const authority = {
    loadPlan: state.loadPlan, items: [state.item], approvedLoadPlanDigest: state.loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  };
  const derivedResult = await invoke(state.root, 'derive', { schemaVersion: 1, command: 'artifact-derive', ...authority });
  assert.equal(derivedResult.status, 0, derivedResult.stderr);
  assert.equal(derivedResult.json.artifacts.length, 1);
  const derived = derivedResult.json.artifacts[0];
  await assert.rejects(readFile(derived.candidatePath), error => error.code === 'ENOENT');

  const operations = Object.fromEntries(Object.entries(derived.operations).map(([phase, operation]) => [`artifact-${phase}`, operation]));
  const directoryTasks = derived.directoryRequirements.map((requirement, index) => {
    const id = `directory.${index}`;
    for (const action of ['check', 'apply', 'verify']) operations[`${id}-${action}`] = {
      kind: 'managed-directory', action, targetPath: requirement.targetPath, candidateMode: requirement.targetMode,
    };
    return {
      schemaVersion: 1, id, inputDigest: digest(id), dependencies: [], predicate: 'supported',
      operations: { check: `${id}-check`, apply: `${id}-apply`, verify: `${id}-verify` }, timeoutMs: 5_000,
      retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 16, network: false },
      privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
      compensation: 'configuration', failurePolicy: 'abort-run', requiredCapabilities: [],
    };
  });
  const task = {
    schemaVersion: 1, id: 'artifact.fixture-tool', inputDigest: digest('fixture-task'), dependencies: directoryTasks.map(task => task.id), predicate: 'supported',
    operations: { check: 'artifact-check', apply: 'artifact-apply', verify: 'artifact-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run', requiredCapabilities: [],
  };
  const facts = {
    schemaVersion: 1, hostId: 'artifact-cli-host', collectedAt: '2026-11-06T00:00:00.000Z', os: hostOs,
    osVersion: 'fixture', arch: hostArch, environment: 'native', roles: ['workstation'], packageManagers: [], capabilities: [],
  };
  const desiredState = {
    schemaVersion: 1, revision: 'artifact-cli-revision', hostId: facts.hostId,
    packages: ['fixture-tool'], services: [], consents: [], offline: true,
  };
  const common = {
    schemaVersion: 1, runId: 'artifact-cli-run', releaseId: 'release-1', facts, desiredState,
    plan: { tasks: [...directoryTasks, task], selectedTaskIds: [...directoryTasks.map(task => task.id), task.id] }, operations,
  };
  const planned = await invoke(state.root, 'plan', { ...common, command: 'plan' });
  assert.equal(planned.status, 0, planned.stderr);

  const wrongApproval = await invoke(state.root, 'wrong-approval', {
    ...common, ...authority, command: 'artifact-prepare', approvedPlanDigest: '0'.repeat(64), offline: true,
  });
  assert.notEqual(wrongApproval.status, 0);
  assert.match(wrongApproval.stderr, /exact normalized plan approval/i);
  await assert.rejects(readFile(derived.candidatePath), error => error.code === 'ENOENT');

  await writeFile(derived.candidatePath, bytes, { mode: 0o600 });
  await chmod(derived.candidatePath, 0o600);
  const prepared = await invoke(state.root, 'prepare', {
    ...common, ...authority, command: 'artifact-prepare', approvedPlanDigest: planned.json.digest, offline: true,
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(prepared.json.normalizedPlanDigest, planned.json.digest);
  assert.deepEqual(prepared.json.artifacts[0].operations, derived.operations);

  const replanned = await invoke(state.root, 'replan', { ...common, command: 'plan' });
  assert.equal(replanned.json.digest, planned.json.digest);
  const run = await invoke(state.root, 'run', {
    ...common, command: 'run', approvedPlanDigest: planned.json.digest, renderer: 'json', stateRoot: state.stateRoot,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(await readFile(join(state.destinationRoot, 'fixture-tool'), 'utf8'), bytes.toString('utf8'));
});

test('one approved fresh-host graph creates roots before descriptor-bound apply fetches', { skip: hostOs === 'win32' }, async t => {
  const state = await fixture(t, false);
  const authority = {
    loadPlan: state.loadPlan, items: [state.item], approvedLoadPlanDigest: state.loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  };
  const derivedResult = await invoke(state.root, 'fresh-derive', { schemaVersion: 1, command: 'artifact-derive', ...authority });
  assert.equal(derivedResult.status, 0, derivedResult.stderr);
  const derived = derivedResult.json.artifacts[0];
  assert.deepEqual(derived.directoryRequirements.map(item => [item.kind, item.exists]), [['cache', false], ['destination', false]]);

  const operations = Object.fromEntries(Object.entries(derived.operations).map(([phase, operation]) => [`artifact-${phase}`, operation]));
  const directoryTasks = derived.directoryRequirements.map((requirement, index) => {
    const id = `fresh-directory.${index}`;
    for (const action of ['check', 'apply', 'verify']) operations[`${id}-${action}`] = {
      kind: 'managed-directory', action, targetPath: requirement.targetPath, candidateMode: requirement.targetMode,
    };
    return {
      schemaVersion: 1, id, inputDigest: digest(id), dependencies: [], predicate: 'supported',
      operations: { check: `${id}-check`, apply: `${id}-apply`, verify: `${id}-verify` }, timeoutMs: 5_000,
      retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 16, network: false },
      privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
      compensation: 'configuration', failurePolicy: 'abort-run', requiredCapabilities: [],
    };
  });
  const artifactTask = {
    schemaVersion: 1, id: 'fresh-artifact.fixture-tool', inputDigest: digest('fresh-artifact'),
    dependencies: directoryTasks.map(task => task.id), predicate: 'supported',
    operations: { check: 'artifact-check', apply: 'artifact-apply', verify: 'artifact-verify' }, timeoutMs: 10_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: true },
    privilege: 'user', network: 'required', consent: 'network', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run', requiredCapabilities: [],
  };
  const facts = {
    schemaVersion: 1, hostId: 'fresh-artifact-host', collectedAt: '2026-11-06T00:00:00.000Z', os: hostOs,
    osVersion: 'fixture', arch: hostArch, environment: 'native', roles: [], packageManagers: [], capabilities: [],
  };
  const common = {
    schemaVersion: 1, runId: 'fresh-artifact-run', releaseId: 'release-1', facts,
    desiredState: {
      schemaVersion: 1, revision: 'fresh-artifact', hostId: facts.hostId,
      packages: ['fixture-tool'], services: [], consents: ['network'], offline: false,
    },
    plan: { tasks: [...directoryTasks, artifactTask], selectedTaskIds: [...directoryTasks.map(task => task.id), artifactTask.id] },
    operations,
  };
  const plan = await invoke(state.root, 'fresh-plan', { ...common, command: 'plan' });
  assert.equal(plan.status, 0, plan.stderr);
  await assert.rejects(readFile(state.cacheRoot), error => error.code === 'ENOENT');
  await assert.rejects(readFile(state.destinationRoot), error => error.code === 'ENOENT');

  const preload = join(state.root, 'fetch-mock.mjs');
  await writeFile(preload, `globalThis.fetch = async () => new Response(Buffer.from('${bytes.toString('base64')}', 'base64'), { status: 200, headers: { 'content-length': '${bytes.length}' } });\n`, { mode: 0o600 });
  const run = await invoke(state.root, 'fresh-run', {
    ...common, command: 'run', approvedPlanDigest: plan.json.digest, renderer: 'json', stateRoot: state.stateRoot,
  }, { NODE_OPTIONS: `--import=${preload}` });
  assert.equal(run.status, 0, run.stderr);
  assert.equal((await lstat(state.cacheRoot)).isDirectory(), true, 'cache directory dependency must commit before fetch');
  assert.equal((await lstat(state.destinationRoot)).isDirectory(), true, 'destination directory dependency must commit before fetch');
  assert.equal(await readFile(join(state.destinationRoot, 'fixture-tool'), 'utf8'), bytes.toString('utf8'));
  assert.equal(await readFile(join(state.cacheRoot, artifactSha256), 'utf8'), bytes.toString('utf8'));
  const installedInode = (await lstat(join(state.destinationRoot, 'fixture-tool'))).ino;

  const failingPreload = join(state.root, 'fetch-failure.mjs');
  await writeFile(failingPreload, `globalThis.fetch = async () => { throw new Error('unchanged execution must not fetch'); };\n`, { mode: 0o600 });
  const second = await invoke(state.root, 'fresh-second-run', {
    ...common, runId: 'fresh-artifact-second-run', command: 'run', approvedPlanDigest: plan.json.digest,
    renderer: 'json', stateRoot: state.stateRoot,
  }, { NODE_OPTIONS: `--import=${failingPreload}` });
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await lstat(join(state.destinationRoot, 'fixture-tool'))).ino, installedInode,
    'unchanged second run must neither fetch nor replace the installed artifact');
});

test('artifact preparation rejects surplus and unselected managed operations before candidate access', { skip: hostOs === 'win32' }, async t => {
  const state = await fixture(t);
  const authority = {
    loadPlan: state.loadPlan, items: [state.item], approvedLoadPlanDigest: state.loadPlan.digest,
    host: { os: hostOs, arch: hostArch }, cacheRoot: state.cacheRoot,
    destinationRoots: { 'user-bin': state.destinationRoot },
  };
  const derived = (await invoke(state.root, 'derive-closure', { schemaVersion: 1, command: 'artifact-derive', ...authority })).json.artifacts[0];
  const operations = Object.fromEntries(Object.entries(derived.operations).map(([phase, operation]) => [`artifact-${phase}`, operation]));
  operations.surplus = { ...derived.operations.check, action: 'check' };
  const task = {
    schemaVersion: 1, id: 'artifact.fixture-tool', inputDigest: digest('closure-task'), dependencies: [], predicate: 'supported',
    operations: { check: 'artifact-check', apply: 'artifact-apply', verify: 'artifact-verify' }, timeoutMs: 5_000,
    retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
    privilege: 'user', network: 'none', consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
    compensation: 'configuration', failurePolicy: 'abort-run', requiredCapabilities: [],
  };
  const facts = {
    schemaVersion: 1, hostId: 'artifact-closure-host', collectedAt: '2026-11-06T00:00:00.000Z', os: hostOs,
    osVersion: 'fixture', arch: hostArch, environment: 'native', roles: [], packageManagers: [], capabilities: [],
  };
  const result = await invoke(state.root, 'surplus', {
    schemaVersion: 1, command: 'artifact-prepare', runId: 'artifact-closure-run', releaseId: 'release-1', facts,
    desiredState: { schemaVersion: 1, revision: 'closure', hostId: facts.hostId, packages: [], services: [], consents: [], offline: true },
    plan: { tasks: [task], selectedTaskIds: [task.id] }, operations, ...authority,
    approvedPlanDigest: 'a'.repeat(64), offline: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unreferenced managed artifact operation|surplus managed artifact operation/i);
  await assert.rejects(readFile(derived.candidatePath), error => error.code === 'ENOENT');
});
