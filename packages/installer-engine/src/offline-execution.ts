import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DesiredStateInputSchema, HostFactsSchema, NormalizedPlanSchema } from './contracts.js';
import type { DesiredStateInput, HostFacts, NativeOfflinePayloadDescriptor, NormalizedPlan } from './contracts.js';
import { reproduceNormalizedPlan } from './engine.js';
import { InstallerOperationError } from './engine.js';
import type { Inspection, InstallerAdapter, TaskExecutionContext, Verification } from './engine.js';
import {
  OfflineBundleError,
  readVerifiedOfflineArtifact,
} from './offline-bundle.js';
import type { VerifiedOfflineBundle } from './offline-bundle.js';
import { createOfflineSandboxRuntime } from './offline-sandbox.js';
import type { OfflineSandboxRuntime } from './offline-sandbox.js';
import { applyConfigurationTransaction } from './config-transaction.js';
import { verifyDebianRepositoryMetadata } from './debian-metadata.js';
import type { DebianMetadataVerifier, VerifiedDebianMetadata } from './debian-metadata.js';
import { inspectNativeDebianPackage } from './native-deb-inspection.js';
import type { NativeDebInspectionInput, ParsedDebianControlArchive } from './native-deb-inspection.js';
import { parseDebianRelationships, validateDebianDependencyClosure } from './debian-relationships.js';
import type { DebianVersionComparator } from './debian-relationships.js';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { createMaterializedArtifactResolver, openVerifiedArtifactSnapshot, VerifiedArtifactMaterializationError } from './verified-artifact-materializer.js';
import type { VerifiedArtifactResolver } from './verified-artifact-materializer.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const packageKey = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9.+-]*(?::[a-z0-9][a-z0-9-]*)?$/);
const literalArgument = z.strictObject({
  kind: z.literal('literal'),
  value: z.string().max(4096).refine(value => !value.includes('\0'), 'literal argument cannot contain NUL'),
});
const artifactArgument = z.strictObject({ kind: z.literal('artifact'), artifactId: identifier });
const processOperation = z.strictObject({
  kind: z.literal('process'),
  effectClass: z.literal('catalog-executable'),
  executableArtifactId: identifier,
  arguments: z.array(z.discriminatedUnion('kind', [literalArgument, artifactArgument])).max(128),
});
const managedFileOperation = z.strictObject({
  kind: z.literal('managed-file'),
  effectClass: z.literal('installer-configuration'),
  action: z.enum(['check', 'apply', 'verify']),
  candidateArtifactId: identifier,
  targetPath: z.string().min(1).max(4096).refine(
    value => isAbsolute(value) && normalize(value) === value && dirname(value) !== value && !value.includes('\0'),
    'managed-file target must be a canonical absolute file path',
  ),
  candidateMode: z.union([z.literal(0o600), z.literal(0o640), z.literal(0o644)]),
});
export const NativePackageInstalledWitnessSchema = z.strictObject({
  kind: z.literal('preexisting-witness'), manager: z.literal('dpkg'),
  packageName: z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,127}$/),
  minimumVersion: z.string().min(1).max(128), architecture: z.enum(['amd64', 'arm64']),
});
export type NativePackageInstalledWitness = z.infer<typeof NativePackageInstalledWitnessSchema>;
export async function assertNativePackageInstalledWitnesses(input: {
  witnesses: readonly NativePackageInstalledWitness[];
  observe: (packageName: string, signal?: AbortSignal) => Promise<import('./native-dpkg-state.js').DpkgPackageState | null>;
  compareDebianVersions: DebianVersionComparator;
  signal?: AbortSignal;
}): Promise<void> {
  for (const witnessInput of input.witnesses) {
    const witness = NativePackageInstalledWitnessSchema.parse(witnessInput);
    const observed = await input.observe(witness.packageName, input.signal);
    const comparison = observed ? input.compareDebianVersions(observed.version, witness.minimumVersion) : Number.NaN;
    if (!observed || observed.packageName !== witness.packageName || observed.architecture !== witness.architecture
      || observed.status !== 'installed' || observed.errorFlag !== 'ok' || observed.want !== 'install'
      || !Number.isFinite(comparison) || comparison < 0) {
      throw new OfflineBundleError(`installed package witness is not satisfied: ${witness.packageName}`);
    }
  }
}
export function validateNativePackageWitnessClosure(input: {
  rootPackageKey: string; descriptors: readonly NativeOfflinePayloadDescriptor[];
  installedWitnesses: readonly NativePackageInstalledWitness[]; compareDebianVersions: DebianVersionComparator;
}) {
  const descriptors = input.descriptors.map(candidate => {
    if (candidate.packageKey !== input.rootPackageKey || input.installedWitnesses.length === 0) return candidate;
    const relationships = parseDebianRelationships(candidate.metadataProof.packageStanza.depends);
    if (candidate.metadataProof.packageStanza.preDepends !== null
      || candidate.dependencyClosure.depends.length !== 0 || candidate.dependencyClosure.preDepends.length !== 0
      || relationships.length !== input.installedWitnesses.length || relationships.some((relationship, index) => {
        const witness = input.installedWitnesses[index];
        return !witness || relationship.packageName !== witness.packageName || relationship.architectureQualifier !== null
          || relationship.operator !== '>=' || relationship.version !== witness.minimumVersion;
      })) throw new OfflineBundleError(`installed witness relationships do not exactly match signed package authority: ${input.rootPackageKey}`);
    const admitted = structuredClone(candidate); admitted.metadataProof.packageStanza.depends = null; return admitted;
  });
  return validateDebianDependencyClosure({ rootPackageKey: input.rootPackageKey, descriptors, compareVersions: input.compareDebianVersions });
}
export const NativePackageOperationSchema = z.strictObject({
  kind: z.literal('native-package'),
  effectClass: z.literal('native-package'),
  action: z.enum(['check', 'apply', 'verify']),
  packageKey,
  payloadArtifactId: identifier,
  installedWitnesses: z.array(NativePackageInstalledWitnessSchema).max(16).optional(),
});
const nativeServiceOperation = z.strictObject({
  kind: z.literal('native-service'),
  effectClass: z.literal('native-service'),
  action: z.enum(['check', 'apply', 'verify']),
  manager: z.literal('systemd'),
  unit: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/),
  desiredState: z.enum(['enabled', 'disabled', 'started', 'stopped']),
});
const operation = z.discriminatedUnion('kind', [processOperation, managedFileOperation, NativePackageOperationSchema, nativeServiceOperation]);
const configurationRoot = z.string().min(1).max(4096).refine(
  value => isAbsolute(value) && normalize(value) === value && dirname(value) !== value && !value.includes('\0'),
  'configuration root must be a canonical absolute non-root path',
);

function isStrictDescendant(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation.length > 0 && !isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

export const OfflineOperationManifestSchema = z.strictObject({
  schemaVersion: z.literal(4),
  configurationRoots: z.array(configurationRoot).max(128),
  operations: z.record(identifier, operation).refine(value => Object.keys(value).length <= 30_000, 'too many offline operations'),
}).superRefine((value, context) => {
  if (!exactSorted(value.configurationRoots)) {
    context.addIssue({ code: 'custom', path: ['configurationRoots'], message: 'configuration roots must be unique and sorted' });
  }
  for (let index = 0; index < value.configurationRoots.length; index += 1) {
    const root = value.configurationRoots[index]!;
    if (value.configurationRoots.some((candidate, candidateIndex) => candidateIndex !== index && isStrictDescendant(candidate, root))) {
      context.addIssue({ code: 'custom', path: ['configurationRoots', index], message: 'configuration roots must not overlap' });
    }
  }
  for (const [operationId, registered] of Object.entries(value.operations)) {
    if (registered.kind !== 'managed-file') continue;
    if (!value.configurationRoots.some(root => isStrictDescendant(root, registered.targetPath))) {
      context.addIssue({
        code: 'custom', path: ['operations', operationId, 'targetPath'],
        message: 'managed-file target must be a strict descendant of an allowed configuration root',
      });
    }
  }
});
export type OfflineOperationManifest = z.infer<typeof OfflineOperationManifestSchema>;
export type OfflineOperation = OfflineOperationManifest['operations'][string];
export type NativePackageOperation = Extract<OfflineOperation, { kind: 'native-package' }>;

export interface NativePackageRuntimeAuthority {
  readonly operation: NativePackageOperation;
  readonly rootDescriptor: NativeOfflinePayloadDescriptor;
  readonly packages: readonly Readonly<{
    descriptor: NativeOfflinePayloadDescriptor;
    metadata: VerifiedDebianMetadata;
    control: ParsedDebianControlArchive;
  }>[];
  readonly installedWitnesses: readonly NativePackageInstalledWitness[];
  /** Opens a fresh verified, already-unlinked borrowed descriptor for one package in the signed closure. */
  readonly withPayload: <T>(packageKey: string, use: (payload: FileHandle) => Promise<T>) => Promise<T>;
  readonly context: TaskExecutionContext | undefined;
}

/**
 * Deliberately injected privileged boundary. Offline bundle verification does
 * not itself grant dpkg mutation authority, and there is no permissive default.
 */
export interface NativePackageRuntime {
  check(authority: NativePackageRuntimeAuthority): Promise<Inspection>;
  apply(authority: NativePackageRuntimeAuthority): Promise<void>;
  verify(authority: NativePackageRuntimeAuthority): Promise<Verification>;
}

export type NativePackageRuntimeFactory = (
  authority: NonNullable<TaskExecutionContext['nativeDpkgTransaction']>,
) => NativePackageRuntime;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

export function canonicalOfflineOperationManifestBytes(value: unknown): Buffer {
  return canonicalBytes(OfflineOperationManifestSchema.parse(value));
}

export function canonicalNormalizedPlanBytes(value: unknown): Buffer {
  return canonicalBytes(NormalizedPlanSchema.parse(value));
}

export function canonicalOfflineDesiredStateBytes(value: unknown): Buffer {
  return canonicalBytes(DesiredStateInputSchema.parse(value));
}

export function canonicalOfflineHostFactsBytes(value: unknown): Buffer {
  return canonicalBytes(HostFactsSchema.parse(value));
}

export function offlineExecutionGraphDigest(
  planInput: unknown,
  operationsInput: unknown,
  desiredStateInput: unknown,
  hostFactsInput: unknown,
): string {
  const plan = NormalizedPlanSchema.parse(planInput);
  const operations = OfflineOperationManifestSchema.parse(operationsInput);
  const desiredState = DesiredStateInputSchema.parse(desiredStateInput);
  const hostFacts = HostFactsSchema.parse(hostFactsInput);
  return createHash('sha256').update(canonicalBytes({
    schemaVersion: 1,
    normalizedPlan: plan,
    operationManifest: operations,
    desiredState,
    hostFacts,
  })).digest('hex');
}

function exactSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

function dependencyClosure(plan: NormalizedPlan): string[] {
  const tasks = new Map(plan.tasks.map(task => [task.id, task]));
  const selected = new Set<string>();
  const visiting = new Set<string>();
  const visit = (taskId: string): void => {
    if (selected.has(taskId)) return;
    if (visiting.has(taskId)) throw new OfflineBundleError(`offline plan dependency cycle includes: ${taskId}`);
    const task = tasks.get(taskId);
    if (!task) throw new OfflineBundleError(`offline plan dependency is missing: ${taskId}`);
    visiting.add(taskId);
    for (const dependency of task.dependencies) visit(dependency);
    visiting.delete(taskId);
    selected.add(taskId);
  };
  for (const taskId of plan.selectedTaskIds) visit(taskId);
  return [...selected].sort((left, right) => left.localeCompare(right));
}

function decodeCanonical<T>(bytes: Buffer, schema: z.ZodType<T>, label: string): T {
  let decoded: unknown;
  try { decoded = JSON.parse(bytes.toString('utf8')); }
  catch { throw new OfflineBundleError(`${label} is not valid JSON`); }
  const value = schema.parse(decoded);
  if (!bytes.equals(canonicalBytes(value))) throw new OfflineBundleError(`${label} is not canonical JSON`);
  return value;
}

export type OfflineExecutionClosure = {
  plan: NormalizedPlan;
  operations: OfflineOperationManifest;
  desiredState: DesiredStateInput;
  hostFacts: HostFacts;
  graphDigest: string;
  selectedTaskIds: string[];
  runtimeArtifactIds: string[];
  runtimeArtifacts: Record<string, { sha256: string; sizeBytes: number; mode: '0600' | '0700' }>;
  nativePackageDescriptors: Record<string, NativeOfflinePayloadDescriptor>;
};

export async function validateOfflineExecutionClosure(
  verified: VerifiedOfflineBundle,
): Promise<OfflineExecutionClosure> {
  for (const metadataId of ['normalized-plan', 'operation-manifest', 'desired-state', 'host-facts']) {
    const metadataArtifact = verified.manifest.artifacts.find(item => item.id === metadataId);
    if (!metadataArtifact || metadataArtifact.mode !== '0600' || metadataArtifact.mediaType !== 'application/json') {
      throw new OfflineBundleError(`offline execution metadata is missing or has unsafe metadata: ${metadataId}`);
    }
  }
  const plan = decodeCanonical(
    await readVerifiedOfflineArtifact(verified, 'normalized-plan'), NormalizedPlanSchema, 'normalized plan',
  );
  const operations = decodeCanonical(
    await readVerifiedOfflineArtifact(verified, 'operation-manifest'), OfflineOperationManifestSchema, 'operation manifest',
  );
  const desiredState = decodeCanonical(
    await readVerifiedOfflineArtifact(verified, 'desired-state'), DesiredStateInputSchema, 'desired state',
  );
  const hostFacts = decodeCanonical(
    await readVerifiedOfflineArtifact(verified, 'host-facts'), HostFactsSchema, 'host facts',
  );
  if (!desiredState.offline) throw new OfflineBundleError('offline desired state must explicitly deny online operation');
  if (desiredState.hostId !== hostFacts.hostId) throw new OfflineBundleError('offline desired state and host facts identify different hosts');
  if (plan.planId !== `plan-${plan.digest.slice(0, 24)}`) throw new OfflineBundleError('normalized plan identity is not canonical');
  if (!exactSorted(plan.tasks.map(task => task.id))
    || plan.tasks.some(task => !exactSorted(task.dependencies) || !exactSorted(task.lockDomains))
    || !exactSorted(plan.selectedTaskIds)) {
    throw new OfflineBundleError('normalized plan graph ordering is not canonical');
  }
  if (plan.releaseId !== verified.manifest.releaseId) throw new OfflineBundleError('normalized plan release does not match the bundle');
  if (plan.digest !== verified.manifest.planDigest) throw new OfflineBundleError('normalized plan digest does not match the bundle');
  if (JSON.stringify(plan.selectedTaskIds) !== JSON.stringify(verified.manifest.selectedTaskIds)) {
    throw new OfflineBundleError('normalized plan selection does not match the bundle');
  }
  const closure = dependencyClosure(plan);
  if (JSON.stringify(closure) !== JSON.stringify(plan.selectedTaskIds)) {
    throw new OfflineBundleError('normalized plan does not contain its exact dependency closure');
  }
  const selectedTasks = new Map(plan.tasks.filter(task => plan.selectedTaskIds.includes(task.id)).map(task => [task.id, task]));
  for (const task of selectedTasks.values()) {
    if (task.lockDomains.includes('service-manager.systemd')) {
      throw new OfflineBundleError(`offline selected task requires unsupported service-state authority: ${task.id}; native service execution remains fail-closed`);
    }
    const unsupportedDomain = task.lockDomains.find(domain => (domain === 'package-manager'
      || domain.startsWith('package-manager.')) && domain !== 'package-manager.dpkg'
      || (domain === 'service-manager' || domain.startsWith('service-manager.')) && domain !== 'service-manager.systemd');
    if (unsupportedDomain) {
      throw new OfflineBundleError(
        `offline selected task requires unsupported ${unsupportedDomain.startsWith('package-manager') ? 'package-manager' : 'service-state'} authority: ${task.id}; create an online plan or provide a future signed native closure`,
      );
    }
    if (task.network !== 'none' || task.resources.network) {
      throw new OfflineBundleError(`offline task is not network-free: ${task.id}`);
    }
  }
  const reproduced = await reproduceNormalizedPlan(
    { tasks: plan.tasks, selectedTaskIds: plan.selectedTaskIds, executionPolicy: plan.executionPolicy },
    hostFacts, desiredState, plan.releaseId, plan.createdAt,
  );
  if (!canonicalNormalizedPlanBytes(reproduced).equals(canonicalNormalizedPlanBytes(plan))) {
    throw new OfflineBundleError('signed semantic inputs do not reproduce the approved normalized plan');
  }
  const operationReferences = [...selectedTasks.values()].flatMap(task => Object.values(task.operations));
  const referencedOperationIds = [...new Set(operationReferences)].sort((left, right) => left.localeCompare(right));
  if (referencedOperationIds.length !== operationReferences.length) {
    throw new OfflineBundleError('offline operation identifiers must be unique across the selected task closure');
  }
  const registeredOperationIds = Object.keys(operations.operations).sort((left, right) => left.localeCompare(right));
  for (const operationId of referencedOperationIds) {
    if (!operations.operations[operationId]) throw new OfflineBundleError(`offline operation is missing: ${operationId}`);
  }
  if (JSON.stringify(referencedOperationIds) !== JSON.stringify(registeredOperationIds)) {
    throw new OfflineBundleError('operation manifest contains operations outside the selected task closure');
  }
  const artifactById = new Map(verified.manifest.artifacts.map(item => [item.id, item]));
  const runtimeArtifactIds = new Set<string>();
  const nativePackageDescriptors = new Map<string, NativeOfflinePayloadDescriptor>();
  const nativeArtifactOwners = new Map<string, string>();
  for (const task of selectedTasks.values()) {
    const taskOperations = Object.entries(task.operations) as Array<['check' | 'apply' | 'verify', string]>;
    const registered = taskOperations.map(([action, operationId]) => ({ action, operationId, operation: operations.operations[operationId]! }));
    const managed = registered.filter(item => item.operation.kind === 'managed-file');
    const nativePackages = registered.filter(item => item.operation.kind === 'native-package');
    const nativeServices = registered.filter(item => item.operation.kind === 'native-service');
    if (task.lockDomains.includes('package-manager.dpkg') && nativePackages.length === 0) {
      throw new OfflineBundleError(`offline selected task requires unsupported package-manager authority: ${task.id}; provide an exact signed native package closure`);
    }
    if (task.lockDomains.includes('service-manager.systemd') && nativeServices.length === 0) {
      throw new OfflineBundleError(`offline selected task requires unsupported service-state authority: ${task.id}; provide a future signed native service closure`);
    }
    if (nativeServices.length > 0) {
      throw new OfflineBundleError(`offline native service execution remains unsupported until honest service compensation exists: ${task.id}`);
    }
    if (nativePackages.length !== 0) {
      if (nativePackages.length !== 3 || registered.length !== 3) throw new OfflineBundleError(`offline native package task requires an exact check/apply/verify triple: ${task.id}`);
      if (task.lockDomains.length !== 1 || task.lockDomains[0] !== 'package-manager.dpkg'
        || task.privilege !== 'admin' || task.consent !== 'package-install'
        || !desiredState.consents.includes('package-install') || task.compensation !== 'none') {
        throw new OfflineBundleError(`offline native package task lacks exact dpkg privilege, consent, lock, or compensation authority: ${task.id}`);
      }
      const authority = nativePackages[0]!.operation;
      if (authority.kind !== 'native-package') throw new OfflineBundleError(`offline native package authority is invalid: ${task.id}`);
      if (!desiredState.packages.includes(authority.packageKey)) throw new OfflineBundleError(`offline native package is not selected in desired state: ${authority.packageKey}`);
      for (const item of nativePackages) {
        const candidate = item.operation;
        if (candidate.kind !== 'native-package' || candidate.action !== item.action
          || candidate.packageKey !== authority.packageKey || candidate.payloadArtifactId !== authority.payloadArtifactId
          || JSON.stringify(candidate.installedWitnesses ?? []) !== JSON.stringify(authority.installedWitnesses ?? [])) {
          throw new OfflineBundleError(`offline native package operations disagree on their authority: ${task.id}`);
        }
      }
    } else if (task.privilege !== 'user' || task.consent !== 'none') {
      throw new OfflineBundleError(`offline task exceeds minimal execution authority: ${task.id}`);
    }
    if (managed.length !== 0 && managed.length !== 3) {
      throw new OfflineBundleError(`offline task cannot mix process and managed-file operations: ${task.id}`);
    }
    if (managed.length === 3) {
      if (task.compensation !== 'configuration') {
        throw new OfflineBundleError(`offline managed-file task requires configuration compensation: ${task.id}`);
      }
      const authority = managed[0]!.operation;
      if (authority.kind !== 'managed-file') throw new OfflineBundleError(`offline managed-file authority is invalid: ${task.id}`);
      for (const item of managed) {
        const candidate = item.operation;
        if (candidate.kind !== 'managed-file' || candidate.action !== item.action) {
          throw new OfflineBundleError(`offline managed-file action does not match task operation: ${item.operationId}`);
        }
        if (candidate.candidateArtifactId !== authority.candidateArtifactId
          || candidate.targetPath !== authority.targetPath
          || candidate.candidateMode !== authority.candidateMode) {
          throw new OfflineBundleError(`offline managed-file operations disagree on their authority: ${task.id}`);
        }
      }
    }
  }
  for (const registered of Object.values(operations.operations)) {
    if (registered.kind === 'managed-file') {
      runtimeArtifactIds.add(registered.candidateArtifactId);
      const candidate = artifactById.get(registered.candidateArtifactId);
      if (!candidate || candidate.mode !== '0600') {
        throw new OfflineBundleError(`offline managed-file candidate artifact is missing or not private: ${registered.candidateArtifactId}`);
      }
      continue;
    }
    if (registered.kind === 'native-service') {
      throw new OfflineBundleError('offline native service execution remains unsupported');
    }
    if (registered.kind === 'native-package') {
      const pending = [{ packageKey: registered.packageKey, artifactId: registered.payloadArtifactId }];
      const admitted = new Set<string>();
      while (pending.length > 0) {
        const expected = pending.shift()!;
        const identity = `${expected.packageKey}/${expected.artifactId}`;
        if (admitted.has(identity)) continue;
        admitted.add(identity);
        runtimeArtifactIds.add(expected.artifactId);
        const payload = artifactById.get(expected.artifactId);
        if (!payload || payload.mode !== '0600' || !payload.catalogDescriptor
          || payload.catalogDescriptor.kind !== 'native-offline-package'
          || payload.catalogDescriptor.packageKey !== expected.packageKey
          || payload.catalogDescriptor.artifact.id !== expected.artifactId) {
          throw new OfflineBundleError(`offline native package lacks exact signed payload authority: ${expected.packageKey}`);
        }
        const descriptor = payload.catalogDescriptor;
        const existingDescriptor = nativePackageDescriptors.get(expected.packageKey);
        if (existingDescriptor && existingDescriptor.artifact.id !== descriptor.artifact.id) {
          throw new OfflineBundleError(`offline native package has conflicting payload authority: ${expected.packageKey}`);
        }
        const existingOwner = nativeArtifactOwners.get(descriptor.artifact.id);
        if (existingOwner && existingOwner !== expected.packageKey) {
          throw new OfflineBundleError(`offline native payload artifact is shared by multiple package identities: ${descriptor.artifact.id}`);
        }
        nativePackageDescriptors.set(expected.packageKey, descriptor);
        nativeArtifactOwners.set(descriptor.artifact.id, expected.packageKey);
        if (descriptor.platform.os !== 'linux' || descriptor.platform.arch !== hostFacts.arch
          || descriptor.distro.versionId !== hostFacts.osVersion) {
          throw new OfflineBundleError(`offline native package platform or distro authority does not match the host: ${expected.packageKey}`);
        }
        runtimeArtifactIds.add(descriptor.metadataProof.inRelease.artifactId);
        runtimeArtifactIds.add(descriptor.metadataProof.inRelease.keyring.artifactId);
        runtimeArtifactIds.add(descriptor.metadataProof.packagesIndex.artifactId);
        pending.push(...descriptor.dependencyClosure.preDepends, ...descriptor.dependencyClosure.depends);
      }
      continue;
    }
    runtimeArtifactIds.add(registered.executableArtifactId);
    const executable = artifactById.get(registered.executableArtifactId);
    if (!executable || executable.mode !== '0700') {
      throw new OfflineBundleError(`offline executable artifact is missing or not executable: ${registered.executableArtifactId}`);
    }
    if (!executable.catalogDescriptor) {
      throw new OfflineBundleError(`offline executable lacks signed catalog authority: ${registered.executableArtifactId}`);
    }
    for (const argument of registered.arguments) {
      if (argument.kind === 'artifact') runtimeArtifactIds.add(argument.artifactId);
    }
  }
  for (const artifactId of runtimeArtifactIds) {
    if (!artifactById.has(artifactId)) throw new OfflineBundleError(`offline operation artifact is missing: ${artifactId}`);
  }
  const permittedArtifacts = new Set([
    'normalized-plan', 'operation-manifest', 'desired-state', 'host-facts',
    'engine', 'catalog', 'release-envelope', 'release-signature',
    ...runtimeArtifactIds,
  ]);
  const unreferenced = verified.manifest.artifacts.map(item => item.id).filter(artifactId => !permittedArtifacts.has(artifactId));
  if (unreferenced.length > 0) throw new OfflineBundleError(`offline bundle has an unreferenced artifact: ${unreferenced.join(', ')}`);
  const graphDigest = offlineExecutionGraphDigest(plan, operations, desiredState, hostFacts);
  if (graphDigest !== verified.manifest.graphDigest) throw new OfflineBundleError('offline execution graph digest does not match the bundle');
  return {
    plan, operations, desiredState, hostFacts, graphDigest,
    selectedTaskIds: [...plan.selectedTaskIds], runtimeArtifactIds: [...runtimeArtifactIds].sort((left, right) => left.localeCompare(right)),
    runtimeArtifacts: Object.fromEntries([...runtimeArtifactIds].sort((left, right) => left.localeCompare(right)).map(artifactId => {
      const item = artifactById.get(artifactId)!;
      return [artifactId, { sha256: item.sha256, sizeBytes: item.sizeBytes, mode: item.mode }];
    })),
    nativePackageDescriptors: Object.fromEntries([...nativePackageDescriptors].sort(([left], [right]) => left.localeCompare(right))),
  };
}

/**
 * Independently proves every native Debian payload against its actual bundled
 * repository bytes. Schema admission and Install Doctor's bundle signature are
 * deliberately insufficient for this step: only this verified result may be
 * handed to a future privileged native runtime.
 */
export async function verifyOfflineNativeDebianMetadata(
  verified: VerifiedOfflineBundle,
  closure: OfflineExecutionClosure,
  verifier: DebianMetadataVerifier | ((input: {
    readonly descriptor: NativeOfflinePayloadDescriptor;
    readonly keyringBytes: Buffer;
  }) => Promise<DebianMetadataVerifier>),
): Promise<Readonly<Record<string, VerifiedDebianMetadata>>> {
  for (const [packageKey, descriptor] of Object.entries(closure.nativePackageDescriptors)) {
    const artifact = verified.manifest.artifacts.find(candidate => candidate.id === descriptor.artifact.id);
    if (!artifact?.catalogDescriptor || artifact.catalogDescriptor.kind !== 'native-offline-package'
      || artifact.catalogDescriptor.packageKey !== packageKey
      || JSON.stringify(artifact.catalogDescriptor) !== JSON.stringify(descriptor)) {
      throw new OfflineBundleError(`offline native package metadata authority is missing: ${packageKey}`);
    }
  }
  const bundleArtifacts = new Map(verified.manifest.artifacts.map(item => [item.id, item]));
  const resolver: VerifiedArtifactResolver = async artifactId => {
    const item = bundleArtifacts.get(artifactId);
    if (!item) throw new OfflineBundleError(`verified bundle artifact is missing: ${artifactId}`);
    return { sourcePath: join(verified.bundleDirectory, item.path), authority: {
      sha256: item.sha256, sizeBytes: item.sizeBytes, mode: item.mode,
    } };
  };
  return verifyNativeDebianMetadataWithResolver({ closure, resolver, verifier });
}

/** Transport-neutral native metadata/runtime admission. Online release objects
 * and verified offline bundles must both resolve the exact descriptor closure. */
export async function verifyNativeDebianMetadataWithResolver(input: {
  closure: OfflineExecutionClosure;
  resolver: VerifiedArtifactResolver;
  verifier: DebianMetadataVerifier | ((input: {
    readonly descriptor: NativeOfflinePayloadDescriptor;
    readonly keyringBytes: Buffer;
  }) => Promise<DebianMetadataVerifier>);
}): Promise<Readonly<Record<string, VerifiedDebianMetadata>>> {
  const { closure, resolver, verifier } = input;
  const payloads = new Map<string, string>();
  const pending: Array<{ packageKey: string; artifactId: string }> = [];
  for (const operation of Object.values(closure.operations.operations)) {
    if (operation.kind !== 'native-package') continue;
    pending.push({ packageKey: operation.packageKey, artifactId: operation.payloadArtifactId });
  }
  while (pending.length > 0) {
    const expected = pending.shift()!;
    const previous = payloads.get(expected.packageKey);
    if (previous !== undefined) {
      if (previous !== expected.artifactId) {
        throw new OfflineBundleError(`offline native package operations disagree on payload authority: ${expected.packageKey}`);
      }
      continue;
    }
    const descriptor = closure.nativePackageDescriptors[expected.packageKey];
    if (!descriptor || descriptor.artifact.id !== expected.artifactId) {
      throw new OfflineBundleError(`offline native package descriptor closure is incomplete: ${expected.packageKey}`);
    }
    payloads.set(expected.packageKey, expected.artifactId);
    pending.push(...descriptor.dependencyClosure.preDepends, ...descriptor.dependencyClosure.depends);
  }
  const results: Record<string, VerifiedDebianMetadata> = {};
  for (const [packageKey, artifactId] of [...payloads].sort(([left], [right]) => left.localeCompare(right))) {
    const descriptor = closure.nativePackageDescriptors[packageKey];
    if (!descriptor || descriptor.artifact.id !== artifactId) throw new OfflineBundleError(`native package descriptor closure is incomplete: ${packageKey}`);
    const read = async (id: string, authority: { sha256: string; sizeBytes: number }): Promise<Buffer> => {
      const handle = await materializeVerifiedArtifactHandle(resolver, id, {
        sha256: authority.sha256, sizeBytes: authority.sizeBytes, mode: '0600',
      });
      try { return Buffer.from(await handle.readFile()); } finally { await handle.close(); }
    };
    const keyringBytes = await read(descriptor.metadataProof.inRelease.keyring.artifactId, descriptor.metadataProof.inRelease.keyring);
    const packageVerifier = typeof verifier === 'function'
      ? await verifier({ descriptor, keyringBytes: Buffer.from(keyringBytes) })
      : verifier;
    results[packageKey] = await verifyDebianRepositoryMetadata({
      descriptor,
      inReleaseBytes: await read(descriptor.metadataProof.inRelease.artifactId, descriptor.metadataProof.inRelease),
      keyringBytes,
      packagesIndexBytes: await read(descriptor.metadataProof.packagesIndex.artifactId, descriptor.metadataProof.packagesIndex),
      payloadBytes: await read(descriptor.artifact.id, descriptor.artifact),
      verifier: packageVerifier,
    });
  }
  return Object.freeze(results);
}

/** Shared online/offline materialization boundary: returns an unlinked, private,
 * content-verified snapshot handle rather than the mutable source inode. */
async function materializeVerifiedArtifactHandle(
  resolveArtifact: VerifiedArtifactResolver,
  artifactId: string,
  expected: { sha256: string; sizeBytes: number; mode: '0600' | '0700' },
): Promise<FileHandle> {
  try {
    const candidate = await resolveArtifact(artifactId);
    if (candidate.authority.sha256 !== expected.sha256 || candidate.authority.sizeBytes !== expected.sizeBytes
      || candidate.authority.mode !== expected.mode) {
      throw new OfflineBundleError(`artifact resolver authority differs from the approved closure: ${artifactId}`);
    }
    return await openVerifiedArtifactSnapshot({ sourcePath: candidate.sourcePath, artifactId, authority: expected });
  } catch (error) {
    if (error instanceof OfflineBundleError) throw error;
    if (error instanceof VerifiedArtifactMaterializationError) throw new OfflineBundleError(error.message);
    const reason = error instanceof Error && !error.message.includes('/') ? `: ${error.message}` : '';
    throw new OfflineBundleError(`materialized artifact could not be opened safely: ${artifactId}${reason}`);
  }
}

export async function createOfflineInstallerAdapter(input: {
  closure: OfflineExecutionClosure;
  materializedRoot: string;
  sandbox?: OfflineSandboxRuntime;
  attestedHostFacts?: HostFacts;
  /** Test-only direct runtime seam. Production orchestration uses the owner-bound factory. */
  nativePackageRuntime?: NativePackageRuntime;
  nativePackageRuntimeFactory?: NativePackageRuntimeFactory;
  verifiedNativeMetadata?: Readonly<Record<string, VerifiedDebianMetadata>>;
  compareDebianVersions?: DebianVersionComparator;
  inspectNativePackage?: (input: NativeDebInspectionInput) => Promise<ParsedDebianControlArchive>;
  observeInstalledWitness?: (packageName: string, signal?: AbortSignal) => Promise<import('./native-dpkg-state.js').DpkgPackageState | null>;
  /** Transport seam. Online release cache and offline bundle resolution both enter here. */
  artifactResolver?: VerifiedArtifactResolver;
}): Promise<InstallerAdapter> {
  if (!isAbsolute(input.materializedRoot)) throw new OfflineBundleError('materialized root must be absolute');
  const materializedRoot = await realpath(input.materializedRoot);
  const rootMetadata = await lstat(materializedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new OfflineBundleError('materialized root must be a real directory');
  const effectiveUserId = process.geteuid?.();
  if (effectiveUserId === undefined || rootMetadata.uid !== effectiveUserId || (rootMetadata.mode & 0o077) !== 0) {
    throw new OfflineBundleError('materialized root must be private and owned by the current user');
  }
  const artifactResolver = input.artifactResolver ?? await createMaterializedArtifactResolver({
    materializedRoot, artifacts: input.closure.runtimeArtifacts,
  });
  const configurationRoots = new Map<string, { device: number; inode: number }>();
  for (const root of input.closure.operations.configurationRoots) {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    let canonicalRoot: string;
    try {
      metadata = await lstat(root);
      canonicalRoot = await realpath(root);
    } catch {
      throw new OfflineBundleError(`offline configuration root must be an existing canonical real directory: ${root}`);
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || resolve(canonicalRoot) !== resolve(root)) {
      throw new OfflineBundleError(`offline configuration root must be a canonical real directory and not a symbolic link: ${root}`);
    }
    configurationRoots.set(root, { device: metadata.dev, inode: metadata.ino });
  }
  const assertManagedTargetAuthority = async (targetPath: string): Promise<void> => {
    const root = [...configurationRoots.keys()].find(candidate => isStrictDescendant(candidate, targetPath));
    if (!root) throw new OfflineBundleError('offline managed-file target escapes its signed configuration roots');
    const expectedRoot = configurationRoots.get(root)!;
    let currentRoot: Awaited<ReturnType<typeof lstat>>;
    let canonicalRoot: string;
    const parent = dirname(targetPath);
    let parentMetadata: Awaited<ReturnType<typeof lstat>>;
    let canonicalParent: string;
    try {
      [currentRoot, canonicalRoot, parentMetadata, canonicalParent] = await Promise.all([
        lstat(root), realpath(root), lstat(parent), realpath(parent),
      ]);
    } catch {
      throw new OfflineBundleError('offline managed-file target parent and signed configuration root must exist');
    }
    if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink()
      || currentRoot.dev !== expectedRoot.device || currentRoot.ino !== expectedRoot.inode
      || resolve(canonicalRoot) !== resolve(root)) {
      throw new OfflineBundleError('offline configuration root changed or became a symbolic link');
    }
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()
      || resolve(canonicalParent) !== resolve(parent)
      || !isStrictDescendant(root, targetPath)
      || (parent !== root && !isStrictDescendant(root, parent))) {
      throw new OfflineBundleError('offline managed-file target parent traverses a symbolic link or escapes its signed configuration root');
    }
  };
  const sandbox = input.sandbox ?? createOfflineSandboxRuntime();
  const registeredOperation = (operationId: string): OfflineOperation => {
    const registered = input.closure.operations.operations[operationId];
    if (!registered) throw new OfflineBundleError(`offline operation is not registered: ${operationId}`);
    return registered;
  };
  const hasNativePackageOperations = Object.values(input.closure.operations.operations)
    .some(candidate => candidate.kind === 'native-package');
  if (input.nativePackageRuntime && input.nativePackageRuntimeFactory) {
    throw new OfflineBundleError('offline native package execution cannot combine direct and owner-bound runtimes');
  }
  if (hasNativePackageOperations && ((!input.nativePackageRuntime && !input.nativePackageRuntimeFactory)
    || !input.verifiedNativeMetadata || !input.compareDebianVersions)) {
    throw new OfflineBundleError('offline native package execution requires an explicit privileged runtime, Debian version comparator, and independently verified metadata');
  }
  const invokeNativePackage = async <T>(
    operationId: string,
    context: TaskExecutionContext | undefined,
    invoke: (runtime: NativePackageRuntime, authority: NativePackageRuntimeAuthority) => Promise<T>,
  ): Promise<T> => {
    const operation = registeredOperation(operationId);
    if (operation.kind !== 'native-package') {
      throw new OfflineBundleError(`offline operation is not a native package operation: ${operationId}`);
    }
    const runtime = input.nativePackageRuntime ?? (() => {
      if (!context?.nativeDpkgTransaction || !input.nativePackageRuntimeFactory) {
        throw new OfflineBundleError('offline native package mutation requires an owner-bound journal claim');
      }
      return input.nativePackageRuntimeFactory(context.nativeDpkgTransaction);
    })();
    const rootDescriptor = input.closure.nativePackageDescriptors[operation.packageKey];
    const rootMetadata = input.verifiedNativeMetadata?.[operation.packageKey];
    if (!runtime || !rootDescriptor || !rootMetadata
      || rootDescriptor.artifact.id !== operation.payloadArtifactId
      || rootMetadata.packageName !== rootDescriptor.package.name
      || rootMetadata.payloadSha256 !== rootDescriptor.artifact.sha256) {
      throw new OfflineBundleError(`offline native package lacks matching verified runtime authority: ${operation.packageKey}`);
    }
    const validatedClosure = validateNativePackageWitnessClosure({ rootPackageKey: operation.packageKey,
      descriptors: Object.values(input.closure.nativePackageDescriptors), installedWitnesses: operation.installedWitnesses ?? [],
      compareDebianVersions: input.compareDebianVersions! });
    const inspectPackage = input.inspectNativePackage ?? inspectNativeDebianPackage;
    const packages = [] as Array<{
      descriptor: NativeOfflinePayloadDescriptor;
      metadata: VerifiedDebianMetadata;
      control: ParsedDebianControlArchive;
    }>;
    for (const descriptor of validatedClosure.installationOrder) {
        const closurePackageKey = descriptor.packageKey;
        const metadata = input.verifiedNativeMetadata?.[closurePackageKey];
        if (!metadata || metadata.packageName !== descriptor.package.name
          || metadata.packageVersion !== descriptor.package.version
          || metadata.packageArchitecture !== descriptor.package.architecture
          || metadata.payloadSha256 !== descriptor.artifact.sha256) {
          throw new OfflineBundleError(`offline native package closure lacks matching verified metadata: ${closurePackageKey}`);
        }
        const expected = input.closure.runtimeArtifacts[descriptor.artifact.id];
        if (!expected || expected.mode !== '0600' || expected.sha256 !== descriptor.artifact.sha256
          || expected.sizeBytes !== descriptor.artifact.sizeBytes) {
          throw new OfflineBundleError(`offline native package payload is not authorized: ${descriptor.artifact.id}`);
        }
        const payload = await materializeVerifiedArtifactHandle(artifactResolver, descriptor.artifact.id, expected);
        try {
          const control = await inspectPackage({
            descriptor, payloadHandle: payload,
            ...(context ? { signal: context.signal } : {}),
          });
          packages.push(Object.freeze({ descriptor, metadata, control }));
        } finally { await payload.close(); }
    }
    const allowedPackageKeys = new Set(packages.map(item => item.descriptor.packageKey));
    const withPayload = async <R>(packageKeyInput: string, use: (payload: FileHandle) => Promise<R>): Promise<R> => {
      if (!allowedPackageKeys.has(packageKeyInput)) {
        throw new OfflineBundleError(`offline native payload is outside the verified package closure: ${packageKeyInput}`);
      }
      const descriptor = input.closure.nativePackageDescriptors[packageKeyInput]!;
      const expected = input.closure.runtimeArtifacts[descriptor.artifact.id];
      if (!expected || expected.mode !== '0600' || expected.sha256 !== descriptor.artifact.sha256
        || expected.sizeBytes !== descriptor.artifact.sizeBytes) {
        throw new OfflineBundleError(`offline native package payload is not authorized: ${descriptor.artifact.id}`);
      }
      const payload = await materializeVerifiedArtifactHandle(artifactResolver, descriptor.artifact.id, expected);
      try { return await use(payload); }
      finally { await payload.close(); }
    };
    if (packages.length === 0) {
      throw new OfflineBundleError(`offline native package closure is empty: ${operation.packageKey}`);
    }
    const installedWitnesses = operation.installedWitnesses ?? [];
    const observeWitness = input.observeInstalledWitness ?? (async (packageName: string, signal?: AbortSignal) => {
      const { createNativeDpkgQueryRunner, parseDpkgQueryState } = await import('./native-dpkg-state.js');
      const result = await createNativeDpkgQueryRunner().query(packageName, signal);
      if (result.code === 1 && result.stdout.length === 0) return null;
      if (result.code !== 0) throw new OfflineBundleError(`installed witness query failed with exit ${result.code}`);
      return parseDpkgQueryState(result.stdout);
    });
    await assertNativePackageInstalledWitnesses({ witnesses: installedWitnesses, observe: observeWitness,
      compareDebianVersions: input.compareDebianVersions!, ...(context ? { signal: context.signal } : {}) });
    return invoke(runtime, Object.freeze({
      operation, rootDescriptor, packages: Object.freeze(packages), withPayload, context,
      installedWitnesses: Object.freeze([...installedWitnesses]),
    }));
  };
  const selectedTaskIds = new Set(input.closure.plan.selectedTaskIds);
  const taskForOperation = (operationId: string) => {
    const task = input.closure.plan.tasks.find(candidate => selectedTaskIds.has(candidate.id)
      && Object.values(candidate.operations).includes(operationId));
    if (!task) throw new OfflineBundleError(`offline operation is not selected by the approved plan: ${operationId}`);
    return task;
  };
  const invokeProcess = async (operationId: string, context?: TaskExecutionContext): Promise<number> => {
    const registered = registeredOperation(operationId);
    if (registered.kind !== 'process') throw new OfflineBundleError(`offline operation is not a process operation: ${operationId}`);
    const executableExpected = input.closure.runtimeArtifacts[registered.executableArtifactId];
    if (!executableExpected || executableExpected.mode !== '0700') throw new OfflineBundleError(`offline executable is not authorized: ${registered.executableArtifactId}`);
    const handles: FileHandle[] = [];
    const executable = await materializeVerifiedArtifactHandle(artifactResolver, registered.executableArtifactId, executableExpected);
    handles.push(executable);
    const argumentsList: string[] = [];
    const artifactFileDescriptors: Array<{ argumentIndex: number; fileDescriptor: number }> = [];
    try {
      for (const argument of registered.arguments) {
        if (argument.kind === 'literal') argumentsList.push(argument.value);
        else {
          const expected = input.closure.runtimeArtifacts[argument.artifactId];
          if (!expected) throw new OfflineBundleError(`offline argument artifact is not authorized: ${argument.artifactId}`);
          const handle = await materializeVerifiedArtifactHandle(artifactResolver, argument.artifactId, expected);
          handles.push(handle);
          artifactFileDescriptors.push({ argumentIndex: argumentsList.length, fileDescriptor: handle.fd });
          argumentsList.push(argument.artifactId);
        }
      }
      const task = taskForOperation(operationId);
      const result = await sandbox.execute({
        materializedRoot, executableFileDescriptor: executable.fd, artifactFileDescriptors,
        arguments: argumentsList, timeoutMs: task.timeoutMs,
        ...(context ? { signal: context.signal, onOutput: context.output } : {}),
      });
      return result.exitCode;
    } finally {
      await Promise.all(handles.map(handle => handle.close()));
    }
  };
  const managedAuthority = async (operationId: string): Promise<{
    operation: Extract<OfflineOperation, { kind: 'managed-file' }>;
    task: ReturnType<typeof taskForOperation>;
    candidateBytes: Buffer;
  }> => {
    const operation = registeredOperation(operationId);
    if (operation.kind !== 'managed-file') throw new OfflineBundleError(`offline operation is not a managed-file operation: ${operationId}`);
    await assertManagedTargetAuthority(operation.targetPath);
    const expected = input.closure.runtimeArtifacts[operation.candidateArtifactId];
    if (!expected || expected.mode !== '0600') throw new OfflineBundleError(`offline managed-file candidate is not authorized: ${operation.candidateArtifactId}`);
    const handle = await materializeVerifiedArtifactHandle(artifactResolver, operation.candidateArtifactId, expected);
    try {
      const candidateBytes = await handle.readFile();
      if (candidateBytes.length !== expected.sizeBytes
        || createHash('sha256').update(candidateBytes).digest('hex') !== expected.sha256) {
        throw new OfflineBundleError(`offline managed-file candidate changed while being read: ${operation.candidateArtifactId}`);
      }
      return { operation, task: taskForOperation(operationId), candidateBytes };
    } finally {
      await handle.close();
    }
  };
  const inspectManagedFile = async (operationId: string): Promise<'needed' | 'verified'> => {
    const { operation, candidateBytes } = await managedAuthority(operationId);
    let handle: FileHandle | undefined;
    try {
      const pathMetadata = await lstat(operation.targetPath);
      if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.nlink !== 1) {
        throw new OfflineBundleError('offline managed-file target must be a regular file with one link');
      }
      handle = await open(operation.targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1
        || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
        throw new OfflineBundleError('offline managed-file target must be a regular file with one link');
      }
      if ((metadata.mode & 0o7777) !== operation.candidateMode) return 'needed';
      return (await handle.readFile()).equals(candidateBytes) ? 'verified' : 'needed';
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'needed';
      if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
        throw new OfflineBundleError('offline managed-file target must not be a symbolic link');
      }
      throw error;
    } finally {
      await handle?.close();
    }
  };
  return {
    discover: async () => structuredClone(input.attestedHostFacts ?? input.closure.hostFacts),
    plan: async () => ({
      tasks: structuredClone(input.closure.plan.tasks), selectedTaskIds: [...input.closure.plan.selectedTaskIds],
    }),
    check: async (task, context) => {
      const registered = registeredOperation(task.operations.check);
      if (registered.kind === 'managed-file') return inspectManagedFile(task.operations.check);
      if (registered.kind === 'native-package') {
        return invokeNativePackage(task.operations.check, context, async (runtime, authority) => runtime.check(authority));
      }
      const code = await invokeProcess(task.operations.check, context);
      if (code === 0) return 'verified' satisfies Inspection;
      if (code === 10) return 'needed' satisfies Inspection;
      if (code === 11) return 'reboot-required' satisfies Inspection;
      if (code === 20) return 'inapplicable' satisfies Inspection;
      throw new Error(`offline check operation failed with exit ${code}`);
    },
    apply: async (task, context) => {
      const registered = registeredOperation(task.operations.apply);
      if (registered.kind === 'managed-file') {
        if (!context?.configurationCompensation) {
          throw new OfflineBundleError('offline managed-file apply requires journal-backed compensation');
        }
        const authority = await managedAuthority(task.operations.apply);
        await applyConfigurationTransaction({
          spec: {
            schemaVersion: 1,
            taskId: authority.task.id,
            targetPath: authority.operation.targetPath,
            effect: 'installer-configuration',
            dependencies: authority.task.dependencies,
            candidateMode: authority.operation.candidateMode,
          },
          candidateBytes: authority.candidateBytes,
          hooks: {
            validateCandidate: async candidatePath => {
              const metadata = await lstat(candidatePath);
              if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
                || (metadata.mode & 0o7777) !== authority.operation.candidateMode
                || !(await readFile(candidatePath)).equals(authority.candidateBytes)) {
                throw new OfflineBundleError('offline managed-file candidate validation failed');
              }
            },
            verifyPostcondition: async () => await inspectManagedFile(task.operations.verify) === 'verified',
          },
          persistence: context.configurationCompensation,
        });
        return;
      }
      if (registered.kind === 'native-package') {
        await invokeNativePackage(task.operations.apply, context, async (runtime, authority) => runtime.apply(authority));
        return;
      }
      const code = await invokeProcess(task.operations.apply, context);
      if (code === 75) throw new InstallerOperationError('offline apply reported a transient failure', 'transient');
      if (code === 76) throw new InstallerOperationError('offline apply reported a rate limit', 'rate-limit');
      if (code !== 0) throw new Error(`offline apply operation failed with exit ${code}`);
    },
    verify: async (task, context) => {
      const registered = registeredOperation(task.operations.verify);
      if (registered.kind === 'managed-file') {
        if (await inspectManagedFile(task.operations.verify) !== 'verified') {
          throw new OfflineBundleError('offline managed-file verification failed');
        }
        return 'verified' satisfies Verification;
      }
      if (registered.kind === 'native-package') {
        return invokeNativePackage(task.operations.verify, context, async (runtime, authority) => runtime.verify(authority));
      }
      const code = await invokeProcess(task.operations.verify, context);
      if (code === 0) return 'verified' satisfies Verification;
      if (code === 20) return 'inapplicable' satisfies Verification;
      if (code === 30) return 'pending' satisfies Verification;
      if (code === 31) return 'pending-reboot' satisfies Verification;
      throw new Error(`offline verify operation failed with exit ${code}`);
    },
  };
}
