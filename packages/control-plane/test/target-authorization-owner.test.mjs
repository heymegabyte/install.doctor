import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeTargetAuthorizationDecision } from '../src/target-authorization-owner.ts';

const now = new Date('2026-11-09T14:00:00.000Z');
const record = {
  requestId: 'auth-1', verificationCode: '2345-6789', profileId: 'profile-1',
  profileRevision: 'revision-1', profileRevisionDigest: 'a'.repeat(64),
  targetKeyFingerprint: 'b'.repeat(64), requestedScopes: ['profile:read', 'session:create'],
  status: 'pending', expiresAt: '2026-11-09T14:05:00.000Z',
};
const request = { ...record, status: undefined, expiresAt: undefined, decision: 'approve',
  approvedScopes: ['profile:read', 'session:create'] };
delete request.status;
delete request.expiresAt;

test('approves or denies only the exact displayed target authorization', () => {
  assert.deepEqual(authorizeTargetAuthorizationDecision(record, request, now), {
    ok: true, status: 'approved', decidedAt: now.toISOString(), approvedScopes: record.requestedScopes,
  });
  assert.deepEqual(authorizeTargetAuthorizationDecision(record, { ...request, decision: 'deny', approvedScopes: undefined }, now), {
    ok: true, status: 'denied', decidedAt: now.toISOString(), approvedScopes: null,
  });
});

test('rejects every binding substitution and stale lifecycle state', () => {
  for (const changed of [
    { requestId: 'auth-2' }, { verificationCode: 'AAAA-BBBB' }, { profileId: 'profile-2' },
    { profileRevision: 'revision-2' }, { profileRevisionDigest: 'c'.repeat(64) },
    { targetKeyFingerprint: 'd'.repeat(64) }, { requestedScopes: ['profile:read'] },
  ]) assert.equal(authorizeTargetAuthorizationDecision(record, { ...request, ...changed }, now).error, 'authorization_binding_mismatch');
  assert.equal(authorizeTargetAuthorizationDecision({ ...record, status: 'approved' }, request, now).error, 'authorization_not_pending');
  assert.equal(authorizeTargetAuthorizationDecision({ ...record, expiresAt: now.toISOString() }, request, now).error, 'authorization_expired');
});

test('allows canonical scope narrowing but rejects broadening, duplicates, and reordering', () => {
  assert.deepEqual(authorizeTargetAuthorizationDecision(record, { ...request, approvedScopes: ['profile:read'] }, now).approvedScopes, ['profile:read']);
  for (const approvedScopes of [
    ['admin:write'], ['profile:read', 'profile:read'], ['session:create', 'profile:read'], [],
  ]) assert.equal(authorizeTargetAuthorizationDecision(record, { ...request, approvedScopes }, now).error, 'invalid_approved_scopes');
});
