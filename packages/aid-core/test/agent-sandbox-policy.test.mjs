import assert from 'node:assert/strict'; import test from 'node:test';
import { compileAgentSandboxPolicy, evaluateAgentSandbox } from '../dist/agent-sandbox-policy.js';
const rule = (effect, values, reason) => ({ effect, values, reason });
const policy = { schemaVersion: 1, policyId: 'policy-1', taskId: 'task-1', autoMode: true, maxSteps: 20, maxCostMicros: 1000, maxSubagents: 2,
  filesystem: { read: [rule('allow', ['/workspace/**'], 'task workspace'), rule('deny', ['/workspace/.env'], 'secret file')], write: [rule('allow', ['/workspace/output/**'], 'output only')] },
  commands: [rule('allow', ['git status'], 'read-only git'), rule('deny', ['*'], 'unreviewed command')], network: [rule('allow', ['docs.example.com'], 'documentation')],
  tools: [rule('allow', ['read-file'], 'reader')], skills: [rule('allow', ['terminal-development'], 'task skill')],
  secrets: [rule('allow', ['api-token'], 'exact task secret'), rule('deny', ['recovery-root'], 'recovery isolation')] };
test('explicit deny wins over allow even in auto mode', () => {
  assert.equal(evaluateAgentSandbox(policy, { kind: 'filesystem-read', value: '/workspace/.env' }).decision, 'deny');
  assert.deepEqual(evaluateAgentSandbox(policy, { kind: 'command', value: 'git status' }), { decision: 'deny', reason: 'explicit-deny', contributingRules: ['unreviewed command'] });
});
test('task policy compilation is deterministic and preserves every authority dimension', () => {
  assert.deepEqual(compileAgentSandboxPolicy(policy), compileAgentSandboxPolicy(structuredClone(policy)));
  assert.deepEqual(Object.keys(compileAgentSandboxPolicy(policy).filesystem).sort(), ['read', 'write']);
});
test('all declared authority dimensions are bounded and default deny', () => {
  for (const request of [{ kind: 'filesystem-read', value: '/workspace/src/index.ts' }, { kind: 'filesystem-write', value: '/workspace/output/result.json' }, { kind: 'network', value: 'docs.example.com' }, { kind: 'tool', value: 'read-file' }, { kind: 'skill', value: 'terminal-development' }, { kind: 'secret', value: 'api-token' }]) assert.equal(evaluateAgentSandbox(policy, request).decision, 'allow');
  assert.equal(evaluateAgentSandbox(policy, { kind: 'network', value: 'evil.example' }).reason, 'default-deny'); assert.equal(evaluateAgentSandbox(policy, { kind: 'secret', value: 'recovery-root' }).decision, 'deny');
});
test('steps, cost, and subagents cannot exceed the compiled task budget', () => {
  assert.equal(evaluateAgentSandbox(policy, { kind: 'step', value: 20 }).decision, 'allow'); assert.equal(evaluateAgentSandbox(policy, { kind: 'step', value: 21 }).decision, 'deny');
  assert.equal(evaluateAgentSandbox(policy, { kind: 'cost', value: 1001 }).decision, 'deny'); assert.equal(evaluateAgentSandbox(policy, { kind: 'subagent', value: 3 }).decision, 'deny');
});
test('strict contracts reject ambiguous policy and traversal', () => {
  assert.throws(() => evaluateAgentSandbox({ ...policy, extra: true }, { kind: 'tool', value: 'read-file' }), /unrecognized/i);
  assert.throws(() => evaluateAgentSandbox(policy, { kind: 'filesystem-read', value: '/workspace/../secret' }), /normalized/);
  assert.throws(() => evaluateAgentSandbox(policy, { kind: 'tool', value: 'read-file', autoApprove: true }), /unrecognized/i);
});
