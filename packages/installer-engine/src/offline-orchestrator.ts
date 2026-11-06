import { z } from 'zod';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { HostFactsSchema } from './contracts.js';
import type { HostFacts, InstallerEvent } from './contracts.js';
import { createInstallerEngine } from './engine.js';
import type { InstallerRunResult } from './engine.js';
import type { JournalStore } from './journal.js';
import { OfflineBundleError, verifyOfflineBundle } from './offline-bundle.js';
import type { OfflineBundlePlan } from './offline-bundle.js';
import {
  createOfflineInstallerAdapter,
  validateOfflineExecutionClosure,
  verifyOfflineNativeDebianMetadata,
} from './offline-execution.js';
import type { NativePackageRuntimeFactory } from './offline-execution.js';
import type { DebianMetadataVerifier } from './debian-metadata.js';
import type { NativeOfflinePayloadDescriptor } from './contracts.js';
import type { DebianVersionComparator } from './debian-relationships.js';
import type { NativeDebInspectionInput, ParsedDebianControlArchive } from './native-deb-inspection.js';
import { createOfflineSandboxRuntime } from './offline-sandbox.js';
import type { OfflineSandboxRuntime } from './offline-sandbox.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);

/**
 * Trust boundary supplied by the enrolled host runtime. Its implementation must
 * discover the current machine, never replay signed bundle observations.
 */
export type OfflineHostAttestor = {
  readonly platform: NodeJS.Platform | string;
  discover(): Promise<{ readonly immutableHostId: string; readonly facts: unknown }>;
};

const LiveHostAttestationSchema = z.strictObject({
  immutableHostId: identifier,
  facts: HostFactsSchema,
});

/**
 * Linux production attestor. The stable host ID is a non-reversible digest of
 * the protected systemd machine-id; semantic discovery receives that ID and
 * must report current observations for it.
 */
export function createLinuxOfflineHostAttestor(
  discoverFacts: (immutableHostId: string) => Promise<unknown>,
): OfflineHostAttestor {
  return {
    platform: process.platform,
    discover: async () => {
      if (process.platform !== 'linux') throw new OfflineBundleError('Linux machine identity is unavailable on this platform');
      const path = '/etc/machine-id';
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
        throw new OfflineBundleError('Linux machine identity source is not a protected root-owned regular file');
      }
      const machineId = (await readFile(path, 'utf8')).trim();
      if (!/^[a-f0-9]{32}$/.test(machineId) || /^0+$/.test(machineId)) {
        throw new OfflineBundleError('Linux machine identity source is invalid');
      }
      const immutableHostId = `linux-${createHash('sha256').update(machineId, 'utf8').digest('hex')}`;
      return { immutableHostId, facts: await discoverFacts(immutableHostId) };
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function semanticFacts(facts: HostFacts): unknown {
  return canonical({
    ...facts,
    collectedAt: undefined,
    roles: [...facts.roles].sort(),
    packageManagers: [...facts.packageManagers].sort(),
    capabilities: [...facts.capabilities].sort(),
  });
}

function sameSemanticFacts(left: HostFacts, right: HostFacts): boolean {
  return JSON.stringify(semanticFacts(left)) === JSON.stringify(semanticFacts(right));
}

/**
 * Executes a signed offline plan only after signature/content re-verification,
 * current-host attestation, sandbox proof, and with a mandatory durable journal.
 */
export async function executeOfflineBundle(input: {
  readonly plan: OfflineBundlePlan;
  readonly trust: unknown;
  readonly releaseTrust: unknown;
  readonly materializedRoot: string;
  readonly journalFactory: (attestedHostId: string) => JournalStore;
  readonly runId: string;
  readonly hostAttestor: OfflineHostAttestor;
  readonly sandbox?: OfflineSandboxRuntime;
  readonly now?: () => string;
  readonly resume?: boolean;
  readonly signal?: AbortSignal;
  readonly observer?: (event: InstallerEvent) => void;
  readonly nativePackageRuntimeFactory?: NativePackageRuntimeFactory;
  readonly debianMetadataVerifier?: DebianMetadataVerifier | ((input: {
    readonly descriptor: NativeOfflinePayloadDescriptor;
    readonly keyringBytes: Buffer;
  }) => Promise<DebianMetadataVerifier>);
  readonly compareDebianVersions?: DebianVersionComparator;
  readonly inspectNativePackage?: (input: NativeDebInspectionInput) => Promise<ParsedDebianControlArchive>;
}): Promise<InstallerRunResult> {
  const runId = identifier.parse(input.runId);
  if (typeof input.journalFactory !== 'function') {
    throw new OfflineBundleError('offline execution requires an attested-host journal factory');
  }
  if (input.hostAttestor.platform !== 'linux') {
    throw new OfflineBundleError(`offline execution authority is supported only on Linux, not ${input.hostAttestor.platform}`);
  }
  const verified = await verifyOfflineBundle({
    bundleDirectory: input.plan.bundleDirectory, trust: input.trust, releaseTrust: input.releaseTrust,
  });
  if (verified.manifestDigest !== input.plan.manifestDigest) {
    throw new OfflineBundleError('offline bundle changed after its approved plan was created');
  }
  const now = input.now ?? (() => new Date().toISOString());
  const executionTime = z.string().datetime({ offset: true }).parse(now());
  if (new Date(verified.manifest.expiresAt).getTime() <= new Date(executionTime).getTime()) {
    throw new OfflineBundleError('offline bundle expired before execution');
  }
  const closure = await validateOfflineExecutionClosure(verified);
  const hasNativePackages = Object.values(closure.operations.operations)
    .some(operation => operation.kind === 'native-package');
  if (hasNativePackages && (!input.nativePackageRuntimeFactory || !input.debianMetadataVerifier || !input.compareDebianVersions)) {
    throw new OfflineBundleError('offline native package execution requires an owner-bound privileged runtime factory, Debian metadata verifier, and Debian version comparator');
  }
  const verifiedNativeMetadata = hasNativePackages
    ? await verifyOfflineNativeDebianMetadata(verified, closure, input.debianMetadataVerifier!)
    : undefined;
  if (verified.manifest.platform.os !== 'linux' || closure.hostFacts.os !== 'linux') {
    throw new OfflineBundleError('offline execution authority requires signed Linux target facts');
  }
  if (verified.manifest.platform.arch !== closure.hostFacts.arch
    || verified.manifest.platform.environment !== closure.hostFacts.environment) {
    throw new OfflineBundleError('signed bundle platform does not match signed host facts');
  }
  const attestation = LiveHostAttestationSchema.parse(await input.hostAttestor.discover());
  const liveFacts = attestation.facts;
  if (attestation.immutableHostId !== liveFacts.hostId) {
    throw new OfflineBundleError('current immutable host identity does not match discovered host facts');
  }
  if (!sameSemanticFacts(liveFacts, closure.hostFacts)) {
    throw new OfflineBundleError('current discovered host does not match signed host facts');
  }
  const sandbox = input.sandbox ?? createOfflineSandboxRuntime();
  const hasProcessOperations = Object.values(closure.operations.operations).some(operation => operation.kind === 'process');
  if (hasProcessOperations) {
    const capability = await sandbox.probe();
    if (!capability.supported) throw new OfflineBundleError(`offline sandbox authority is unavailable: ${capability.reason}`);
  }
  const adapter = await createOfflineInstallerAdapter({
    closure, materializedRoot: input.materializedRoot, sandbox,
    attestedHostFacts: liveFacts,
    ...(input.nativePackageRuntimeFactory ? { nativePackageRuntimeFactory: input.nativePackageRuntimeFactory } : {}),
    ...(verifiedNativeMetadata ? { verifiedNativeMetadata } : {}),
    ...(input.compareDebianVersions ? { compareDebianVersions: input.compareDebianVersions } : {}),
    ...(input.inspectNativePackage ? { inspectNativePackage: input.inspectNativePackage } : {}),
  });
  const planningEngine = createInstallerEngine({
    adapter, now, maxConcurrency: closure.plan.executionPolicy.maxConcurrency,
    resourceLimits: closure.plan.executionPolicy.resourceLimits,
  });
  const reproduced = await planningEngine.plan(liveFacts, closure.desiredState, closure.plan.releaseId);
  if (reproduced.digest !== closure.plan.digest) {
    throw new OfflineBundleError('current host cannot reproduce the approved offline plan authority');
  }
  const journal = input.journalFactory(liveFacts.hostId);
  if (!journal || typeof journal.claim !== 'function' || typeof journal.finalize !== 'function') {
    throw new OfflineBundleError('offline execution journal factory returned an invalid journal store');
  }
  const engine = createInstallerEngine({
    adapter, journal, now, maxConcurrency: closure.plan.executionPolicy.maxConcurrency,
    resourceLimits: closure.plan.executionPolicy.resourceLimits,
  });
  if (input.resume) {
    const inspection = await journal.inspectCompletion(runId, closure.plan.digest);
    if (inspection.authority !== 'uncommitted') {
      throw new OfflineBundleError(`offline resume requires released uncommitted evidence; found ${inspection.authority}`);
    }
  }
  return engine.run({
    runId, releaseId: closure.plan.releaseId, desiredState: closure.desiredState,
    approvedPlanDigest: closure.plan.digest, resume: z.boolean().parse(input.resume ?? false),
  }, {
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.observer ? { observer: input.observer } : {}),
  });
}
