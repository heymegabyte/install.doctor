import assert from 'node:assert/strict';
import test from 'node:test';
import { systemdStateMatches } from '../dist/index.js';

test('read-only systemd status evaluates every admitted desired-state form', () => {
  const stoppedAndDisabled = { enabled: false, running: false };
  const runningAndEnabled = { enabled: true, running: true };
  assert.equal(systemdStateMatches(runningAndEnabled, 'enabled-and-started'), true);
  assert.equal(systemdStateMatches(stoppedAndDisabled, 'enabled-and-started'), false);
  assert.equal(systemdStateMatches(runningAndEnabled, 'enabled'), true);
  assert.equal(systemdStateMatches(stoppedAndDisabled, 'disabled'), true);
  assert.equal(systemdStateMatches(runningAndEnabled, 'started'), true);
  assert.equal(systemdStateMatches(stoppedAndDisabled, 'stopped'), true);
});

test('read-only systemd status rejects malformed observations', () => {
  assert.throws(() => systemdStateMatches({ enabled: true }, 'enabled-and-started'));
});
