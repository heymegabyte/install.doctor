import assert from 'node:assert/strict';
import test from 'node:test';
import { planStagedDriftRepair } from '../dist/index.js';

const d = character => character.repeat(64);
const base = (id, changes = {}) => ({
  id, cohort: 'canary', dependencies: [], effect: 'configuration', observedDigest: d('a'), desiredDigest: d('b'),
  rollbackEvidenceDigest: d('c'), exception: null, ...changes,
});
const input = items => ({
  schemaVersion: 1, evaluatedAt: '2026-11-10T12:00:00.000Z', cohortOrder: ['canary', 'stable'],
  approvedConfigurationIds: items.filter(item => item.effect === 'configuration').map(item => item.id), priorOutcomes: [], items,
});

test('repairs only the active cohort and binds automatic configuration repair to rollback evidence', () => {
  const items = [base('canary-config'), base('stable-config', { cohort: 'stable' })];
  const decision = planStagedDriftRepair(input(items));
  assert.equal(decision.activeCohort, 'canary');
  assert.equal(decision.items.find(item => item.id === 'canary-config').disposition, 'automatic-repair');
  assert.equal(decision.items.find(item => item.id === 'stable-config').disposition, 'later-cohort');
  const noRollback = structuredClone(input([base('no-rollback', { rollbackEvidenceDigest: null })]));
  assert.equal(planStagedDriftRepair(noRollback).items[0].disposition, 'manual-approval');
});

test('intentional exceptions are honored only until their explicit expiry', () => {
  const excepted = base('excepted', { exception: { id: 'maintenance', reason: 'operator-owned local setting', expiresAt: '2026-11-11T12:00:00.000Z' } });
  assert.equal(planStagedDriftRepair(input([excepted])).items[0].disposition, 'intentional-exception');
  const expired = { ...excepted, exception: { ...excepted.exception, expiresAt: '2026-11-10T11:59:59.000Z' } };
  assert.equal(planStagedDriftRepair(input([expired])).items[0].disposition, 'automatic-repair');
});

test('dependency failure stops its dependent while unrelated approved repair proceeds', () => {
  const items = [base('base'), base('dependent', { dependencies: ['base'] }), base('unrelated')];
  const plan = input(items); plan.priorOutcomes = [{ itemId: 'base', outcome: 'failed' }];
  const decision = planStagedDriftRepair(plan);
  assert.equal(decision.items.find(item => item.id === 'dependent').disposition, 'blocked-dependency');
  assert.equal(decision.items.find(item => item.id === 'unrelated').disposition, 'automatic-repair');
});

test('access and destructive repair always remain outside automatic authorization', () => {
  const items = [base('access', { effect: 'access', rollbackEvidenceDigest: null }), base('delete', { effect: 'destructive', rollbackEvidenceDigest: null })];
  const plan = input(items); plan.approvedConfigurationIds = ['access', 'delete'];
  const decision = planStagedDriftRepair(plan);
  assert.deepEqual(decision.items.map(item => item.disposition), ['manual-approval', 'manual-approval']);
  assert.ok(decision.items.every(item => item.rollbackEvidenceDigest === null));
});

test('strict planner rejects cycles, unknown cohorts, and nonconfiguration rollback claims', () => {
  assert.throws(() => planStagedDriftRepair(input([base('a', { dependencies: ['b'] }), base('b', { dependencies: ['a'] })])), /cycle/);
  assert.throws(() => planStagedDriftRepair(input([base('unknown', { cohort: 'other' })])), /cohort/);
  assert.throws(() => planStagedDriftRepair(input([base('package', { effect: 'package' })])), /rollback evidence/);
});
