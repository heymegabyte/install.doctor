import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlatformBenchmarkReceiptSchema, PlatformCanaryReceiptSchema, PlatformFixtureReceiptSchema,
  PlatformQualificationReceiptSchema, SignedSupportCellSchema, evaluateSupportCellValidity,
} from '../dist/platform-support-evidence.js';

const d = character => character.repeat(64);
const at = '2026-11-10T12:00:00.000Z';
const expires = '2026-12-10T12:00:00.000Z';
const tuple = capability => ({ os: 'linux', version: '24.04', arch: 'x64', environment: 'native', role: 'workstation', capability });
const bindings = suffix => ({
  code: { componentId: `engine-${suffix}`, digest: d('1') },
  policy: { policyId: `policy-${suffix}`, digest: d('2') },
  recipe: { recipeId: `recipe-${suffix}`, digest: d('3') },
  release: { channel: `channel-${suffix}`, releaseId: `release-${suffix}`, manifestDigest: d('4') },
});
const signature = namespace => ({ keyId: 'platform-signer', algorithm: 'sshsig-ed25519', namespace, detached: true, signedDigest: d('9') });
const base = suffix => ({ schemaVersion: 1, receiptId: `receipt-${suffix}`, cellId: `cell-${suffix}`,
  supportCellDigest: d('5'), bindings: bindings(suffix), recordedAt: at, expiresAt: expires, evidenceDigest: d('6'), statementDigest: d('9') });

const fixture = { ...base('a'), evidenceClass: 'platform-fixture', result: 'passed',
  fixture: { kind: 'vm', imageDigest: d('7'), configurationDigest: d('8'), disposable: true }, observedTuple: tuple('bootstrap'),
  signature: signature('desktop.tools.platform-fixture') };
const canary = { ...base('a'), evidenceClass: 'platform-canary', result: 'passed', hostEvidenceDigest: d('7'),
  lifecycle: { freshInstall: 'passed', unchangedReapply: 'passed', upgrade: 'passed', interruptionResume: 'passed', restart: 'passed', rollback: 'passed' },
  signature: signature('desktop.tools.platform-canary') };
const benchmark = { ...base('a'), evidenceClass: 'platform-benchmark', result: 'passed', benchmarkSuiteId: 'bootstrap-v1',
  measurements: [{ metric: 'cold-bootstrap', unit: 'milliseconds', value: 100, budget: 200, comparison: 'at-most' }], safetyInvariantsPassed: true,
  signature: signature('desktop.tools.platform-benchmark') };
const qualification = { ...base('a'), evidenceClass: 'platform-qualification', result: 'qualified', fixtureReceiptDigest: d('7'),
  canaryReceiptDigest: d('8'), benchmarkReceiptDigest: d('9'), independentVerifier: 'verifier-1',
  signature: signature('desktop.tools.platform-qualification') };

test('signed platform evidence schemas accept exact receipts and reject ambiguity', () => {
  for (const [schema, value] of [[PlatformFixtureReceiptSchema, fixture], [PlatformCanaryReceiptSchema, canary],
    [PlatformBenchmarkReceiptSchema, benchmark], [PlatformQualificationReceiptSchema, qualification]]) {
    assert.deepEqual(schema.parse(value), value);
    assert.throws(() => schema.parse({ ...value, unexpected: true }));
    assert.throws(() => schema.parse({ ...value, schemaVersion: 2 }));
    assert.throws(() => schema.parse({ ...value, expiresAt: at }));
    assert.throws(() => schema.parse({ ...value, signature: { ...value.signature, namespace: 'wrong' } }));
    assert.throws(() => schema.parse({ ...value, signature: { ...value.signature, signedDigest: d('0') } }));
  }
});

const cell = suffix => ({ schemaVersion: 1, cellId: `cell-${suffix}`, tuple: tuple(`capability-${suffix}`), bindings: bindings(suffix),
  qualificationReceiptDigest: d('8'), qualifiedAt: at, evidenceExpiresAt: expires, statementDigest: d('9'), signature: signature('desktop.tools.support-cell') });
const authority = {
  codeDigests: { 'engine-a': d('1'), 'engine-b': d('1') }, policyDigests: { 'policy-a': d('2'), 'policy-b': d('2') },
  recipeDigests: { 'recipe-a': d('3'), 'recipe-b': d('3') },
  releases: { 'channel-a': { releaseId: 'release-a', manifestDigest: d('4') }, 'channel-b': { releaseId: 'release-b', manifestDigest: d('4') } },
  now: at,
};

test('code, policy, recipe, release, and freshness invalidate only affected support cells', () => {
  const cells = [cell('a'), cell('b')];
  assert.deepEqual(evaluateSupportCellValidity(cells, authority).map(result => result.valid), [true, true]);
  for (const [field, mutation, reason] of [
    ['codeDigests', { 'engine-a': d('0') }, 'code-changed'],
    ['policyDigests', { 'policy-a': d('0') }, 'policy-changed'],
    ['recipeDigests', { 'recipe-a': d('0') }, 'recipe-changed'],
    ['releases', { 'channel-a': { releaseId: 'release-new', manifestDigest: d('4') } }, 'release-changed'],
  ]) {
    const changed = { ...authority, [field]: { ...authority[field], ...mutation } };
    assert.deepEqual(evaluateSupportCellValidity(cells, changed), [
      { cellId: 'cell-a', valid: false, reasons: [reason] }, { cellId: 'cell-b', valid: true, reasons: [] },
    ]);
  }
  const freshnessCells = [{ ...cells[0], evidenceExpiresAt: '2026-11-11T12:00:00.000Z' }, cells[1]];
  assert.deepEqual(evaluateSupportCellValidity(freshnessCells, { ...authority, now: '2026-11-12T12:00:00.000Z' }), [
    { cellId: 'cell-a', valid: false, reasons: ['evidence-expired'] }, { cellId: 'cell-b', valid: true, reasons: [] },
  ]);
});

test('support cells reject invalid validity windows and unknown fields', () => {
  assert.deepEqual(SignedSupportCellSchema.parse(cell('a')), cell('a'));
  assert.throws(() => SignedSupportCellSchema.parse({ ...cell('a'), evidenceExpiresAt: at }));
  assert.throws(() => SignedSupportCellSchema.parse({ ...cell('a'), extra: true }));
});
