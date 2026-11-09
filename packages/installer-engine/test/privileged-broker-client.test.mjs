import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivilegedBrokerNativeRuntime } from '../dist/privileged-broker-client.js';
import { createPrivilegedBrokerReceipt, privilegedBrokerDigest } from '../dist/privileged-broker-protocol.js';

const hex = character => character.repeat(64);

function grant() {
  return { schemaVersion: 1, grantId: 'grant-1', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
    planDigest: hex('a'), approvedPlanDigest: hex('a'), enrolledUid: process.getuid(),
    brokerExecutableDigest: hex('6'), runtimeDigest: hex('7'), workerDigest: hex('8'),
    operations: [
      { taskId: 'package.tree', operationId: 'tree.check', phase: 'check' },
      { taskId: 'package.tree', operationId: 'tree.apply', phase: 'apply' },
      { taskId: 'package.tree', operationId: 'tree.verify', phase: 'verify' },
    ], descriptorDigest: hex('b'), closureDigest: hex('c'), consentDigest: hex('d'),
    issuedAt: '2026-11-08T12:00:00.000Z', expiresAt: '2026-11-08T12:05:00.000Z' };
}

function descriptor(sizeBytes) {
  return { packageKey: 'tree', artifact: { sha256: hex('e'), sizeBytes } };
}

test('user runtime sends exact fd-bound operations and accepts only matching receipts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'broker-client-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payloadPath = join(root, 'payload');
  await writeFile(payloadPath, 'payload');
  const calls = [];
  const transport = { invoke: async input => {
    calls.push(input);
    const statuses = { check: 'needed', apply: 'applied', verify: 'verified' };
    return createPrivilegedBrokerReceipt({ request: input.request, grantDigest: input.request.grantDigest,
      status: statuses[input.request.phase], fenceDigest: hex('f'), completedAt: '2026-11-08T12:01:01.000Z' });
  } };
  const runtime = createPrivilegedBrokerNativeRuntime({ helperPath: '/run/desktop-tools/bin/broker',
    socketPath: '/run/desktop-tools/privileged/run-1/broker.sock', hostId: 'host-1', releaseId: 'release-1', runId: 'run-1',
    planDigest: hex('a'), taskId: 'package.tree', grant: grant() }, transport, () => new Date('2026-11-08T12:01:00.000Z'));
  const authority = phase => ({ operation: { kind: 'native-package', effectClass: 'native-package', action: phase,
    packageKey: 'tree', payloadArtifactId: 'tree-deb' }, rootDescriptor: descriptor(7), packages: [], installedWitnesses: [],
    withPayload: async (_packageKey, use) => { const handle = await open(payloadPath, 'r'); try { return await use(handle); } finally { await handle.close(); } },
    context: undefined });
  assert.equal(await runtime.check(authority('check')), 'needed');
  await runtime.apply(authority('apply'));
  assert.equal(await runtime.verify(authority('verify')), 'verified');
  assert.deepEqual(calls.map(call => call.request.operationId), ['tree.check', 'tree.apply', 'tree.verify']);
  assert.ok(calls.every(call => call.helperDigest === grant().brokerExecutableDigest
    && call.request.grantDigest === privilegedBrokerDigest(grant())
    && call.request.payload.requiredSeals.join(',') === 'seal,shrink,grow,write'));
  assert.equal(new Set(calls.map(call => call.request.nonce)).size, 3);
});

test('user runtime rejects missing phase authority and substituted receipts', async () => {
  const base = grant();
  const missing = { ...base, operations: base.operations.filter(item => item.phase !== 'apply') };
  const config = value => ({ helperPath: '/run/desktop-tools/bin/broker', socketPath: '/run/desktop-tools/privileged/run-1/broker.sock',
    hostId: 'host-1', releaseId: 'release-1', runId: 'run-1', planDigest: hex('a'), taskId: 'package.tree', grant: value });
  const runtime = createPrivilegedBrokerNativeRuntime(config(missing), { invoke: async () => { throw new Error('must not invoke'); } });
  const authority = { operation: { kind: 'native-package', effectClass: 'native-package', action: 'apply', packageKey: 'tree', payloadArtifactId: 'tree-deb' },
    rootDescriptor: descriptor(7), packages: [], installedWitnesses: [], withPayload: async () => { throw new Error('must not open payload'); }, context: undefined };
  await assert.rejects(runtime.apply(authority), /lacks the apply operation/);

  const substituted = createPrivilegedBrokerNativeRuntime(config(base), { invoke: async input => createPrivilegedBrokerReceipt({
    request: input.request, grantDigest: input.request.grantDigest, status: 'verified', fenceDigest: hex('f'), completedAt: new Date().toISOString(),
  }) });
  await assert.rejects(substituted.apply({ ...authority, operation: { ...authority.operation, action: 'apply' },
    withPayload: async (_key, use) => use({ fd: 9 }) }), /not applied/);
});
