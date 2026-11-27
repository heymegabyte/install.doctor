import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAAS_ACCESSIBILITY_CONTRACT,
  projectSaasRead,
  validateSaasAccessibilityContract,
} from '../dist/saas-api-contracts.js';

const NOW = '2026-11-10T12:00:00.000Z';
const EXPIRY = '2026-11-11T12:00:00.000Z';
const DIGEST = 'a'.repeat(64);

/** @typedef {import('../dist/saas-api-contracts.js').SaasResourceRecord} Resource */
/** @param {string} capabilityId @returns {Resource['capability']} */
const truth = capabilityId => ({ capabilityId, status: 'implemented-unverified',
  evidenceRef: `evidence://${capabilityId}`, observedAt: NOW, expiresAt: null });
/** @template {Resource['kind']} Kind @param {Kind} kind @param {string} id */
const base = (kind, id, capabilityId = `read-${kind}`) => ({ schemaVersion: /** @type {const} */ (1), id, tenantId: 'tenant-one', kind,
  capability: truth(capabilityId), updatedAt: NOW });

/** @returns {Resource[]} */
function records() {
  return [
    { ...base('profiles', 'profile-one'), slug: 'brian', revision: 'rev-one', desiredStateDigest: DIGEST, state: 'ready' },
    { ...base('machines', 'machine-one'), displayName: 'Zen', platform: 'linux', state: 'current', lastSeenAt: NOW },
    { ...base('plans', 'plan-one'), profileId: 'profile-one', machineId: 'machine-one', planDigest: DIGEST, state: 'pending-approval', risk: 'low' },
    { ...base('approvals', 'approval-one'), planId: 'plan-one', state: 'pending', expiresAt: EXPIRY, reauthenticationRequired: true },
    { ...base('live-runs', 'run-one'), planId: 'plan-one', sessionId: 'session-one', state: 'running', eventCursor: 42, terminal: false },
    { ...base('history', 'history-one'), subjectKind: 'machines', subjectId: 'machine-one', event: 'machine-observed', outcome: 'informational', occurredAt: NOW },
    { schemaVersion: 1, id: 'catalog-one', tenantId: null, kind: 'catalog', capability: truth('read-catalog'), updatedAt: NOW,
      packageName: 'restic', lifecycle: 'active', defaultEligible: true, platforms: ['linux', 'macos', 'windows'], public: true },
    { ...base('drift', 'drift-one'), machineId: 'machine-one', state: 'drifted', findingCount: 2, observedAt: NOW },
    { ...base('secrets-readiness', 'secrets-one'), workloadId: 'backup-agent', state: 'missing-references',
      declaredReferenceCount: 2, missingReferenceIds: ['restic-password'] },
    { ...base('recovery', 'recovery-one'), workloadId: 'home-data', state: 'restorable', recoveryPointAt: NOW, lastRestoreVerifiedAt: NOW },
  ];
}

const principal = () => ({ schemaVersion: 1, principalId: 'owner-one', tenantId: 'tenant-one',
  readCapabilities: records().map(record => record.capability.capabilityId) });
const request = () => ({ schemaVersion: 1, kinds: records().map(record => record.kind) });

void test('projects all ten nonvisual SaaS resources with exact tenant and evidence truth', () => {
  const result = projectSaasRead(principal(), request(), records(), NOW);
  assert.equal(result.items.length, 10);
  assert.equal(result.tenantId, 'tenant-one');
  assert.equal(result.accessibilityVersion, 1);
  assert.equal(result.items.find(item => item.kind === 'live-runs')?.eventCursor, 42);
  assert.equal(result.items.find(item => item.kind === 'catalog')?.tenantId, null);
});

void test('rejects cross-tenant records instead of silently filtering them', () => {
  const input = records();
  const machine = input.find(item => item.kind === 'machines');
  assert.ok(machine);
  machine.tenantId = 'tenant-two';
  assert.throws(() => projectSaasRead(principal(), request(), input, NOW), /cross-tenant/i);
});

void test('rejects missing capability and unrequested authority results', () => {
  const underprivileged = principal();
  underprivileged.readCapabilities = underprivileged.readCapabilities.filter(value => value !== 'read-recovery');
  assert.throws(() => projectSaasRead(underprivileged, request(), records(), NOW), /missing read capability: read-recovery/i);

  const narrow = request();
  narrow.kinds = narrow.kinds.filter(kind => kind !== 'history');
  assert.throws(() => projectSaasRead(principal(), narrow, records(), NOW), /unrequested.*history/i);
});

void test('requires expired evidence to surface as stale and live truth to expire', () => {
  const expired = records();
  const [expiredRecord] = expired;
  assert.ok(expiredRecord);
  expiredRecord.capability.observedAt = '2026-11-09T11:00:00.000Z';
  expiredRecord.capability.expiresAt = '2026-11-10T11:00:00.000Z';
  assert.throws(() => projectSaasRead(principal(), request(), expired, NOW), /must be reported stale/i);
  expiredRecord.capability.status = 'stale';
  assert.doesNotThrow(() => projectSaasRead(principal(), request(), expired, NOW));

  const liveWithoutExpiry = records();
  const [liveRecord] = liveWithoutExpiry;
  assert.ok(liveRecord);
  liveRecord.capability.status = 'verified-live';
  assert.throws(() => projectSaasRead(principal(), request(), liveWithoutExpiry, NOW), /verified-live capability truth must expire/i);
});

void test('strict contracts reject secret values, unknown fields, and tenant-private catalog data', () => {
  const secretLeak = records().map(item => item.kind === 'secrets-readiness' ? { ...item, secretValue: 'do-not-accept' } : item);
  assert.throws(() => projectSaasRead(principal(), request(), secretLeak, NOW), /unrecognized/i);

  const privateCatalog = records().map(item => item.kind === 'catalog' ? { ...item, tenantId: 'tenant-one', public: false } : item);
  assert.throws(() => projectSaasRead(principal(), request(), privateCatalog, NOW));
});

void test('accessibility semantics cover every resource exactly once with keyboard and live-region contracts', () => {
  const contract = validateSaasAccessibilityContract(SAAS_ACCESSIBILITY_CONTRACT);
  assert.equal(contract.resources.length, 10);
  assert.equal(new Set(contract.resources.map(resource => resource.kind)).size, 10);
  for (const resource of contract.resources) {
    assert.equal(resource.liveRegion, 'polite');
    assert.ok(resource.keyboardActions.some(action => action.key === 'Enter' && action.requiresSelection));
    assert.ok(resource.emptyMessage.length > 0);
    assert.equal(Object.hasOwn(resource, 'errorMessage'), false);
  }

  const duplicate = structuredClone(contract);
  const first = duplicate.resources[0];
  const last = duplicate.resources[9];
  assert.ok(first && last);
  last.kind = first.kind;
  assert.throws(() => validateSaasAccessibilityContract(duplicate), /every SaaS resource exactly once/i);
});
