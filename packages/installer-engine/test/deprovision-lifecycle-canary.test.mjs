import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyConfigurationTransaction,
  createDesktopToolsToolAdapters,
  createInstallerEngine,
  createJournalStore,
} from '../dist/index.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixedDigest = character => character.repeat(64);
const facts = {
  schemaVersion: 1, hostId: 'deprovision-canary', collectedAt: '2026-11-09T00:00:00.000Z',
  os: 'linux', osVersion: 'fixture', arch: 'x64', environment: 'container',
  roles: ['container'], packageManagers: [], capabilities: [],
};
const desiredState = {
  schemaVersion: 1, revision: 'deprovision-canary-1', hostId: facts.hostId,
  packages: [], services: [], consents: [], offline: true,
};

async function snapshot(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => {
    const metadata = await stat(path);
    const bytes = await readFile(path);
    return [path, { digest: digest(bytes), mode: metadata.mode & 0o7777, size: metadata.size }];
  })));
}

test('disposable committed lifecycle deprovision preview preserves user, modified, unowned, and unsupported resources', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-tools-deprovision-canary-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, 'state');
  await chmod(root, 0o700);
  const managed = join(root, 'managed.conf');
  const modified = join(root, 'modified.conf');
  const userData = join(root, 'user-data.txt');
  const unowned = join(root, 'unowned.conf');
  const unsupported = join(root, 'storage-volume');
  await Promise.all([
    writeFile(managed, 'previous managed\n', { mode: 0o600 }),
    writeFile(modified, 'previous modified\n', { mode: 0o600 }),
    writeFile(userData, 'irreplaceable user data\n', { mode: 0o600 }),
    writeFile(unowned, 'foreign configuration\n', { mode: 0o600 }),
    writeFile(unsupported, 'storage sentinel\n', { mode: 0o600 }),
  ]);

  const task = {
    schemaVersion: 1, id: 'config.managed', inputDigest: fixedDigest('b'), dependencies: [],
    predicate: 'host-supported', operations: { check: 'managed-check', apply: 'managed-apply', verify: 'managed-verify' },
    timeoutMs: 10_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 16, network: false }, privilege: 'user', network: 'none',
    consent: 'none', lockDomains: ['configuration.fixture'], cleanup: 'always', compensation: 'configuration',
  };
  const modifiedTask = {
    ...task, id: 'config.modified', inputDigest: fixedDigest('c'),
    operations: { check: 'modified-check', apply: 'modified-apply', verify: 'modified-verify' },
  };
  const unsupportedTask = {
    ...task, id: 'storage.unsupported', inputDigest: fixedDigest('d'),
    operations: { check: 'storage-check', apply: 'storage-apply', verify: 'storage-verify' },
  };
  const journal = createJournalStore({
    stateRoot, hostId: facts.hostId, bootId: 'fixture-boot', processStart: 'fixture-process',
    pid: process.pid, isProcessAlive: async () => true,
  });
  const engine = createInstallerEngine({
    journal,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [task, modifiedTask, unsupportedTask],
        selectedTaskIds: [task.id, modifiedTask.id, unsupportedTask.id] }),
      check: async () => 'needed',
      apply: async (node, context) => {
        const [target, content] = node.id === task.id ? [managed, 'installed managed\n']
          : node.id === modifiedTask.id ? [modified, 'installed modified\n'] : [unsupported, 'installed storage sentinel\n'];
        const candidate = Buffer.from(content);
        return applyConfigurationTransaction({
          spec: { schemaVersion: 1, taskId: node.id, targetPath: target, effect: 'installer-configuration', dependencies: [] },
          candidateBytes: candidate,
          hooks: {
            validateCandidate: async path => assert.deepEqual(await readFile(path), candidate),
            verifyPostcondition: async path => Buffer.compare(await readFile(path), candidate) === 0,
          },
          persistence: context.configurationCompensation,
        });
      },
      verify: async node => {
        const [target, expected] = node.id === task.id
          ? [managed, 'installed managed\n'] : node.id === modifiedTask.id
            ? [modified, 'installed modified\n'] : [unsupported, 'installed storage sentinel\n'];
        return await readFile(target, 'utf8') === expected ? 'verified' : 'pending';
      },
    },
  });
  const sourceRunId = 'deprovision-source';
  const plan = await engine.plan(facts, desiredState, 'fixture-release');
  const installed = await engine.run({
    runId: sourceRunId, releaseId: 'fixture-release', desiredState, approvedPlanDigest: plan.digest,
  });
  assert.equal(installed.receipt.status, 'success');
  assert.equal((await journal.inspectCompletion(sourceRunId, plan.digest)).authority, 'committed');
  const compensations = await journal.readCompensations(sourceRunId, plan.digest);
  assert.equal(compensations.length, 3);
  const evidenceByResource = Object.fromEntries(compensations.map(value => [value.record.taskId, value]));
  for (const value of compensations) {
    assert.equal(value.record.state, 'available');
    assert.match(value.record.artifactDigest, /^[a-f0-9]{64}$/);
    assert.match(value.appliedDigest, /^[a-f0-9]{64}$/);
  }

  // Simulate a user edit after a second installer-owned resource was recorded.
  await writeFile(modified, 'user modified after install\n', { mode: 0o600 });
  const before = await snapshot([managed, modified, userData, unowned, unsupported]);
  const invocations = [];
  const adapters = createDesktopToolsToolAdapters({
    operation: Object.freeze({ facts, desiredState, plan, operations: {} }),
    runId: sourceRunId, releaseId: 'fixture-release', stateRoot,
    invokeEngine: async invocation => { invocations.push(invocation); return {}; },
    requestConsent: async () => { throw new Error('deprovision preview must not request mutation consent'); },
    now: () => '2026-11-09T00:00:00.000Z',
  });
  const ownershipEvidence = resourceId => ({
    schemaVersion: 1, owner: 'install.doctor', sourceRunId,
    artifactDigest: evidenceByResource[resourceId].record.artifactDigest,
    appliedDigest: evidenceByResource[resourceId].appliedDigest,
  });
  const preview = await adapters.desktop_tools_deprovision_preview({
    schemaVersion: 1, sourceRunId, sourcePlanDigest: plan.digest,
    resources: [
      { schemaVersion: 1, resourceId: 'config.managed', effect: 'configuration', target: managed,
        ownership: 'installer-owned', ownershipEvidence: ownershipEvidence('config.managed'),
        observedDigest: digest(await readFile(managed)), userData: 'absent' },
      { schemaVersion: 1, resourceId: 'config.modified', effect: 'configuration', target: modified,
        ownership: 'installer-owned', ownershipEvidence: ownershipEvidence('config.modified'),
        observedDigest: digest(await readFile(modified)), userData: 'absent' },
      { schemaVersion: 1, resourceId: 'data.user', effect: 'user-data', target: userData,
        ownership: 'user-owned', ownershipEvidence: null, observedDigest: digest(await readFile(userData)), userData: 'present' },
      { schemaVersion: 1, resourceId: 'config.unowned', effect: 'configuration', target: unowned,
        ownership: 'unowned', ownershipEvidence: null, observedDigest: digest(await readFile(unowned)), userData: 'absent' },
      { schemaVersion: 1, resourceId: 'storage.unsupported', effect: 'storage', target: unsupported,
        ownership: 'installer-owned', ownershipEvidence: ownershipEvidence('storage.unsupported'),
        observedDigest: digest(await readFile(unsupported)), userData: 'absent' },
    ],
  });

  assert.equal(preview.executable, false);
  assert.deepEqual(preview.eligibleResourceIds, ['config.managed']);
  assert.deepEqual(preview.refusedResourceIds,
    ['config.modified', 'config.unowned', 'data.user', 'storage.unsupported']);
  assert.equal(preview.items.find(item => item.resourceId === 'config.modified').reason, 'target-modified-since-install');
  assert.equal(preview.items.find(item => item.resourceId === 'config.unowned').reason, 'ownership-not-installer');
  assert.equal(preview.items.find(item => item.resourceId === 'data.user').reason, 'user-data-preserved');
  assert.equal(preview.items.find(item => item.resourceId === 'storage.unsupported').reason, 'effect-prohibited');
  assert.equal(invocations.length, 0, 'preview must not invoke the mutation engine');
  assert.deepEqual(await snapshot([managed, modified, userData, unowned, unsupported]), before,
    'preview must preserve bytes and metadata for every resource');
});
