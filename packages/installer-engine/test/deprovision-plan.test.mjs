import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeprovisionPlanSchema,
  buildDeprovisionPlan,
} from '../dist/index.js';

const at = '2026-11-06T12:00:00.000Z';
const digest = character => character.repeat(64);

const owned = (resourceId, effect, target) => ({
  schemaVersion: 1,
  resourceId,
  effect,
  target,
  ownership: 'installer-owned',
  ownershipEvidence: {
    schemaVersion: 1,
    owner: 'install.doctor',
    sourceRunId: 'install-run',
    artifactDigest: digest('a'),
    appliedDigest: digest('b'),
  },
  observedDigest: digest('b'),
  userData: 'absent',
});

const input = resources => ({
  schemaVersion: 1,
  sourceRunId: 'install-run',
  sourcePlanDigest: digest('f'),
  resources,
});

test('builds a deterministic non-executing plan and preserves user data by default', () => {
  const resources = [
    owned('config.shell', 'configuration', '/home/fixture/.config/install-doctor/config.json'),
    owned('service.agent', 'service', 'install-doctor-agent.service'),
    owned('package.curl', 'package', 'curl'),
    owned('network.tunnel', 'network', 'cloudflared/install-doctor'),
    {
      schemaVersion: 1,
      resourceId: 'data.projects',
      effect: 'user-data',
      target: '/home/fixture/projects',
      ownership: 'user-owned',
      ownershipEvidence: null,
      observedDigest: null,
      userData: 'present',
    },
  ];
  const first = buildDeprovisionPlan(input(resources), () => at);
  const second = buildDeprovisionPlan(input([...resources].reverse()), () => '2026-11-06T13:00:00.000Z');

  assert.equal(first.digest, second.digest);
  assert.equal(first.planId, second.planId);
  assert.equal(first.executable, false);
  assert.equal(first.policy.preserveUserData, true);
  assert.deepEqual(first.eligibleResourceIds, ['config.shell', 'service.agent']);
  assert.deepEqual(first.refusedResourceIds, ['data.projects', 'network.tunnel', 'package.curl']);
  assert.equal(first.items.find(item => item.resourceId === 'config.shell').operation, 'preview-remove-managed-configuration');
  assert.equal(first.items.find(item => item.resourceId === 'service.agent').operation, 'preview-disable-managed-service');
  assert.equal(first.items.find(item => item.resourceId === 'package.curl').reason, 'effect-prohibited');
  assert.equal(first.items.find(item => item.resourceId === 'network.tunnel').reason, 'effect-prohibited');
  assert.equal(first.items.find(item => item.resourceId === 'data.projects').reason, 'user-data-preserved');
  DeprovisionPlanSchema.parse(first);
});

test('refuses unowned and unknown resources even when their effect would otherwise be eligible', () => {
  const plan = buildDeprovisionPlan(input([
    {
      schemaVersion: 1,
      resourceId: 'config.foreign',
      effect: 'configuration',
      target: '/etc/foreign.conf',
      ownership: 'unowned',
      ownershipEvidence: null,
      observedDigest: null,
      userData: 'absent',
    },
    {
      schemaVersion: 1,
      resourceId: 'service.uncertain',
      effect: 'service',
      target: 'uncertain.service',
      ownership: 'unknown',
      ownershipEvidence: null,
      observedDigest: null,
      userData: 'absent',
    },
  ]), () => at);

  assert.deepEqual(plan.eligibleResourceIds, []);
  assert.deepEqual(plan.refusedResourceIds, ['config.foreign', 'service.uncertain']);
  assert.ok(plan.items.every(item => item.disposition === 'refused' && item.reason === 'ownership-not-installer'));
});

test('rejects destructive policy, forged ownership evidence, duplicates, and unknown fields', () => {
  assert.throws(() => buildDeprovisionPlan({
    ...input([]),
    policy: { preserveUserData: false },
  }), /preserveUserData/i);
  assert.throws(() => buildDeprovisionPlan(input([{
    ...owned('config.forged', 'configuration', '/etc/install-doctor.conf'),
    ownershipEvidence: null,
  }])), /ownership evidence/i);
  assert.throws(() => buildDeprovisionPlan(input([{
    schemaVersion: 1,
    resourceId: 'config.foreign',
    effect: 'configuration',
    target: '/etc/foreign.conf',
    ownership: 'unowned',
    ownershipEvidence: owned('unused', 'configuration', '/tmp/unused').ownershipEvidence,
    observedDigest: null,
    userData: 'absent',
  }])), /ownership evidence/i);
  const duplicate = owned('config.same', 'configuration', '/etc/install-doctor.conf');
  assert.throws(() => buildDeprovisionPlan(input([duplicate, duplicate])), /duplicate resource identifier/i);
  assert.throws(() => buildDeprovisionPlan({ ...input([]), surprise: true }));
});

test('preserves modified artifacts and configuration with present or unknown user data', () => {
  const modified = owned('config.modified', 'configuration', '/etc/install-doctor/modified.conf');
  const withUserData = owned('config.user-data', 'configuration', '/home/fixture/.config/install-doctor/data.json');
  const uncertain = owned('config.uncertain', 'configuration', '/home/fixture/.config/install-doctor/uncertain.json');
  const plan = buildDeprovisionPlan(input([
    { ...modified, observedDigest: digest('c') },
    { ...withUserData, userData: 'present' },
    { ...uncertain, userData: 'unknown' },
  ]), () => at);

  assert.deepEqual(plan.eligibleResourceIds, []);
  assert.equal(plan.items.find(item => item.resourceId === 'config.modified').reason, 'target-modified-since-install');
  assert.equal(plan.items.find(item => item.resourceId === 'config.user-data').reason, 'user-data-present');
  assert.equal(plan.items.find(item => item.resourceId === 'config.uncertain').reason, 'user-data-unknown');
});

test('refuses every privileged or ambiguous effect even with installer ownership', () => {
  const effects = ['package', 'operating-system', 'network', 'storage', 'user-data', 'unknown'];
  const plan = buildDeprovisionPlan(input(effects.map(effect => owned(`effect.${effect}`, effect, `target:${effect}`))), () => at);

  assert.deepEqual(plan.eligibleResourceIds, []);
  assert.equal(plan.refusedResourceIds.length, effects.length);
  assert.ok(plan.items.every(item => item.disposition === 'refused'));
  assert.equal(plan.items.find(item => item.effect === 'user-data').reason, 'user-data-preserved');
  assert.ok(plan.items.filter(item => item.effect !== 'user-data').every(item => item.reason === 'effect-prohibited'));
});
