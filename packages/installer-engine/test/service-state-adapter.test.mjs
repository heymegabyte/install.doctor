import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemdServiceStateAdapter } from '../dist/index.js';

function fixture(initial) {
  const state = { ...initial };
  const calls = [];
  const execute = async (_file, args) => {
    calls.push([...args]);
    const [verb, _separator, serviceId] = args;
    assert.equal(serviceId, 'install-doctor-fixture.service');
    if (verb === 'is-enabled') return state.enabled === 'enabled' ? { code: 0, stdout: 'enabled\n' } : { code: 1, stdout: `${state.enabled}\n` };
    if (verb === 'is-active') return state.active === 'active' ? { code: 0, stdout: 'active\n' } : { code: 3, stdout: `${state.active}\n` };
    if (verb === 'enable' || verb === 'disable') { state.enabled = verb === 'enable' ? 'enabled' : 'disabled'; return { code: 0, stdout: '' }; }
    if (verb === 'start' || verb === 'stop') { state.active = verb === 'start' ? 'active' : 'inactive'; return { code: 0, stdout: '' }; }
    throw new Error(`unexpected verb: ${verb}`);
  };
  return { state, calls, adapter: createSystemdServiceStateAdapter({ systemctlPath: '/usr/bin/systemctl', execute }) };
}

test('systemd adapter captures only exactly reversible enabled/running states', async () => {
  const enabled = fixture({ enabled: 'enabled', active: 'active' });
  assert.deepEqual(await enabled.adapter.capture('install-doctor-fixture.service'), { enabled: true, running: true });
  const disabled = fixture({ enabled: 'disabled', active: 'inactive' });
  assert.deepEqual(await disabled.adapter.capture('install-doctor-fixture.service'), { enabled: false, running: false });

  await assert.rejects(
    fixture({ enabled: 'static', active: 'inactive' }).adapter.capture('install-doctor-fixture.service'),
    /cannot represent systemd enabled state: static/,
  );
  await assert.rejects(
    fixture({ enabled: 'enabled', active: 'failed' }).adapter.capture('install-doctor-fixture.service'),
    /cannot represent systemd active state: failed/,
  );
});

test('systemd adapter restores enablement before activity and verifies exact postconditions', async () => {
  const value = fixture({ enabled: 'disabled', active: 'active' });
  await value.adapter.restore('install-doctor-fixture.service', { enabled: true, running: false });
  assert.deepEqual(value.calls.map(call => call[0]), ['enable', 'stop', 'is-enabled', 'is-active']);
  assert.deepEqual(value.state, { enabled: 'enabled', active: 'inactive' });
});

test('systemd adapter rejects ambiguous identifiers and failed native mutations', async () => {
  const value = fixture({ enabled: 'enabled', active: 'active' });
  await assert.rejects(value.adapter.capture('../escape.service'), /invalid systemd service identifier/);
  const adapter = createSystemdServiceStateAdapter({
    systemctlPath: '/usr/bin/systemctl',
    execute: async () => ({ code: 1, stdout: '', stderr: 'denied' }),
  });
  await assert.rejects(adapter.restore('install-doctor-fixture.service', { enabled: false, running: false }), /systemctl disable failed/);
});
