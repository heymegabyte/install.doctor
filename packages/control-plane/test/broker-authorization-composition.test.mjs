import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { brokerApprovalSemanticDigest } from '../../aid-core/dist/broker-approval-contracts.js';
import { createBrokerAuthorizationComposition } from '../src/broker-authorization-composition.ts';

const hex = value => value.repeat(64);
const now = new Date('2026-11-09T12:00:00.000Z');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonical(entry)])) : value;
const jsonBytes = value => new TextEncoder().encode(`${JSON.stringify(canonical(value))}\n`);
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

async function fixture({ delegatedKeyId = 'approval-key-1', configuredKeyId = delegatedKeyId } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0013_broker_approval_state.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0014_broker_run_authority.sql', import.meta.url), 'utf8'));
  const database = { prepare(sql) { let values = []; const statement = {
    bind(...bound) { values = bound; return statement; },
    async first() { const row = sqlite.prepare(sql).get(...values); return row ? { ...row } : null; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; return statement; } };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const projection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId: delegatedKeyId, algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools', releaseId: 'release-1', channel: 'stable',
    publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    notBefore: '2026-11-09T11:00:00.000Z', notAfter: '2026-11-09T14:00:00.000Z',
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 7 };
  const delegation = { ...projection, delegationDigest: await brokerApprovalSemanticDigest(
    'desktop-tools:broker-approval-signer-delegation:v1', projection) };
  const delegationBytes = jsonBytes(delegation);
  const release = { schemaVersion: 9, product: 'desktop-tools', channel: 'stable', releaseId: 'release-1',
    createdAt: Date.parse('2026-11-09T11:00:00.000Z') / 1000,
    expiresAt: Date.parse('2026-11-09T14:00:00.000Z') / 1000,
    brokerApproval: { delegationUrl: 'https://desktop.tools/releases/release-1/broker-approval-signer-delegation.json',
      delegationSha256: await sha256(delegationBytes), delegationSize: delegationBytes.byteLength,
      minimumRevocationEpoch: 7 } };
  const principal = { deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), tenantId: 'tenant-1',
    permissions: ['authorize-privileged-run'] };
  const intent = { schemaVersion: 1, runIntentId: 'intent-1', authorizationId: 'authorization-1',
    tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: hex('a'),
    deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), grantId: 'grant-1', hostId: 'host-1',
    releaseId: 'release-1', runId: 'run-1', planDigest: hex('c'), enrolledUid: 1000,
    brokerExecutableDigest: hex('d'), runtimeDigest: hex('e'), workerDigest: hex('f'),
    operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
    descriptorDigest: hex('1'), closureDigest: hex('2'), consentDigest: hex('3'),
    requestedAt: '2026-11-09T11:59:00.000Z', grantExpiresAt: '2026-11-09T12:20:00.000Z' };
  const plan = { hostId: intent.hostId, runId: intent.runId, planDigest: intent.planDigest,
    enrolledUid: intent.enrolledUid, brokerExecutableDigest: intent.brokerExecutableDigest,
    runtimeDigest: intent.runtimeDigest, workerDigest: intent.workerDigest, operations: intent.operations,
    descriptorDigest: intent.descriptorDigest, closureDigest: intent.closureDigest, consentDigest: intent.consentDigest };
  const dependencies = { database,
    releaseBucket: { async get(key) { assert.equal(key,
      'desktop-tools/bootstrap/release-1/broker-approval-signer-delegation.json');
      return { size: delegationBytes.byteLength, body: new ReadableStream({ start(controller) {
        controller.enqueue(delegationBytes); controller.close(); } }) }; } },
    resolveActiveRelease: async () => release,
    deviceAuthority: { async resolve() { return { deviceCredentialId: principal.deviceCredentialId,
      deviceFingerprint: principal.deviceFingerprint, tenantId: principal.tenantId,
      profileId: intent.profileId, profileRevisionDigest: intent.profileRevisionDigest, active: true }; } },
    publicProfileAuthority: { async resolve() { return { profileId: intent.profileId, tenantId: intent.tenantId,
      revision: 'revision-1', digest: intent.profileRevisionDigest, visibility: 'public-bootstrap', enabled: true }; } },
    planAuthority: { async reconstruct() { return plan; } },
    tenantOwnerAuthority: { async resolveForTenant() { return { authenticationActor: 'owner@example.com', ownerActorId: 'owner-1' }; } },
    resolveDevice: async () => principal,
    resolveFreshOwner: async () => ({ actor: 'owner@example.com', authenticatedAt: '2026-11-09T11:58:00.000Z' }),
    signerService: { async fetch(_url, init) { const request = JSON.parse(init.body);
      const signature = sign(null, Buffer.from(request.message, 'base64url'), privateKey).toString('base64url');
      return Response.json({ schemaVersion: 1, keyId: configuredKeyId, algorithm: 'Ed25519', signature }); } },
    signerKeyId: configuredKeyId, now: () => now, randomApprovalId: () => 'approval-1' };
  return { dependencies, intent, principal };
}

test('composes request, owner decision, locator status, one-use signed claim, and replay denial', async () => {
  const setup = await fixture();
  const { api } = createBrokerAuthorizationComposition(setup.dependencies);
  let response = await api.request('/api/devices/broker-authorizations', { method: 'POST',
    body: JSON.stringify(setup.intent) });
  assert.equal(response.status, 201);
  response = await api.request('/api/owner/broker-authorizations/decisions', { method: 'POST', body: JSON.stringify({
    schemaVersion: 1, ownerDecisionId: 'decision-1', runIntentId: setup.intent.runIntentId,
    authorizationId: setup.intent.authorizationId, approvedPlanDigest: setup.intent.planDigest,
    consentDigest: setup.intent.consentDigest, decision: 'approved' }) });
  assert.equal(response.status, 201);
  response = await api.request('/api/devices/broker-authorizations/status', { method: 'POST', body: JSON.stringify({
    schemaVersion: 1, authorizationId: setup.intent.authorizationId, runIntentId: setup.intent.runIntentId,
    grantId: setup.intent.grantId }) });
  assert.deepEqual(await response.json(), { schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1' });
  const claim = { schemaVersion: 1, authorizationId: setup.intent.authorizationId, ownerDecisionId: 'decision-1',
    tenantId: setup.intent.tenantId, profileId: setup.intent.profileId,
    profileRevisionDigest: setup.intent.profileRevisionDigest, deviceCredentialId: setup.intent.deviceCredentialId,
    deviceFingerprint: setup.intent.deviceFingerprint, runIntentId: setup.intent.runIntentId, grantId: setup.intent.grantId };
  response = await api.request('/api/devices/broker-approvals/claim', { method: 'POST', body: JSON.stringify(claim) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.approval.signerKeyId, setup.dependencies.signerKeyId);
  assert.equal(result.approval.revocationEpoch, 7);
  response = await api.request('/api/devices/broker-approvals/claim', { method: 'POST', body: JSON.stringify(claim) });
  assert.equal(response.status, 503);
});

test('requires every production authority explicitly and rejects signer/delegation substitution', async () => {
  const setup = await fixture();
  for (const key of ['database', 'releaseBucket', 'resolveActiveRelease', 'deviceAuthority', 'publicProfileAuthority',
    'planAuthority', 'tenantOwnerAuthority', 'resolveDevice', 'resolveFreshOwner', 'signerService', 'signerKeyId']) {
    const dependencies = { ...setup.dependencies };
    delete dependencies[key];
    assert.throws(() => createBrokerAuthorizationComposition(dependencies), /requires|invalid/i, key);
  }
  const substituted = await fixture({ delegatedKeyId: 'delegated-key', configuredKeyId: 'configured-key' });
  const composition = createBrokerAuthorizationComposition(substituted.dependencies);
  await assert.rejects(composition.approval.delegationForRelease('release-1'), /differs/);
});
