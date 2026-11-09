import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortableProfileExport, materializePortableDesiredState, parsePortableProfileExport, serializePortableProfileExport } from '@install-doctor/aid-core/profile-export';
import { migrateBlueprintV2ToV3, migrateBlueprintV3ToV4 } from '@install-doctor/aid-core';
import { deriveBoundNormalizedPlan } from '../dist/index.js';

const task = {
  schemaVersion: 1, id: 'package.git', inputDigest: 'a'.repeat(64), dependencies: [], predicate: 'host-supported',
  requiredCapabilities: ['linux'], operations: { check: 'git-check', apply: 'git-apply', verify: 'git-verify' }, timeoutMs: 10_000,
  retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 64, network: false },
  privilege: 'user', network: 'none', consent: 'none', lockDomains: ['package-manager.apt'], cleanup: 'always', compensation: 'none',
};
const draft = { tasks: [task], selectedTaskIds: [task.id] };

function environment() {
  const v2 = {
    schemaVersion: 2, revision: 'revision-1', appUrl: 'https://app.install.doctor',
    routing: { engine: 'projectsites', preferredProvider: 'deepseek', allowPremium: false, maxTaskCostMicros: 0 },
    skills: { repository: 'heymegabyte/agent-skills', commit: '0'.repeat(40), include: ['desktop-provisioning'] },
    defaults: { packages: ['git'], shellHistory: 'hishtory' },
    roles: [{ id: 'runner', packages: [] }],
    machines: [{ id: 'private-source-host', os: 'linux', role: 'runner', packageOverrides: { add: [], remove: [] } }],
    services: [], privacy: { shellAnalysis: 'off', screenshots: 'off', terminalInput: false, productLearning: false },
  };
  return migrateBlueprintV3ToV4(migrateBlueprintV2ToV3(v2), {
    profileId: 'example', visibility: 'public-bootstrap', promptPolicyId: 'offline-v1', promptPolicyVersion: 'v1',
    promptMode: 'deterministic-only', allowedRoutes: [],
  });
}

test('a fresh standalone import reproduces the exact normalized plan digest', async () => {
  const exported = await createPortableProfileExport({
    environment: environment(), machineId: 'private-source-host', recipes: [{ id: 'packages', version: '1.0.0', sha256: 'b'.repeat(64) }],
  });
  const facts = {
    schemaVersion: 1, hostId: 'rebuilt-host', collectedAt: '2026-11-08T12:00:00.000Z', os: 'linux', osVersion: '24.04', arch: 'x64',
    environment: 'native', roles: ['runner'], packageManagers: ['apt'], capabilities: ['linux', 'server'],
  };
  const sourceDesired = await materializePortableDesiredState(exported, facts);
  const sourcePlan = await deriveBoundNormalizedPlan(draft, facts, sourceDesired, 'release-1', '2026-11-08T12:01:00.000Z');

  const imported = await parsePortableProfileExport(await serializePortableProfileExport(exported));
  const freshFacts = { ...facts, collectedAt: '2026-11-08T13:00:00.000Z' };
  const freshDesired = await materializePortableDesiredState(imported, freshFacts);
  const freshPlan = await deriveBoundNormalizedPlan(draft, freshFacts, freshDesired, 'release-1', '2026-11-08T13:01:00.000Z');

  assert.equal(freshPlan.digest, sourcePlan.digest);
  assert.equal(freshPlan.planId, sourcePlan.planId);
  assert.doesNotMatch(await serializePortableProfileExport(exported), /private-source-host/);
});
