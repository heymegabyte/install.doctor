import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LINUX_PLATFORM_FIXTURES, LinuxFixtureDefinitionSchema,
  admitLinuxFixtureInfrastructure, verifyLinuxFixtureLifecycle,
} from '../dist/linux-platform-fixtures.js';

const evidenceDigest = 'e'.repeat(64);
const observation = definition => ({ fixtureId: definition.fixtureId, boundary: definition.boundary, disposable: true,
  imageDigest: definition.image.digest, ...definition.tuple, infrastructureEvidenceDigest: evidenceDigest });
function adapter({ dirty = false, duplicate = false } = {}) {
  let state = { desiredStateDigest: dirty ? 'f'.repeat(64) : undefined, mutationCount: dirty ? 1 : 0 };
  return { discover: () => ({ ...state }), apply: desiredStateDigest => {
    const mutated = duplicate || state.desiredStateDigest !== desiredStateDigest;
    state = { desiredStateDigest, mutationCount: state.mutationCount + (mutated ? 1 : 0) };
    return { state: { ...state }, mutated };
  } };
}

test('matrix owns exact Debian, Ubuntu, Fedora, Alpine, Arch, container, immutable OS, and WSL fixtures', () => {
  assert.deepEqual(new Set(LINUX_PLATFORM_FIXTURES.map(item => item.family)),
    new Set(['debian', 'ubuntu', 'fedora', 'alpine', 'arch', 'container', 'immutable-os', 'wsl']));
  for (const definition of LINUX_PLATFORM_FIXTURES) {
    assert.deepEqual(LinuxFixtureDefinitionSchema.parse(definition), definition);
    assert.throws(() => LinuxFixtureDefinitionSchema.parse({ ...definition, inferredPass: true }), /unrecognized/i);
  }
});

test('every materialized exact disposable fixture proves clean install and unchanged reapply without promoting support', () => {
  for (const definition of LINUX_PLATFORM_FIXTURES.filter(item => item.image.materialized)) {
    const receipt = verifyLinuxFixtureLifecycle(definition, observation(definition), adapter());
    assert.deepEqual(receipt.cleanInstall, { mutated: true, mutationDelta: 1 });
    assert.deepEqual(receipt.unchangedReapply, { mutated: false, mutationDelta: 0 });
    assert.equal(receipt.promotesSupport, false);
  }
});

test('unmaterialized OSTree and WSL definitions cannot mint semantic pass receipts', () => {
  for (const definition of LINUX_PLATFORM_FIXTURES.filter(item => !item.image.materialized)) {
    assert.throws(() => verifyLinuxFixtureLifecycle(definition, observation(definition), adapter()), /not materialized/);
    const result = admitLinuxFixtureInfrastructure(definition,
      { availableBoundaries: [definition.boundary], imageDigests: { [definition.image.reference]: definition.image.digest } });
    assert.equal(result.status, 'BLOCKED');
  }
});

test('fixture lifecycle rejects dirty roots, duplicate reapply mutations, and tuple substitution', () => {
  const definition = LINUX_PLATFORM_FIXTURES[0];
  assert.throws(() => verifyLinuxFixtureLifecycle(definition, observation(definition), adapter({ dirty: true })), /not clean/);
  assert.throws(() => verifyLinuxFixtureLifecycle(definition, observation(definition), adapter({ duplicate: true })), /unchanged reapply/);
  assert.throws(() => verifyLinuxFixtureLifecycle(definition, { ...observation(definition), osId: 'ubuntu' }, adapter()), /mismatch: osId/);
  assert.throws(() => verifyLinuxFixtureLifecycle(definition,
    { ...observation(definition), imageDigest: '0'.repeat(64) }, adapter()), /mismatch: imageDigest/);
});

test('unavailable platform infrastructure emits exact BLOCKED evidence instead of pass or skip', () => {
  const expectedCodes = { 'oci-container': 'OCI_RUNTIME_UNAVAILABLE',
    'disposable-ostree-vm': 'OSTREE_FIXTURE_UNAVAILABLE', 'windows-wsl2': 'WINDOWS_WSL2_FIXTURE_UNAVAILABLE' };
  for (const definition of LINUX_PLATFORM_FIXTURES) {
    const blocked = admitLinuxFixtureInfrastructure(definition, { availableBoundaries: [], imageDigests: {} });
    assert.equal(blocked.status, 'BLOCKED'); assert.equal(blocked.code, expectedCodes[definition.boundary]);
    assert.equal(blocked.promotesSupport, false); assert.ok(blocked.missingPrerequisite); assert.ok(blocked.remediation);
  }
});

test('an available boundary still blocks a missing or substituted immutable image', () => {
  const definition = LINUX_PLATFORM_FIXTURES[0];
  const blocked = admitLinuxFixtureInfrastructure(definition,
    { availableBoundaries: [definition.boundary], imageDigests: {} });
  assert.equal(blocked.status, 'BLOCKED'); assert.equal(blocked.code, 'FIXTURE_IMAGE_UNAVAILABLE');
  const substituted = admitLinuxFixtureInfrastructure(definition,
    { availableBoundaries: [definition.boundary], imageDigests: { [definition.image.reference]: '0'.repeat(64) } });
  assert.equal(substituted.code, 'FIXTURE_IMAGE_UNAVAILABLE');
  const ready = admitLinuxFixtureInfrastructure(definition,
    { availableBoundaries: [definition.boundary], imageDigests: { [definition.image.reference]: definition.image.digest } });
  assert.equal(ready.status, 'READY');
});
