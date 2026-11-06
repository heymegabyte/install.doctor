import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  InstallerEventSchema,
  InstallerOperationError,
  TerminalReceiptSchema,
  applyConfigurationTransaction,
  createInstallerEngine,
  createJournalStore,
  createRendererSession,
  renderInstallerResult,
  reduceInstallerEvents,
  semanticInstallerResult,
} from '../dist/index.js';

const digest = character => character.repeat(64);
const facts = {
  schemaVersion: 1, hostId: 'fixture-host', collectedAt: '2026-11-06T00:00:00.000Z',
  os: 'darwin', osVersion: '15.7', arch: 'arm64', environment: 'native',
  roles: ['workstation'], packageManagers: ['brew'], capabilities: ['network'],
};
const desired = {
  schemaVersion: 1, revision: 'revision-1', hostId: 'fixture-host', packages: ['git'],
  services: [], consents: ['network'], offline: false,
};
const task = {
  schemaVersion: 1, id: 'package.git', inputDigest: digest('b'), dependencies: [],
  predicate: 'host-supported', operations: { check: 'git-check', apply: 'git-apply', verify: 'git-verify' },
  timeoutMs: 10_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: true }, privilege: 'user', network: 'required',
  consent: 'network', lockDomains: ['package-manager.brew'], cleanup: 'always', compensation: 'none',
};
const plan = {
  schemaVersion: 1, planId: 'plan-1', digest: digest('c'), releaseId: 'release-1',
  desiredRevision: desired.revision, hostFactsDigest: digest('d'), createdAt: '2026-11-06T00:00:02.000Z',
  tasks: [task], selectedTaskIds: [task.id],
};
const planDraft = { tasks: [task], selectedTaskIds: [task.id] };

function harness(overrides = {}) {
  const calls = [];
  let tick = 0;
  const adapter = {
    discover: async () => { calls.push('discover'); return facts; },
    plan: async () => { calls.push('plan'); return planDraft; },
    check: async () => { calls.push('check'); return 'needed'; },
    apply: async () => { calls.push('apply'); },
    verify: async () => { calls.push('verify'); return 'verified'; },
    ...overrides,
  };
  const engine = createInstallerEngine({
    adapter,
    now: () => new Date(Date.UTC(2026, 10, 6, 0, 0, tick++)).toISOString(),
  });
  return { calls, engine };
}

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

async function eventually(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    // Yield across an actual event-loop turn. A tight setImmediate-only loop
    // can exhaust all attempts before Node 24 advances pending filesystem and
    // module work on loaded Linux runners, producing false scheduler failures.
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function runApproved(engine, request, options) {
  const approvedPlan = await engine.plan(facts, request.desiredState, request.releaseId);
  return engine.run({ ...request, approvedPlanDigest: approvedPlan.digest }, options);
}

test('runs one deterministic renderer-neutral lifecycle', async () => {
  const { calls, engine } = harness();
  const result = await runApproved(engine, { runId: 'run-1', releaseId: 'release-1', desiredState: desired });
  assert.deepEqual(calls, ['plan', 'discover', 'plan', 'check', 'apply', 'verify']);
  assert.deepEqual(result.phaseOrder, ['discover', 'validate', 'plan', 'approve', 'apply', 'verify', 'record']);
  assert.match(result.plan.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.taskStatuses[task.id], 'verified');
  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.status, 'success');
  assert.ok(result.events.every(event => InstallerEventSchema.safeParse(event).success));
  assert.deepEqual(result.events.map(event => event.sequence), result.events.map((_, index) => index));
  TerminalReceiptSchema.parse(result.receipt);
});

test('online output evidence is bounded while terminal capacity is preserved', async () => {
  const { engine } = harness({
    apply: async (_node, context) => {
      for (let index = 0; index < 6_000; index += 1) context.output('stdout', `bounded-line-${index}`);
    },
  });
  const result = await runApproved(engine, { runId: 'run-output-budget', releaseId: 'release-1', desiredState: desired });
  const output = result.events.filter(event => event.kind === 'output');
  assert.equal(output.length, 5_001);
  assert.equal(output.filter(event => event.line.includes('output truncated')).length, 1);
  assert.deepEqual(result.events.map(event => event.sequence), result.events.map((_, index) => index));
  assert.equal(result.events.at(-1).kind, 'run-status');
  assert.equal(result.events.at(-1).status, 'success');
  assert.equal(result.receipt.status, 'success');
});

test('unchanged apply verifies without mutation', async () => {
  const state = harness();
  state.engine = createInstallerEngine({
    adapter: {
      discover: async () => { state.calls.push('discover'); return facts; },
      plan: async () => { state.calls.push('plan'); return planDraft; },
      check: async () => { state.calls.push('check'); return 'verified'; },
      apply: async () => { state.calls.push('apply'); },
      verify: async () => { state.calls.push('verify'); return 'verified'; },
    },
    now: (() => { let tick = 0; return () => new Date(Date.UTC(2026, 10, 6, 1, 0, tick++)).toISOString(); })(),
  });
  const result = await runApproved(state.engine, { runId: 'run-2', releaseId: 'release-1', desiredState: desired });
  assert.equal(state.calls.includes('apply'), false);
  assert.equal(result.taskStatuses[task.id], 'verified');
});

test('required reboot is a truthful resumable boundary and never mutates', async () => {
  const { calls, engine } = harness({
    check: async () => { calls.push('check'); return 'reboot-required'; },
    apply: async () => assert.fail('reboot boundary cannot apply'),
    verify: async () => assert.fail('reboot boundary cannot verify before restart'),
  });
  const result = await runApproved(engine, {
    runId: 'run-reboot-required', releaseId: 'release-1', desiredState: desired,
  });
  assert.deepEqual(calls, ['plan', 'discover', 'plan', 'check']);
  assert.equal(result.taskStatuses[task.id], 'pending-reboot');
  assert.equal(result.receipt.taskCounts.pending, 1);
  assert.equal(result.receipt.status, 'pending-reboot');
  assert.equal(result.exitCode, 5);
  assert.equal(result.receipt.nextAction, 'Reboot the host, then rerun the same approved desired state to verify convergence.');
  assert.ok(result.events.some(event => event.kind === 'task-status' && event.status === 'pending-reboot'));
  TerminalReceiptSchema.parse(result.receipt);
});

test('approval denial and invalid desired state cannot mutate', async () => {
  const denied = harness();
  const deniedResult = await denied.engine.run({ runId: 'run-3', releaseId: 'release-1', desiredState: desired, approvedPlanDigest: null });
  assert.equal(denied.calls.includes('apply'), false);
  assert.equal(deniedResult.receipt.status, 'rejected');
  assert.equal(deniedResult.exitCode, 3);
  const stale = harness();
  const staleResult = await stale.engine.run({ runId: 'run-stale-approval', releaseId: 'release-1', desiredState: desired, approvedPlanDigest: digest('f') });
  assert.equal(stale.calls.includes('apply'), false);
  assert.equal(staleResult.receipt.status, 'rejected');
  assert.equal(staleResult.exitCode, 3);
  assert.match(staleResult.receipt.nextAction, /exact normalized plan digest/);
  const invalid = harness();
  await assert.rejects(invalid.engine.run({ runId: 'run-4', releaseId: 'release-1', desiredState: { ...desired, unknown: true }, approvedPlanDigest: digest('a') }));
  assert.deepEqual(invalid.calls, []);
});

test('status is read-only and truthfully reports pending work', async () => {
  const { calls, engine } = harness();
  const normalized = await engine.plan(facts, desired, 'release-1');
  await assert.rejects(
    engine.status({ runId: 'run-5-rejected', plan: normalized, approvedPlanDigest: digest('f') }),
    /exact normalized plan approval authority/,
  );
  calls.length = 0;
  const result = await engine.status({ runId: 'run-5', plan: normalized, approvedPlanDigest: normalized.digest });
  assert.deepEqual(calls, ['check']);
  assert.equal(result.taskStatuses[task.id], 'pending');
  assert.equal(result.receipt.status, 'pending-verification');
  assert.notEqual(result.exitCode, 0);
});

test('status never creates or refreshes journal ownership or evidence', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'install-doctor-status-readonly-'));
  const stateRoot = join(parent, 'must-not-exist');
  const journal = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'status-process',
  });
  const { engine: base } = harness();
  const engine = createInstallerEngine({
    journal,
    adapter: {
      discover: async () => facts,
      plan: async () => planDraft,
      check: async () => 'needed',
      apply: async () => assert.fail('status cannot apply'),
      verify: async () => assert.fail('status cannot verify'),
    },
  });
  const normalized = await base.plan(facts, desired, 'release-1');
  const result = await engine.status({ runId: 'status-readonly', plan: normalized, approvedPlanDigest: normalized.digest });
  assert.equal(result.receipt.status, 'pending-verification');
  await assert.rejects(stat(stateRoot), error => error.code === 'ENOENT');
});

test('plan identity is stable across observation timestamps and renderer choices', async () => {
  const first = harness();
  const second = harness({ discover: async () => ({ ...facts, collectedAt: '2026-11-06T09:10:11.000Z' }) });
  const left = await first.engine.plan(facts, desired, 'release-1');
  const right = await second.engine.plan({ ...facts, collectedAt: '2026-11-06T09:10:11.000Z' }, desired, 'release-1');
  assert.equal(left.digest, right.digest);
  assert.equal(left.planId, right.planId);
  assert.deepEqual(left.selectedTaskIds, right.selectedTaskIds);
});

test('plan identity binds every semantic desired-state field', async () => {
  const { engine } = harness();
  const baseline = await engine.plan(facts, desired, 'release-1');
  for (const changed of [
    { ...desired, packages: ['git', 'jq'] },
    { ...desired, services: ['alloy'] },
    { ...desired, consents: ['network', 'telemetry'] },
  ]) {
    const candidate = await engine.plan(facts, changed, 'release-1');
    assert.notEqual(candidate.digest, baseline.digest);
    assert.notEqual(candidate.planId, baseline.planId);
  }
  const offlineTask = { ...task, network: 'none', resources: { ...task.resources, network: false }, consent: 'none' };
  const offlineEngine = harness({ plan: async () => ({ tasks: [offlineTask], selectedTaskIds: [offlineTask.id] }) }).engine;
  const online = await offlineEngine.plan(facts, desired, 'release-1');
  const offline = await offlineEngine.plan(facts, { ...desired, offline: true }, 'release-1');
  assert.notEqual(offline.digest, online.digest);
});

test('planning rejects duplicate tasks, unknown dependencies, and cycles before operations', async () => {
  const variants = [
    { tasks: [task, { ...task }], selectedTaskIds: [task.id] },
    { tasks: [{ ...task, dependencies: ['missing.task'] }], selectedTaskIds: [task.id] },
    {
      tasks: [
        { ...task, id: 'task.a', dependencies: ['task.b'] },
        { ...task, id: 'task.b', dependencies: ['task.a'] },
      ],
      selectedTaskIds: ['task.a', 'task.b'],
    },
  ];
  for (const draft of variants) {
    const state = harness({ plan: async () => draft });
    await assert.rejects(state.engine.plan(facts, desired, 'release-1'));
    assert.equal(state.calls.includes('check'), false);
    assert.equal(state.calls.includes('apply'), false);
  }
});

test('planning rejects missing capabilities, consent, offline network, and impossible resources', async () => {
  const cases = [
    { node: { ...task, requiredCapabilities: ['gpu'] }, facts, desired },
    { node: { ...task, consent: 'destructive-storage' }, facts, desired },
    { node: task, facts, desired: { ...desired, offline: true } },
    { node: { ...task, resources: { ...task.resources, memoryMiB: 65 } }, facts, desired },
  ];
  for (const [index, fixture] of cases.entries()) {
    const engine = createInstallerEngine({
      resourceLimits: { cpu: 4, memoryMiB: 64, networkConcurrency: 2 },
      adapter: {
        discover: async () => fixture.facts,
        plan: async () => ({ tasks: [fixture.node], selectedTaskIds: [fixture.node.id] }),
        check: async () => { assert.fail(`case ${index} reached check`); },
        apply: async () => { assert.fail(`case ${index} reached apply`); },
        verify: async () => { assert.fail(`case ${index} reached verify`); },
      },
    });
    await assert.rejects(engine.plan(fixture.facts, fixture.desired, 'release-1'));
  }
});

test('planning canonicalizes set-like discovery order', async () => {
  const secondTask = { ...task, id: 'package.jq', dependencies: ['package.git'], lockDomains: ['z.lock', 'a.lock'] };
  const left = harness({ plan: async () => ({ tasks: [secondTask, task], selectedTaskIds: [secondTask.id, task.id] }) });
  const right = harness({ plan: async () => ({
    tasks: [task, { ...secondTask, dependencies: [...secondTask.dependencies].reverse(), lockDomains: [...secondTask.lockDomains].reverse() }],
    selectedTaskIds: [task.id, secondTask.id],
  }) });
  const leftPlan = await left.engine.plan({ ...facts, roles: ['z', 'a'], capabilities: ['z', 'a'] }, { ...desired, packages: ['jq', 'git'] }, 'release-1');
  const rightPlan = await right.engine.plan({ ...facts, roles: ['a', 'z'], capabilities: ['a', 'z'] }, { ...desired, packages: ['git', 'jq'] }, 'release-1');
  assert.equal(leftPlan.digest, rightPlan.digest);
  assert.deepEqual(leftPlan.tasks.map(node => node.id), ['package.git', 'package.jq']);
  assert.deepEqual(leftPlan.selectedTaskIds, ['package.git', 'package.jq']);
});

test('engine rejects configured scheduler authority that conflicts with a declared plan policy', async () => {
  const engine = createInstallerEngine({
    maxConcurrency: 1,
    resourceLimits: { cpu: 2, memoryMiB: 128, networkConcurrency: 1 },
    adapter: {
      discover: async () => facts,
      plan: async () => ({
        tasks: [task], selectedTaskIds: [task.id],
        executionPolicy: { maxConcurrency: 2, resourceLimits: { cpu: 2, memoryMiB: 128, networkConcurrency: 1 } },
      }),
      check: async () => 'verified', apply: async () => {}, verify: async () => 'verified',
    },
  });
  await assert.rejects(engine.plan(facts, desired, 'release-1'), /do not match the plan-bound execution policy/);
});

test('scheduler bounds concurrency and serializes overlapping lock domains', async () => {
  const gates = new Map([['task.a', deferred()], ['task.b', deferred()], ['task.c', deferred()]]);
  const started = [];
  let active = 0;
  let maxActive = 0;
  const tasks = [
    { ...task, id: 'task.a', lockDomains: ['package-manager'] },
    { ...task, id: 'task.b', lockDomains: ['package-manager'] },
    { ...task, id: 'task.c', lockDomains: ['download'] },
  ];
  const engine = createInstallerEngine({
    maxConcurrency: 2,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async node => {
        started.push(node.id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gates.get(node.id).promise;
        active -= 1;
      },
      verify: async () => 'verified',
    },
  });
  const run = runApproved(engine, { runId: 'run-scheduler', releaseId: 'release-1', desiredState: desired });
  await eventually(() => started.length === 2, 'two disjoint tasks should start');
  assert.deepEqual(started, ['task.a', 'task.c']);
  assert.equal(maxActive, 2);
  gates.get('task.c').resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.includes('task.b'), false, 'shared lock remains held by task.a');
  gates.get('task.a').resolve();
  await eventually(() => started.includes('task.b'), 'task.b should start after lock release');
  gates.get('task.b').resolve();
  const result = await run;
  assert.equal(result.receipt.status, 'success');
  assert.equal(maxActive, 2);
  const lockEvents = result.events.filter(event => event.kind === 'lock' && event.state !== 'waiting');
  assert.equal(lockEvents.filter(event => event.state === 'acquired').length, 3);
  assert.equal(lockEvents.filter(event => event.state === 'released').length, 3);
});

test('scheduler admission respects aggregate CPU and memory budgets', async () => {
  const gates = new Map([['task.a', deferred()], ['task.b', deferred()], ['task.c', deferred()]]);
  const started = [];
  const tasks = ['task.a', 'task.b', 'task.c'].map(id => ({ ...task, id, lockDomains: [], resources: { cpu: 1, memoryMiB: 32, network: false } }));
  const engine = createInstallerEngine({
    maxConcurrency: 3,
    resourceLimits: { cpu: 2, memoryMiB: 64, networkConcurrency: 0 },
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async node => { started.push(node.id); await gates.get(node.id).promise; },
      verify: async () => 'verified',
    },
  });
  const run = runApproved(engine, { runId: 'run-resources', releaseId: 'release-1', desiredState: desired });
  await eventually(() => started.length === 2, 'resource limits should admit exactly two tasks');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, 2);
  gates.get(started[0]).resolve();
  await eventually(() => started.length === 3, 'third task should enter after resources are released');
  for (const gate of gates.values()) gate.resolve();
  assert.equal((await run).receipt.status, 'success');
});

test('adaptive admission reduces concurrency under bounded host pressure and emits evidence', async () => {
  const gates = new Map([['task.a', deferred()], ['task.b', deferred()], ['task.c', deferred()]]);
  const started = [];
  const tasks = ['task.a', 'task.b', 'task.c'].map((id, index) => ({
    ...task, id, lockDomains: [], resources: { cpu: 1, memoryMiB: 16, network: index > 0 },
  }));
  const engine = createInstallerEngine({
    maxConcurrency: 3,
    resourcePressureSampler: {
      sample: async () => ({
        cpuUtilization: 0.91, memoryUtilization: 0.82, ioUtilization: 0.8, thermalState: 'serious',
        powerSource: 'battery', batteryLevel: 0.15, meteredNetwork: true,
      }),
    },
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async node => { started.push(node.id); await gates.get(node.id).promise; },
      verify: async () => 'verified',
    },
  });
  const run = runApproved(engine, { runId: 'run-adaptive-pressure', releaseId: 'release-1', desiredState: desired });
  await eventually(() => started.length === 1, 'pressure policy should admit one task');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['task.a']);
  gates.get('task.a').resolve();
  await eventually(() => started.length === 2, 'second task should enter after the first completes');
  gates.get('task.b').resolve();
  await eventually(() => started.length === 3, 'third task should enter after the second completes');
  gates.get('task.c').resolve();
  const result = await run;
  assert.equal(result.receipt.status, 'success');
  const adjustments = result.events.filter(event => event.kind === 'output' && event.line.startsWith('[admission-adjustment]'));
  assert.ok(adjustments.length >= 1);
  assert.match(adjustments[0].line, /cpu-critical/);
  assert.match(adjustments[0].line, /memory-high/);
  assert.match(adjustments[0].line, /thermal-serious/);
  assert.match(adjustments[0].line, /io-high/);
  assert.match(adjustments[0].line, /battery-low/);
  assert.match(adjustments[0].line, /metered-network/);
});

test('resource pressure samples are strict and rejected before task admission', async () => {
  let applied = false;
  const engine = createInstallerEngine({
    resourcePressureSampler: { sample: async () => ({ cpuUtilization: 2, unknown: true }) },
    adapter: {
      discover: async () => facts,
      plan: async () => planDraft,
      check: async () => 'needed',
      apply: async () => { applied = true; },
      verify: async () => 'verified',
    },
  });
  await assert.rejects(runApproved(engine, { runId: 'run-invalid-pressure', releaseId: 'release-1', desiredState: desired }));
  assert.equal(applied, false);
});

test('resource pressure sampling is time bounded before admission', async () => {
  let applied = false;
  const engine = createInstallerEngine({
    resourcePressureSampleTimeoutMs:10,
    resourcePressureSampler:{ sample:async () => new Promise(() => {}) },
    adapter:{
      discover:async () => facts,
      plan:async () => planDraft,
      check:async () => 'needed',
      apply:async () => { applied = true; },
      verify:async () => 'verified',
    },
  });
  await assert.rejects(runApproved(engine, {runId:'run-pressure-timeout',releaseId:'release-1',desiredState:desired}), /timed out/);
  assert.equal(applied, false);
});

test('metered pressure admits local work while serializing network work', async () => {
  const gates = new Map([['task.local', deferred()], ['task.net-a', deferred()], ['task.net-b', deferred()]]);
  const started = [];
  const tasks = [
    { ...task, id:'task.local', lockDomains:[], resources:{cpu:1,memoryMiB:16,network:false} },
    { ...task, id:'task.net-a', lockDomains:[], resources:{cpu:1,memoryMiB:16,network:true} },
    { ...task, id:'task.net-b', lockDomains:[], resources:{cpu:1,memoryMiB:16,network:true} },
  ];
  const engine = createInstallerEngine({
    maxConcurrency:3,
    resourcePressureSampler:{ sample:async () => ({ cpuUtilization:0.1, memoryUtilization:0.1, ioUtilization:0.1, thermalState:'nominal', powerSource:'ac', batteryLevel:null, meteredNetwork:true }) },
    adapter:{
      discover:async () => facts,
      plan:async () => ({tasks,selectedTaskIds:tasks.map(node => node.id)}),
      check:async () => 'needed',
      apply:async node => { started.push(node.id); await gates.get(node.id).promise; },
      verify:async () => 'verified',
    },
  });
  const run = runApproved(engine, {runId:'run-metered',releaseId:'release-1',desiredState:desired});
  await eventually(() => started.length === 2, 'local and one network task should start');
  assert.deepEqual(started, ['task.local','task.net-a']);
  gates.get('task.net-a').resolve();
  await eventually(() => started.includes('task.net-b'), 'second network task starts after network capacity is released');
  gates.get('task.local').resolve();
  gates.get('task.net-b').resolve();
  const result = await run;
  assert.equal(result.receipt.status, 'success');
  assert.equal(result.events.filter(event => event.kind === 'output' && event.line.includes('metered-network')).length, 1);
});

test('failed dependency blocks descendants while an unrelated branch completes', async () => {
  const tasks = [
    { ...task, id: 'task.fail' },
    { ...task, id: 'task.blocked', dependencies: ['task.fail'] },
    { ...task, id: 'task.safe' },
  ];
  const applied = [];
  const engine = createInstallerEngine({
    maxConcurrency: 2,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async node => {
        applied.push(node.id);
        if (node.id === 'task.fail') throw new Error('fixture failure');
      },
      verify: async () => 'verified',
    },
  });
  const result = await runApproved(engine, { runId: 'run-blocking', releaseId: 'release-1', desiredState: desired });
  assert.deepEqual(applied.sort(), ['task.fail', 'task.safe']);
  assert.equal(result.taskStatuses['task.fail'], 'failed');
  assert.equal(result.taskStatuses['task.blocked'], 'blocked');
  assert.equal(result.taskStatuses['task.safe'], 'verified');
  assert.equal(result.receipt.status, 'failed');
});

test('abort-run failure policy interrupts siblings and stops unrelated admission', async () => {
  const slowEntered = deferred();
  const applied = [];
  const tasks = [
    { ...task, id: 'task.abort', lockDomains: [], failurePolicy: 'abort-run' },
    { ...task, id: 'task.running', lockDomains: [] },
    { ...task, id: 'task.zz-not-admitted', lockDomains: [] },
  ];
  const engine = createInstallerEngine({
    maxConcurrency: 2,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async (node, context) => {
        applied.push(node.id);
        if (node.id === 'task.abort') {
          await slowEntered.promise;
          throw new Error('abort the run');
        }
        if (node.id === 'task.running') {
          slowEntered.resolve();
          await new Promise((_, reject) => context.signal.addEventListener(
            'abort',
            () => reject(new InstallerOperationError('policy abort', 'cancelled')),
            { once: true },
          ));
        }
      },
      verify: async () => 'verified',
    },
  });
  const result = await runApproved(engine, { runId: 'run-abort-policy', releaseId: 'release-1', desiredState: desired });
  assert.deepEqual(applied.sort(), ['task.abort', 'task.running']);
  assert.equal(result.taskStatuses['task.abort'], 'failed');
  assert.equal(result.taskStatuses['task.running'], 'interrupted');
  assert.equal(result.taskStatuses['task.zz-not-admitted'], 'blocked');
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.exitCode, 7);
});

test('retry policy is typed, bounded, and cleanup runs exactly once', async () => {
  let attempts = 0;
  let cleanups = 0;
  const delays = [];
  const retryTask = {
    ...task,
    id: 'task.retry',
    retry: { class: 'transient', maxAttempts: 3, backoffMs: 25 },
  };
  const engine = createInstallerEngine({
    sleep: async milliseconds => { delays.push(milliseconds); },
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [retryTask], selectedTaskIds: [retryTask.id] }),
      check: async () => 'needed',
      apply: async () => {
        attempts += 1;
        if (attempts < 3) throw new InstallerOperationError('temporary fixture failure', 'transient');
      },
      verify: async () => 'verified',
      cleanup: async () => { cleanups += 1; },
    },
  });
  const result = await runApproved(engine, { runId: 'run-retry', releaseId: 'release-1', desiredState: desired });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [25, 50]);
  assert.equal(cleanups, 1);
  assert.equal(result.taskStatuses[retryTask.id], 'verified');
  assert.deepEqual(
    result.events.filter(event => event.kind === 'task-status' && event.status === 'retrying').map(event => event.attempt),
    [1, 2],
  );
});

test('cancellation stops admission, interrupts running work, cleans up, and returns exit 130', async () => {
  const entered = deferred();
  const controller = new AbortController();
  const applied = [];
  let cleanups = 0;
  const tasks = [
    { ...task, id: 'task.a' },
    { ...task, id: 'task.b' },
    { ...task, id: 'task.c', dependencies: ['task.a'] },
  ];
  const engine = createInstallerEngine({
    maxConcurrency: 1,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks, selectedTaskIds: tasks.map(node => node.id) }),
      check: async () => 'needed',
      apply: async (node, context) => {
        applied.push(node.id);
        entered.resolve();
        await new Promise((_, reject) => context.signal.addEventListener(
          'abort',
          () => reject(new InstallerOperationError('cancelled fixture', 'cancelled')),
          { once: true },
        ));
      },
      verify: async () => 'verified',
      cleanup: async () => { cleanups += 1; },
    },
  });
  const run = runApproved(engine,
    { runId: 'run-cancel', releaseId: 'release-1', desiredState: desired },
    { signal: controller.signal },
  );
  await entered.promise;
  controller.abort(new Error('test cancellation'));
  const result = await run;
  assert.deepEqual(applied, ['task.a']);
  assert.equal(cleanups, 1);
  assert.equal(result.taskStatuses['task.a'], 'interrupted');
  assert.equal(result.taskStatuses['task.b'], 'interrupted');
  assert.equal(result.taskStatuses['task.c'], 'interrupted');
  assert.equal(result.receipt.status, 'cancelled');
  assert.equal(result.exitCode, 130);
  assert.equal(result.events.at(-1).status, 'cancelled');
});

test('journaled cancellation remains resumable and rechecks postconditions before mutation', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-cancel-resume-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
    isProcessAlive: async () => false,
  });
  const entered = deferred();
  const controller = new AbortController();
  let installed = false;
  let applies = 0;
  const adapter = {
    discover: async () => facts,
    plan: async () => planDraft,
    check: async () => installed ? 'verified' : 'needed',
    apply: async (_node, context) => {
      applies += 1;
      installed = true;
      entered.resolve();
      await new Promise((_, reject) => context.signal.addEventListener(
        'abort', () => reject(new InstallerOperationError('cancelled after mutation', 'cancelled')), { once: true },
      ));
    },
    verify: async () => installed ? 'verified' : 'pending',
  };
  const first = createInstallerEngine({ adapter, journal: store });
  const approved = await first.plan(facts, desired, 'release-1');
  const running = first.run({
    runId: 'cancel-resume', releaseId: 'release-1', desiredState: desired, approvedPlanDigest: approved.digest,
  }, { signal: controller.signal });
  await entered.promise;
  controller.abort(new Error('fixture interruption'));
  const cancelled = await running;
  assert.equal(cancelled.receipt.status, 'cancelled');
  assert.equal((await store.inspectCompletion('cancel-resume', approved.digest)).authority, 'uncommitted');

  const resumedEngine = createInstallerEngine({ adapter, journal: store });
  const resumed = await resumedEngine.run({
    runId: 'cancel-resume', releaseId: 'release-1', desiredState: desired,
    approvedPlanDigest: approved.digest, resume: true,
  });
  assert.equal(resumed.receipt.status, 'success');
  assert.equal(applies, 1, 'resume must re-check and not replay a mutation whose postcondition already holds');
  assert.equal((await store.inspectCompletion('cancel-resume', approved.digest)).authority, 'committed');
});

test('run finalizer executes after ordinary failure and gates terminal completion on verification', async () => {
  const ordinary = { ...task, id: 'task.failing', cleanup: 'none', failurePolicy: 'continue-independent' };
  const finalizer = {
    ...task, id: 'task.finalizer', dependencies: [ordinary.id], cleanup: 'none', lifecycle: 'run-finalizer',
    network: 'none', consent: 'none', resources: { ...task.resources, network: false },
  };
  const calls = [];
  const engine = createInstallerEngine({
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [ordinary, finalizer], selectedTaskIds: [ordinary.id, finalizer.id] }),
      check: async node => { calls.push(`check:${node.id}`); return 'needed'; },
      apply: async node => {
        calls.push(`apply:${node.id}`);
        if (node.id === ordinary.id) throw new Error('ordinary failure');
      },
      verify: async node => { calls.push(`verify:${node.id}`); return 'verified'; },
    },
  });
  const result = await runApproved(engine, { runId: 'run-finalizer-failure', releaseId: 'release-1', desiredState: desired });
  assert.equal(result.taskStatuses[ordinary.id], 'failed');
  assert.equal(result.taskStatuses[finalizer.id], 'verified');
  assert.equal(result.receipt.status, 'failed');
  assert.ok(result.events.some(event => event.kind === 'output'
    && event.taskId === ordinary.id && event.stream === 'stderr'
    && event.line === '[operation-failed] ordinary failure'));
  assert.deepEqual(calls, [
    `check:${ordinary.id}`, `apply:${ordinary.id}`,
    `check:${finalizer.id}`, `apply:${finalizer.id}`, `verify:${finalizer.id}`,
  ]);
});

test('planning rejects an ordinary task that depends on a run finalizer', async () => {
  const finalizer = { ...task, id: 'task.invalid-finalizer', lifecycle: 'run-finalizer' };
  const ordinary = { ...task, id: 'task.invalid-dependent', dependencies: [finalizer.id], cleanup: 'none' };
  const engine = createInstallerEngine({
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [ordinary, finalizer], selectedTaskIds: [ordinary.id, finalizer.id] }),
      check: async () => 'verified', apply: async () => {}, verify: async () => 'verified',
    },
  });
  await assert.rejects(engine.plan(facts, desired, 'release-1'), /ordinary task cannot depend on run finalizer/);
});

test('run finalizer survives user cancellation and persists verified cleanup evidence', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-finalizer-cancel-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-finalizer-cancel', processStart: 'process-finalizer-cancel',
    isProcessAlive: async () => false,
  });
  const ordinary = { ...task, id: 'task.cancelled-effect', cleanup: 'none' };
  const finalizer = {
    ...task, id: 'task.cancel-finalizer', dependencies: [ordinary.id], cleanup: 'none', lifecycle: 'run-finalizer',
    network: 'none', consent: 'none', resources: { ...task.resources, network: false },
  };
  const entered = deferred();
  const controller = new AbortController();
  let finalized = false;
  const engine = createInstallerEngine({
    journal: store,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [ordinary, finalizer], selectedTaskIds: [ordinary.id, finalizer.id] }),
      check: async node => node.id === finalizer.id ? (finalized ? 'verified' : 'needed') : 'needed',
      apply: async (node, context) => {
        if (node.id === finalizer.id) { assert.equal(context.signal.aborted, false); finalized = true; return; }
        entered.resolve();
        await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(
          new InstallerOperationError('cancelled fixture', 'cancelled'),
        ), { once: true }));
      },
      verify: async () => 'verified',
    },
  });
  const request = { runId: 'run-finalizer-cancel', releaseId: 'release-1', desiredState: desired };
  const run = runApproved(engine, request, { signal: controller.signal });
  await entered.promise;
  controller.abort(new Error('test cancellation'));
  const result = await run;
  assert.equal(result.receipt.status, 'cancelled');
  assert.equal(result.taskStatuses[ordinary.id], 'interrupted');
  assert.equal(result.taskStatuses[finalizer.id], 'verified');
  assert.equal(finalized, true);
  assert.equal((await store.inspectCompletion(request.runId, result.plan.digest)).authority, 'uncommitted');
  const listed = await store.listRuns();
  assert.equal(listed[0].taskCounts.interrupted, 1);
  assert.equal(listed[0].taskCounts.verified, 1);
});

test('failed run finalizer remains exact uncommitted evidence and resume rechecks it before commit', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-finalizer-resume-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-finalizer', processStart: 'process-finalizer',
    isProcessAlive: async () => false,
  });
  const ordinary = { ...task, id: 'task.effect', cleanup: 'none' };
  const finalizer = {
    ...task, id: 'task.effect-finalizer', dependencies: [ordinary.id], cleanup: 'none', lifecycle: 'run-finalizer',
    network: 'none', consent: 'none', resources: { ...task.resources, network: false },
  };
  let effectApplied = false;
  let effectApplyCount = 0;
  let finalizerApplyCount = 0;
  let failFinalizer = true;
  const engine = createInstallerEngine({
    journal: store,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [ordinary, finalizer], selectedTaskIds: [ordinary.id, finalizer.id] }),
      check: async node => node.id === ordinary.id
        ? (effectApplied ? 'verified' : 'needed')
        : 'needed',
      apply: async node => {
        if (node.id === ordinary.id) { effectApplied = true; effectApplyCount += 1; }
        else { finalizerApplyCount += 1; if (failFinalizer) throw new Error('cleanup boundary interruption'); }
      },
      verify: async () => 'verified',
    },
  });
  const request = { runId: 'run-finalizer-resume', releaseId: 'release-1', desiredState: desired };
  const first = await runApproved(engine, request);
  assert.equal(first.taskStatuses[ordinary.id], 'verified');
  assert.equal(first.taskStatuses[finalizer.id], 'failed');
  assert.equal((await store.inspectCompletion(request.runId, first.plan.digest)).authority, 'uncommitted');
  const listed = await store.listRuns();
  assert.equal(listed[0].resumeCandidate, true);
  assert.equal(listed[0].taskCounts.verified, 1);
  assert.equal(listed[0].taskCounts.failed, 1);

  failFinalizer = false;
  const resumed = await engine.run({
    ...request, approvedPlanDigest: first.plan.digest, resume: true,
  });
  assert.equal(resumed.receipt.status, 'success');
  assert.equal(effectApplyCount, 1, 'resume must recheck and not replay the ordinary effect');
  assert.equal(finalizerApplyCount, 2, 'resume retries only after a fresh finalizer check');
  assert.equal((await store.inspectCompletion(request.runId, first.plan.digest)).authority, 'committed');
});

test('resume recognizes a landed finalizer effect when interruption preceded its verified checkpoint', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-finalizer-postapply-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-finalizer-postapply', processStart: 'process-finalizer-postapply',
    isProcessAlive: async () => false,
  });
  const ordinary = { ...task, id: 'task.postapply-effect', cleanup: 'none' };
  const finalizer = {
    ...task, id: 'task.postapply-finalizer', dependencies: [ordinary.id], cleanup: 'none', lifecycle: 'run-finalizer',
    network: 'none', consent: 'none', resources: { ...task.resources, network: false },
  };
  let ordinaryApplied = false;
  let finalized = false;
  let finalizerApplyCount = 0;
  let interruptVerification = true;
  const engine = createInstallerEngine({
    journal: store,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [ordinary, finalizer], selectedTaskIds: [ordinary.id, finalizer.id] }),
      check: async node => node.id === ordinary.id
        ? (ordinaryApplied ? 'verified' : 'needed')
        : (finalized ? 'verified' : 'needed'),
      apply: async node => {
        if (node.id === ordinary.id) ordinaryApplied = true;
        else { finalized = true; finalizerApplyCount += 1; }
      },
      verify: async node => {
        if (node.id === finalizer.id && interruptVerification) throw new Error('interrupted after cleanup mutation');
        return 'verified';
      },
    },
  });
  const request = { runId: 'run-finalizer-postapply', releaseId: 'release-1', desiredState: desired };
  const first = await runApproved(engine, request);
  assert.equal(first.taskStatuses[finalizer.id], 'failed');
  assert.equal(finalized, true);
  assert.equal((await store.inspectCompletion(request.runId, first.plan.digest)).authority, 'uncommitted');

  interruptVerification = false;
  const resumed = await engine.run({ ...request, approvedPlanDigest: first.plan.digest, resume: true });
  assert.equal(resumed.receipt.status, 'success');
  assert.equal(finalizerApplyCount, 1, 'landed cleanup must be recognized by check and never replayed');
  assert.equal(resumed.taskStatuses[finalizer.id], 'verified');
  assert.equal((await store.inspectCompletion(request.runId, first.plan.digest)).authority, 'committed');
});

test('a new run revalidates an unchanged verified task without duplicate mutation', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-engine-resume-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
    isProcessAlive: async () => false,
  });
  let needed = true;
  let applies = 0;
  const adapter = {
    discover: async () => facts,
    plan: async () => planDraft,
    check: async () => needed ? 'needed' : 'verified',
    apply: async () => { applies += 1; needed = false; },
    verify: async () => 'verified',
  };
  const first = createInstallerEngine({ adapter, journal: store });
  const firstResult = await runApproved(first, { runId: 'run-resume', releaseId: 'release-1', desiredState: desired });
  assert.equal(firstResult.receipt.status, 'success');
  assert.equal(applies, 1);
  assert.ok(firstResult.receipt.evidencePaths.every(path => path.startsWith(stateRoot)));
  for (const path of firstResult.receipt.evidencePaths) await readFile(path);
  const eventPath = firstResult.receipt.evidencePaths.find(path => path.endsWith('.ndjson'));
  assert.ok(eventPath);
  const persistedEvents = (await readFile(eventPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(persistedEvents, firstResult.events);

  const second = createInstallerEngine({ adapter, journal: store });
  const secondResult = await runApproved(second, { runId: 'run-reapply', releaseId: 'release-1', desiredState: desired });
  assert.equal(secondResult.receipt.status, 'success');
  assert.equal(applies, 1, 'unchanged reapply must re-check but never duplicate mutation');
  assert.equal(secondResult.taskStatuses[task.id], 'verified');
});

test('configuration tasks durably register compensation before activation', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-engine-config-state-'));
  const configRoot = await realpath(await mkdtemp(join(tmpdir(), 'install-doctor-engine-config-target-')));
  await chmod(stateRoot, 0o700);
  const target = join(configRoot, 'service.conf');
  await writeFile(target, 'old\n', { mode: 0o640 });
  const configurationTask = { ...task, id: 'config.service', compensation: 'configuration' };
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
    isProcessAlive: async () => false,
  });
  const engine = createInstallerEngine({
    journal: store,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [configurationTask], selectedTaskIds: [configurationTask.id] }),
      check: async () => 'needed',
      apply: async (node, context) => {
        await applyConfigurationTransaction({
          spec: { schemaVersion: 1, taskId: node.id, targetPath: target, effect: 'installer-configuration', dependencies: node.dependencies },
          candidateBytes: Buffer.from('new\n'),
          hooks: {
            validateCandidate: async path => assert.equal(await readFile(path, 'utf8'), 'new\n'),
            verifyPostcondition: async path => await readFile(path, 'utf8') === 'new\n',
          },
          persistence: context.configurationCompensation,
        });
      },
      verify: async () => await readFile(target, 'utf8') === 'new\n' ? 'verified' : 'pending',
    },
  });
  const result = await runApproved(engine, { runId: 'run-config', releaseId: 'release-1', desiredState: desired });
  assert.equal(result.receipt.status, 'success');
  const artifacts = await store.readCompensations('run-config', result.plan.digest);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].record.taskId, configurationTask.id);
  assert.equal(artifacts[0].record.state, 'available');
  assert.equal(Buffer.from(artifacts[0].bytesBase64, 'base64').toString('utf8'), 'old\n');
  assert.equal((await store.inspectCompletion('run-config', result.plan.digest)).authority, 'committed');
  const compensationRoot = join(stateRoot, 'runs', result.plan.digest, 'run-config', 'compensations');
  const [artifactName] = await readdir(compensationRoot);
  await writeFile(join(compensationRoot, artifactName), '{}\n', { mode: 0o600 });
  assert.equal((await store.inspectCompletion('run-config', result.plan.digest)).authority, 'corrupt');
});

test('configuration tasks fail before apply without durable journal compensation', async () => {
  let applied = false;
  const configurationTask = { ...task, id: 'config.no-journal', compensation: 'configuration' };
  const engine = createInstallerEngine({
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [configurationTask], selectedTaskIds: [configurationTask.id] }),
      check: async () => 'needed',
      apply: async () => { applied = true; },
      verify: async () => 'verified',
    },
  });
  const result = await runApproved(engine, { runId: 'run-config-no-journal', releaseId: 'release-1', desiredState: desired });
  assert.equal(applied, false);
  assert.equal(result.taskStatuses[configurationTask.id], 'failed');
});

test('evidence persistence failure cannot publish terminal success', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-evidence-failure-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
    fault: async point => { if (point === 'after-events-sync') throw new Error('injected evidence failure'); },
  });
  const observed = [];
  const engine = createInstallerEngine({
    journal: store,
    adapter: {
      discover: async () => facts,
      plan: async () => planDraft,
      check: async () => 'verified',
      apply: async () => assert.fail('verified fixture cannot apply'),
      verify: async () => 'verified',
    },
  });
  await assert.rejects(
    runApproved(engine,
      { runId: 'run-evidence-failure', releaseId: 'release-1', desiredState: desired },
      event => observed.push(event),
    ),
    /injected evidence failure/,
  );
  assert.equal(observed.some(event => event.kind === 'run-status' && event.status === 'success'), false);
  await assert.rejects(stat(join(stateRoot, 'owner.json')), error => error.code === 'ENOENT');
});

test('postcommit lease cleanup failure cannot contradict durable and observer-visible success', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-postcommit-release-'));
  await chmod(stateRoot, 0o700);
  const store = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
  });
  let releaseAttempts = 0;
  const observed = [];
  const engine = createInstallerEngine({
    journal: {
      ...store,
      release: async () => { releaseAttempts += 1; throw new Error('injected lease cleanup failure'); },
    },
    sleep: async () => undefined,
    adapter: {
      discover: async () => facts,
      plan: async () => planDraft,
      check: async () => 'verified',
      apply: async () => assert.fail('verified fixture cannot apply'),
      verify: async () => 'verified',
    },
  });
  const result = await runApproved(engine,
    { runId: 'run-postcommit-release', releaseId: 'release-1', desiredState: desired },
    event => observed.push(event),
  );
  assert.equal(result.receipt.status, 'success');
  assert.equal(result.events.at(-1).status, 'success');
  assert.equal(observed.at(-1).status, 'success');
  assert.equal(releaseAttempts, 3);
  const commitPath = result.receipt.evidencePaths.find(path => path.endsWith('.commit.json'));
  assert.ok(commitPath);
  await readFile(commitPath);
});

test('resume reconciles interruption on either side of mutation without blind replay', async () => {
  for (const mutationLanded of [false, true]) {
    const stateRoot = await mkdtemp(join(tmpdir(), `install-doctor-crash-window-${mutationLanded}-`));
    await chmod(stateRoot, 0o700);
    let alive = true;
    let clock = Date.parse('2026-11-06T00:00:00.000Z');
    const store = createJournalStore({
      stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'crashed-process', pid: 4242,
      leaseMs: 1_000, now: () => new Date(clock).toISOString(), isProcessAlive: async () => alive,
    });
    const normalized = await harness().engine.plan(facts, desired, 'release-1');
    const crashed = await store.claim(`run-crash-${mutationLanded}`, normalized);
    await store.checkpoint(crashed.owner, {
      taskId: task.id, inputDigest: task.inputDigest, status: 'running', attempts: 1,
      updatedAt: new Date(clock).toISOString(),
    });
    alive = false;
    clock += 2_000;
    let installed = mutationLanded;
    let applies = 0;
    const engine = createInstallerEngine({
      journal: store,
      adapter: {
        discover: async () => facts,
        plan: async () => planDraft,
        check: async () => installed ? 'verified' : 'needed',
        apply: async () => { applies += 1; installed = true; },
        verify: async () => installed ? 'verified' : 'pending',
      },
    });
    const result = await runApproved(engine, {
      runId: `run-crash-${mutationLanded}`, releaseId: 'release-1', desiredState: desired, resume: true,
    });
    assert.equal(result.receipt.status, 'success');
    assert.equal(applies, mutationLanded ? 0 : 1, mutationLanded ? 'landed mutation must be verified, not replayed' : 'missing mutation must run exactly once');
  }
});

test('long engine runs renew their journal lease and stop heartbeating after cleanup', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'install-doctor-heartbeat-'));
  await chmod(stateRoot, 0o700);
  const durable = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'boot-one', processStart: 'process-one',
    leaseMs: 1_000, heartbeatIntervalMs: 20, isProcessAlive: async () => true,
  });
  let renewals = 0;
  const journal = {
    ...durable,
    renew: async owner => { renewals += 1; return durable.renew(owner); },
  };
  const engine = createInstallerEngine({
    journal,
    adapter: {
      discover: async () => facts,
      plan: async () => planDraft,
      check: async () => 'needed',
      apply: async () => { await new Promise(resolve => setTimeout(resolve, 90)); },
      verify: async () => 'verified',
    },
  });
  const result = await runApproved(engine, { runId: 'run-heartbeat', releaseId: 'release-1', desiredState: desired });
  assert.equal(result.receipt.status, 'success');
  assert.ok(renewals >= 2, `expected periodic renewals, observed ${renewals}`);
  const atCompletion = renewals;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(renewals, atCompletion, 'heartbeat continued after run cleanup');
});

test('all renderers project identical plan and terminal semantics', async () => {
  const { engine } = harness();
  const result = await runApproved(engine, { runId: 'run-6', releaseId: 'release-1', desiredState: desired });
  const expected = semanticInstallerResult(result);
  for (const mode of ['plain', 'json', 'ndjson', 'headless', 'ci', 'tui']) {
    const rendered = renderInstallerResult(result, mode);
    assert.deepEqual(rendered.semantic, expected, mode);
    assert.equal(rendered.exitCode, result.exitCode, mode);
    assert.ok(rendered.output.length > 0, mode);
  }
  const baselineMachine = renderInstallerResult(result, 'ndjson').output;
  const constrainedMachine = renderInstallerResult(result, 'ndjson', {
    width: 20, follow: false, logFilter: 'never-match', criticalTaskIds: [task.id], reducedMotion: true, color: false,
  }).output;
  assert.equal(constrainedMachine, baselineMachine, 'presentation preferences must not alter machine protocols');
});

test('streaming renderer emits attributable progress before execution completes without replay', async () => {
  const gate = deferred();
  const { engine } = harness({ apply: async (_task, context) => {
    context.output('stdout', 'live-output');
    await gate.promise;
  } });
  const chunks = [];
  const session = createRendererSession('ndjson', chunk => { chunks.push(chunk); return true; });
  const running = runApproved(engine,
    { runId: 'run-live-render', releaseId: 'release-1', desiredState: desired },
    { observer: event => session.onEvent(event) },
  );
  await eventually(() => chunks.some(chunk => chunk.includes('live-output')), 'renderer did not receive live task output');
  assert.equal(chunks.some(chunk => chunk.includes('"status":"success"')), false, 'run completed before the gate was released');
  gate.resolve();
  const result = await running;
  session.finish(result);
  assert.equal(chunks.length, result.events.length, 'finish must not replay streamed events');
  const parsed = chunks.map(chunk => JSON.parse(chunk));
  assert.ok(parsed.some(event => event.kind === 'output' && event.taskId === task.id && event.line === 'live-output'));
});

test('renderer backpressure detaches presentation without cancelling execution', async () => {
  const { engine } = harness();
  let writes = 0;
  const session = createRendererSession('plain', () => { writes += 1; return false; });
  const result = await runApproved(engine,
    { runId: 'run-render-backpressure', releaseId: 'release-1', desiredState: desired },
    { observer: event => session.onEvent(event) },
  );
  session.finish(result);
  assert.equal(session.detached, true);
  assert.equal(writes, 1, 'detached renderer must keep no growing output queue');
  assert.equal(result.receipt.status, 'success');
});

test('presentation failure is isolated from execution and evidence', async () => {
  let observations = 0;
  const { engine } = harness();
  const result = await runApproved(engine,
    { runId: 'run-7', releaseId: 'release-1', desiredState: desired },
    () => { observations += 1; throw new Error('renderer crashed'); },
  );
  assert.ok(observations > 0);
  assert.equal(result.receipt.status, 'success');
  assert.equal(result.exitCode, 0);
  assert.equal(result.rendererFailures, observations);
});

test('event reduction rejects gaps, post-terminal output, and falsified engine state', async () => {
  const { engine } = harness();
  const result = await runApproved(engine, { runId: 'run-8', releaseId: 'release-1', desiredState: desired });
  const gap = { ...result, events: result.events.map((event, index) => index === 1 ? { ...event, sequence: 99 } : event) };
  assert.throws(() => reduceInstallerEvents(gap), /sequence gap/);
  const afterTerminal = { ...result, events: [...result.events, { ...result.events[0], sequence: result.events.length }] };
  assert.throws(() => reduceInstallerEvents(afterTerminal), /follows the terminal/);
  const falsified = { ...result, taskStatuses: { [task.id]: 'failed' } };
  assert.throws(() => semanticInstallerResult(falsified), /disagree/);
});
