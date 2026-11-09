import assert from 'node:assert/strict';
import test from 'node:test';
import { AdoptionPlanSchema, buildAdoptionPlan } from '../dist/index.js';

const digest = character => character.repeat(64);
const resource = (resourceId, values = {}) => ({
  schemaVersion: 1, resourceId, effect: 'configuration', target: `/etc/${resourceId}.conf`,
  ownership: 'unowned', desiredDigest: digest('a'), observedState: 'present', observedDigest: digest('a'), userData: 'absent', ...values,
});
const input = resources => ({ schemaVersion: 1, hostId: 'fixture-host', profileRevision: 'revision-one', resources });

test('classifies preexisting state without mutation or implicit ownership transfer', () => {
  const plan = buildAdoptionPlan(input([
    resource('existing-match'),
    resource('missing', { observedState: 'absent', observedDigest: null }),
    resource('drifted', { observedDigest: digest('b') }),
    resource('managed', { ownership: 'installer-owned' }),
    resource('user-owned', { ownership: 'user-owned' }),
    resource('user-data', { effect: 'user-data', ownership: 'user-owned', userData: 'present' }),
    resource('storage', { effect: 'storage' }),
  ]));
  assert.equal(plan.executable, false);
  assert.equal(plan.transfersOwnership, false);
  assert.deepEqual(plan.observedResourceIds, ['existing-match']);
  assert.deepEqual(plan.plannedCreateResourceIds, ['missing']);
  assert.deepEqual(plan.reviewResourceIds, ['drifted']);
  assert.deepEqual(plan.alreadyManagedResourceIds, ['managed']);
  assert.deepEqual(plan.preservedResourceIds, ['storage', 'user-data', 'user-owned']);
  assert.equal(plan.items.find(item => item.resourceId === 'existing-match').reason, 'matching-preexisting-state');
  AdoptionPlanSchema.parse(plan);
});

test('is deterministic regardless of discovery order', () => {
  const values = [resource('second'), resource('first', { observedState: 'absent', observedDigest: null })];
  const first = buildAdoptionPlan(input(values));
  const second = buildAdoptionPlan(input([...values].reverse()));
  assert.equal(first.digest, second.digest);
  assert.equal(first.planId, second.planId);
  assert.deepEqual(first.items, second.items);
});

test('preserves incomplete, ambiguous, and modified state for explicit review', () => {
  const plan = buildAdoptionPlan(input([
    resource('unknown-owner', { ownership: 'unknown' }),
    resource('missing-authority', { desiredDigest: null }),
    resource('unreadable', { observedState: 'unreadable', observedDigest: null }),
    resource('modified-managed', { ownership: 'installer-owned', observedDigest: digest('b') }),
  ]));
  assert.deepEqual(plan.preservedResourceIds, ['unknown-owner']);
  assert.deepEqual(plan.reviewResourceIds, ['missing-authority', 'modified-managed', 'unreadable']);
  assert.equal(plan.items.find(item => item.resourceId === 'missing-authority').reason, 'evidence-incomplete');
  assert.equal(plan.items.find(item => item.resourceId === 'modified-managed').reason, 'state-differs');
});

test('rejects duplicates, unknown fields, unsafe targets, and malformed evidence', () => {
  const duplicate = resource('same');
  assert.throws(() => buildAdoptionPlan(input([duplicate, duplicate])), /duplicate adoption resource/);
  assert.throws(() => buildAdoptionPlan({ ...input([]), surprise: true }));
  assert.throws(() => buildAdoptionPlan(input([resource('unsafe', { target: '/etc/value\nother' })])), /unsafe text/);
  assert.throws(() => buildAdoptionPlan(input([resource('digest', { observedDigest: 'not-a-digest' })])));
  assert.throws(() => buildAdoptionPlan(input([resource('ambiguous-absence', { observedDigest: null })])), /require a digest/);
});
