import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationAuthorities,
  EffectiveAuthorizationPolicySchema,
  simulateEffectiveAuthorization,
} from '../dist/effective-authorization.js';

/** @typedef {import('zod').input<typeof import('../dist/effective-authorization.js').EffectiveAuthorizationRuleSchema>} Rule */
/** @param {Rule['authority']} authority */
const target = authority => ({ resource: `${authority}://desktop-tools/fleet/host-01`, action: 'provision.apply' });
const request = (overrides = {}) => ({
  schemaVersion: 1,
  requestId: 'request-01',
  principal: 'agent-01',
  tenant: 'desktop-tools',
  evaluatedAt: '2026-11-10T15:00:00.000Z',
  claims: { environment: 'production', posture: 'verified' },
  targets: Object.fromEntries(authorizationAuthorities.map(authority => [authority, target(authority)])),
  ...overrides,
});

/** @param {Rule['authority']} authority @param {Rule['effect']} effect @param {Partial<Rule>} overrides @returns {Rule} */
const rule = (authority, effect = 'grant', overrides = {}) => ({
  schemaVersion: 1,
  id: `${authority}-${effect}`,
  authority,
  effect,
  principals: ['agent-01'],
  tenants: ['desktop-tools'],
  resources: [target(authority).resource],
  actions: ['provision.apply'],
  conditions: [{ claim: 'environment', values: ['production'] }],
  source: { policyId: `${authority}-policy`, revision: 'revision-01' },
  ...overrides,
});

const completePolicy = () => ({ schemaVersion: 1, rules: authorizationAuthorities.map(authority => rule(authority)) });

void test('grants only when every authority contributes a matching grant', () => {
  const result = simulateEffectiveAuthorization(request(), completePolicy());
  assert.equal(result.decision, 'grant');
  assert.deepEqual(Object.values(result.authorityDecisions), Array(5).fill('grant'));
  assert.deepEqual(result.contributions.map(value => [value.authority, value.effect, value.ruleId]),
    authorizationAuthorities.map(authority => [authority, 'grant', `${authority}-grant`]));
});

void test('an explicit deny overrides grants and every matched grant and denial remains explained', () => {
  const policy = completePolicy();
  policy.rules.push(rule('opencode', 'deny', {
    id: 'opencode-deny-network',
    source: { policyId: 'opencode-guardrails', revision: 'revision-07' },
  }));
  policy.rules.push(rule('opencode', 'grant', {
    id: 'opencode-grant-secondary',
    source: { policyId: 'opencode-task', revision: 'revision-03' },
  }));
  const result = simulateEffectiveAuthorization(request(), policy);
  assert.equal(result.decision, 'deny');
  assert.equal(result.authorityDecisions.opencode, 'deny');
  assert.deepEqual(result.contributions.filter(value => value.authority === 'opencode').map(value => value.ruleId), [
    'opencode-deny-network', 'opencode-grant', 'opencode-grant-secondary',
  ]);
  assert.ok(result.contributions.some(value => value.policyId === 'opencode-guardrails' && value.effect === 'deny'));
});

void test('missing, expired, and condition-mismatched grants fail closed with an explicit denial per authority', () => {
  const policy = completePolicy();
  policy.rules = policy.rules.filter(value => value.authority !== 'infisical');
  const cloudflare = policy.rules.find(value => value.authority === 'cloudflare');
  const hostPrivilege = policy.rules.find(value => value.authority === 'host-privilege');
  assert.ok(cloudflare && hostPrivilege);
  cloudflare.expiresAt = '2026-11-10T15:00:00.000Z';
  hostPrivilege.conditions = [{ claim: 'posture', values: ['quarantined'] }];
  const result = simulateEffectiveAuthorization(request(), policy);
  assert.equal(result.decision, 'deny');
  for (const authority of /** @type {const} */ (['cloudflare', 'infisical', 'host-privilege'])) {
    assert.equal(result.authorityDecisions[authority], 'deny');
    assert.ok(result.contributions.some(value => value.authority === authority && value.reason === 'missing-grant'));
  }
});

void test('wildcards are explicit and constraints still bind the request context', () => {
  const policy = completePolicy();
  policy.rules[0] = rule('product', 'grant', {
    principals: ['*'], tenants: ['*'], resources: ['*'], actions: ['*'],
    conditions: [{ claim: 'posture', values: ['verified'] }],
  });
  assert.equal(simulateEffectiveAuthorization(request(), policy).decision, 'grant');
  assert.equal(simulateEffectiveAuthorization(request({ claims: { environment: 'production', posture: 'unknown' } }), policy).decision, 'deny');
});

void test('rejects ambiguous or malformed policy rather than choosing precedence accidentally', () => {
  const duplicate = completePolicy();
  const [first, second] = duplicate.rules;
  assert.ok(first && second);
  second.id = first.id;
  assert.throws(() => EffectiveAuthorizationPolicySchema.parse(duplicate), /globally unique/i);
  const duplicateCondition = completePolicy();
  const [ruleWithDuplicateCondition] = duplicateCondition.rules;
  assert.ok(ruleWithDuplicateCondition);
  ruleWithDuplicateCondition.conditions.push({ claim: 'environment', values: ['production'] });
  assert.throws(() => EffectiveAuthorizationPolicySchema.parse(duplicateCondition), /condition claims must be unique/i);
  const backwards = completePolicy();
  const [ruleWithBackwardsDates] = backwards.rules;
  assert.ok(ruleWithBackwardsDates);
  ruleWithBackwardsDates.validFrom = '2026-11-11T00:00:00.000Z';
  ruleWithBackwardsDates.expiresAt = '2026-11-10T00:00:00.000Z';
  assert.throws(() => EffectiveAuthorizationPolicySchema.parse(backwards), /validity interval/i);
});

void test('rejects unknown fields and credential-shaped targets', () => {
  assert.throws(() => simulateEffectiveAuthorization({ ...request(), allow: true }, completePolicy()), /unrecognized/i);
  const unsafe = request();
  assert.ok(unsafe.targets.infisical);
  unsafe.targets.infisical.resource = 'https://user:password@example.com/secret';
  assert.throws(() => simulateEffectiveAuthorization(unsafe, completePolicy()));
});
