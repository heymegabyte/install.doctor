import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectMigrationManifestSchema, verifyEffectMigration } from '../dist/index.js';

const operation = {
  schemaVersion: 1, id: 'fixture.apply', kind: 'apply', authority: 'user', inputDigest: 'a'.repeat(64),
  resources: { cpuUnits: 1, memoryMiB: 16, diskIo: 'light', networkIo: 'none' },
  locks: [{ domain: 'config.fixture', mode: 'exclusive' }],
  retry: { class: 'never', maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 },
  cancellation: { cooperativeSignal: 'abort-signal', graceMs: 100, forceAfterMs: 200 },
  postconditions: [{ id: 'fixture.digest', kind: 'content-digest', expected: 'a'.repeat(64), required: true }],
};
const manifest = {
  schemaVersion: 1, effectId: 'fixture-config', effectClass: 'installer-configuration',
  legacyOwner: { path: 'scripts/legacy.sh', mutation: 'writes the fixture configuration' },
  engineOwner: { operationIds: ['fixture.apply'] },
  preconditions: [{ id: 'fixture.parent-safe', testId: 'test.precondition', description: 'parent is canonical and trusted' }],
  postconditions: [{ id: 'fixture.digest', testId: 'test.postcondition', description: 'exact installed bytes are verified' }],
  lockDomains: ['config.fixture'],
  interruptionTests: { beforeMutation: 'test.interrupt-before', duringMutation: 'test.interrupt-during', afterMutation: 'test.interrupt-after', resume: 'test.resume' },
  rollback: { automatic: true, supportedEffects: ['installer-configuration'], excludedEffects: ['package', 'operating-system', 'network', 'storage', 'external'], testId: 'test.rollback', limits: 'Only exact installer-owned bytes and metadata are restored.' },
  parity: { fixtureIds: ['fixture.fresh', 'fixture.existing'], testId: 'test.parity' },
  legacySubtraction: { path: 'scripts/legacy.sh', assertion: 'the legacy mutation is absent after engine admission', testId: 'test.legacy-subtraction' },
};
const tests = ['test.precondition', 'test.postcondition', 'test.interrupt-before', 'test.interrupt-during', 'test.interrupt-after', 'test.resume', 'test.rollback', 'test.parity', 'test.legacy-subtraction'];

test('a complete effect migration is admitted', () => {
  assert.equal(verifyEffectMigration(manifest, [operation], tests).effectId, 'fixture-config');
});

test('schema rejects every omitted migration evidence category', () => {
  for (const field of ['preconditions', 'postconditions', 'lockDomains', 'interruptionTests', 'rollback', 'parity', 'legacySubtraction']) {
    const candidate = structuredClone(manifest);
    delete candidate[field];
    assert.equal(EffectMigrationManifestSchema.safeParse(candidate).success, false, field);
  }
});

test('harness rejects missing runtime bindings and passing evidence', () => {
  assert.throws(() => verifyEffectMigration(manifest, [], tests), /missing typed operations/);
  assert.throws(() => verifyEffectMigration(manifest, [{ ...operation, locks: [] }], tests), /missing declared locks/);
  assert.throws(() => verifyEffectMigration(manifest, [{ ...operation, postconditions: [] }], tests), /missing declared postconditions/);
  assert.throws(() => verifyEffectMigration(manifest, [operation], tests.slice(1)), /test.precondition/);
});

test('nonconfiguration effects cannot claim automatic rollback', () => {
  assert.equal(EffectMigrationManifestSchema.safeParse({
    ...manifest, effectClass: 'package', rollback: { ...manifest.rollback, supportedEffects: ['package'] },
  }).success, false);
});
