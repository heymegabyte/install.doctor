import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  authorizePasskeyRecoveryRegistration,
  consumePrivilegedStepUp,
  hashStepUpChallenge,
  PrivilegedStepUpRecord,
  verifiedPasskeySessionFromBetterAuth,
  verifyPrivilegedStepUp,
} from '../src/privileged-step-up.ts';
import fs from 'node:fs';

const challenge = 'A'.repeat(43);
const now = new Date('2026-11-11T12:00:00.000Z');
const binding = {
  actor: 'better-auth-user:owner_1', origin: 'https://desktop.tools',
  target: { kind: 'host', id: 'host-1' }, planDigest: 'a'.repeat(64),
  scopes: ['plan:apply', 'secret:read'],
};
const pending = {
  schemaVersion: 1, id: 'step-up-1', challengeSha256: hashStepUpChallenge(challenge), binding,
  status: 'pending', issuedAt: '2026-11-11T11:59:00.000Z', expiresAt: '2026-11-11T12:04:00.000Z',
  verifiedAt: null, verifiedSessionId: null, credentialId: null, credentialRevocationEpoch: 4,
  consumedAt: null, revokedAt: null,
};
const passkey = {
  actor: binding.actor, origin: binding.origin, sessionId: 'session-2',
  authenticatedAt: '2026-11-11T11:59:59.000Z', credentialId: 'credential-1',
  credentialActive: true, credentialRevocationEpoch: 4,
};

test('verified passkey step-up binds actor, challenge, origin, target, plan, scope and fresh session', () => {
  const verified = verifyPrivilegedStepUp(pending, challenge, binding, passkey, now);
  assert.equal(verified.ok, true);
  assert.equal(verified.record.status, 'verified');
  assert.equal(verified.record.verifiedSessionId, passkey.sessionId);
  assert.equal(verified.record.credentialId, passkey.credentialId);
  const consumed = consumePrivilegedStepUp(verified.record, challenge, binding, passkey, now);
  assert.equal(consumed.ok, true);
  assert.equal(consumed.record.status, 'consumed');
  assert.deepEqual(consumePrivilegedStepUp(consumed.record, challenge, binding, passkey, now),
    { ok: false, error: 'not_verified' });
});

test('official Better Auth success projection is strict and origin-bound', () => {
  const proof = verifiedPasskeySessionFromBetterAuth({
    user: { id: 'owner_1' }, session: { id: 'session-2', createdAt: passkey.authenticatedAt },
  }, { response: { id: 'credential-1', response: { clientDataJSON: 'opaque' } } }, binding.origin, 4);
  assert.deepEqual(proof, passkey);
  assert.equal(verifiedPasskeySessionFromBetterAuth({ user: { id: 'owner_1' } },
    { response: { id: 'credential-1' } }, binding.origin, 4), null);
  assert.equal(verifiedPasskeySessionFromBetterAuth({ user: { id: 'owner_1' }, session: { id: 'session-2', createdAt: passkey.authenticatedAt } },
    { response: { id: 'credential-1' } }, 'https://profile.desktop.tools', 4), null);
});

test('every binding dimension and stale reauthentication fail closed', () => {
  assert.equal(verifyPrivilegedStepUp(pending, 'B'.repeat(43), binding, passkey, now).error, 'challenge_mismatch');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, { ...binding, planDigest: 'b'.repeat(64) }, passkey, now).error, 'invalid_binding');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, { ...binding, target: { ...binding.target, id: 'host-2' } }, passkey, now).error, 'invalid_binding');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, { ...binding, scopes: ['plan:apply'] }, passkey, now).error, 'invalid_binding');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, binding, { ...passkey, actor: 'better-auth-user:other' }, now).error, 'wrong_actor');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, binding, { ...passkey, origin: 'https://brian.desktop.tools' }, now).error, 'wrong_origin');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, binding, { ...passkey, authenticatedAt: '2026-11-11T11:58:59.000Z' }, now).error, 'reauthentication_required');
});

test('credential deletion or epoch rotation invalidates verification and consumption', () => {
  assert.equal(verifyPrivilegedStepUp(pending, challenge, binding, { ...passkey, credentialActive: false }, now).error, 'credential_revoked');
  assert.equal(verifyPrivilegedStepUp(pending, challenge, binding, { ...passkey, credentialRevocationEpoch: 5 }, now).error, 'revocation_epoch_changed');
  const verified = verifyPrivilegedStepUp(pending, challenge, binding, passkey, now).record;
  assert.equal(consumePrivilegedStepUp(verified, challenge, binding, { ...passkey, credentialActive: false }, now).error, 'credential_revoked');
});

test('fresh OAuth recovery may register but never grants privilege', () => {
  assert.deepEqual(authorizePasskeyRecoveryRegistration(binding.actor,
    { actor: binding.actor, authenticatedAt: '2026-11-11T11:59:00.000Z' }, now), { ok: true });
  assert.deepEqual(authorizePasskeyRecoveryRegistration(binding.actor,
    { actor: 'better-auth-user:other', authenticatedAt: '2026-11-11T11:59:00.000Z' }, now),
    { ok: false, error: 'wrong_actor' });
  assert.equal(authorizePasskeyRecoveryRegistration(binding.actor,
    { actor: binding.actor, authenticatedAt: '2026-11-11T11:00:00.000Z' }, now).error, 'reauthentication_required');
});

test('migration enforces challenge lifecycle and canonical origin', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(fs.readFileSync(new URL('../migrations/0020_privileged_step_up.sql', import.meta.url), 'utf8'));
    const statement = db.prepare(`INSERT INTO privileged_step_up_challenges
      (id,challenge_sha256,actor,origin,target_kind,target_id,plan_digest,scopes_json,status,issued_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    statement.run('step-1', 'a'.repeat(64), binding.actor, binding.origin, 'host', 'host-1', binding.planDigest,
      JSON.stringify(binding.scopes), 'pending', pending.issuedAt, pending.expiresAt);
    assert.throws(() => statement.run('step-2', 'b'.repeat(64), binding.actor, 'https://evil.example', 'host',
      'host-1', binding.planDigest, JSON.stringify(binding.scopes), 'pending', pending.issuedAt, pending.expiresAt));
    assert.equal(db.prepare('SELECT count(*) AS count FROM privileged_step_up_challenges').get().count, 1);
  } finally { db.close(); }
});

test('strict record schema rejects ambiguous evidence and unsorted scope', () => {
  assert.equal(PrivilegedStepUpRecord.safeParse({ ...pending, binding: { ...binding, scopes: ['secret:read', 'plan:apply'] } }).success, false);
  assert.equal(PrivilegedStepUpRecord.safeParse({ ...pending, verifiedSessionId: 'session-2' }).success, false);
});
