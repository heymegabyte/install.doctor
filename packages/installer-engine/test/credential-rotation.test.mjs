import assert from 'node:assert/strict'; import test from 'node:test';
import { advanceCredentialRotation, beginCredentialRotation } from '../dist/index.js';
const plan = { schemaVersion: 1, rotationId: 'rotation-1', credentialClass: 'service-api-token', consumerId: 'service-1',
  historicalVersionRef: 'infisical://prod/service/token#v1', candidateVersionRef: 'infisical://prod/service/token#v2',
  historicalDigest: 'a'.repeat(64), candidateDigest: 'b'.repeat(64), expiresAt: '2026-11-11T00:00:00.000Z' };
const next = (state, action, minute, char) => advanceCredentialRotation(state, { action, at: `2026-11-10T12:${minute}:00.000Z`, evidenceDigest: char.repeat(64) });
test('dual-phase reload and verification precede historical retirement', () => {
  let state = beginCredentialRotation(plan, '2026-11-10T12:00:00.000Z');
  state = next(state, 'record-reload', '01', 'c'); assert.equal(state.historicalRetained, true);
  state = next(state, 'record-verification', '02', 'd'); assert.equal(state.phase, 'candidate-verified');
  state = next(state, 'retire-historical', '03', 'e'); assert.equal(state.phase, 'historical-retired'); assert.equal(state.historicalRetained, false);
});
test('rollback reactivates historical credential and retains recovery material', () => {
  let state = beginCredentialRotation(plan, '2026-11-10T12:00:00.000Z'); state = next(state, 'record-reload', '01', 'c');
  state = next(state, 'rollback', '02', 'e'); assert.equal(state.phase, 'rolled-back'); assert.equal(state.activeDigest, plan.historicalDigest); assert.equal(state.historicalRetained, true);
});
test('retirement without reload and verification evidence fails closed', () => {
  const state = beginCredentialRotation(plan, '2026-11-10T12:00:00.000Z');
  assert.throws(() => next(state, 'retire-historical', '01', 'e'), /requires verified/);
  const reloaded = next(state, 'record-reload', '01', 'c'); assert.throws(() => next(reloaded, 'retire-historical', '02', 'e'), /requires verified/);
});
test('strict plans reject secret values, same versions, expiry, and replayed evidence time', () => {
  assert.throws(() => beginCredentialRotation({ ...plan, secretValue: 'nope' }, '2026-11-10T12:00:00.000Z'), /unrecognized/i);
  assert.throws(() => beginCredentialRotation({ ...plan, candidateDigest: plan.historicalDigest }, '2026-11-10T12:00:00.000Z'), /distinct/);
  assert.throws(() => beginCredentialRotation(plan, plan.expiresAt), /expired/);
  const state = beginCredentialRotation(plan, '2026-11-10T12:00:00.000Z'); assert.throws(() => advanceCredentialRotation(state, { action: 'record-reload', at: state.updatedAt, evidenceDigest: 'c'.repeat(64) }), /advance/);
});
