import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PrivilegedStepUpRecord,
  verifiedPasskeySessionFromBetterAuth,
  verifyPrivilegedStepUp,
} from '../src/privileged-step-up.ts';
import { createWorkerFixture } from './helpers/worker-app-fixture.mjs';

const cookiePair = value => value.split(';', 1)[0];
const setCookies = headers => typeof headers.getSetCookie === 'function'
  ? headers.getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);

async function githubSession(app, env, serial) {
  const started = await app.fetch(new Request('https://desktop.tools/api/auth/sign-in/social', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.20' },
    body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
  }), env);
  assert.equal(started.status, 200, await started.clone().text());
  const providerUrl = new URL((await started.json()).url);
  const stateCookie = setCookies(started.headers).find(value => value.startsWith('__Secure-better-auth.state='));
  assert.ok(stateCookie);
  const state = providerUrl.searchParams.get('state');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url === 'https://github.com/login/oauth/access_token' && method === 'POST') {
      return Response.json({ access_token: `token-${serial}`, token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url === 'https://api.github.com/user' && method === 'GET') {
      return Response.json({ id: 271828, login: 'step-up-owner', name: 'Step Up Owner',
        email: 'step-up@example.test', avatar_url: 'https://avatars.example.test/step-up' });
    }
    if (url === 'https://api.github.com/user/emails' && method === 'GET') {
      return Response.json([{ email: 'step-up@example.test', primary: true, verified: true }]);
    }
    throw new Error(`unexpected provider request: ${method} ${url}`);
  };
  try {
    const callback = await app.fetch(new Request(
      `https://desktop.tools/api/auth/callback/github?code=code-${serial}&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookiePair(stateCookie), 'cf-connecting-ip': '192.0.2.20' }, redirect: 'manual' },
    ), env);
    assert.equal(callback.status, 302, await callback.clone().text());
    const sessionCookie = setCookies(callback.headers)
      .find(value => value.startsWith('__Secure-better-auth.session_token='));
    assert.ok(sessionCookie);
    const cookie = cookiePair(sessionCookie);
    const response = await app.fetch(new Request('https://desktop.tools/api/auth/get-session', {
      headers: { cookie, 'cf-connecting-ip': '192.0.2.20' },
    }), env);
    assert.equal(response.status, 200, await response.clone().text());
    return { cookie, value: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function rowToRecord(row) {
  return PrivilegedStepUpRecord.parse({
    schemaVersion: 1, id: row.id, challengeSha256: row.challenge_sha256,
    binding: { actor: row.actor, origin: row.origin,
      target: { kind: row.target_kind, id: row.target_id }, planDigest: row.plan_digest,
      scopes: JSON.parse(row.scopes_json) },
    status: row.status, issuedAt: row.issued_at, expiresAt: row.expires_at,
    verifiedAt: row.verified_at, verifiedSessionId: row.verified_session_id,
    credentialId: row.credential_id, credentialRevocationEpoch: row.credential_revocation_epoch,
    consumedAt: row.consumed_at, revokedAt: row.revoked_at,
  });
}

async function mockOfficialVerification(db, issued, session, credentialId) {
  const row = await db.prepare('SELECT * FROM privileged_step_up_challenges WHERE id=?').bind(issued.id).first();
  const record = rowToRecord(row);
  const authenticatedAt = new Date(Math.max(Date.now(), Date.parse(record.issuedAt) + 1)).toISOString();
  const proof = verifiedPasskeySessionFromBetterAuth({
    user: session.value.user,
    session: { ...session.value.session, createdAt: authenticatedAt },
  }, { response: { id: credentialId } }, 'https://desktop.tools', record.credentialRevocationEpoch);
  assert.ok(proof, 'documented Better Auth verification response must project to a proof');
  const verified = verifyPrivilegedStepUp(record, issued.challenge, issued.binding, proof, new Date(authenticatedAt));
  assert.equal(verified.ok, true);
  const updated = await db.prepare(`UPDATE privileged_step_up_challenges
    SET status='verified',verified_at=?,verified_session_id=?,credential_id=?
    WHERE id=? AND status='pending' AND challenge_sha256=? AND actor=? AND expires_at>?`).bind(
      verified.record.verifiedAt, verified.record.verifiedSessionId, verified.record.credentialId,
      record.id, record.challengeSha256, record.binding.actor, verified.record.verifiedAt).run();
  assert.equal(updated.meta.changes, 1, 'verification must transition pending to verified exactly once');
}

test('HTTP/D1 step-up is exactly bound, one-time, and denied after official passkey deletion', async t => {
  const fixture = await createWorkerFixture();
  t.after(() => fixture.cleanup());
  const first = await githubSession(fixture.app, fixture.env, 1);
  const headers = { cookie: first.cookie, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.20' };
  const input = { target: { kind: 'host', id: 'host-1' }, planDigest: 'a'.repeat(64), scopes: ['plan:apply'] };
  const issueResponse = await fixture.app.fetch(new Request('https://desktop.tools/api/v1/privileged-step-up/challenges', {
    method: 'POST', headers, body: JSON.stringify(input),
  }), fixture.env);
  assert.equal(issueResponse.status, 201, await issueResponse.clone().text());
  const issued = await issueResponse.json();

  const verifiedSession = await githubSession(fixture.app, fixture.env, 2);
  const credentialId = 'credential-1';
  await fixture.db.prepare(`INSERT INTO passkey
    (id,name,publicKey,userId,credentialID,counter,deviceType,backedUp,createdAt)
    VALUES (?,?,?,?,?,0,'singleDevice',0,?)`).bind(
      'passkey-1', 'fixture', 'fixture-public-key', verifiedSession.value.user.id,
      credentialId, new Date().toISOString()).run();
  await mockOfficialVerification(fixture.db, issued, verifiedSession, credentialId);

  const consumeBody = JSON.stringify({ id: issued.id, challenge: issued.challenge, ...input });
  const consumeHeaders = { cookie: verifiedSession.cookie, 'content-type': 'application/json',
    'cf-connecting-ip': '192.0.2.20', origin: 'https://desktop.tools' };
  const consumed = await fixture.app.fetch(new Request('https://desktop.tools/api/v1/privileged-step-up/consume', {
    method: 'POST', headers: consumeHeaders, body: consumeBody,
  }), fixture.env);
  assert.equal(consumed.status, 200, await consumed.clone().text());
  assert.equal((await consumed.json()).status, 'consumed');
  const replay = await fixture.app.fetch(new Request('https://desktop.tools/api/v1/privileged-step-up/consume', {
    method: 'POST', headers: consumeHeaders, body: consumeBody,
  }), fixture.env);
  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).error, 'not_verified');

  const secondIssueResponse = await fixture.app.fetch(new Request('https://desktop.tools/api/v1/privileged-step-up/challenges', {
    method: 'POST', headers: consumeHeaders, body: JSON.stringify(input),
  }), fixture.env);
  assert.equal(secondIssueResponse.status, 201, await secondIssueResponse.clone().text());
  const secondIssued = await secondIssueResponse.json();
  await mockOfficialVerification(fixture.db, secondIssued, verifiedSession, credentialId);
  const deleted = await fixture.app.fetch(new Request('https://desktop.tools/api/auth/passkey/delete-passkey', {
    method: 'POST', headers: consumeHeaders, body: JSON.stringify({ id: 'passkey-1' }),
  }), fixture.env);
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const denied = await fixture.app.fetch(new Request('https://desktop.tools/api/v1/privileged-step-up/consume', {
    method: 'POST', headers: consumeHeaders,
    body: JSON.stringify({ id: secondIssued.id, challenge: secondIssued.challenge, ...input }),
  }), fixture.env);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'credential_revoked');

  const recovery = await fixture.app.fetch(new Request('https://desktop.tools/api/auth/passkey/generate-register-options', {
    method: 'GET', headers: { cookie: verifiedSession.cookie, 'cf-connecting-ip': '192.0.2.20' },
  }), fixture.env);
  assert.equal(recovery.status, 200, await recovery.clone().text());
  const registration = await recovery.json();
  assert.equal(registration.rp.id, 'desktop.tools');
  assert.equal(registration.authenticatorSelection.userVerification, 'required');
});
