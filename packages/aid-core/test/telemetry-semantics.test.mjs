import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopToolsSemanticEventSchema, DesktopToolsTelemetryBatchSchema, DesktopToolsTelemetryResourceSchema } from '../dist/telemetry-semantics.js';

const digest = 'a'.repeat(64);
const base = { schemaVersion: 1, observedAt: '2026-11-10T15:00:00.000Z', severity: 'info' };
const resource = { 'service.name': 'desktop-tools-installer', 'service.version': '1.2.3', 'deployment.environment.name': 'production',
  'host.id': 'host-1', 'host.arch': 'arm64', 'os.type': 'darwin' };
const events = [
  ['desktop_tools.host.observed', { 'host.facts.digest': digest, 'host.capability.count': 4, 'desktop_tools.status': 'succeeded' }],
  ['desktop_tools.profile.resolved', { 'desktop_tools.profile.id': 'profile-1', 'desktop_tools.profile.revision': 'revision-1', 'desktop_tools.profile.digest': digest, 'desktop_tools.status': 'succeeded' }],
  ['desktop_tools.release.evaluated', { 'desktop_tools.release.id': 'release-1', 'desktop_tools.release.manifest.digest': digest, 'desktop_tools.release.channel': 'stable', 'desktop_tools.release.decision': 'admitted' }],
  ['desktop_tools.run.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.run.plan.digest': digest, 'desktop_tools.status': 'running' }],
  ['desktop_tools.agent.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.agent.id': 'agent-1', 'desktop_tools.agent.role': 'executor', 'desktop_tools.agent.parent.id': null, 'desktop_tools.status': 'running' }],
  ['desktop_tools.task.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.task.id': 'task-1', 'desktop_tools.task.attempt': 1, 'desktop_tools.status': 'running' }],
  ['desktop_tools.lock.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.task.id': 'task-1', 'desktop_tools.lock.domain': 'package-manager', 'desktop_tools.lock.state': 'acquired' }],
  ['desktop_tools.approval.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.approval.id': 'approval-1', 'desktop_tools.approval.scope.digest': digest, 'desktop_tools.approval.state': 'approved' }],
  ['desktop_tools.effect.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.task.id': 'task-1', 'desktop_tools.effect.id': 'effect-1', 'desktop_tools.effect.class': 'configuration', 'desktop_tools.status': 'succeeded', 'desktop_tools.effect.evidence.digest': digest }],
  ['desktop_tools.cost.recorded', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.agent.id': 'agent-1', 'desktop_tools.cost.provider': 'local-ollama', 'desktop_tools.cost.input.tokens': 100, 'desktop_tools.cost.output.tokens': 50, 'desktop_tools.cost.usd.micros': 0 }],
  ['desktop_tools.verification.state', { 'desktop_tools.run.id': 'run-1', 'desktop_tools.verification.id': 'verify-1', 'desktop_tools.verification.evidence.digest': digest, 'desktop_tools.status': 'succeeded', 'desktop_tools.verification.gaps': [] }],
  ['desktop_tools.backup.state', { 'desktop_tools.backup.id': 'backup-1', 'desktop_tools.backup.workload.id': 'workload-1', 'desktop_tools.backup.kind': 'file-backup', 'desktop_tools.status': 'succeeded', 'desktop_tools.backup.recovery_point.digest': digest }],
  ['desktop_tools.recovery.state', { 'desktop_tools.recovery.id': 'recovery-1', 'desktop_tools.recovery.workload.id': 'workload-1', 'desktop_tools.recovery.kind': 'file', 'desktop_tools.status': 'succeeded', 'desktop_tools.recovery.evidence.digest': digest }],
].map(([name, attributes]) => ({ ...base, name, attributes }));

test('semantic conventions cover every required signal family', () => {
  assert.equal(events.map(event => DesktopToolsSemanticEventSchema.parse(event)).length, 13);
  assert.deepEqual(DesktopToolsTelemetryBatchSchema.parse({ schemaVersion: 1, resource,
    scope: { name: 'desktop.tools', version: '1.0.0' }, events, droppedEvents: 0 }).events, events);
});

test('resource labels are fixed and exclude high-cardinality identifiers', () => {
  assert.deepEqual(DesktopToolsTelemetryResourceSchema.parse(resource), resource);
  for (const extra of [{ 'desktop_tools.profile.id': 'profile-1' }, { 'desktop_tools.release.id': 'release-1' }, { 'desktop_tools.run.id': 'run-1' }, { 'desktop_tools.task.id': 'task-1' }, { 'user.id': 'owner-1' }, { token: 'secret' }, { arbitrary: 'x' }]) {
    assert.throws(() => DesktopToolsTelemetryResourceSchema.parse({ ...resource, ...extra }));
  }
  assert.throws(() => DesktopToolsTelemetryResourceSchema.parse({ ...resource, 'host.id': 'h'.repeat(129) }));
});

test('event attributes and batches enforce cardinality bounds', () => {
  assert.throws(() => DesktopToolsSemanticEventSchema.parse({ ...events[3], attributes: { ...events[3].attributes, custom: 'x' } }));
  assert.throws(() => DesktopToolsSemanticEventSchema.parse({ ...events[5], attributes: { ...events[5].attributes, 'desktop_tools.task.id': 'x'.repeat(129) } }));
  assert.throws(() => DesktopToolsSemanticEventSchema.parse({ ...events[10], attributes: { ...events[10].attributes,
    'desktop_tools.verification.gaps': Array.from({ length: 65 }, (_, index) => `gap-${index}`) } }));
  assert.throws(() => DesktopToolsSemanticEventSchema.parse({ ...events[10], attributes: { ...events[10].attributes,
    'desktop_tools.verification.gaps': ['same-gap', 'same-gap'] } }));
  assert.throws(() => DesktopToolsTelemetryBatchSchema.parse({ schemaVersion: 1, resource,
    scope: { name: 'desktop.tools', version: '1.0.0' }, events: Array.from({ length: 513 }, () => events[0]), droppedEvents: 0 }));
});
