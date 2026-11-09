import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadPlan, composeSelectedNativeSystemdService, deriveBoundNormalizedPlan,
  derivePrivilegedBrokerServiceAuthority } from '../dist/index.js';

const entry = (name, overrides = {}) => ({ name, bin: name, platforms: ['linux'], installMode: 'cli',
  loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], ...overrides });
async function fixture() {
  const loadPlan = buildLoadPlan({ schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['server'],
    selectedPackages: [], selectedServices: ['alloy'], selectedSupportedPaths: [], lazyResolverRequirements: ['resolver'],
    catalog: [entry('resolver', { loadPolicy: 'eager-bootstrap', loadRationale: 'lazy-resolver:hook' }),
      entry('alloy', { installMode: 'service', serviceDeclarations: [{ name: 'alloy.service', privilege: 'admin', manager: 'systemd' }] })] });
  const composed = composeSelectedNativeSystemdService({ loadPlan, loadPlanDigest: loadPlan.digest, serviceKey: 'alloy', legacyServices: ['alloy'] });
  const desiredState = { schemaVersion: 1, revision: 'revision-1', hostId: 'host-1', packages: [], services: ['alloy'], consents: ['privileged'], offline: false };
  const facts = { schemaVersion: 1, hostId: 'host-1', collectedAt: '2026-11-09T12:00:00.000Z', os: 'linux', osVersion: '12', arch: 'x64', environment: 'native', roles: ['server'], packageManagers: ['dpkg'], capabilities: [] };
  const packageTask = { ...composed.task, id: 'desired.packages', inputDigest: 'b'.repeat(64), dependencies: [],
    operations: { check: 'packages-check', apply: 'packages-apply', verify: 'packages-verify' }, privilege: 'user', consent: 'none',
    lockDomains: ['package-manager'], compensation: 'none' };
  const plan = await deriveBoundNormalizedPlan({ tasks: [packageTask, composed.task], selectedTaskIds: [composed.task.id], executionPolicy: { maxConcurrency: 1, resourceLimits: { cpu: 2, memoryMiB: 512, networkConcurrency: 0 } } }, facts, desiredState, 'release-1', '2026-11-09T12:00:01.000Z');
  const root = '/run/desktop-tools/authority/release-1';
  return { schemaVersion: 1, approvalMode: 'trusted-local', runId: 'run-1', approvedPlanDigest: plan.digest,
    plan, operations: composed.operations.operations, desiredState, hostFacts: facts,
    releaseProof: { manifestPath: `${root}/manifest`, signaturePath: `${root}/manifest.sig`, catalogPath: `${root}/catalog.json`, manifestSha256: '1'.repeat(64), trust: { keyId: 'desktop-release', publicKey: `ssh-ed25519 ${'A'.repeat(43)}=` } },
    transactionRoot: '/var/lib/desktop-tools/transactions/run-1', enrolledUid: 501, socketGid: 20,
    helperPath: `${root}/desktop-tools-privileged-broker`, helperDigest: '6'.repeat(64), runtimePath: `${root}/node`, runtimeDigest: '7'.repeat(64), workerPath: `${root}/worker.mjs`, workerDigest: '8'.repeat(64), socketPath: '/run/desktop-tools/broker/run-1/broker.sock', issuedAt: '2026-11-09T12:00:00.000Z', expiresAt: '2026-11-09T12:05:00.000Z' };
}

test('derives one exact native-service grant without package or payload authority', async () => {
  const input = await fixture();
  const result = derivePrivilegedBrokerServiceAuthority(input);
  assert.equal(result.authority.authorityKind, 'native-service');
  assert.equal(result.authority.descriptor.unit, 'alloy.service');
  assert.equal('artifacts' in result.authority, false);
  assert.deepEqual(result.grant.operations.map(value => value.phase).sort(), ['apply', 'check', 'verify']);
  assert.equal(result.controllerInput.requestLimit, 3);
});

test('service derivation rejects plan, operation, consent, and socket substitution', async () => {
  const base = await fixture();
  for (const mutate of [
    value => { value.approvedPlanDigest = '0'.repeat(64); },
    value => { value.operations['native-systemd-alloy-apply'].unit = 'other.service'; },
    value => { value.desiredState.consents = []; },
    value => { value.socketPath = '/run/desktop-tools/broker/other/broker.sock'; },
  ]) { const candidate = structuredClone(base); mutate(candidate); assert.throws(() => derivePrivilegedBrokerServiceAuthority(candidate)); }
});
