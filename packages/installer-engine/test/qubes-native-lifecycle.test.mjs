import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUBES_LIFECYCLE_PHASES,
  digestQubesFixture,
} from '../dist/qubes-fixture-contract.js';
import {
  QUBES_NATIVE_OPERATION_KINDS,
  QubesNativePlanSchema,
  executeDisposableQubesLifecycle,
} from '../dist/qubes-native-lifecycle.js';

const releaseDigest = 'a'.repeat(64);
const recipeDigest = 'b'.repeat(64);
const payload = index => index.toString(16).repeat(64);
const compartments = [
  { id: 'admin', kind: 'dom0', templateId: null, networking: 'none', persistentRoot: true },
  { id: 'debian-12', kind: 'template-vm', templateId: null, networking: 'none', persistentRoot: true },
  { id: 'mgmt', kind: 'app-vm', templateId: 'debian-12', networking: 'none', persistentRoot: true },
  { id: 'work', kind: 'app-vm', templateId: 'debian-12', networking: 'through-netvm', persistentRoot: true },
  { id: 'disp-work', kind: 'disposable-vm', templateId: 'debian-12', networking: 'none', persistentRoot: false },
  { id: 'sys-whonix', kind: 'whonix-gateway', templateId: 'debian-12', networking: 'direct', persistentRoot: true },
  { id: 'anon-whonix', kind: 'whonix-workstation', templateId: 'debian-12', networking: 'whonix-only', persistentRoot: true },
].map(item => ({ ...item, outboundAuthorities: item.id === 'admin' ? [
  'dom0.policy', 'template.package', 'app.configure', 'disposable.run', 'disposable.destroy',
  'whonix.gateway.configure', 'whonix.workstation.configure',
] : [], acceptedAuthorities: [] }));
const managementAuthorities = ['dom0.policy', 'template.package', 'app.configure', 'disposable.run',
  'disposable.destroy', 'whonix.gateway.configure', 'whonix.workstation.configure'];
compartments.find(item => item.id === 'admin').outboundAuthorities = [];
compartments.find(item => item.id === 'mgmt').outboundAuthorities = managementAuthorities;

const definitions = [
  ['policy', 'dom0-policy', 'admin', 'desktop.ToolsDom0Policy', 'dom0.policy'],
  ['template', 'template-package', 'debian-12', 'desktop.ToolsTemplatePackage', 'template.package'],
  ['app', 'app-config', 'work', 'desktop.ToolsAppConfig', 'app.configure'],
  ['disp-run', 'disposable-run', 'disp-work', 'desktop.ToolsDisposableRun', 'disposable.run'],
  ['disp-destroy', 'disposable-destroy', 'disp-work', 'desktop.ToolsDisposableDestroy', 'disposable.destroy'],
  ['gateway', 'whonix-gateway-config', 'sys-whonix', 'desktop.ToolsWhonixGateway', 'whonix.gateway.configure'],
  ['workstation', 'whonix-workstation-config', 'anon-whonix', 'desktop.ToolsWhonixWorkstation', 'whonix.workstation.configure'],
];
for (const [, , target, , authority] of definitions) compartments.find(item => item.id === target).acceptedAuthorities.push(authority);

const fixture = {
  schemaVersion: 1,
  fixtureId: 'qubes-native-lab',
  isolation: 'disposable-qubes-lab',
  platform: 'qubes',
  qubesVersion: '4.2.4',
  compartments,
  qrexecRules: definitions.map(([id, , targetId, service, authority]) => ({
    ruleId: `route-${id}`, sourceId: 'mgmt', targetId, service, argument: id,
    authorities: [authority], user: 'user',
  })),
  supportedBoundaries: ['dom0', 'template-vm', 'app-vm', 'disposable-vm', 'whonix-gateway', 'whonix-workstation', 'qrexec'],
};

const evidence = {
  schemaVersion: 1,
  evidenceId: 'qubes-native-qrexec',
  source: 'real-qubes-lab',
  fixtureId: fixture.fixtureId,
  boundary: 'qrexec',
  releaseDigest,
  recipeDigest,
  fixtureDigest: digestQubesFixture(fixture),
  observedAt: '2026-11-10T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  independentAttestor: 'qubes-lab-attestor',
  phases: [...QUBES_LIFECYCLE_PHASES],
  outcome: 'passed',
};

const operations = definitions.map(([id, kind, targetId], index) => ({
  operationId: `op-${id}`,
  kind,
  dependsOn: kind === 'disposable-destroy' ? ['op-disp-run'] : [],
  sourceId: 'mgmt',
  targetId,
  argument: id,
  payloadDigest: payload(index + 1),
  ...(kind === 'template-package' ? { artifactDigest: 'f'.repeat(64) } : {}),
  offlineSafe: true,
  timeoutMs: 30_000,
}));

const plan = {
  schemaVersion: 1,
  planId: 'qubes-offline-lifecycle',
  fixture,
  releaseDigest,
  recipeDigest,
  networkPolicy: 'deny',
  offline: true,
  operations,
  evidence: [evidence],
  verifiedEvidenceIds: [evidence.evidenceId],
  expiresAt: '2026-11-11T10:00:00.000Z',
};

const freshState = () => ({ values: new Map(), activeDisposables: new Set(), networkAttempts: 0 });

test('strict offline fixture executes every Qubes lifecycle through exact qrexec services and tears down DisposableVMs', () => {
  assert.deepEqual([...new Set(QubesNativePlanSchema.parse(plan).operations.map(item => item.kind))].sort(),
    [...QUBES_NATIVE_OPERATION_KINDS].sort());
  const state = freshState();
  const receipt = executeDisposableQubesLifecycle(plan, state, '2026-11-10T12:00:00.000Z');
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.offline, true);
  assert.equal(receipt.networkAttempts, 0);
  assert.deepEqual(receipt.compartmentsVerified, ['admin', 'anon-whonix', 'debian-12', 'disp-work', 'sys-whonix', 'work']);
  assert.deepEqual(receipt.destroyedDisposables, ['disp-work']);
  assert.equal(state.activeDisposables.size, 0);
  assert.ok(receipt.operationReceipts.every(item => item.ruleId.startsWith('route-')));
});

test('unchanged reapply preserves persistent compartment state and creates no leaked disposable state', () => {
  const state = freshState();
  executeDisposableQubesLifecycle(plan, state, '2026-11-10T12:00:00.000Z');
  const second = executeDisposableQubesLifecycle(plan, state, '2026-11-10T12:05:00.000Z');
  const persistent = second.operationReceipts.filter(item => !item.kind.startsWith('disposable-'));
  assert.ok(persistent.every(item => item.outcome === 'unchanged'));
  assert.equal(second.operationReceipts.find(item => item.kind === 'disposable-run').outcome, 'applied');
  assert.equal(second.operationReceipts.find(item => item.kind === 'disposable-destroy').outcome, 'destroyed');
  assert.equal(state.activeDisposables.size, 0);
});

test('compartment isolation rejects mismatched targets, undelegated routes, generic shell fields, and missing teardown', () => {
  const retargeted = structuredClone(plan);
  retargeted.operations.find(item => item.kind === 'template-package').targetId = 'work';
  assert.throws(() => QubesNativePlanSchema.parse(retargeted), /exact template-vm target/);

  const undelegated = structuredClone(plan);
  undelegated.operations.find(item => item.kind === 'app-config').argument = 'unexpected';
  assert.throws(() => QubesNativePlanSchema.parse(undelegated), /exact least-privilege qrexec route/);

  const genericShell = structuredClone(plan);
  genericShell.operations[0].command = 'sh -c whoami';
  assert.throws(() => QubesNativePlanSchema.parse(genericShell), /unrecognized/i);

  const leaked = structuredClone(plan);
  leaked.operations = leaked.operations.filter(item => item.kind !== 'disposable-destroy');
  assert.throws(() => QubesNativePlanSchema.parse(leaked), /requires disposable-destroy|dependent teardown/);
});

test('offline and evidence boundaries fail closed before any fixture state changes', () => {
  for (const candidate of [
    { ...plan, networkPolicy: 'allow' },
    { ...plan, offline: false },
    { ...plan, verifiedEvidenceIds: [] },
  ]) {
    const state = freshState();
    assert.throws(() => executeDisposableQubesLifecycle(candidate, state, '2026-11-10T12:00:00.000Z'));
    assert.equal(state.values.size, 0);
  }
  const state = { ...freshState(), networkAttempts: 1 };
  assert.throws(() => executeDisposableQubesLifecycle(plan, state, '2026-11-10T12:00:00.000Z'), /network attempt/);
  assert.equal(state.values.size, 0);
});
