import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOWS_FIXTURE_BOUNDARIES,
  WINDOWS_LIFECYCLE_PHASES,
  WindowsFixtureSchema,
  WindowsFixtureEvidenceSchema,
  preflightWindowsMutation,
} from '../dist/windows-fixture-contract.js';

const releaseDigest = 'a'.repeat(64);
const recipeDigest = 'b'.repeat(64);
const now = '2026-11-10T12:00:00.000Z';

const fixture = {
  schemaVersion: 1,
  fixtureId: 'windows-11-26100-x64',
  isolation: 'disposable-vm',
  platform: 'win32',
  architecture: 'x64',
  edition: 'Windows 11 Enterprise',
  build: '26100.2314',
  powershell: { edition: 'Core', version: '7.5.4', executionPolicyObserved: 'RemoteSigned' },
  packageProviders: ['winget', 'msi', 'msix', 'chocolatey', 'scoop'],
  secretStores: ['credential-manager', 'dpapi-user', 'dpapi-machine'],
  wsl: { available: true, authoritySeparated: true },
  supportedBoundaries: [...WINDOWS_FIXTURE_BOUNDARIES],
};

function receipt(boundary, overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: `win-${boundary}`,
    source: 'real-windows-host',
    fixtureId: fixture.fixtureId,
    boundary,
    releaseDigest,
    recipeDigest,
    observedAt: '2026-11-10T10:00:00.000Z',
    expiresAt: '2026-11-17T10:00:00.000Z',
    independentAttestor: 'windows-lab-attestor',
    phases: [...WINDOWS_LIFECYCLE_PHASES],
    outcome: 'passed',
    ...overrides,
  };
}

function request(boundary, overrides = {}) {
  const evidence = [receipt(boundary)];
  return { fixture, boundary, releaseDigest, recipeDigest, evidence,
    verifiedEvidenceIds: [evidence[0].evidenceId], now, ...overrides };
}

test('strict fixture covers every required Windows-native boundary', () => {
  const parsed = WindowsFixtureSchema.parse(fixture);
  assert.deepEqual(parsed.supportedBoundaries, [
    'powershell-stage-zero', 'package-provider', 'file', 'acl', 'reparse-point', 'registry',
    'service', 'reboot', 'wsl', 'secret-storage',
  ]);
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture, unexpected: true }), /unrecognized/i);
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture, isolation: 'production-host' }));
});

test('fixture refuses capability claims without their native prerequisites', () => {
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture, packageProviders: [] }), /observed provider/i);
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture, secretStores: [] }), /observed store/i);
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture, wsl: { available: true, authoritySeparated: false } }), /separate Windows\/Linux authority/i);
  assert.throws(() => WindowsFixtureSchema.parse({ ...fixture,
    supportedBoundaries: [...fixture.supportedBoundaries.slice(0, -1), 'acl'] }), /unique/i);
});

test('admits every boundary only with externally verified current real-host lifecycle evidence', () => {
  for (const boundary of WINDOWS_FIXTURE_BOUNDARIES) {
    assert.deepEqual(preflightWindowsMutation(request(boundary)), {
      decision: 'allow', boundary, evidenceId: `win-${boundary}`, reason: 'verified-real-evidence',
    });
  }
});

test('preflight-denies unsupported Windows mutation even if evidence claims support', () => {
  const limited = { ...fixture, supportedBoundaries: ['powershell-stage-zero'] };
  assert.deepEqual(preflightWindowsMutation(request('registry', { fixture: limited })), {
    decision: 'deny', boundary: 'registry', reason: 'unsupported-boundary',
  });
});

test('mocked, unverified, stale, future, mismatched, and incomplete evidence cannot authorize mutation', () => {
  const base = request('acl');
  const denied = [
    { ...base, verifiedEvidenceIds: [] },
    { ...base, now: '2026-11-18T12:00:00.000Z' },
    { ...base, now: '2026-11-01T12:00:00.000Z' },
    { ...base, releaseDigest: 'c'.repeat(64) },
    { ...base, recipeDigest: 'd'.repeat(64) },
    { ...base, evidence: [receipt('acl', { fixtureId: 'some-other-fixture' })] },
  ];
  for (const input of denied) {
    assert.deepEqual(preflightWindowsMutation(input), {
      decision: 'deny', boundary: 'acl', reason: 'no-current-verified-real-evidence',
    });
  }
  assert.throws(() => WindowsFixtureEvidenceSchema.parse(receipt('acl', {
    phases: WINDOWS_LIFECYCLE_PHASES.slice(0, -1),
  })), /too_small|length|array/i);
  assert.throws(() => WindowsFixtureEvidenceSchema.parse({
    ...receipt('acl'), source: 'simulated-windows-host',
  }));
});

test('contract rejects malformed evidence and does not execute platform operations', () => {
  assert.throws(() => preflightWindowsMutation({ ...request('service'), now: 'not-a-time' }));
  assert.throws(() => preflightWindowsMutation({ ...request('reboot'), releaseDigest: 'unsigned' }));
  assert.throws(() => preflightWindowsMutation({ ...request('registry'), verifiedEvidenceIds: ['unknown'], extra: true }), /unrecognized/i);
});
