import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { blueprintDigest, exportMarkdown } from '../../aid-core/dist/core.js';
import { main as runSupervisor } from '../../desktop-tools-runtime/src/desktop-tools-supervisor.mjs';
import { createProtocolRuntimeFixture } from '../../desktop-tools-runtime/test/helpers/runtime-fixture.mjs';
import { createWorkerFixture } from './helpers/worker-app-fixture.mjs';

test('disposable composition carries profile and authorization identity through Worker routes and supervisor launch', async t => {
  const fixture = await createWorkerFixture();
  t.after(() => fixture.cleanup());
  const { app, db } = fixture;
  const desiredEnvironment = {
    schemaVersion: 4, revision: 'revision-1', appUrl: 'https://desktop.tools',
    routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
    skills: { repository: 'heymegabyte/agent-skills', commit: 'a'.repeat(40), include: [] },
    defaults: { packages: ['git'], shellHistory: 'hishtory', tier: 'workstation' },
    roles: [{ id: 'workstation', tier: 'workstation', packages: ['ripgrep'], capabilities: ['workstation'] }],
    machines: [{ id: 'fixture-host', os: 'linux', role: 'workstation', tier: 'workstation', capabilities: ['linux'], packageOverrides: { add: [], remove: [] } }],
    services: [], privacy: { shellAnalysis: 'local', screenshots: 'off', terminalInput: false, productLearning: false },
    profile: { id: 'profile-example', revision: 'revision-1', visibility: 'public-bootstrap' },
    promptPolicy: { id: 'deterministic', version: 'v1', mode: 'deterministic-only', allowedRoutes: [] },
    secretReferences: [],
  };
  const profile = {
    id: 'profile-example', tenantId: 'tenant-example', slug: 'example', revision: 'revision-1',
    digest: await blueprintDigest(desiredEnvironment), visibility: 'public-bootstrap', enabled: true,
  };
  const now = new Date(); const later = new Date(now.getTime() + 10 * 60_000);
  await db.prepare('INSERT INTO blueprints (tenant, markdown, updated_at) VALUES (?, ?, ?)')
    .bind(profile.tenantId, exportMarkdown(desiredEnvironment), now.toISOString()).run();
  await db.prepare(`INSERT INTO tenant_owner_authority
    (authority_id, tenant_id, owner_actor_id, better_auth_user_id, authentication_actor, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`)
    .bind('authority-1', profile.tenantId, 'owner-1', 'owner-1', 'better-auth-user:owner-1', now.toISOString()).run();
  const env = { ...fixture.env, DESKTOP_TOOLS_PUBLIC_PROFILES: [profile] };

  const descriptorResponse = await app.fetch(new Request('https://example.desktop.tools/.well-known/desktop-tools-profile.json'), env);
  assert.equal(descriptorResponse.status, 200, await descriptorResponse.clone().text());
  assert.deepEqual(await descriptorResponse.json(), { schemaVersion: 1, profile: {
    id: profile.id, slug: profile.slug, revision: profile.revision, digest: profile.digest,
  } });
  for (const url of ['https://unknown.desktop.tools/', 'https://nested.example.desktop.tools/', 'https://example.desktop.tools/unrelated']) {
    assert.notEqual((await app.fetch(new Request(url), env)).status, 200, `unexpected profile fallback for ${url}`);
  }

  const pollSecret = 'p'.repeat(43);
  const binding = { profileId: profile.id, targetPublicKey: 'A'.repeat(43), targetKeyFingerprint: 'b'.repeat(64),
    scopes: ['profile:read', 'session:create'], nonce: 'n'.repeat(32), expiresAt: later.toISOString() };
  const startedResponse = await app.fetch(new Request('https://example.desktop.tools/api/v1/device-authorizations/start', {
    method: 'POST', headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ binding, machineLabel: 'Fixture Host' }),
  }), env);
  assert.equal(startedResponse.status, 201, await startedResponse.clone().text());
  const started = await startedResponse.json();
  const reviewUrl = `https://desktop.tools/api/v1/device-authorizations/review?code=${started.request.verificationCode}`;
  assert.equal((await app.fetch(new Request(reviewUrl), env)).status, 401);
  // OIDC callback/session completion is deliberately not forged here. Until
  // task 4.5 is complete, the fixture owner decision is the explicit reason
  // this evidence can never be promoted as production or real-host evidence.
  await db.prepare("UPDATE device_authorizations SET status='approved', approved_scopes=?, approved_at=? WHERE request_id=?")
    .bind(JSON.stringify(binding.scopes), now.toISOString(), started.request.requestId).run();
  const pollResponse = await app.fetch(new Request(`https://example.desktop.tools/api/v1/device-authorizations/${started.request.requestId}/poll`, {
    method: 'POST', headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(pollResponse.status, 200, await pollResponse.clone().text());
  const credential = await pollResponse.json();
  assert.equal(credential.status, 'approved');
  assert.match(credential.credential, /^dtc_[a-f0-9]{64}$/);
  assert.equal(JSON.stringify({ started, credential }).includes(pollSecret), false);
  const replay = await app.fetch(new Request(`https://example.desktop.tools/api/v1/device-authorizations/${started.request.requestId}/poll`, {
    method: 'POST', headers: { authorization: `Bearer ${pollSecret}`, 'content-type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(replay.status, 404);

  const runtime = await createProtocolRuntimeFixture({
    profileId: profile.id, profileRevision: profile.revision, profileDigest: profile.digest,
    releaseId: 'fixture-release-1', releaseDigest: '6'.repeat(64), deviceFingerprint: binding.targetKeyFingerprint,
    authorizationId: started.request.requestId, authorizationExpiresAt: credential.expiresAt,
    scopes: binding.scopes, sessionId: 'session-composition-1', runId: 'run-composition-1',
  });
  t.after(() => runtime.cleanup());
  process.env.OPENAI_API_KEY = 'ambient-openai-must-not-leak';
  process.env.API_TOKEN = 'ambient-api-token-must-not-leak';
  let supervisorResult;
  try { supervisorResult = await runSupervisor(runtime.args); }
  finally { delete process.env.OPENAI_API_KEY; delete process.env.API_TOKEN; }
  assert.equal(await readFile(join(runtime.state, 'argv'), 'utf8'), 'serve\n--hostname\n127.0.0.1\n--port\n4123\n');
  const observedEnvironment = await readFile(join(runtime.state, 'observed-environment'), 'utf8');
  for (const forbidden of ['OPENAI_API_KEY', 'API_TOKEN', 'ambient-openai-must-not-leak', 'ambient-api-token-must-not-leak', pollSecret, credential.credential]) {
    assert.equal(observedEnvironment.includes(forbidden), false, `supervisor leaked ${forbidden}`);
  }
  const config = JSON.parse(await readFile(join(runtime.state, 'opencode-config'), 'utf8'));
  assert.equal(config.model, 'projectsites/dynamic/code');
  assert.equal(config.providers.projectsites.settings.baseURL, 'https://desktop.tools/api/ai/v1');
  assert.deepEqual(config.policies.slice(0, 2), [
    { action: 'provider.use', resource: '*', effect: 'deny' },
    { action: 'provider.use', resource: 'projectsites', effect: 'allow' },
  ]);
  assert.equal(JSON.stringify(config).toLowerCase().includes('litellm'), false);
  assert.equal(supervisorResult.evidence.captureComplete, false);
  const history = JSON.parse(await readFile(supervisorResult.evidence.historyPath, 'utf8'));
  const recording = JSON.parse(await readFile(supervisorResult.evidence.recordingPath, 'utf8'));
  assert.deepEqual(recording, history);
  assert.equal(history.evidenceState, 'headers-persisted');
  assert.deepEqual(history.profile, runtime.prompt.profile);
  assert.equal(history.authorization.id, started.request.requestId);
  assert.equal(history.machine.fingerprint, binding.targetKeyFingerprint);
  assert.equal(history.release.id, 'fixture-release-1');
  assert.equal((await stat(supervisorResult.evidence.historyPath)).mode & 0o777, 0o600);
});
