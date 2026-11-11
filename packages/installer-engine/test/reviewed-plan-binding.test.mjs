import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReviewedPlanBindingSchema,
  admitReviewedPlan,
  createReviewedPlanBinding,
} from '../dist/reviewed-plan-binding.js';

const d = character => character.repeat(64);
const rollbackLimits = {
  automaticEffects: ['configuration'],
  separatelyApprovedEffects: ['external-provider', 'network', 'operating-system', 'package', 'storage'],
  destructiveAutomaticRepair: false,
};
const unsigned = {
  schemaVersion: 1,
  reviewId: 'review-1',
  tenantId: 'tenant-1',
  profile: { id: 'profile-1', revision: 'revision-7', digest: d('1') },
  host: { id: 'host-1', factsDigest: d('2') },
  release: { id: 'release-1', manifestDigest: d('3') },
  policyDigest: d('4'),
  normalizedPlanDigest: d('5'),
  operationClosureDigest: d('6'),
  approvalSetDigest: d('7'),
  rollbackLimits,
  reviewedBy: 'owner-1',
  reviewedAt: '2026-11-10T12:00:00.000Z',
  expiresAt: '2026-11-10T12:10:00.000Z',
};
const binding = createReviewedPlanBinding(unsigned);
const current = {
  tenantId: unsigned.tenantId,
  profile: unsigned.profile,
  host: unsigned.host,
  release: unsigned.release,
  policyDigest: unsigned.policyDigest,
  normalizedPlanDigest: unsigned.normalizedPlanDigest,
  operationClosureDigest: unsigned.operationClosureDigest,
  approvalSetDigest: unsigned.approvalSetDigest,
  rollbackLimits,
  now: '2026-11-10T12:05:00.000Z',
};

test('one immutable review binds profile, facts, release, policy, closure, approvals, and rollback limits', () => {
  assert.deepEqual(admitReviewedPlan(binding, current), {
    decision: 'allow', reason: 'exact-reviewed-plan', reviewId: binding.reviewId,
    bindingDigest: binding.bindingDigest,
  });
  assert.equal(createReviewedPlanBinding(unsigned).bindingDigest, binding.bindingDigest);
  assert.throws(() => ReviewedPlanBindingSchema.parse({ ...binding, policyDigest: d('8') }), /binding digest/);
  assert.throws(() => ReviewedPlanBindingSchema.parse({ ...binding, unreviewedAuthority: true }), /unrecognized/i);
});

test('every safety-relevant drift invalidates the review with an exact reason', () => {
  const cases = [
    ['review-expired', { now: binding.expiresAt }],
    ['tenant-changed', { tenantId: 'tenant-2' }],
    ['profile-changed', { profile: { ...current.profile, revision: 'revision-8' } }],
    ['host-identity-changed', { host: { ...current.host, id: 'host-2' } }],
    ['host-facts-changed', { host: { ...current.host, factsDigest: d('8') } }],
    ['release-changed', { release: { ...current.release, manifestDigest: d('8') } }],
    ['policy-changed', { policyDigest: d('8') }],
    ['plan-changed', { normalizedPlanDigest: d('8') }],
    ['operation-closure-changed', { operationClosureDigest: d('8') }],
    ['approvals-changed', { approvalSetDigest: d('8') }],
    ['rollback-limits-changed', { rollbackLimits: { ...rollbackLimits, automaticEffects: [] } }],
  ];
  for (const [reason, change] of cases) {
    assert.deepEqual(admitReviewedPlan(binding, { ...current, ...change }).reason, reason);
  }
});

test('rollback review cannot authorize destructive or non-configuration automatic effects', () => {
  for (const changed of [
    { automaticEffects: ['configuration', 'package'] },
    { separatelyApprovedEffects: ['external-provider', 'network', 'operating-system', 'storage'] },
    { destructiveAutomaticRepair: true },
    { automaticEffects: ['package', 'configuration'] },
  ]) assert.throws(() => createReviewedPlanBinding({ ...unsigned,
    rollbackLimits: { ...rollbackLimits, ...changed },
  }), /rollback|configuration|literal|sorted/i);
});
