import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadPlan, composeSelectedNativeSystemdService } from '../dist/index.js';

const entry = (name, overrides = {}) => ({
  name, bin: name, platforms: ['linux'], installMode: 'cli', loadPolicy: 'lazy', loadRationale: 'default-lazy', deps: [], ...overrides,
});
const report = () => buildLoadPlan({
  schemaVersion: 1, platform: 'linux', architecture: 'x64', roles: ['workstation'],
  selectedPackages: [], selectedServices: ['alloy'], selectedSupportedPaths: [], lazyResolverRequirements: ['resolver'],
  catalog: [
    entry('resolver', { loadPolicy: 'eager-bootstrap', loadRationale: 'lazy-resolver:hook' }),
    entry('alloy', { installMode: 'service', serviceDeclarations: [{ name: 'alloy.service', privilege: 'admin', manager: 'systemd' }] }),
  ],
});

test('composes one exact reversible systemd authority triplet and subtracts only its legacy writer', () => {
  const loadPlan = report();
  const result = composeSelectedNativeSystemdService({
    loadPlan, loadPlanDigest: loadPlan.digest, serviceKey: 'alloy', legacyServices: ['alloy', 'other'],
  });
  assert.equal(result.task.id, 'service.native.alloy');
  assert.equal(result.task.compensation, 'configuration');
  assert.deepEqual(Object.values(result.operations.operations).map(value => value.action).sort(), ['apply', 'check', 'verify']);
  assert.ok(Object.values(result.operations.operations).every(value => value.kind === 'native-service'
    && value.unit === 'alloy.service' && value.desiredState === 'enabled-and-started'));
  assert.deepEqual(result.remainingLegacyServices, ['other']);
});

test('rejects unselected, substituted, ambiguous, and wrong-platform service authority', () => {
  const loadPlan = report();
  assert.throws(() => composeSelectedNativeSystemdService({ loadPlan, loadPlanDigest: '0'.repeat(64), serviceKey: 'alloy', legacyServices: ['alloy'] }), /exact load-plan digest/);
  assert.throws(() => composeSelectedNativeSystemdService({ loadPlan, loadPlanDigest: loadPlan.digest, serviceKey: 'other', legacyServices: ['alloy'] }), /admits only alloy/);
  const changed = structuredClone(loadPlan);
  changed.items.find(item => item.name === 'alloy').serviceDeclarations[0].name = 'other.service';
  assert.throws(() => composeSelectedNativeSystemdService({ loadPlan: changed, loadPlanDigest: changed.digest, serviceKey: 'alloy', legacyServices: ['alloy'] }), /exact load-plan digest/);
});
