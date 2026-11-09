import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { blueprintDigest, exportMarkdown } from '../../aid-core/dist/core.js';
import { DisposableProductCompositionReceiptSchema, RealHostCanaryReceiptSchema } from '../../aid-core/dist/installer-contracts.js';
import { main as runSupervisor } from '../../desktop-tools-runtime/src/desktop-tools-supervisor.mjs';
import { createProtocolRuntimeFixture } from '../../desktop-tools-runtime/test/helpers/runtime-fixture.mjs';
import { createCompositionEngineFixture } from '../../installer-engine/test/helpers/composition-engine-fixture.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]))
    : value;
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
  ? value : `${JSON.stringify(canonical(value))}\n`).digest('hex');
import { createWorkerFixture } from './helpers/worker-app-fixture.mjs';

test('disposable composition carries one identity through Worker, supervisor, engine, recovery, and deprovision preview', async t => {
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

  const engine = await createCompositionEngineFixture({ profileRevision: profile.revision,
    releaseId: 'fixture-release-1', actorId: 'fixture-owner' });
  t.after(() => engine.cleanup());
  const first = engine.makeAdapters('run-composition-1');
  assert.equal((await first.adapters.desktop_tools_discover({ schemaVersion: 1 })).hostId, engine.facts.hostId);
  assert.equal((await first.adapters.desktop_tools_validate({ schemaVersion: 1 })).valid, true);
  const firstPlan = await first.adapters.desktop_tools_plan({ schemaVersion: 1 });
  const firstApproval = await first.adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: firstPlan.digest });
  const firstApply = await first.adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: firstApproval.approvalId });
  assert.equal(firstApply.receipt.status, 'success');
  assert.equal(engine.mutationCount(), 1);
  const firstVerify = await first.adapters.desktop_tools_verify({ schemaVersion: 1, runId: 'run-composition-1', planDigest: firstPlan.digest });
  assert.equal(firstVerify.authority, 'committed');
  const firstStatus = await first.adapters.desktop_tools_status({ schemaVersion: 1, runId: 'run-composition-1', planDigest: firstPlan.digest });
  assert.equal(firstStatus.receipt.status, 'success');
  const beforeSecondRun = await engine.snapshot();

  const second = engine.makeAdapters('run-composition-2');
  const secondPlan = await second.adapters.desktop_tools_plan({ schemaVersion: 1 });
  const secondApproval = await second.adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: secondPlan.digest });
  const secondApply = await second.adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: secondApproval.approvalId });
  assert.equal(secondApply.receipt.status, 'success');
  assert.equal(engine.mutationCount(), 1, 'unchanged second run must not apply configuration again');
  assert.deepEqual(await engine.snapshot(), beforeSecondRun, 'unchanged second run must preserve inode, bytes, mode, and timestamp');

  await engine.resetTarget();
  const controller = new AbortController();
  const entered = engine.prepareInterruption();
  const interrupted = engine.makeAdapters('run-composition-interrupted', { signal: controller.signal });
  const interruptedPlan = await interrupted.adapters.desktop_tools_plan({ schemaVersion: 1 });
  const interruptedApproval = await interrupted.adapters.desktop_tools_approve({ schemaVersion: 1, planDigest: interruptedPlan.digest });
  const interruptedApply = interrupted.adapters.desktop_tools_apply({ schemaVersion: 1, approvalId: interruptedApproval.approvalId });
  await entered; controller.abort(new Error('disposable composition interruption'));
  const cancelled = await interruptedApply;
  assert.equal(cancelled.receipt.status, 'cancelled');
  assert.equal((await engine.journal.inspectCompletion('run-composition-interrupted', interruptedPlan.digest)).authority, 'uncommitted');
  const resumed = await interrupted.adapters.desktop_tools_resume({ schemaVersion: 1, approvalId: interruptedApproval.approvalId });
  assert.equal(resumed.receipt.status, 'success');
  assert.equal(engine.mutationCount(), 2, 'resume must recheck and not replay the landed interrupted mutation');
  assert.equal((await engine.journal.inspectCompletion('run-composition-interrupted', interruptedPlan.digest)).authority, 'committed');

  const compensation = (await engine.journal.readCompensations('run-composition-interrupted', interruptedPlan.digest))[0];
  const beforePreview = await engine.snapshot();
  const ownershipEvidence = { schemaVersion: 1, owner: 'install.doctor', sourceRunId: 'run-composition-interrupted',
    artifactDigest: compensation.record.artifactDigest, appliedDigest: compensation.appliedDigest };
  const preview = await interrupted.adapters.desktop_tools_deprovision_preview({
    schemaVersion: 1, sourceRunId: 'run-composition-interrupted', sourcePlanDigest: interruptedPlan.digest,
    resources: [
      { schemaVersion: 1, resourceId: 'config.composition', effect: 'configuration', target: engine.target,
        ownership: 'installer-owned', ownershipEvidence, observedDigest: beforePreview.digest, userData: 'absent' },
      { schemaVersion: 1, resourceId: 'config.modified', effect: 'configuration', target: `${engine.target}.modified`,
        ownership: 'installer-owned', ownershipEvidence, observedDigest: 'f'.repeat(64), userData: 'absent' },
      { schemaVersion: 1, resourceId: 'data.user', effect: 'user-data', target: `${engine.target}.user`,
        ownership: 'user-owned', ownershipEvidence: null, observedDigest: '1'.repeat(64), userData: 'present' },
      { schemaVersion: 1, resourceId: 'config.unowned', effect: 'configuration', target: `${engine.target}.unowned`,
        ownership: 'unowned', ownershipEvidence: null, observedDigest: '2'.repeat(64), userData: 'absent' },
      { schemaVersion: 1, resourceId: 'storage.unsupported', effect: 'storage', target: `${engine.target}.storage`,
        ownership: 'installer-owned', ownershipEvidence, observedDigest: compensation.appliedDigest, userData: 'absent' },
    ],
  });
  assert.equal(preview.executable, false);
  assert.deepEqual(preview.eligibleResourceIds, ['config.composition']);
  assert.deepEqual(preview.refusedResourceIds, ['config.modified', 'config.unowned', 'data.user', 'storage.unsupported']);
  assert.deepEqual(await engine.snapshot(), beforePreview, 'deprovision preview must not mutate managed state');

  const rollbackPlan = await interrupted.adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'plan',
    sourceRunId: 'run-composition-interrupted', sourcePlanDigest: interruptedPlan.digest });
  const rollbackApproval = await interrupted.adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'approve',
    sourceRunId: 'run-composition-interrupted', sourcePlanDigest: interruptedPlan.digest, rollbackPlanDigest: rollbackPlan.digest });
  const rollback = await interrupted.adapters.desktop_tools_rollback_config({ schemaVersion: 1, action: 'execute',
    approvalId: rollbackApproval.approvalId });
  assert.equal(rollback.status, 'succeeded');
  assert.deepEqual(await readFile(engine.target), engine.previousBytes);

  const receipt = DisposableProductCompositionReceiptSchema.parse({
    schemaVersion: 1, evidenceClass: 'disposable-composition', scope: 'local-product-composition',
    production: false, publicDns: false, productionSigner: false, realOpenCode: false,
    source: { commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : '0'.repeat(40) },
    components: {
      aidCoreDigest: digest(await readFile(new URL('../../aid-core/dist/installer-contracts.js', import.meta.url))),
      controlPlaneDigest: digest(await readFile(new URL('../dist/index.js', import.meta.url))),
      installerEngineDigest: digest(await readFile(new URL('../../installer-engine/dist/index.js', import.meta.url))),
      supervisorDigest: digest(await readFile(new URL('../../desktop-tools-runtime/src/desktop-tools-supervisor.mjs', import.meta.url))),
    },
    identity: {
      profile: { slug: profile.slug, revision: profile.revision, digest: profile.digest },
      release: { releaseId: 'fixture-release-1', manifestDigest: '6'.repeat(64) },
      deviceFingerprint: binding.targetKeyFingerprint, authorizationId: started.request.requestId,
      sessionId: runtime.session.sessionId, runId: 'run-composition-1', planDigest: firstPlan.digest,
    },
    phases: {
      profileResolution: { result: 'passed', evidenceDigest: digest({ profile: profile.slug, revision: profile.revision, digest: profile.digest }) },
      authorization: { result: 'passed', evidenceDigest: digest({ requestId: started.request.requestId,
        credentialId: credential.credentialId, scopes: binding.scopes, replayStatus: replay.status }) },
      supervisorLaunch: { result: 'passed', evidenceDigest: digest({ history: digest(await readFile(supervisorResult.evidence.historyPath)),
        recording: digest(await readFile(supervisorResult.evidence.recordingPath)), captureComplete: false }) },
      planApplyVerify: { result: 'passed', evidenceDigest: digest({ planDigest: firstPlan.digest,
        status: firstApply.receipt.status, authority: firstVerify.authority, observedStatus: firstStatus.receipt.status }) },
      unchangedSecondRun: { result: 'passed', evidenceDigest: digest({ planDigest: secondPlan.digest,
        status: secondApply.receipt.status, snapshot: beforeSecondRun, mutationCount: 1 }) },
      interruptedResume: { result: 'passed', evidenceDigest: digest({ planDigest: interruptedPlan.digest,
        interruptedStatus: cancelled.receipt.status, resumedStatus: resumed.receipt.status, mutationCount: 2 }) },
      rollback: { result: 'passed', evidenceDigest: digest({ planDigest: rollbackPlan.digest, status: rollback.status,
        restoredDigest: digest(await readFile(engine.target)) }) },
      deprovisionPreview: { result: 'passed', evidenceDigest: digest({ executable: preview.executable,
        eligible: preview.eligibleResourceIds, refused: preview.refusedResourceIds }) },
    },
    limitations: ['fixture-signer', 'fixture-owner-decision', 'in-memory-control-plane', 'protocol-opencode'],
  });
  assert.throws(() => RealHostCanaryReceiptSchema.parse(receipt));
  if (process.env.DESKTOP_TOOLS_COMPOSITION_RECEIPT) {
    await writeFile(process.env.DESKTOP_TOOLS_COMPOSITION_RECEIPT, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' });
  }
});
