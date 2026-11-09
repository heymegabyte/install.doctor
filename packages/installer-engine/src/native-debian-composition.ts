import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DesiredStateInputSchema, NativeOfflinePayloadDescriptorSchema, TaskNodeSchema } from './contracts.js';
import type { DesiredStateInput, NativeOfflinePayloadDescriptor, TaskNode } from './contracts.js';
import { NativePackageInstalledWitnessSchema, OfflineOperationManifestSchema } from './offline-execution.js';
import type { OfflineOperationManifest } from './offline-execution.js';
import { parseDebianRelationships, validateDebianDependencyClosure } from './debian-relationships.js';
import type { DebianVersionComparator } from './debian-relationships.js';

const WitnessSchema = z.strictObject({
  kind: z.literal('preexisting-witness'), manager: z.literal('dpkg'), packageName: z.literal('libc6'),
  version: z.string().min(1).max(128), architecture: z.literal('amd64'),
  status: z.literal('installed'), healthy: z.literal(true), held: z.literal(false),
});

export type NativeDebianInstalledWitness = z.infer<typeof WitnessSchema>;
export type NativeDebianComposition = Readonly<{
  task: TaskNode;
  operations: OfflineOperationManifest;
  desiredState: DesiredStateInput;
  artifactIds: readonly string[];
  rootPackageKey: string;
  installedWitnesses: readonly NativeDebianInstalledWitness[];
  remainingLegacyPackages: readonly string[];
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

/**
 * Generic composition boundary with deliberately exact first-slice admission.
 * Future slices must add their own named admission profile instead of relaxing
 * this one or the ordinary mutable dependency-closure validator.
 */
export function composeNativeDebianPackageSlice(input: {
  descriptor: NativeOfflinePayloadDescriptor;
  target: { distroId: string; versionId: string; codename: string; architecture: string };
  installedWitnesses: readonly NativeDebianInstalledWitness[];
  desiredState: DesiredStateInput;
  legacyPackages: readonly string[];
  compareDebianVersions: DebianVersionComparator;
}): NativeDebianComposition {
  const descriptor = NativeOfflinePayloadDescriptorSchema.parse(input.descriptor);
  const desiredState = DesiredStateInputSchema.parse(input.desiredState);
  const witnesses = z.array(WitnessSchema).length(1).parse(input.installedWitnesses);
  if (descriptor.packageKey !== 'tree' || descriptor.package.name !== 'tree' || descriptor.package.version !== '2.1.0-1'
    || descriptor.package.architecture !== 'amd64' || descriptor.platform.os !== 'linux' || descriptor.platform.arch !== 'x64') {
    throw new Error('native Debian slice admits only tree=2.1.0-1 for Linux amd64');
  }
  if (input.target.distroId !== 'debian' || input.target.versionId !== '12' || input.target.codename !== 'bookworm'
    || input.target.architecture !== 'amd64' || descriptor.distro.id !== 'debian'
    || descriptor.distro.versionId !== '12' || descriptor.distro.codename !== 'bookworm') {
    throw new Error('native Debian tree slice requires Debian 12 bookworm amd64');
  }
  if (descriptor.repository.repositoryOrigin !== 'https://deb.debian.org/debian'
    || descriptor.repository.suite !== 'bookworm' || descriptor.repository.component !== 'main') {
    throw new Error('native Debian tree slice requires exact Debian bookworm main repository authority');
  }
  if (descriptor.metadataProof.packagesIndex.architecture !== 'amd64'
    || descriptor.metadataProof.packagesIndex.path !== 'dists/bookworm/main/binary-amd64/Packages.xz') {
    throw new Error('native Debian tree slice has incompatible Packages index authority');
  }
  const relationships = parseDebianRelationships(descriptor.metadataProof.packageStanza.depends);
  if (descriptor.metadataProof.packageStanza.preDepends !== null || relationships.length !== 1
    || relationships[0]?.packageName !== 'libc6' || relationships[0].architectureQualifier !== null
    || relationships[0].operator !== '>=' || relationships[0].version !== '2.34'
    || descriptor.dependencyClosure.depends.length !== 0 || descriptor.dependencyClosure.preDepends.length !== 0) {
    throw new Error('native Debian tree slice requires only the installed libc6 (>= 2.34) witness relationship');
  }
  const witness = witnesses[0]!;
  if (input.compareDebianVersions(witness.version, '2.34') < 0) throw new Error('installed libc6 witness does not satisfy >= 2.34');

  // Validate every ordinary descriptor invariant after substituting only the
  // explicitly admitted non-mutating relationship. No general closure rule is changed.
  const rootForClosure = structuredClone(descriptor);
  rootForClosure.metadataProof.packageStanza.depends = null;
  validateDebianDependencyClosure({ rootPackageKey: descriptor.packageKey, descriptors: [rootForClosure], compareVersions: input.compareDebianVersions });

  const operationIds = { check: 'native-debian-tree-check', apply: 'native-debian-tree-apply', verify: 'native-debian-tree-verify' } as const;
  const task = TaskNodeSchema.parse({
    schemaVersion: 1, id: 'package.native.tree',
    inputDigest: createHash('sha256').update(JSON.stringify(canonical({ descriptor, witness }))).digest('hex'),
    dependencies: [], predicate: 'host-supported', requiredCapabilities: [], operations: operationIds,
    timeoutMs: 300_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 256, network: false }, privilege: 'admin', network: 'none',
    consent: 'package-install', lockDomains: ['package-manager.dpkg'], cleanup: 'none', compensation: 'none',
    failurePolicy: 'abort-run',
  });
  const nativeOperation = (action: 'check' | 'apply' | 'verify') => ({
    kind: 'native-package' as const, effectClass: 'native-package' as const, action,
    packageKey: descriptor.packageKey, payloadArtifactId: descriptor.artifact.id,
    installedWitnesses: [NativePackageInstalledWitnessSchema.parse({
      kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', minimumVersion: '2.34', architecture: 'amd64',
    })],
  });
  const operations = OfflineOperationManifestSchema.parse({ schemaVersion: 4, configurationRoots: [], operations: {
    [operationIds.check]: nativeOperation('check'), [operationIds.apply]: nativeOperation('apply'), [operationIds.verify]: nativeOperation('verify'),
  } });
  const packages = [...new Set([...desiredState.packages, descriptor.packageKey])].sort();
  const consents = [...new Set([...desiredState.consents, 'package-install'])].sort();
  const boundDesiredState = DesiredStateInputSchema.parse({ ...desiredState, packages, consents, offline: true });
  const artifactIds = [...new Set([
    descriptor.artifact.id, descriptor.metadataProof.inRelease.artifactId,
    descriptor.metadataProof.inRelease.keyring.artifactId, descriptor.metadataProof.packagesIndex.artifactId,
  ])].sort();
  const remainingLegacyPackages = [...input.legacyPackages];
  const treeIndex = remainingLegacyPackages.indexOf('tree');
  if (treeIndex >= 0) remainingLegacyPackages.splice(treeIndex, 1);
  return Object.freeze({ task, operations, desiredState: boundDesiredState, artifactIds: Object.freeze(artifactIds),
    rootPackageKey: descriptor.packageKey, installedWitnesses: Object.freeze(witnesses),
    remainingLegacyPackages: Object.freeze(remainingLegacyPackages) });
}
