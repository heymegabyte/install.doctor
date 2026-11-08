import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOwnerContextRead, authorizeOwnerDecision } from '../src/owner-approval.ts';

const now = new Date('2026-11-08T12:00:00.000Z');
const record = {
  code: '2345-6789-ABCD',
  status: 'pending',
  profileRevision: 'sha256:profile-v7',
  ownerActor: 'owner@example.com',
  expiresAt: '2026-11-08T12:05:00.000Z',
  requestedScopes: ['pull-desired-state', 'report-status'],
};
const owner = { actor: 'OWNER@example.com', authenticatedAt: '2026-11-08T11:58:00.000Z' };
const request = { code: record.code, matchingCode: record.code, profileRevision: record.profileRevision, decision: 'approve' };

test('owner can approve or deny the exact displayed request', () => {
  assert.deepEqual(authorizeOwnerDecision(record, request, owner, now), {
    ok: true, nextStatus: 'approved', actor: 'owner@example.com', decidedAt: now.toISOString(),
    approvedScopes: ['pull-desired-state', 'report-status'],
  });
  assert.equal(authorizeOwnerDecision(record, { ...request, decision: 'deny' }, owner, now).ok, true);
  assert.equal(authorizeOwnerDecision(record, { ...request, decision: 'deny' }, owner, now).nextStatus, 'denied');
});

test('owner may narrow requested scopes but cannot broaden them', () => {
  assert.deepEqual(authorizeOwnerDecision(record, { ...request, approvedScopes: ['report-status'] }, owner, now), {
    ok: true, nextStatus: 'approved', actor: 'owner@example.com', decidedAt: now.toISOString(),
    approvedScopes: ['report-status'],
  });
  assert.deepEqual(authorizeOwnerDecision(record, { ...request, approvedScopes: ['pull-desired-state', 'tenant:admin'] }, owner, now), {
    ok: false, status: 400, error: 'invalid_approved_scopes',
  });
});

test('owner decision rejects a mismatched code and stale profile revision', () => {
  assert.deepEqual(authorizeOwnerDecision(record, { ...request, matchingCode: 'ZZZZ-ZZZZ-ZZZZ' }, owner, now), {
    ok: false, status: 400, error: 'matching_code_mismatch',
  });
  assert.deepEqual(authorizeOwnerDecision(record, { ...request, profileRevision: 'sha256:old' }, owner, now), {
    ok: false, status: 409, error: 'stale_profile_revision',
  });
});

test('owner decision rejects wrong actor, absent reauthentication, and an old session', () => {
  assert.deepEqual(authorizeOwnerDecision(record, request, { ...owner, actor: 'attacker@example.com' }, now), {
    ok: false, status: 403, error: 'wrong_actor',
  });
  assert.deepEqual(authorizeOwnerDecision(record, request, null, now), {
    ok: false, status: 401, error: 'reauthentication_required',
  });
  assert.deepEqual(authorizeOwnerDecision(record, request, { ...owner, authenticatedAt: '2026-11-08T11:54:59.999Z' }, now), {
    ok: false, status: 401, error: 'reauthentication_required',
  });
});

test('expired and already-decided pairings cannot be replayed', () => {
  assert.equal(authorizeOwnerDecision({ ...record, expiresAt: now.toISOString() }, request, owner, now).error, 'expired');
  assert.equal(authorizeOwnerDecision({ ...record, status: 'approved' }, request, owner, now).error, 'pairing_not_pending');
});

test('owner-bound context requires the freshly authenticated intended owner', () => {
  assert.deepEqual(authorizeOwnerContextRead(record.ownerActor, null, now), {
    ok: false, status: 401, error: 'reauthentication_required',
  });
  assert.deepEqual(authorizeOwnerContextRead(record.ownerActor, { ...owner, actor: 'wrong@example.com' }, now), {
    ok: false, status: 403, error: 'wrong_actor',
  });
  assert.deepEqual(authorizeOwnerContextRead(record.ownerActor, owner, now), {
    ok: true, actor: 'owner@example.com',
  });
});
