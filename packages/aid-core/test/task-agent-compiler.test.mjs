import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedTaskAgentPlanDigest, compileTaskAgents } from '../dist/task-agent-compiler.js';
import { evaluateAgentSandbox } from '../dist/agent-sandbox-policy.js';

const task = {
  taskId: 'inventory-docs', agent: { id: 'inventory-docs-agent', role: 'researcher' },
  prompt: { system: 'Use only admitted sources and tools.', objective: 'Summarize the approved inventory.', contextRefs: ['inventory-v3'] },
  tools: [{ id: 'read-file', contractVersion: 1, purpose: 'Read admitted inventory files.' }],
  skills: [{ id: 'terminal-development', repository: 'heymegabyte/agent-skills', commit: 'a'.repeat(40) }],
  modelPolicy: { gateway: 'projectsites', preferredRoute: 'economy', allowedRoutes: ['economy'], allowPremium: false, maxModelCalls: 4 },
  context: { refs: ['inventory-v3'], maxTokens: 8_000, maxBytes: 100_000, maxItems: 20 },
  recording: { required: true, outputOnly: true, encrypted: true, encryptionKeyRef: 'recording-key', retentionDays: 30 },
  budgets: { maxSteps: 40, maxCostMicros: 50_000, maxSubagents: 0, maxWallClockSeconds: 300, maxToolCalls: 25 },
  authority: {
    filesystemRead: ['/workspace/inventory/**'], filesystemWrite: ['/workspace/output/**'], commands: [], networkHosts: ['docs.example.com'],
    toolIds: ['read-file'], skillIds: ['terminal-development'], secretRefs: ['recording-key'],
    denied: { filesystemRead: ['/workspace/inventory/private/**'], filesystemWrite: [], commands: [], networkHosts: [], toolIds: [], skillIds: [], secretRefs: ['recovery-root'] },
  },
};

async function plan(overrides = {}) {
  const unsigned = { schemaVersion: 1, planId: 'plan-7', tasks: [structuredClone(task)], ...overrides };
  return { ...unsigned, planDigest: await approvedTaskAgentPlanDigest(unsigned) };
}

test('approved plan deterministically generates every task-specific runtime dimension', async () => {
  const approved = await plan(); const first = await compileTaskAgents(approved); const second = await compileTaskAgents(structuredClone(approved));
  assert.deepEqual(first, second); assert.equal(first.length, 1); const compiled = first[0];
  assert.deepEqual(compiled.agent, task.agent); assert.deepEqual(compiled.prompt.contextRefs, ['inventory-v3']);
  assert.deepEqual(compiled.tools.map(value => value.id), ['read-file']); assert.deepEqual(compiled.skills.map(value => value.id), ['terminal-development']);
  assert.deepEqual(compiled.modelPolicy, task.modelPolicy); assert.deepEqual(compiled.context, task.context);
  assert.deepEqual(compiled.recording, task.recording); assert.deepEqual(compiled.budgets, task.budgets);
  assert.deepEqual(compiled.inheritance, { environment: 'none', credentials: 'none', tools: 'none', skills: 'none', context: 'none' });
});

test('compiled runtime has no inherited ambient authority', async () => {
  const approved = await plan(); process.env.DESKTOP_TOOLS_AMBIENT_SECRET = 'must-not-be-read'; const before = await compileTaskAgents(approved);
  process.env.DESKTOP_TOOLS_AMBIENT_SECRET = 'changed'; const after = await compileTaskAgents(approved); delete process.env.DESKTOP_TOOLS_AMBIENT_SECRET;
  assert.deepEqual(after, before); const policy = before[0].sandboxPolicy;
  for (const request of [
    { kind: 'filesystem-read', value: '/home/operator/.ssh/id_ed25519' }, { kind: 'filesystem-write', value: '/workspace/source.ts' },
    { kind: 'command', value: 'bash' }, { kind: 'network', value: 'metadata.google.internal' }, { kind: 'tool', value: 'shell' },
    { kind: 'skill', value: 'architect' }, { kind: 'secret', value: 'controller-root' }, { kind: 'subagent', value: 1 },
  ]) assert.equal(evaluateAgentSandbox(policy, request).decision, 'deny', JSON.stringify(request));
  assert.equal(evaluateAgentSandbox(policy, { kind: 'filesystem-read', value: '/workspace/inventory/private/a' }).reason, 'explicit-deny');
  assert.equal(evaluateAgentSandbox(policy, { kind: 'tool', value: 'read-file' }).decision, 'allow');
});

test('compiler rejects plan tampering and ambient-authority-shaped input', async () => {
  const approved = await plan(); approved.tasks[0].budgets.maxSteps += 1;
  await assert.rejects(() => compileTaskAgents(approved), /digest does not match/);
  const withAmbient = await plan(); withAmbient.ambientAuthority = { inheritEnvironment: true };
  await assert.rejects(() => compileTaskAgents(withAmbient), /unrecognized/i);
});

test('compiler rejects authority not exactly derived from task declarations', async () => {
  for (const mutate of [
    value => { value.authority.toolIds = []; }, value => { value.authority.skillIds = []; }, value => { value.context.refs = ['other-context']; },
    value => { value.modelPolicy.allowedRoutes = ['code']; }, value => { value.authority.secretRefs = []; },
  ]) {
    const changed = structuredClone(task); mutate(changed); const unsigned = { schemaVersion: 1, planId: 'plan-bad', tasks: [changed] };
    const planDigest = await approvedTaskAgentPlanDigest(unsigned);
    await assert.rejects(() => compileTaskAgents({ ...unsigned, planDigest }));
  }
});

test('generated sandbox enforces task budgets', async () => {
  const [compiled] = await compileTaskAgents(await plan());
  assert.equal(evaluateAgentSandbox(compiled.sandboxPolicy, { kind: 'step', value: 40 }).decision, 'allow');
  assert.equal(evaluateAgentSandbox(compiled.sandboxPolicy, { kind: 'step', value: 41 }).decision, 'deny');
  assert.equal(evaluateAgentSandbox(compiled.sandboxPolicy, { kind: 'cost', value: 50_001 }).decision, 'deny');
});
