import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeTargetAuthorizationDecision } from '../src/target-authorization-owner.ts';

const now = new Date('2026-11-09T14:00:00.000Z');
/** @type {Parameters<typeof authorizeTargetAuthorizationDecision>[0]} */
const record = {
  requestId: 'auth-1', verificationCode: '2345-6789', profileId: 'profile-1',
  profileRevision: 'revision-1', profileRevisionDigest: 'a'.repeat(64),
  targetKeyFingerprint: 'b'.repeat(64), requestedScopes: ['profile:read', 'session:create'],
  status: 'pending', expiresAt: '2026-11-09T14:05:00.000Z',
};
const { status, expiresAt, ...binding } = record;
/** @type {Parameters<typeof authorizeTargetAuthorizationDecision>[1]} */
const request = { ...binding, decision: 'approve', approvedScopes: ['profile:read', 'session:create'] };

test('approves or denies only the exact displayed target authorization', () => {
  assert.deepEqual(authorizeTargetAuthorizationDecision(record, request, now), {
    ok: true, status: 'approved', decidedAt: now.toISOString(), approvedScopes: record.requestedScopes,
  });
  assert.deepEqual(authorizeTargetAuthorizationDecision(record, { ...binding, decision: 'deny' }, now), {
    ok: true, status: 'denied', decidedAt: now.toISOString(), approvedScopes: null,
  });
});

test('rejects every binding substitution and stale lifecycle state', () => {
  for (const changed of [
    { requestId: 'auth-2' }, { verificationCode: 'AAAA-BBBB' }, { profileId: 'profile-2' },
    { profileRevision: 'revision-2' }, { profileRevisionDigest: 'c'.repeat(64) },
    { targetKeyFingerprint: 'd'.repeat(64) }, { requestedScopes: ['profile:read'] },
  ]) assert.deepEqual(authorizeTargetAuthorizationDecision(record, { ...request, ...changed }, now), { ok: false, status: 409, error: 'authorization_binding_mismatch' });
  assert.deepEqual(authorizeTargetAuthorizationDecision({ ...record, status: 'approved' }, request, now), { ok: false, status: 409, error: 'authorization_not_pending' });
  assert.deepEqual(authorizeTargetAuthorizationDecision({ ...record, expiresAt: now.toISOString() }, request, now), { ok: false, status: 410, error: 'authorization_expired' });
});

test('allows canonical scope narrowing but rejects broadening, duplicates, and reordering', () => {
  const narrowed = authorizeTargetAuthorizationDecision(record, { ...request, approvedScopes: ['profile:read'] }, now);
  assert.equal(narrowed.ok, true);
  assert.deepEqual(narrowed.approvedScopes, ['profile:read']);
  for (const approvedScopes of [
    ['admin:write'], ['profile:read', 'profile:read'], ['session:create', 'profile:read'], [],
  ]) assert.deepEqual(authorizeTargetAuthorizationDecision(record, { ...request, approvedScopes }, now), { ok: false, status: 400, error: 'invalid_approved_scopes' });
});
