import assert from 'node:assert/strict';
import test from 'node:test';
import { ProvisioningSessionEventSchema, reduceProvisioningSessionEvents } from '../dist/session-events.js';

const d = character => character.repeat(64);
const at = '2026-11-08T12:00:00.000Z';
const supervisor = { kind: 'supervisor', id: 'supervisor-one', parentId: null };
const engine = { kind: 'engine', id: 'engine-one', parentId: 'session-one' };
const child = id => ({ kind: 'agent', id, parentId: 'session-one' });
const base = (sequence, producer = supervisor) => ({
  schemaVersion: 1, sequence, at, sessionId: 'session-one', runId: 'run-one', authorizationId: 'authorization-one', producer,
});

function completeStream() {
  return [
    { ...base(0), kind: 'session-status', status: 'started' },
    { ...base(1), kind: 'plan', planDigest: d('a'), profileRevision: 'revision-one', diffDigest: d('b') },
    { ...base(2), kind: 'diff', planDigest: d('a'), diffDigest: d('b'), additions: 2, changes: 1, removals: 0 },
    { ...base(3), kind: 'approval', approvalId: 'approval-one', planDigest: d('a'), status: 'requested', actorId: null },
    { ...base(4), kind: 'approval', approvalId: 'approval-one', planDigest: d('a'), status: 'approved', actorId: 'owner-one' },
    { ...base(5, child('child-one')), kind: 'child-agent', childSessionId: 'child-one', parentSessionId: 'session-one',
      taskId: 'research-one', status: 'started', resultDigest: null },
    { ...base(6, child('child-two')), kind: 'child-agent', childSessionId: 'child-two', parentSessionId: 'session-one',
      taskId: 'research-two', status: 'started', resultDigest: null },
    { ...base(7, child('child-two')), kind: 'output', sourceId: 'child-two', sourceSequence: 0, stream: 'stdout', text: 'second child first' },
    { ...base(8, child('child-one')), kind: 'output', sourceId: 'child-one', sourceSequence: 0, stream: 'stdout', text: 'first child first' },
    { ...base(9, child('child-one')), kind: 'output', sourceId: 'child-one', sourceSequence: 1, stream: 'status', text: 'first child second' },
    { ...base(10, child('child-two')), kind: 'child-agent', childSessionId: 'child-two', parentSessionId: 'session-one',
      taskId: 'research-two', status: 'succeeded', resultDigest: d('2') },
    { ...base(11, child('child-one')), kind: 'child-agent', childSessionId: 'child-one', parentSessionId: 'session-one',
      taskId: 'research-one', status: 'succeeded', resultDigest: d('1') },
    { ...base(12, engine), kind: 'engine-event', event: {
      schemaVersion: 1, sequence: 0, at, runId: 'run-one', kind: 'run-status', status: 'started',
    } },
    { ...base(13, child('child-one')), kind: 'cost', provider: 'projectsites', model: 'deepseek-code',
      inputTokens: 100, outputTokens: 20, costMicrousd: 42 },
    { ...base(14), kind: 'verification', planDigest: d('a'), status: 'started', evidenceDigest: null },
    { ...base(15), kind: 'verification', planDigest: d('a'), status: 'passed', evidenceDigest: d('e') },
    { ...base(16), kind: 'terminal', status: 'verified-success', planDigest: d('a'), evidenceDigest: d('e'), nextAction: null },
  ];
}

test('correlates parallel children, approval, plan, diff, engine events, cost, verification, and terminal status', () => {
  const summary = reduceProvisioningSessionEvents(completeStream());
  assert.deepEqual(summary.childStatuses, { 'child-one': 'succeeded', 'child-two': 'succeeded' });
  assert.deepEqual(summary.approvalStatuses, { 'approval-one': 'approved' });
  assert.equal(summary.totalInputTokens, 100);
  assert.equal(summary.totalOutputTokens, 20);
  assert.equal(summary.totalCostMicrousd, 42);
  assert.equal(summary.outputGapCount, 0);
  assert.equal(summary.verificationStatus, 'passed');
  assert.equal(summary.terminalStatus, 'verified-success');
});

test('strict schemas reject unknown fields, unbounded data, and invalid explicit gaps', () => {
  assert.throws(() => ProvisioningSessionEventSchema.parse({ ...completeStream()[0], surprise: true }), /unrecognized_keys/i);
  assert.throws(() => ProvisioningSessionEventSchema.parse({ ...base(0), kind: 'output', sourceId: 'supervisor-one',
    sourceSequence: 0, stream: 'stdout', text: 'x'.repeat(16_385) }));
  assert.throws(() => ProvisioningSessionEventSchema.parse({ ...base(0), kind: 'output-gap', sourceId: 'supervisor-one',
    fromSourceSequence: 4, throughSourceSequence: 3, reason: 'transport' }), /cannot end before/i);
});

test('detects global, embedded-engine, and per-source sequence gaps without confusing parallel output', () => {
  const global = completeStream(); global[8] = { ...global[8], sequence: 99 };
  assert.throws(() => reduceProvisioningSessionEvents(global), /session event sequence gap/);
  const engineGap = completeStream(); engineGap[12] = { ...engineGap[12], event: { ...engineGap[12].event, sequence: 1 } };
  assert.throws(() => reduceProvisioningSessionEvents(engineGap), /embedded engine event sequence gap/);
  const outputGap = completeStream(); outputGap[9] = { ...outputGap[9], sourceSequence: 2 };
  assert.throws(() => reduceProvisioningSessionEvents(outputGap), /output sequence gap for child-one/);
});

test('accepts explicit bounded output loss but forces an incomplete-evidence terminal outcome', () => {
  const stream = completeStream();
  stream.splice(9, 0, { ...base(9, child('child-one')), kind: 'output-gap', sourceId: 'child-one',
    fromSourceSequence: 1, throughSourceSequence: 3, reason: 'backpressure' });
  for (let index = 10; index < stream.length; index += 1) stream[index] = { ...stream[index], sequence: index };
  const laterOutput = stream.find(event => event.kind === 'output' && event.sourceId === 'child-one' && event.text === 'first child second');
  laterOutput.sourceSequence = 4;
  const terminal = stream.at(-1);
  terminal.status = 'incomplete-evidence'; terminal.evidenceDigest = null;
  const summary = reduceProvisioningSessionEvents(stream);
  assert.equal(summary.outputGapCount, 3);
  assert.equal(summary.terminalStatus, 'incomplete-evidence');
  terminal.status = 'verified-success'; terminal.evidenceDigest = d('e');
  assert.throws(() => reduceProvisioningSessionEvents(stream), /complete evidence/);
});

test('rejects uncorrelated children, output, approvals, terminal success, denial, and cancellation', () => {
  const childParent = completeStream(); childParent[5] = { ...childParent[5], parentSessionId: 'other-session' };
  assert.throws(() => reduceProvisioningSessionEvents(childParent), /invalid parent correlation/);
  const producer = completeStream(); producer[7] = { ...producer[7], producer: child('child-one') };
  assert.throws(() => reduceProvisioningSessionEvents(producer), /does not match its source/);
  const approval = completeStream(); approval[3] = { ...approval[3], planDigest: d('c') };
  assert.throws(() => reduceProvisioningSessionEvents(approval), /approval is not bound/);
  const evidence = completeStream(); evidence.at(-1).evidenceDigest = d('f');
  assert.throws(() => reduceProvisioningSessionEvents(evidence), /matching passed verification/);
  const cancellation = completeStream(); cancellation.at(-1).status = 'cancellation'; cancellation.at(-1).evidenceDigest = null;
  assert.throws(() => reduceProvisioningSessionEvents(cancellation), /requires cancellation evidence/);
  const denial = completeStream(); denial.at(-1).status = 'denial'; denial.at(-1).evidenceDigest = null;
  assert.throws(() => reduceProvisioningSessionEvents(denial), /requires denied approval evidence/);
});

test('requires all child and approval lifecycles to close before terminal status', () => {
  const child = completeStream(); child.splice(10, 1); for (let index = 10; index < child.length; index += 1) child[index] = { ...child[index], sequence: index };
  assert.throws(() => reduceProvisioningSessionEvents(child), /running child/);
  const approval = completeStream(); approval.splice(4, 1); for (let index = 4; index < approval.length; index += 1) approval[index] = { ...approval[index], sequence: index };
  assert.throws(() => reduceProvisioningSessionEvents(approval), /undecided approval/);
});

test('requires one rooted supervisor and one stable attributable engine producer', () => {
  const root = completeStream(); root[0] = { ...root[0], producer: engine };
  assert.throws(() => reduceProvisioningSessionEvents(root), /rooted by a supervisor/);
  const parent = completeStream(); parent[12] = { ...parent[12], producer: { ...engine, parentId: 'other-session' } };
  assert.throws(() => reduceProvisioningSessionEvents(parent), /not attributable/);
});
