import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAULT_KINDS, InjectedFaultError, classifyInjectedFault,
  createDeterministicFaultInjector, runDeterministicFaultMatrix,
} from '../dist/index.js';

const safeScenarios = [
  ['process', 'process-loss', 'before-mutation'], ['reboot', 'reboot', 'before-mutation'],
  ['space', 'enospc', 'preflight'], ['resolver', 'dns', 'preflight'],
  ['artifact', 'corrupt-artifact', 'preflight'], ['credential', 'expired-credential', 'preflight'],
  ['lock', 'lock-loss', 'before-mutation'], ['clock', 'clock-skew', 'preflight'],
  ['permission', 'permission-drift', 'preflight'], ['telemetry', 'telemetry-failure', 'advisory-export'],
].map(([id, kind, boundary]) => ({ id, kind, boundary }));

test('injector fails at the exact occurrence and exposes deterministic evidence', () => {
  const injector = createDeterministicFaultInjector({ id: 'dns-second-hit', kind: 'dns', boundary: 'preflight', occurrence: 2 });
  injector.hit('dns', 'before-mutation');
  injector.hit('dns', 'preflight');
  assert.deepEqual(injector.evidence(), {
    scenario: { id: 'dns-second-hit', kind: 'dns', boundary: 'preflight', occurrence: 2 }, matchingHits: 1, injected: false,
  });
  assert.throws(() => injector.hit('dns', 'preflight'), error => error instanceof InjectedFaultError && error.scenario.id === 'dns-second-hit');
  injector.hit('dns', 'preflight');
  assert.equal(injector.evidence().injected, true);
});

test('all required failures have exact recoverable outcomes before mutation', () => {
  const report = runDeterministicFaultMatrix(safeScenarios);
  assert.equal(report.complete, true);
  assert.deepEqual([...new Set(report.outcomes.map(item => item.scenario.kind))].sort(), [...FAULT_KINDS].sort());
  assert.ok(report.outcomes.every(item => item.outcome === 'recoverable' && item.mutationMayHaveOccurred === false));
  assert.equal(report.outcomes.find(item => item.scenario.kind === 'reboot').status, 'pending-reboot');
  assert.equal(report.outcomes.find(item => item.scenario.kind === 'telemetry-failure').status, 'success-with-telemetry-gap');
  assert.equal(report.outcomes.find(item => item.scenario.kind === 'corrupt-artifact').nextAction, 'replace-artifact');
  assert.equal(report.outcomes.find(item => item.scenario.kind === 'expired-credential').automaticRetryAllowed, false);
  assert.equal(report.outcomes.find(item => item.scenario.kind === 'enospc').automaticRetryAllowed, false);
});

test('possible mutation is uncertain and never automatically retried or resumed', () => {
  for (const kind of ['process-loss', 'enospc', 'lock-loss', 'permission-drift']) {
    const outcome = classifyInjectedFault({ id: `uncertain-${kind}`, kind, boundary: 'mutation-possible' });
    assert.deepEqual({ outcome: outcome.outcome, mutation: outcome.mutationMayHaveOccurred, retry: outcome.automaticRetryAllowed,
      resume: outcome.resumeAllowed, action: outcome.nextAction },
    { outcome: 'uncertain', mutation: true, retry: false, resume: false, action: 'inspect-postcondition' });
  }
});

test('matrix evidence is order-independent, complete, and strict', () => {
  const forward = runDeterministicFaultMatrix(safeScenarios);
  const reverse = runDeterministicFaultMatrix([...safeScenarios].reverse());
  assert.equal(forward.digest, reverse.digest);
  assert.deepEqual(forward.outcomes, reverse.outcomes);
  assert.equal(runDeterministicFaultMatrix(safeScenarios.slice(1)).complete, false);
  assert.deepEqual(runDeterministicFaultMatrix(safeScenarios.slice(1)).missingKinds, ['process-loss']);
  assert.throws(() => runDeterministicFaultMatrix([...safeScenarios, safeScenarios[0]]), /duplicate/);
  assert.throws(() => classifyInjectedFault({ id: 'unknown', kind: 'dns', boundary: 'preflight', extra: true }), /unrecognized|unknown/i);
  assert.throws(() => classifyInjectedFault({ id: 'late-corruption', kind: 'corrupt-artifact', boundary: 'after-mutation' }), /before mutation/);
  assert.throws(() => classifyInjectedFault({ id: 'authoritative-telemetry', kind: 'telemetry-failure', boundary: 'recording' }), /advisory export/);
});
