import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySimulatedHardwareFault, hardwareCategories, validateHardwareInventory } from '../dist/hardware-evidence.js';

const digest = character => character.repeat(64);
const signal = (id, value, state = 'ok', unit = null) => ({ id, value, unit, state });
const device = (id, identity, signals) => ({ id, identity: { type: id.startsWith('disk') ? 'wwn-sha256' : 'host-stable', sha256: identity }, signals });

function fixture() {
  const sections = {
    cpu: [device('cpu-0', digest('a'), [signal('model', 'fixture-cpu'), signal('logical-cpus', 8, 'ok', 'count'), signal('health', 'passed')])],
    memory: [device('memory-0', digest('b'), [signal('total-bytes', 17179869184, 'ok', 'bytes'), signal('ecc', 'supported'), signal('health', 'passed')])],
    disk: [device('disk-system', digest('c'), [signal('identity-sha256', digest('c')), signal('transport', 'nvme'), signal('capacity-bytes', 1000000000, 'ok', 'bytes'), signal('smart-health', 'passed'), signal('nvme-health', 'passed')])],
    gpu: [device('gpu-0', digest('d'), [signal('model', 'fixture-gpu'), signal('firmware', '1.0'), signal('health', 'passed')])],
    firmware: [device('firmware-system', digest('e'), [signal('vendor', 'fixture'), signal('version', '1.0'), signal('health', 'passed')])],
    'secure-boot': [device('secure-boot-system', digest('f'), [signal('state', 'enabled')])],
    tpm: [device('tpm-0', digest('1'), [signal('state', 'ready'), signal('version', '2.0')])],
    battery: [device('battery-0', digest('2'), [signal('health', 'good'), signal('charge-percent', 88, 'ok', 'percent'), signal('cycle-count', 10, 'ok', 'count')])],
    thermal: [device('thermal-cpu', digest('3'), [signal('state', 'nominal'), signal('temperature-celsius', 42, 'ok', 'celsius')])],
    ups: [device('ups-0', digest('4'), [signal('state', 'online'), signal('charge-percent', 100, 'ok', 'percent'), signal('runtime-seconds', 1800, 'ok', 'seconds')])],
  };
  return {
    schemaVersion: 1, hostId: 'fixture-host', collectedAt: '2026-11-10T12:00:00.000Z',
    collector: { id: 'hardware-fixture', version: '1.0.0', readOnly: true },
    categories: hardwareCategories.map(category => ({ category, applicability: 'present', reason: 'Disposable simulated device', devices: sections[category] })),
  };
}

const fault = overrides => ({
  schemaVersion: 1, simulationId: 'smart-media-errors', simulated: true, hostId: 'fixture-host', deviceId: 'disk-system',
  signal: 'media-errors', severity: 'critical', observedValue: 10, threshold: 0, occurredAt: '2026-11-10T12:01:00.000Z', ...overrides,
});

test('requires explicit CPU, memory, disk, GPU, firmware, Secure Boot, TPM, battery, thermal, and UPS inventory', () => {
  assert.deepEqual(validateHardwareInventory(fixture()), fixture());
  const missing = fixture(); missing.categories.pop();
  assert.throws(() => validateHardwareInventory(missing));
  const absent = fixture(); absent.categories[3] = { category: 'gpu', applicability: 'absent', reason: 'No GPU installed', devices: [] };
  assert.doesNotThrow(() => validateHardwareInventory(absent));
});

test('disk identity is privacy preserving, stable, and bound to the disk signal', () => {
  const mismatch = fixture(); mismatch.categories[2].devices[0].signals[0].value = digest('d');
  assert.throws(() => validateHardwareInventory(mismatch), /identity signal/);
  const raw = fixture(); raw.categories[2].devices[0].identity.sha256 = 'SERIAL-123';
  assert.throws(() => validateHardwareInventory(raw));
});

test('deterministic simulated SMART fault identifies the exact host and device', async () => {
  const first = await classifySimulatedHardwareFault(fixture(), fault());
  const second = await classifySimulatedHardwareFault(structuredClone(fixture()), structuredClone(fault()));
  assert.deepEqual(second, first);
  assert.deepEqual({ hostId: first.hostId, deviceId: first.deviceId, category: first.category, signal: first.signal }, {
    hostId: 'fixture-host', deviceId: 'disk-system', category: 'disk', signal: 'media-errors',
  });
  assert.match(first.evidenceSha256, /^[a-f0-9]{64}$/);
});

test('host, device, category-signal, and simulation substitutions fail closed', async () => {
  await assert.rejects(classifySimulatedHardwareFault(fixture(), fault({ hostId: 'other-host' })), /host does not match/);
  await assert.rejects(classifySimulatedHardwareFault(fixture(), fault({ deviceId: 'disk-other' })), /not present/);
  await assert.rejects(classifySimulatedHardwareFault(fixture(), fault({ deviceId: 'battery-0', signal: 'media-errors' })), /not valid for battery/);
  await assert.rejects(classifySimulatedHardwareFault(fixture(), fault({ simulated: false })));
});

test('unknown fields, duplicate devices, missing signals, and mutable collector claims are rejected', () => {
  const unknown = fixture(); unknown.categories[0].devices[0].serial = 'raw';
  assert.throws(() => validateHardwareInventory(unknown), /unrecognized/i);
  const duplicate = fixture(); duplicate.categories[1].devices[0].id = 'cpu-0';
  assert.throws(() => validateHardwareInventory(duplicate), /unique/i);
  const missing = fixture(); missing.categories[8].devices[0].signals.pop();
  assert.throws(() => validateHardwareInventory(missing), /missing required thermal signal/);
  const mutable = fixture(); mutable.collector.readOnly = false;
  assert.throws(() => validateHardwareInventory(mutable));
});
