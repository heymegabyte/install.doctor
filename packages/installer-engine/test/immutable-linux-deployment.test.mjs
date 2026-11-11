import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMMUTABLE_LINUX_LIFECYCLE_PHASES,
  ImmutableLinuxFixtureEvidenceSchema,
  ImmutableLinuxObservationSchema,
  inspectImmutableLinuxActivation,
  planImmutableLinuxDeployment,
  statusImmutableLinuxDeployment,
} from '../dist/immutable-linux-deployment.js';

const oldChecksum = 'a'.repeat(64);
const targetChecksum = 'b'.repeat(64);
const rollbackChecksum = 'c'.repeat(64);
const releaseDigest = 'd'.repeat(64);
const recipeDigest = 'e'.repeat(64);
const observation = {
  schemaVersion: 1,
  observationId: 'silverblue-observation-1',
  evidenceDigest: 'f'.repeat(64),
  observedAt: '2026-11-10T09:00:00.000Z',
  readOnly: true,
  fixture: {
    fixtureId: 'silverblue-43-disposable-amd64',
    isolation: 'disposable-ostree-vm',
    platform: 'ostree-linux',
    implementation: 'rpm-ostree',
    osName: 'Fedora Silverblue',
    osVersion: '43',
    architecture: 'x86_64',
  },
  deployments: [
    { checksum: oldChecksum, origin: 'fedora/43/x86_64/silverblue', version: '43.1', booted: true,
      staged: false, rollbackEligible: false },
    { checksum: rollbackChecksum, origin: 'fedora/43/x86_64/silverblue', version: '43.0', booted: false,
      staged: false, rollbackEligible: true },
  ],
  layeredPackages: [{ name: 'fish', nevra: 'fish-4.0.2-1.fc43.x86_64' },
    { name: 'remove-me', nevra: 'remove-me-1.0-1.fc43.x86_64' }],
  flatpaks: [{ ref: 'app/org.mozilla.firefox/x86_64/stable', commit: '1'.repeat(64),
    remote: 'flathub', scope: 'system' }],
  bootId: 'boot-before-reconciliation',
};

const policy = {
  schemaVersion: 1,
  policyId: 'silverblue-workstation-v1',
  releaseDigest,
  recipeDigest,
  target: { checksum: targetChecksum, origin: 'fedora/43/x86_64/silverblue', version: '43.2' },
  layeredPackages: [{ name: 'fish', nevra: 'fish-4.0.3-1.fc43.x86_64' },
    { name: 'tailscale', nevra: 'tailscale-1.90.9-1.x86_64' }],
  flatpaks: [
    { ref: 'app/org.mozilla.firefox/x86_64/stable', commit: '2'.repeat(64), remote: 'flathub', scope: 'system' },
    { ref: 'app/com.visualstudio.code/x86_64/stable', commit: '3'.repeat(64), remote: 'flathub',
      scope: 'user', owner: 'desktop-user' },
  ],
  removal: { layeredPackages: true, flatpaks: false },
  reboot: { policy: 'maintenance-window', maintenanceWindowOpen: true, activeInteractiveUsers: 0,
    workloadsSafeToRestart: true },
  rollback: { mode: 'prepare', targetChecksum: rollbackChecksum },
};

const evidence = {
  schemaVersion: 1,
  evidenceId: 'silverblue-lifecycle-evidence-1',
  source: 'disposable-ostree-fixture',
  fixtureId: observation.fixture.fixtureId,
  implementation: 'rpm-ostree',
  releaseDigest,
  recipeDigest,
  observedAt: '2026-11-10T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  independentAttestor: 'ostree-lab-attestor',
  phases: [...IMMUTABLE_LINUX_LIFECYCLE_PHASES],
  outcome: 'passed',
};

function request(overrides = {}) {
  return { policy, observation, evidence: [evidence], verifiedEvidenceIds: [evidence.evidenceId],
    now: '2026-11-10T12:00:00.000Z', ...overrides };
}

test('strict disposable OSTree observation requires one booted deployment and immutable identities', () => {
  assert.equal(ImmutableLinuxObservationSchema.parse(observation).fixture.isolation, 'disposable-ostree-vm');
  assert.throws(() => ImmutableLinuxObservationSchema.parse({ ...observation, unexpected: true }), /unrecognized/i);
  assert.throws(() => ImmutableLinuxObservationSchema.parse({ ...observation,
    fixture: { ...observation.fixture, isolation: 'production-host' } }));
  assert.throws(() => ImmutableLinuxObservationSchema.parse({ ...observation,
    deployments: observation.deployments.map(item => ({ ...item, booted: false })) }), /exactly one/i);
  assert.throws(() => ImmutableLinuxObservationSchema.parse({ ...observation,
    deployments: observation.deployments.map(item => ({ ...item, staged: true })) }), /at most one/i);
});

test('planner deterministically separates OSTree, package layering, Flatpak, reboot, and rollback semantics', () => {
  const first = planImmutableLinuxDeployment(request());
  const second = planImmutableLinuxDeployment(request());
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ready');
  assert.equal(first.mode, 'read-only');
  assert.equal(first.admittedEvidenceId, evidence.evidenceId);
  assert.deepEqual(first.reboot, { required: true, admitted: true,
    preBootId: observation.bootId, expectedChecksum: targetChecksum });
  assert.deepEqual(first.rollback, { mode: 'prepare', targetChecksum: rollbackChecksum, admitted: true });
  assert.deepEqual(first.operations.map(item => `${item.kind}:${item.subject}`), [
    `install-flatpak:user:desktop-user:app/com.visualstudio.code/x86_64/stable`,
    'install-layer:tailscale',
    `prepare-rollback:${rollbackChecksum}`,
    'reboot:silverblue-43-disposable-amd64',
    'remove-layer:remove-me',
    `replace-layer:fish`,
    `stage-deployment:${targetChecksum}`,
    `update-flatpak:system::app/org.mozilla.firefox/x86_64/stable`,
  ]);
  assert.ok(first.operations.every(item => item.mutating === false));
  assert.equal(first.operations.find(item => item.kind === 'update-flatpak').requiresReboot, false);
  assert.equal(first.operations.find(item => item.kind === 'replace-layer').requiresReboot, true);
  assert.deepEqual(statusImmutableLinuxDeployment(first), {
    policyId: policy.policyId, observationId: observation.observationId,
    fixtureId: observation.fixture.fixtureId, planDigest: first.planDigest, mode: 'read-only', status: 'ready',
    bootedChecksum: oldChecksum, targetChecksum, reboot: first.reboot, rollback: first.rollback,
    findings: first.findings,
  });
});

test('current externally verified exact fixture evidence is required for admission', () => {
  for (const changed of [
    { verifiedEvidenceIds: [] },
    { now: '2026-11-18T12:00:00.000Z' },
    { now: '2026-11-10T09:30:00.000Z' },
    { evidence: [{ ...evidence, fixtureId: 'other-fixture' }] },
    { evidence: [{ ...evidence, implementation: 'bootc' }] },
    { policy: { ...policy, releaseDigest: '9'.repeat(64) } },
    { policy: { ...policy, recipeDigest: '8'.repeat(64) } },
  ]) {
    const plan = planImmutableLinuxDeployment(request(changed));
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.admittedEvidenceId, undefined);
    assert.ok(plan.findings.some(item => item.code === 'fixture-evidence-missing'));
  }
  assert.throws(() => ImmutableLinuxFixtureEvidenceSchema.parse({ ...evidence,
    phases: IMMUTABLE_LINUX_LIFECYCLE_PHASES.slice(0, -1) }));
  assert.throws(() => ImmutableLinuxFixtureEvidenceSchema.parse({ ...evidence, source: 'mock' }));
});

test('reboot is deferred or blocked until policy, users, workloads, and maintenance window admit it', () => {
  const deferred = planImmutableLinuxDeployment(request({ policy: { ...policy,
    reboot: { ...policy.reboot, policy: 'defer' } } }));
  assert.equal(deferred.status, 'pending-reboot');
  assert.equal(deferred.reboot.admitted, false);
  assert.ok(deferred.findings.some(item => item.code === 'reboot-deferred'));
  assert.equal(deferred.operations.some(item => item.kind === 'reboot'), false);

  for (const reboot of [
    { ...policy.reboot, maintenanceWindowOpen: false },
    { ...policy.reboot, activeInteractiveUsers: 1 },
    { ...policy.reboot, workloadsSafeToRestart: false },
  ]) {
    const plan = planImmutableLinuxDeployment(request({ policy: { ...policy, reboot } }));
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.reboot.admitted, false);
    assert.ok(plan.findings.some(item => item.code === 'reboot-blocked'));
    assert.equal(plan.operations.some(item => item.kind === 'reboot'), false);
  }
});

test('post-reboot status requires a new boot identity and the exact expected checksum', () => {
  const plan = planImmutableLinuxDeployment(request());
  assert.deepEqual(inspectImmutableLinuxActivation(plan, observation), {
    status: 'awaiting-reboot', verified: false, reason: 'boot-identity-unchanged',
    expectedChecksum: targetChecksum, observedChecksum: oldChecksum,
    preBootId: observation.bootId, postBootId: observation.bootId,
  });
  const wrong = { ...observation, bootId: 'boot-after-wrong-deployment' };
  assert.equal(inspectImmutableLinuxActivation(plan, wrong).status, 'wrong-deployment');
  const activated = { ...observation, bootId: 'boot-after-target-activation',
    deployments: observation.deployments.map(item => item.checksum === oldChecksum
      ? { ...item, booted: false, rollbackEligible: true }
      : item).concat({ checksum: targetChecksum, origin: policy.target.origin, version: policy.target.version,
      booted: true, staged: false, rollbackEligible: false }) };
  assert.deepEqual(inspectImmutableLinuxActivation(plan, activated), {
    status: 'activated', verified: true, reason: 'boot-and-deployment-verified',
    expectedChecksum: targetChecksum, observedChecksum: targetChecksum,
    preBootId: observation.bootId, postBootId: activated.bootId,
  });
  const differentFixture = { ...activated, fixture: { ...activated.fixture, fixtureId: 'another-fixture' } };
  assert.equal(inspectImmutableLinuxActivation(plan, differentFixture).status, 'fixture-mismatch');
});

test('rollback uses an observed eligible checksum and rejects missing, booted, or foreign-origin targets', () => {
  const missing = planImmutableLinuxDeployment(request({ policy: { ...policy,
    rollback: { mode: 'prepare', targetChecksum: '7'.repeat(64) } } }));
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.findings.some(item => item.code === 'rollback-target-missing'));

  const booted = planImmutableLinuxDeployment(request({ policy: { ...policy,
    rollback: { mode: 'prepare', targetChecksum: oldChecksum } } }));
  assert.equal(booted.status, 'blocked');
  assert.ok(booted.findings.some(item => item.code === 'rollback-target-ineligible'));

  const foreign = planImmutableLinuxDeployment(request({ observation: { ...observation,
    deployments: observation.deployments.map(item => item.checksum === rollbackChecksum
      ? { ...item, origin: 'vendor/foreign/stable' } : item) } }));
  assert.equal(foreign.status, 'blocked');
  assert.ok(foreign.findings.some(item => item.code === 'rollback-origin-mismatch'));
});

test('absent package and Flatpak removal requires separate explicit authority', () => {
  const denied = planImmutableLinuxDeployment(request({ policy: { ...policy,
    removal: { layeredPackages: false, flatpaks: false } } }));
  assert.equal(denied.status, 'blocked');
  assert.ok(denied.findings.some(item => item.code === 'removal-not-authorized' && item.subject === 'remove-me'));
  assert.equal(denied.operations.some(item => item.kind === 'remove-layer'), false);

  const extraFlatpak = { ref: 'app/org.gnome.Calculator/x86_64/stable', commit: '6'.repeat(64),
    remote: 'flathub', scope: 'system' };
  const allowed = planImmutableLinuxDeployment(request({
    observation: { ...observation, flatpaks: [...observation.flatpaks, extraFlatpak] },
    policy: { ...policy, removal: { layeredPackages: true, flatpaks: true } },
  }));
  assert.ok(allowed.operations.some(item => item.kind === 'remove-flatpak'
    && item.subject === 'system::app/org.gnome.Calculator/x86_64/stable'));
});

test('an exact unchanged deployment produces stable status without synthetic work', () => {
  const exactObservation = {
    ...observation,
    deployments: [{ checksum: targetChecksum, origin: policy.target.origin, version: policy.target.version,
      booted: true, staged: false, rollbackEligible: false }],
    layeredPackages: policy.layeredPackages,
    flatpaks: policy.flatpaks,
  };
  const exactPolicy = { ...policy, removal: { layeredPackages: false, flatpaks: false }, rollback: { mode: 'preserve' } };
  const plan = planImmutableLinuxDeployment(request({ observation: exactObservation, policy: exactPolicy }));
  assert.equal(plan.status, 'unchanged');
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.reboot.required, false);
  assert.equal(plan.reboot.admitted, false);
  assert.ok(plan.findings.some(item => item.code === 'unchanged'));
});
