import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintDigest, exportMarkdown } from '../../aid-core/dist/core.js';
import { createWorkerFixture } from './helpers/worker-app-fixture.mjs';

const cookiePair = value => value.split(';', 1)[0];
const setCookies = headers => typeof headers.getSetCookie === 'function'
  ? headers.getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);

test('actual Better Auth callback session completes exact owner enrollment without an admin token', async t => {
  const fixture = await createWorkerFixture();
  t.after(() => fixture.cleanup());
  const { app, db } = fixture;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const returnCode = '2345-6789';
  const startedSignIn = await app.fetch(new Request('https://desktop.tools/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.10' },
    body: JSON.stringify({ provider: 'github', callbackURL: `/pair?code=${returnCode}` }),
  }), fixture.env);
  assert.equal(startedSignIn.status, 200, await startedSignIn.clone().text());
  const signIn = await startedSignIn.json();
  const providerUrl = new URL(signIn.url);
  assert.equal(providerUrl.origin, 'https://github.com');
  assert.equal(providerUrl.searchParams.get('redirect_uri'), 'https://desktop.tools/api/auth/callback/github');
  const state = providerUrl.searchParams.get('state');
  assert.match(state, /^[A-Za-z0-9_-]{20,}$/);
  const stateSetCookie = setCookies(startedSignIn.headers).find(value => value.startsWith('__Secure-better-auth.state='));
  assert.ok(stateSetCookie);
  assert.match(stateSetCookie, /; HttpOnly; Secure; SameSite=Lax/);

  const providerRequests = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    providerRequests.push({ url, method });
    if (url === 'https://github.com/login/oauth/access_token' && method === 'POST') {
      return Response.json({ access_token: 'fixture-access-token', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url === 'https://api.github.com/user' && method === 'GET') {
      return Response.json({ id: 314159, login: 'fixture-owner', name: 'Fixture Owner',
        email: 'owner@example.test', avatar_url: 'https://avatars.example.test/owner' });
    }
    if (url === 'https://api.github.com/user/emails' && method === 'GET') {
      return Response.json([{ email: 'owner@example.test', primary: true, verified: true, visibility: 'private' }]);
    }
    throw new Error(`unexpected provider request: ${method} ${url}`);
  };

  const callback = await app.fetch(new Request(
    `https://desktop.tools/api/auth/callback/github?code=fixture-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookiePair(stateSetCookie), 'cf-connecting-ip': '192.0.2.10' }, redirect: 'manual' },
  ), fixture.env);
  assert.equal(callback.status, 302, await callback.clone().text());
  assert.equal(callback.headers.get('location'), `/pair?code=${returnCode}`);
  assert.deepEqual(providerRequests, [
    { url: 'https://github.com/login/oauth/access_token', method: 'POST' },
    { url: 'https://api.github.com/user', method: 'GET' },
    { url: 'https://api.github.com/user/emails', method: 'GET' },
  ]);
  const sessionSetCookie = setCookies(callback.headers).find(value => value.startsWith('__Secure-better-auth.session_token='));
  assert.ok(sessionSetCookie);
  assert.match(sessionSetCookie, /; HttpOnly; Secure; SameSite=Lax/);
  const sessionCookie = cookiePair(sessionSetCookie);

  const sessionResponse = await app.fetch(new Request('https://desktop.tools/api/auth/get-session', {
    headers: { cookie: sessionCookie, 'cf-connecting-ip': '192.0.2.10' },
  }), fixture.env);
  assert.equal(sessionResponse.status, 200, await sessionResponse.clone().text());
  const session = await sessionResponse.json();
  assert.equal(session.user.email, 'owner@example.test');
  assert.equal(session.user.emailVerified, true);
  assert.match(session.user.id, /^[A-Za-z0-9_-]+$/);

  const desired = {
    schemaVersion: 4, revision: 'revision-oidc', appUrl: 'https://desktop.tools',
    routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
    skills: { repository: 'heymegabyte/agent-skills', commit: 'a'.repeat(40), include: [] },
    defaults: { packages: [], shellHistory: 'hishtory', tier: 'workstation' },
    roles: [{ id: 'workstation', tier: 'workstation', packages: [], capabilities: ['workstation'] }],
    machines: [], services: [],
    privacy: { shellAnalysis: 'local', screenshots: 'off', terminalInput: false, productLearning: false },
    profile: { id: 'profile-oidc', revision: 'revision-oidc', visibility: 'public-bootstrap' },
    promptPolicy: { id: 'deterministic', version: 'v1', mode: 'deterministic-only', allowedRoutes: [] },
    secretReferences: [],
  };
  const profile = { id: 'profile-oidc', tenantId: 'tenant-oidc', slug: 'oidc', revision: 'revision-oidc',
    digest: await blueprintDigest(desired), visibility: 'public-bootstrap', enabled: true };
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO blueprints (tenant, markdown, updated_at) VALUES (?, ?, ?)')
    .bind(profile.tenantId, exportMarkdown(desired), now).run();
  await db.prepare(`INSERT INTO tenant_owner_authority
    (authority_id, tenant_id, owner_actor_id, better_auth_user_id, authentication_actor, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`).bind(
      'authority-oidc', profile.tenantId, 'owner-oidc', session.user.id,
      `better-auth-user:${session.user.id}`, now,
    ).run();
  const env = { ...fixture.env, DESKTOP_TOOLS_PUBLIC_PROFILES: [profile] };
  const pollSecret = 'p'.repeat(43);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const binding = { profileId: profile.id, targetPublicKey: 'A'.repeat(43), targetKeyFingerprint: 'b'.repeat(64),
    scopes: ['profile:read', 'session:create'], nonce: 'n'.repeat(32), expiresAt };
  const authorizationResponse = await app.fetch(new Request('https://oidc.desktop.tools/api/v1/device-authorizations/start', {
    method: 'POST', headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ binding, machineLabel: 'OIDC Fixture Host' }),
  }), env);
  assert.equal(authorizationResponse.status, 201, await authorizationResponse.clone().text());
  const authorization = await authorizationResponse.json();

  const ownerHeaders = { cookie: sessionCookie, 'cf-connecting-ip': '192.0.2.10' };
  const reviewResponse = await app.fetch(new Request(
    `https://desktop.tools/api/v1/device-authorizations/review?code=${authorization.request.verificationCode}`,
    { headers: ownerHeaders },
  ), env);
  assert.equal(reviewResponse.status, 200, await reviewResponse.clone().text());
  const review = await reviewResponse.json();
  assert.equal(review.actor, undefined, 'review must not echo owner authority into the browser payload');
  assert.equal(review.targetKeyFingerprint, binding.targetKeyFingerprint);
  assert.deepEqual(review.requestedScopes, binding.scopes);

  const decisionResponse = await app.fetch(new Request('https://desktop.tools/api/v1/device-authorizations/decision', {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: review.requestId, verificationCode: review.matchingCode,
      profileId: review.profileId, profileRevision: review.profileRevision,
      profileRevisionDigest: review.profileRevisionDigest, targetKeyFingerprint: review.targetKeyFingerprint,
      requestedScopes: review.requestedScopes, decision: 'approve', approvedScopes: review.requestedScopes }),
  }), env);
  assert.equal(decisionResponse.status, 200, await decisionResponse.clone().text());
  assert.equal(decisionResponse.headers.get('authorization'), null);

  const pollUrl = `https://oidc.desktop.tools/api/v1/device-authorizations/${review.requestId}/poll`;
  const claimResponse = await app.fetch(new Request(pollUrl, { method: 'POST',
    headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(claimResponse.status, 200, await claimResponse.clone().text());
  const claim = await claimResponse.json();
  assert.equal(claim.status, 'approved');
  assert.match(claim.credential, /^dtc_[a-f0-9]{64}$/);
  const replay = await app.fetch(new Request(pollUrl, { method: 'POST',
    headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(replay.status, 404);
});
