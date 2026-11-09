import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { authorizeOwnerContextRead, authorizeOwnerDecision, persistOwnerDecision } from '../src/owner-approval.ts';

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

test('privileged-run authority is explicit, narrowable, and never implied for legacy requests', () => {
  const privileged = { ...record, requestedScopes: ['pull-desired-state', 'authorize-privileged-run'] };
  assert.equal(authorizeOwnerDecision(privileged, { ...request,
    approvedScopes: ['authorize-privileged-run'] }, owner, now).ok, true);
  assert.deepEqual(authorizeOwnerDecision(record, { ...request,
    approvedScopes: ['authorize-privileged-run'] }, owner, now), {
    ok: false, status: 400, error: 'invalid_approved_scopes',
  });
});

test('privileged owner decision binds the exact server-resolved profile id and digest', () => {
  const digest = 'a'.repeat(64);
  const privileged = { ...record, profileRevision: digest, profileId: 'profile-1',
    profileRevisionDigest: digest, requestedScopes: ['authorize-privileged-run'] };
  const exact = { ...request, profileRevision: digest, profileId: 'profile-1',
    profileRevisionDigest: digest, approvedScopes: ['authorize-privileged-run'] };
  assert.equal(authorizeOwnerDecision(privileged, exact, owner, now).ok, true);
  for (const changed of [{ profileId: undefined }, { profileId: 'profile-2' },
    { profileRevisionDigest: undefined }, { profileRevisionDigest: 'b'.repeat(64) }]) {
    assert.deepEqual(authorizeOwnerDecision(privileged, { ...exact, ...changed }, owner, now), {
      ok: false, status: 409, error: 'stale_profile_revision',
    });
  }
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

test('decision persistence is atomic with the exact reviewed row and expiry', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE pairings (
    code text primary key, status text not null, expires_at text not null, profile_revision text not null,
    owner_actor text not null, permissions text not null, profile_id text, profile_revision_digest text,
    approved_at text, denied_at text, decided_by text, approved_scopes text
  )`);
  const database = { prepare(sql) { const statement = sqlite.prepare(sql); return {
    bind(...values) { return { async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } }; },
  }; } };
  const reviewed = { code: record.code, expiresAt: record.expiresAt, profileRevision: record.profileRevision,
    ownerActor: record.ownerActor, permissionsJson: JSON.stringify(record.requestedScopes), profileId: null,
    profileRevisionDigest: null };
  const approved = authorizeOwnerDecision(record, request, owner, now);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const insert = () => sqlite.prepare(`INSERT INTO pairings
    (code,status,expires_at,profile_revision,owner_actor,permissions,profile_id,profile_revision_digest)
    VALUES (?,?,?,?,?,?,?,?)`).run(reviewed.code, 'pending', reviewed.expiresAt, reviewed.profileRevision,
    reviewed.ownerActor, reviewed.permissionsJson, reviewed.profileId, reviewed.profileRevisionDigest);
  insert();
  sqlite.prepare('UPDATE pairings SET profile_revision=? WHERE code=?').run('sha256:changed-after-review', reviewed.code);
  assert.equal(await persistOwnerDecision(database, reviewed, approved), false);
  assert.equal(sqlite.prepare('SELECT status FROM pairings WHERE code=?').get(reviewed.code).status, 'pending');

  sqlite.prepare('DELETE FROM pairings').run();
  insert();
  assert.equal(await persistOwnerDecision(database, reviewed, approved), true);
  assert.deepEqual({ ...sqlite.prepare('SELECT status, decided_by, approved_scopes FROM pairings WHERE code=?').get(reviewed.code) }, {
    status: 'approved', decided_by: 'owner@example.com', approved_scopes: '["pull-desired-state","report-status"]',
  });
});
