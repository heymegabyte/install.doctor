import assert from 'node:assert/strict';
import test from 'node:test';
import { planBackupAuthorities } from '../dist/backup-authority-plan.js';

const d = value => value.repeat(64);
const identity = (role, actions) => ({
  identityId: `${role}-identity`,
  principalId: `provider:${role}`,
  credentialRef: `infisical://desktop-tools/backup/${role}`,
  allowedActions: actions,
});
const input = overrides => ({
  schemaVersion: 1,
  planId: 'critical-backup-authority',
  provider: {
    providerId: 'object-store',
    capabilityEvidenceDigest: d('a'),
    supportedActions: ['backup:create', 'backup:read', 'metadata:append', 'backup:prune', 'backup:delete'],
    identityEnforcement: 'provider-iam',
    independentlyScopedPrincipals: true,
    retention: {
      enforcement: 'provider-enforced', retentionLockEnabled: true,
      writerCannotDeleteRetainedData: true, maintenanceCannotBypassRetention: true,
      evidenceRef: 'evidence://provider/retention/locked',
    },
    limitations: [],
  },
  writer: identity('writer', ['backup:create', 'backup:read', 'metadata:append']),
  maintenance: identity('maintenance', ['backup:read', 'backup:prune', 'backup:delete']),
  ...overrides,
});

test('separates provider-enforced writer and maintenance authority and binds evidence', () => {
  const plan = planBackupAuthorities(input());
  assert.equal(plan.status, 'ready');
  assert.equal(plan.immutability.guarantee, 'provider-enforced');
  assert.equal(plan.immutability.evidenceRef, 'evidence://provider/retention/locked');
  assert.equal(plan.findings.length, 0);
  assert.match(plan.planDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(planBackupAuthorities(input()), plan);
});

test('writer can never receive prune, delete, overwrite, or retention authority', () => {
  for (const action of ['backup:prune', 'backup:delete', 'backup:overwrite', 'snapshot:delete', 'retention:change', 'retention:bypass']) {
    assert.throws(() => planBackupAuthorities(input({
      writer: identity('writer', ['backup:create', action]),
    })), /writer cannot prune, delete, overwrite, or administer retention/i);
  }
});

test('shared identity, principal, or credential is rejected rather than described as separation', () => {
  for (const collision of [
    { identityId: 'writer-identity' },
    { principalId: 'provider:writer' },
    { credentialRef: 'infisical://desktop-tools/backup/writer' },
  ]) {
    assert.throws(() => planBackupAuthorities(input({
      maintenance: { ...identity('maintenance', ['backup:prune']), ...collision },
    })), /distinct identities, principals, and credentials/i);
  }
});

test('provider capability gaps gate activation and are reported exactly', () => {
  const candidate = input();
  candidate.provider.independentlyScopedPrincipals = false;
  candidate.provider.identityEnforcement = 'process-only';
  candidate.provider.supportedActions = ['backup:create', 'backup:read', 'metadata:append'];
  const plan = planBackupAuthorities(candidate);
  assert.equal(plan.status, 'gated');
  assert.deepEqual(plan.findings.map(finding => finding.code), [
    'provider-cannot-separate-identities', 'provider-enforcement-insufficient', 'provider-action-unsupported',
  ]);
  assert.match(plan.findings[2].detail, /backup:delete, backup:prune/);
});

test('policy-only and generic-compatible storage explicitly cannot guarantee immutability', () => {
  const candidate = input();
  candidate.provider.retention = {
    enforcement: 'policy-only', retentionLockEnabled: false,
    writerCannotDeleteRetainedData: true, maintenanceCannotBypassRetention: false,
    evidenceRef: null,
  };
  candidate.provider.limitations = ['S3-compatible API does not establish provider retention semantics'];
  const plan = planBackupAuthorities(candidate);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.immutability.guarantee, 'not-guaranteed');
  assert.equal(plan.immutability.evidenceRef, null);
  assert.ok(plan.findings.some(finding => finding.code === 'immutability-not-guaranteed'));
  assert.match(plan.findings.at(-1).detail, /policy-only.*lock is not enabled.*can bypass.*evidence is absent.*S3-compatible/s);
});

test('contracts reject unknown fields, duplicate actions, and maintenance without owned destructive work', () => {
  assert.throws(() => planBackupAuthorities({ ...input(), surprise: true }), /unrecognized|invalid/i);
  assert.throws(() => planBackupAuthorities(input({
    writer: identity('writer', ['backup:create', 'backup:create']),
  })), /actions must be unique/i);
  assert.throws(() => planBackupAuthorities(input({
    maintenance: identity('maintenance', ['backup:read']),
  })), /must explicitly own at least one destructive/i);
});
