import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  compileProfile,
  exportCompiledProfile,
  importCompiledProfile,
  migrateProfile,
  semanticProfileDiff,
  simulateProfile,
} from '../dist/profile-compiler.js';

const catalog = [
  { id: 'git', dependencies: ['runtime'], conflicts: [] },
  { id: 'runtime', dependencies: [], conflicts: [] },
  { id: 'ripgrep', dependencies: ['runtime'], conflicts: ['slowgrep'] },
  { id: 'slowgrep', dependencies: [], conflicts: ['ripgrep'] },
];

function environment() {
  return {
    schemaVersion: 4,
    revision: 'revision-1',
    appUrl: 'https://desktop.tools',
    routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
    skills: { repository: 'heymegabyte/agent-skills', commit: 'a'.repeat(40), include: ['terminal', 'backup'] },
    defaults: { packages: ['git'], shellHistory: 'hishtory', tier: 'workstation' },
    roles: [{ id: 'workstation', tier: 'workstation', packages: ['ripgrep'], capabilities: ['interactive', 'desktop'] }],
    machines: [{ id: 'zen', os: 'linux', role: 'workstation', tier: 'workstation', capabilities: ['linux'],
      packageOverrides: { add: [], remove: [] } }],
    services: [{ id: 'alloy', kind: 'loki', pushUrl: 'https://loki.example.test/push',
      credentialRef: 'infisical://desktop-tools/profiles/demo/loki', machineIds: ['zen'] }],
    privacy: { shellAnalysis: 'local', screenshots: 'off', terminalInput: false, productLearning: false },
    profile: { id: 'demo', revision: 'revision-1', visibility: 'private' },
    promptPolicy: { id: 'deterministic', version: 'v1', mode: 'deterministic-only', allowedRoutes: [] },
    secretReferences: [{ id: 'loki-writer', reference: 'infisical://desktop-tools/profiles/demo/loki',
      requiredAt: 'runtime', offlineRecovery: 'not-required' }],
  };
}

test('profile compilation is byte-identical across repeated and permuted equivalent input', () => {
  const first = compileProfile({ environment: environment(), catalog });
  const permuted = environment();
  permuted.skills.include.reverse();
  permuted.roles[0].capabilities.reverse();
  const second = compileProfile({ environment: permuted, catalog: [...catalog].reverse() });
  assert.equal(exportCompiledProfile(first), exportCompiledProfile(second));
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.catalogClosure, ['git', 'ripgrep', 'runtime']);
  assert.deepEqual(first.hostOverlays[0].packages, ['git', 'ripgrep']);
  assert.deepEqual(first.servicePolicy, [{ serviceId: 'alloy', machineIds: ['zen'], credentialReferenceId: 'loki-writer' }]);
  assert.deepEqual(first.secretRequirements, [{ id: 'loki-writer', requiredAt: 'runtime', offlineRecovery: 'not-required' }]);
});

test('simulation explains package conflicts and undeclared service references without mutation or values', () => {
  const conflicting = environment();
  conflicting.machines[0].packageOverrides.add = ['slowgrep'];
  const result = simulateProfile({ environment: conflicting, catalog });
  assert.equal(result.valid, false);
  assert.equal(result.conflicts[0].code, 'catalog-conflict');
  assert.match(result.conflicts[0].remediation, /Remove either/);

  const undeclared = environment();
  undeclared.secretReferences = [];
  const secretResult = simulateProfile({ environment: undeclared, catalog });
  assert.equal(secretResult.valid, false);
  assert.equal(secretResult.conflicts[0].code, 'missing-secret-reference');
  assert.doesNotMatch(JSON.stringify(secretResult), /infisical:|secret-device-value/);
});

test('legacy migration is explicit, deterministic, and compilation rejects unmigrated input', () => {
  const legacy = {
    schemaVersion: 2, revision: 'revision-1', appUrl: 'https://app.install.doctor',
    routing: environment().routing, skills: environment().skills,
    defaults: { packages: ['git'], shellHistory: 'hishtory' },
    roles: [{ id: 'workstation', packages: ['ripgrep'] }],
    machines: [{ id: 'zen', os: 'linux', role: 'workstation', packageOverrides: { add: [], remove: [] } }],
    services: [], privacy: environment().privacy,
  };
  assert.throws(() => compileProfile({ environment: legacy, catalog }), /migrate explicitly/);
  const options = { profileId: 'demo', visibility: 'private', promptPolicyId: 'deterministic', promptPolicyVersion: 'v1',
    promptMode: 'deterministic-only', allowedRoutes: [] };
  assert.deepEqual(migrateProfile(legacy, options), migrateProfile(legacy, options));
  assert.equal(compileProfile({ environment: migrateProfile(legacy, options), catalog }).environment.schemaVersion, 4);
});

test('import/export validates content integrity and semantic diff omits secret locations', () => {
  const before = compileProfile({ environment: environment(), catalog });
  const serialized = exportCompiledProfile(before);
  assert.deepEqual(importCompiledProfile(serialized), before);
  const tampered = JSON.parse(serialized);
  tampered.hostOverlays[0].packages.push('malware');
  assert.throws(() => importCompiledProfile(JSON.stringify(tampered)), /digest mismatch/);
  const selfSignedForgery = JSON.parse(serialized);
  selfSignedForgery.hostOverlays[0].packages.push('malware');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  const { digest: _oldDigest, ...forgedUnsigned } = selfSignedForgery;
  selfSignedForgery.digest = createHash('sha256').update(JSON.stringify(canonical(forgedUnsigned))).digest('hex');
  assert.throws(() => importCompiledProfile(JSON.stringify(selfSignedForgery)), /derived state differs/);

  const changed = environment();
  changed.privacy.shellAnalysis = 'off';
  changed.secretReferences[0].reference = 'infisical://desktop-tools/profiles/demo/replaced';
  changed.services[0].credentialRef = changed.secretReferences[0].reference;
  const diff = semanticProfileDiff(before, compileProfile({ environment: changed, catalog }));
  assert.ok(diff.some(change => change.path === '/environment/privacy/shellAnalysis'));
  assert.doesNotMatch(JSON.stringify(diff), /infisical:|replaced/);
});
