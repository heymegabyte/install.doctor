import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivilegedBrokerServiceRuntime } from '../dist/privileged-broker-client.js';
import { createPrivilegedBrokerReceipt, privilegedBrokerDigest } from '../dist/privileged-broker-protocol.js';
import { privilegedBrokerDescriptorDigest } from '../dist/privileged-broker-authority.js';

const descriptor = { kind: 'native-service', manager: 'systemd', serviceKey: 'alloy', unit: 'alloy.service', desiredState: 'enabled-and-started' };
const grant = {
  schemaVersion: 1, grantId: 'grant-service', hostId: 'host-one', releaseId: 'release-one', runId: 'run-one',
  planDigest: 'a'.repeat(64), approvedPlanDigest: 'a'.repeat(64), enrolledUid: 501,
  brokerExecutableDigest: 'b'.repeat(64), runtimeDigest: 'c'.repeat(64), workerDigest: 'd'.repeat(64),
  operations: ['check', 'apply', 'verify'].map(phase => ({ taskId: 'service.native.alloy', operationId: `alloy-${phase}`, phase })),
  descriptorDigest: privilegedBrokerDescriptorDigest(descriptor), closureDigest: 'e'.repeat(64), consentDigest: 'f'.repeat(64),
  issuedAt: '2026-11-09T12:00:00.000Z', expiresAt: '2026-11-09T12:05:00.000Z',
};
const config = { helperPath: '/run/desktop-tools/authority/release-one/broker',
  socketPath: '/run/desktop-tools/broker/run-one/broker.sock', hostId: 'host-one', releaseId: 'release-one',
  runId: 'run-one', planDigest: 'a'.repeat(64), taskId: 'service.native.alloy', grant };
const operation = action => ({ kind: 'native-service', effectClass: 'native-service', action,
  manager: 'systemd', unit: 'alloy.service', desiredState: 'enabled-and-started' });

test('service client sends only the canonical sealed descriptor and validates receipts', async () => {
  const seen = [];
  const transport = { async invoke(input) {
    const bytes = await input.payload.readFile();
    seen.push({ request: input.request, bytes: bytes.toString('utf8'), links: (await input.payload.stat()).nlink });
    const status = input.request.phase === 'check' ? 'needed' : input.request.phase === 'apply' ? 'applied' : 'verified';
    return createPrivilegedBrokerReceipt({ request: input.request, grantDigest: privilegedBrokerDigest(grant),
      status, fenceDigest: '1'.repeat(64), completedAt: '2026-11-09T12:00:01.000Z',
      serviceState: input.request.phase === 'check' ? { enabled: false, running: false } : null });
  } };
  const runtime = createPrivilegedBrokerServiceRuntime(config, descriptor, transport, () => new Date('2026-11-09T12:00:00.000Z'));
  assert.equal(await runtime.check(operation('check')), 'needed');
  assert.deepEqual(runtime.preparedState(), { enabled: false, running: false });
  await runtime.apply(operation('apply'));
  assert.equal(await runtime.verify(operation('verify')), 'verified');
  assert.equal(seen.length, 3);
  assert.ok(seen.every(value => assert.deepEqual(JSON.parse(value.bytes), descriptor) === undefined && value.links === 0));
  assert.ok(seen.every(value => value.request.payload.sizeBytes === Buffer.byteLength(value.bytes)));
});

test('service client rejects operation and descriptor substitution before transport', async () => {
  let calls = 0;
  const runtime = createPrivilegedBrokerServiceRuntime(config, descriptor, { async invoke() { calls += 1; throw new Error('unexpected'); } });
  await assert.rejects(runtime.apply({ ...operation('apply'), unit: 'other.service' }), /differs from descriptor authority/);
  assert.equal(calls, 0);
  assert.throws(() => createPrivilegedBrokerServiceRuntime(config, { ...descriptor, unit: 'other.service' }), /Invalid|configuration differs/);
});
