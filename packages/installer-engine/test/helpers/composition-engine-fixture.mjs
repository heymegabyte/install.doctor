import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyConfigurationTransaction,
  createDesktopToolsToolAdapters,
  createInstallerEngine,
  createJournalStore,
  createRollbackPlan,
  NormalizedPlanSchema,
  executeApprovedUserFileRollback,
} from '../../dist/index.js';
import { InstallerOperationError } from '../../dist/engine.js';

/** @param {string | Uint8Array} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} character */
const fixedDigest = character => character.repeat(64);

/** @param {{ profileRevision: string, releaseId: string, actorId: string }} identity */
export async function createCompositionEngineFixture(identity) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-tools-composition-engine-')));
  await chmod(root, 0o700);
  const stateRoot = join(root, 'state');
  const target = join(root, 'managed.conf');
  const previousBytes = Buffer.from('previous configuration\n');
  const desiredBytes = Buffer.from('desktop tools configuration\n');
  await writeFile(target, previousBytes, { mode: 0o600 });
  const facts = {
    schemaVersion: 1, hostId: 'composition-host', collectedAt: '2026-11-09T00:00:00.000Z',
    os: 'linux', osVersion: 'fixture', arch: 'x64', environment: 'container',
    roles: ['container'], packageManagers: [], capabilities: [],
  };
  const desiredState = { schemaVersion: 1, revision: identity.profileRevision, hostId: facts.hostId,
    packages: [], services: [], consents: [], offline: true };
  const task = {
    schemaVersion: 1, id: 'config.composition', inputDigest: fixedDigest('b'), dependencies: [], predicate: 'host-supported',
    operations: { check: 'composition-check', apply: 'composition-apply', verify: 'composition-verify' },
    timeoutMs: 10_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 16, network: false }, privilege: 'user', network: 'none', consent: 'none',
    lockDomains: ['configuration.composition'], cleanup: 'always', compensation: 'configuration',
  };
  let mutationCount = 0;
  /** @type {{ entered: () => void } | null} */
  let interruption = null;
  const journal = createJournalStore({ stateRoot, hostId: facts.hostId, bootId: 'fixture-boot', processStart: 'fixture-process',
    pid: process.pid, isProcessAlive: async () => true });
  const engine = createInstallerEngine({
    journal,
    adapter: {
      discover: async () => facts,
      plan: async () => ({ tasks: [task], selectedTaskIds: [task.id] }),
      check: async () => Buffer.compare(await readFile(target), desiredBytes) === 0 ? 'verified' : 'needed',
      apply: async (_node, context) => {
        mutationCount += 1;
        assert.ok(context?.configurationCompensation);
        await applyConfigurationTransaction({
          spec: { schemaVersion: 1, taskId: task.id, targetPath: target, effect: 'installer-configuration', dependencies: [] },
          candidateBytes: desiredBytes,
          hooks: { validateCandidate: async path => assert.deepEqual(await readFile(path), desiredBytes),
            verifyPostcondition: async path => Buffer.compare(await readFile(path), desiredBytes) === 0 },
          persistence: context.configurationCompensation,
        });
        if (interruption) {
          const active = interruption; interruption = null; active.entered();
          await new Promise((_, reject) => context.signal.addEventListener('abort',
            () => reject(new InstallerOperationError('composition interruption after mutation', 'cancelled')), { once: true }));
        }
      },
      verify: async () => Buffer.compare(await readFile(target), desiredBytes) === 0 ? 'verified' : 'pending',
    },
  });

  /** @param {string} runId @param {{ signal?: AbortSignal }} [options] */
  const makeAdapters = (runId, options = {}) => {
    let id = 0;
    /** @type {Awaited<ReturnType<typeof engine.plan>> | undefined} */
    let plan;
    /** @type {Map<string, { rollback: Awaited<ReturnType<typeof createRollbackPlan>>, compensations: Awaited<ReturnType<typeof journal.readCompensations>> }>} */
    const rollbackPlans = new Map();
    /** @type {Parameters<typeof createDesktopToolsToolAdapters>[0]['invokeEngine']} */
    const invokeEngine = async invocation => {
      /** @param {string} name */
      const readString = name => {
        const value = invocation[name];
        assert.ok(typeof value === 'string', `missing engine invocation field: ${name}`);
        return value;
      };
      switch (invocation.command) {
        case 'discover': return engine.discover();
        case 'validate': return { schemaVersion: 1, valid: true, factsDigest: digest(JSON.stringify(facts)) };
        case 'plan': plan = await engine.plan(facts, desiredState, identity.releaseId); return plan;
        case 'run': return engine.run({ runId, releaseId: identity.releaseId, desiredState, approvedPlanDigest: readString('approvedPlanDigest') },
          options.signal ? { signal: options.signal } : undefined);
        case 'resume': return engine.run({ runId, releaseId: identity.releaseId, desiredState,
          approvedPlanDigest: readString('planDigest'), resume: true });
        case 'evidence-verify': {
          const completion = await journal.inspectCompletion(runId, readString('planDigest'));
          if (completion.authority !== 'committed') throw new Error('composition run has no committed authority');
          return { schemaVersion: 1, ...completion };
        }
        case 'status': return engine.status({ runId, plan: NormalizedPlanSchema.parse(invocation.plan), approvedPlanDigest: readString('approvedPlanDigest') });
        case 'rollback-config-plan': {
          const compensations = await journal.readCompensations(readString('sourceRunId'), readString('sourcePlanDigest'));
          const rollback = await createRollbackPlan({ sourceRunId: readString('sourceRunId'),
            sourcePlanDigest: readString('sourcePlanDigest'), compensations });
          rollbackPlans.set(rollback.digest, { rollback, compensations }); return rollback;
        }
        case 'rollback-config-execute': {
          const stored = rollbackPlans.get(readString('approvedPlanDigest'));
          if (!stored) throw new Error('composition rollback plan is unavailable');
          return executeApprovedUserFileRollback({ plan: stored.rollback,
            approvedPlanDigest: readString('approvedPlanDigest') }, stored.compensations);
        }
        default: throw new Error(`composition fixture does not implement engine command: ${invocation.command}`);
      }
    };
    const adapters = createDesktopToolsToolAdapters({
      operation: Object.freeze({ facts, desiredState, plan: {}, operations: {} }), runId, releaseId: identity.releaseId, stateRoot,
      invokeEngine, requestConsent: async () => ({ approved: true, actorId: identity.actorId, approvedAt: '2026-11-09T00:00:01.000Z' }),
      createId: () => `composition-${++id}`, now: () => '2026-11-09T00:00:02.000Z',
    });
    return { adapters, getPlan: () => plan };
  };

  return Object.freeze({
    root, stateRoot, target, previousBytes, desiredBytes, facts, desiredState, task, journal, engine, makeAdapters,
    mutationCount: () => mutationCount,
    resetTarget: () => writeFile(target, previousBytes, { mode: 0o600 }),
    prepareInterruption: () => {
      /** @type {Promise<void>} */
      const promise = new Promise(resolveEntered => {
        interruption = { entered: resolveEntered };
      });
      return promise;
    },
    snapshot: async () => { const metadata = await stat(target); return { digest: digest(await readFile(target)), ino: metadata.ino, mtimeMs: metadata.mtimeMs, mode: metadata.mode & 0o777 }; },
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
