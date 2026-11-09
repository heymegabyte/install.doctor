import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brokerApprovalSemanticDigest } from '../../aid-core/dist/broker-approval-contracts.js';
import { createBrokerApprovalTransport, readPrivateDeviceToken } from '../dist/broker-approval-transport.js';

const d = 'a'.repeat(64);
const now = '2030-01-01T00:00:00.000Z';
const later = '2030-01-01T00:10:00.000Z';
const grant = { schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
  planDigest: d, approvedPlanDigest: d, enrolledUid: 501, brokerExecutableDigest: d, runtimeDigest: d,
  workerDigest: d, operations: [{ taskId: 'task-1', operationId: 'operation-1', phase: 'apply' }],
  descriptorDigest: d, closureDigest: d, consentDigest: d, issuedAt: now, expiresAt: later };
const binding = { tenantId: 'tenant-1', profileId: 'profile-1', profileRevisionDigest: d,
  deviceCredentialId: 'device-1', deviceFingerprint: d, runIntentId: 'intent-1', authorizationId: 'authorization-1' };

async function tokenFixture() {
  const root = await mkdtemp(join(tmpdir(), 'broker-transport-'));
  const dir = join(root, 'config');
  await mkdir(dir, { mode: 0o700 });
  const path = join(dir, 'device-token');
  await writeFile(path, 'opaque-device-token-value', { mode: 0o600 });
  return { root, path };
}

test('reads only an owner-only non-linked enrollment credential', async () => {
  const fixture = await tokenFixture();
  assert.equal(await readPrivateDeviceToken(fixture.path), 'opaque-device-token-value');
  await chmod(fixture.path, 0o644);
  await assert.rejects(readPrivateDeviceToken(fixture.path), /owner-only/);
  const target = join(fixture.root, 'target');
  const link = join(fixture.root, 'link');
  await writeFile(target, 'opaque-device-token-value', { mode: 0o600 });
  await symlink(target, link);
  await assert.rejects(readPrivateDeviceToken(link), /owner-only/);
});

test('submits an exact run intent and never places the credential in URL or body', async () => {
  const fixture = await tokenFixture();
  let seen;
  const transport = createBrokerApprovalTransport({ origin: 'https://desktop.tools', tokenPath: fixture.path,
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      const runIntent = JSON.parse(init.body);
      return Response.json({ created: true, runIntent });
    } });
  const intent = await transport.request(grant, binding);
  assert.equal(intent.grantId, grant.grantId);
  assert.equal(seen.url, 'https://desktop.tools/api/devices/broker-authorizations');
  assert.equal(seen.init.headers.authorization, 'Bearer opaque-device-token-value');
  assert.doesNotMatch(seen.url + seen.init.body, /opaque-device-token-value/);
  assert.equal(intent.deviceFingerprint, binding.deviceFingerprint);
});

test('loads only a server-bound device identity with explicit privileged-run scope', async () => {
  const fixture = await tokenFixture();
  let response = { deviceId: binding.deviceCredentialId, tenant: binding.tenantId, label: 'workstation',
    enrolledAt: now, grantedPermissions: ['pull-desired-state', 'authorize-privileged-run'],
    profileRevision: binding.profileRevisionDigest, machineFingerprint: binding.deviceFingerprint };
  const transport = createBrokerApprovalTransport({ origin: 'https://desktop.tools', tokenPath: fixture.path,
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://desktop.tools/api/devices/me');
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      return Response.json(response);
    } });
  assert.deepEqual(await transport.identity(), response);
  response = { ...response, grantedPermissions: ['pull-desired-state'] };
  await assert.rejects(transport.identity(), /privileged-run authority/);
  response = { ...response, grantedPermissions: ['authorize-privileged-run'], machineFingerprint: null };
  await assert.rejects(transport.identity());
});

test('requires a server-issued claim locator and rejects substituted approval bindings', async () => {
  const fixture = await tokenFixture();
  const grantDigest = await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', grant);
  const approval = { schemaVersion: 1, kind: 'desktop-tools-broker-approval', signerKeyId: 'signer-1',
    signatureDomain: 'desktop-tools-broker-approval-v1', approvalId: 'approval-1',
    authorizationId: binding.authorizationId, ownerDecisionId: 'decision-1', ownerActorId: 'owner-1',
    tenantId: binding.tenantId, profileId: binding.profileId, profileRevisionDigest: binding.profileRevisionDigest,
    deviceCredentialId: binding.deviceCredentialId, deviceFingerprint: binding.deviceFingerprint,
    runIntentId: binding.runIntentId, grant, grantDigest, delegationDigest: d, revocationEpoch: 1,
    approvedAt: now, expiresAt: later, signature: 'A'.repeat(86), auditDigest: d };
  let response = { approval };
  const transport = createBrokerApprovalTransport({ origin: 'https://desktop.tools', tokenPath: fixture.path,
    fetch: async (_url, init) => {
      const lookup = JSON.parse(init.body);
      assert.equal(lookup.ownerDecisionId, 'decision-1');
      return Response.json(response);
    } });
  await assert.rejects(transport.claim(grant, binding, {}));
  assert.equal((await transport.claim(grant, binding, { ownerDecisionId: 'decision-1' })).approvalId, 'approval-1');
  response = { approval: { ...approval, tenantId: 'tenant-2' } };
  await assert.rejects(transport.claim(grant, binding, { ownerDecisionId: 'decision-1' }), /exact target binding/);
});

test('polls only the exact authorization, run intent, and grant for a server-issued locator', async () => {
  const fixture = await tokenFixture();
  let response = { schemaVersion: 1, status: 'pending' };
  const transport = createBrokerApprovalTransport({ origin: 'https://desktop.tools', tokenPath: fixture.path,
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://desktop.tools/api/devices/broker-authorizations/status');
      assert.deepEqual(JSON.parse(init.body), { schemaVersion: 1, authorizationId: binding.authorizationId,
        runIntentId: binding.runIntentId, grantId: grant.grantId });
      return Response.json(response);
    } });
  assert.deepEqual(await transport.status(grant, binding), response);
  response = { schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1' };
  assert.deepEqual(await transport.status(grant, binding), response);
  response = { schemaVersion: 1, status: 'approved', ownerDecisionId: 'decision-1', tenantId: 'tenant-2' };
  await assert.rejects(transport.status(grant, binding));
});

test('fails closed on insecure origins, non-success status, oversized and malformed responses', async () => {
  const fixture = await tokenFixture();
  assert.throws(() => createBrokerApprovalTransport({ origin: 'http://desktop.tools', tokenPath: fixture.path }), /HTTPS origin/);
  const failures = [
    async () => new Response('{}', { status: 403 }),
    async () => new Response('x'.repeat(70_000)),
    async () => new Response('{'),
  ];
  for (const fetch of failures) {
    const transport = createBrokerApprovalTransport({ origin: 'https://desktop.tools', tokenPath: fixture.path, fetch });
    await assert.rejects(transport.request(grant, binding));
  }
});
