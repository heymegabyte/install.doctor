import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeDisposableWindowsPlan,
  resumeDisposableWindowsReboot,
  WindowsNativePlanSchema,
} from '../dist/windows-native-operations.js';

const d = letter => letter.repeat(64);
const fixture = {
  schemaVersion: 1, fixtureId: 'authorized-win11-fixture', isolation: 'disposable-vm', platform: 'win32', architecture: 'x64',
  edition: 'Windows 11 Enterprise', build: '26100.2314',
  powershell: { edition: 'Core', version: '7.5.4', executionPolicyObserved: 'AllSigned' },
  packageProviders: ['winget'], secretStores: ['credential-manager', 'dpapi-machine'],
  wsl: { available: false, authoritySeparated: true },
  supportedBoundaries: ['powershell-stage-zero', 'package-provider', 'file', 'acl', 'registry', 'service', 'reboot', 'secret-storage'],
};
const base = { schemaVersion: 1, dependsOn: [], authority: 'machine', timeoutMs: 60_000 };
const operations = [
  { ...base, operationId: 'stage', kind: 'stage-zero', releaseDigest: d('a'), envelopeDigest: d('b'),
    profileOrigin: 'https://fixture.desktop.tools', expectedProduct: 'desktop-tools', signerEvidenceId: 'verified-signer', maxBytes: 1_000_000 },
  { ...base, operationId: 'pkg', dependsOn: ['stage'], kind: 'package', action: 'install', provider: 'winget', packageId: 'Git.Git', version: '2.47.0', artifactDigest: d('c'), scope: 'machine' },
  { ...base, operationId: 'file', dependsOn: ['stage'], kind: 'file', action: 'write', path: 'C:\\ProgramData\\DesktopTools\\config.json', contentDigest: d('d'), ownerSid: 'S-1-5-18' },
  { ...base, operationId: 'reg', dependsOn: ['stage'], kind: 'registry', action: 'set', hive: 'HKLM', key: 'Software\\DesktopTools', valueName: 'Release', valueType: 'String', valueDigest: d('e') },
  { ...base, operationId: 'svc', dependsOn: ['file'], kind: 'service', action: 'configure', serviceName: 'DesktopTools', startType: 'Automatic' },
  { ...base, operationId: 'acl', dependsOn: ['file'], kind: 'acl', path: 'C:\\ProgramData\\DesktopTools', ownerSid: 'S-1-5-18', inherit: false,
    entries: [{ principalSid: 'S-1-5-18', access: 'allow', rights: ['full-control'] }] },
  { ...base, authority: 'user', operationId: 'secret', dependsOn: ['acl'], kind: 'secret', action: 'materialize', store: 'credential-manager',
    secretReference: 'infisical://desktop-tools/prod/windows-token', targetName: 'desktop-tools-token', consumerSid: 'S-1-5-21-1000', valueDigest: d('f') },
];
const plan = {
  schemaVersion: 1, planId: 'windows-native-plan', fixture,
  authorization: { fixtureId: fixture.fixtureId, purpose: 'disposable-windows-qualification', authorizedBy: 'fixture-owner', evidenceId: 'fixture-authorization', expiresAt: '2026-12-01T00:00:00.000Z' },
  verifiedEvidenceIds: ['fixture-authorization', 'verified-signer'],
  target: { platform: 'win32', architecture: 'x64', machineSid: 'S-1-5-18', userSid: 'S-1-5-21-1000', bootId: 'boot-before' },
  releaseDigest: d('a'), operations,
};
const state = () => ({ bootId: 'boot-before', packages: new Map(), files: new Map(), registry: new Map(), services: new Map(), acls: new Map(), secrets: new Map() });

test('authorized disposable fixture applies every non-reboot Windows-native boundary and reapplies unchanged', () => {
  const host = state();
  const first = executeDisposableWindowsPlan(plan, host, '2026-11-10T12:00:00.000Z');
  assert.equal(first.outcome, 'verified');
  assert.deepEqual(first.operationReceipts.map(item => item.kind), ['stage-zero', 'package', 'file', 'registry', 'service', 'acl', 'secret']);
  assert.deepEqual(first.operationReceipts.map(item => item.outcome), Array(7).fill('applied'));
  const second = executeDisposableWindowsPlan(plan, host, '2026-11-10T12:01:00.000Z');
  assert.deepEqual(second.operationReceipts.slice(1).map(item => item.outcome), Array(6).fill('unchanged'));
  assert.equal([...host.secrets.values()][0], d('f'), 'only a value digest reaches fixture evidence');
  assert.doesNotMatch(JSON.stringify(second), /windows-token|secretReference|infisical/u);
});

test('reboot is pending until a fresh boot identity resumes the exact continuation', () => {
  const host = state();
  const rebootPlan = { ...plan, operations: [{ ...base, operationId: 'reboot', kind: 'reboot', expectedPreBootId: 'boot-before', continuationId: 'resume-after-reboot', deadline: '2026-11-10T13:00:00.000Z' }] };
  const pending = executeDisposableWindowsPlan(rebootPlan, host, '2026-11-10T12:00:00.000Z');
  assert.equal(pending.outcome, 'pending-reboot');
  assert.throws(() => resumeDisposableWindowsReboot(pending, host, 'boot-before'), /fresh boot identity/);
  assert.deepEqual(resumeDisposableWindowsReboot(pending, host, 'boot-after'), { outcome: 'verified', continuationId: 'resume-after-reboot', postBootId: 'boot-after' });
});

test('Windows plan denies expired or mismatched fixture authority and unavailable native capabilities', () => {
  assert.throws(() => executeDisposableWindowsPlan({ ...plan, authorization: { ...plan.authorization, expiresAt: '2026-11-01T00:00:00.000Z' } }, state(), '2026-11-10T12:00:00.000Z'), /authorization is expired/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, authorization: { ...plan.authorization, fixtureId: 'other-fixture' } }), /bind the fixture/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[1], provider: 'chocolatey' }] }), /not observed/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[6], store: 'dpapi-user' }] }), /not observed/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[3], authority: 'user' }] }), /match its hive/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[3], extra: true }] }), /unrecognized/i);
});

test('secret values, unsafe paths, non-HTTPS stage zero, and stale boot identity fail before execution', () => {
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[2], path: 'C:\\ProgramData\\..\\Windows\\evil' }] }), /parent traversal/);
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[0], profileOrigin: 'http://fixture.desktop.tools' }] }));
  assert.throws(() => WindowsNativePlanSchema.parse({ ...plan, operations: [{ ...operations[6], secretValue: 'plaintext' }] }), /unrecognized/i);
  const changed = state(); changed.bootId = 'different-boot';
  assert.throws(() => executeDisposableWindowsPlan(plan, changed, '2026-11-10T12:00:00.000Z'), /boot identity changed/);
});
