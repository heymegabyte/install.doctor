import { z } from 'zod';
import {
  NativeOfflinePayloadDescriptorSchema,
  type NativeOfflinePayloadDescriptor,
} from './contracts.js';

const MAX_RELATIONSHIP_BYTES = 16_384;
const MAX_RELATIONSHIPS = 4_096;
const packageName = z.string().min(2).max(128).regex(/^[a-z0-9][a-z0-9+.-]*$/);
const version = z.string().min(1).max(128).regex(/^[0-9][A-Za-z0-9.+:~-]*$/);
const relationshipInput = z.string().max(MAX_RELATIONSHIP_BYTES).nullable();
const descriptorInput = z.array(NativeOfflinePayloadDescriptorSchema).min(1).max(MAX_RELATIONSHIPS);

export type DebianVersionOperator = '<<' | '<=' | '=' | '>=' | '>>';
export type DebianArchitectureQualifier = 'any' | 'native' | null;

export interface DebianRelationship {
  readonly packageName: string;
  readonly architectureQualifier: DebianArchitectureQualifier;
  readonly operator: DebianVersionOperator | null;
  readonly version: string | null;
}

export interface DebianVersionComparator {
  (left: string, right: string): number;
}

export interface ValidatedDebianClosure {
  /** Exact installation order. Every dependency precedes its dependent. */
  readonly installationOrder: readonly NativeOfflinePayloadDescriptor[];
  readonly descriptorsByPackageKey: ReadonlyMap<string, NativeOfflinePayloadDescriptor>;
}

export class DebianRelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebianRelationshipError';
  }
}

function fail(message: string): never {
  throw new DebianRelationshipError(message);
}

/**
 * Parse the deliberately small relationship grammar admitted by the first
 * offline dpkg profile. Apt-only resolution features are rejected rather than
 * approximated.
 */
export function parseDebianRelationships(raw: string | null): readonly DebianRelationship[] {
  const parsed = relationshipInput.safeParse(raw);
  if (!parsed.success) return fail('Debian relationship field exceeds its bound or is invalid');
  if (parsed.data === null) return Object.freeze([]);
  if (/\r|\0|[^\x09\x0a\x20-\x7e]/.test(parsed.data)) return fail('Debian relationship field contains unsupported characters');
  const text = parsed.data.trim();
  if (text.length === 0) return fail('Debian relationship field is empty');
  if (/\||\$\{|[\[\]]|(?:^|\s)<[A-Za-z!]/.test(text)) {
    return fail('alternatives, substvars, profiles, and architecture restrictions are unsupported');
  }
  const terms = text.split(',');
  if (terms.length > MAX_RELATIONSHIPS) return fail('Debian relationship field contains too many terms');
  const result: DebianRelationship[] = [];
  const identities = new Set<string>();
  for (const untrimmed of terms) {
    const term = untrimmed.trim().replace(/[\t\n ]+/g, ' ');
    if (term.length === 0) return fail('Debian relationship field contains an empty term');
    const match = /^([a-z0-9][a-z0-9+.-]*)(?::(any|native))?(?: ?\( ?(<<|<=|=|>=|>>) ([0-9][A-Za-z0-9.+:~-]*) ?\))?$/.exec(term);
    if (!match) return fail(`unsupported or malformed Debian relationship: ${term}`);
    const nameResult = packageName.safeParse(match[1]);
    const versionResult = match[4] === undefined ? undefined : version.safeParse(match[4]);
    if (!nameResult.success || (versionResult && !versionResult.success)) {
      return fail(`unsupported or malformed Debian relationship: ${term}`);
    }
    const relationship: DebianRelationship = Object.freeze({
      packageName: nameResult.data,
      architectureQualifier: (match[2] as 'any' | 'native' | undefined) ?? null,
      operator: (match[3] as DebianVersionOperator | undefined) ?? null,
      version: versionResult?.data ?? null,
    });
    const identity = relationship.packageName;
    if (identities.has(identity)) return fail(`duplicate Debian relationship for ${relationship.packageName}`);
    identities.add(identity);
    result.push(relationship);
  }
  return Object.freeze(result);
}

function versionSatisfies(actual: string, operator: DebianVersionOperator | null, expected: string | null, compare: DebianVersionComparator): boolean {
  if (operator === null || expected === null) return operator === null && expected === null;
  const comparison = compare(actual, expected);
  if (!Number.isFinite(comparison)) return fail('Debian version comparator returned a non-finite result');
  switch (operator) {
    case '<<': return comparison < 0;
    case '<=': return comparison <= 0;
    case '=': return comparison === 0;
    case '>=': return comparison >= 0;
    case '>>': return comparison > 0;
  }
}

function sameRepository(left: NativeOfflinePayloadDescriptor, right: NativeOfflinePayloadDescriptor): boolean {
  return left.repository.repositoryOrigin === right.repository.repositoryOrigin
    && left.repository.suite === right.repository.suite
    && left.repository.component === right.repository.component
    && left.metadataProof.inRelease.artifactId === right.metadataProof.inRelease.artifactId
    && left.metadataProof.inRelease.sha256 === right.metadataProof.inRelease.sha256
    && left.metadataProof.inRelease.signingKeyFingerprint.toUpperCase()
      === right.metadataProof.inRelease.signingKeyFingerprint.toUpperCase()
    && left.metadataProof.inRelease.keyring.artifactId === right.metadataProof.inRelease.keyring.artifactId
    && left.metadataProof.inRelease.keyring.sha256 === right.metadataProof.inRelease.keyring.sha256
    && left.metadataProof.packagesIndex.artifactId === right.metadataProof.packagesIndex.artifactId
    && left.metadataProof.packagesIndex.path === right.metadataProof.packagesIndex.path
    && left.metadataProof.packagesIndex.sha256 === right.metadataProof.packagesIndex.sha256;
}

function sameDistro(left: NativeOfflinePayloadDescriptor, right: NativeOfflinePayloadDescriptor): boolean {
  return left.distro.id === right.distro.id
    && left.distro.versionId === right.distro.versionId
    && left.distro.codename === right.distro.codename;
}

function resolveRelationship(
  owner: NativeOfflinePayloadDescriptor,
  relationship: DebianRelationship,
  byName: ReadonlyMap<string, NativeOfflinePayloadDescriptor>,
  compareVersions: DebianVersionComparator,
): NativeOfflinePayloadDescriptor {
  const target = byName.get(relationship.packageName);
  if (!target) return fail(`${owner.packageKey} references missing package ${relationship.packageName}`);
  const nativeArchitecture = owner.platform.arch === 'x64' ? 'amd64' : 'arm64';
  if (target.package.architecture !== 'all' && target.package.architecture !== nativeArchitecture) {
    return fail(`${target.packageKey} has an incompatible Debian architecture`);
  }
  if (relationship.architectureQualifier === 'any'
    && target.metadataProof.packageStanza.multiArch !== 'allowed') {
    return fail(`${target.packageKey} cannot safely satisfy an :any relationship`);
  }
  if (relationship.architectureQualifier === 'native'
    && target.package.architecture !== 'all'
    && target.package.architecture !== nativeArchitecture) {
    return fail(`${target.packageKey} cannot satisfy an :native relationship`);
  }
  if (!versionSatisfies(target.package.version, relationship.operator, relationship.version, compareVersions)) {
    return fail(`${target.packageKey} does not satisfy the signed version relationship`);
  }
  return target;
}

function referenceIdentity(value: { readonly packageKey: string; readonly artifactId: string }): string {
  return `${value.packageKey}\u0000${value.artifactId}`;
}

/** Validate an entire signed, self-contained dependency closure. */
export function validateDebianDependencyClosure(input: {
  readonly rootPackageKey: string;
  readonly descriptors: readonly NativeOfflinePayloadDescriptor[];
  readonly compareVersions: DebianVersionComparator;
}): ValidatedDebianClosure {
  if (typeof input.compareVersions !== 'function') return fail('a Debian version comparator is required');
  const parsed = descriptorInput.safeParse(input.descriptors);
  if (!parsed.success) return fail(`invalid native package closure: ${parsed.error.issues[0]?.message ?? 'unknown descriptor error'}`);
  const descriptors = parsed.data;
  const byKey = new Map<string, NativeOfflinePayloadDescriptor>();
  const byName = new Map<string, NativeOfflinePayloadDescriptor>();
  for (const descriptor of descriptors) {
    if (byKey.has(descriptor.packageKey)) return fail(`duplicate package key ${descriptor.packageKey}`);
    if (byName.has(descriptor.package.name)) return fail(`ambiguous package name ${descriptor.package.name}`);
    byKey.set(descriptor.packageKey, descriptor);
    byName.set(descriptor.package.name, descriptor);
  }
  const root = byKey.get(input.rootPackageKey);
  if (!root) return fail('root package is absent from the signed closure');

  const edges = new Map<string, { preDepends: NativeOfflinePayloadDescriptor[]; depends: NativeOfflinePayloadDescriptor[] }>();
  for (const descriptor of descriptors) {
    if (descriptor.platform.os !== root.platform.os || descriptor.platform.arch !== root.platform.arch
      || !sameDistro(descriptor, root) || !sameRepository(descriptor, root)) {
      return fail(`${descriptor.packageKey} is outside the root platform, distro, or repository authority`);
    }
    const preRelationships = parseDebianRelationships(descriptor.metadataProof.packageStanza.preDepends);
    const relationships = parseDebianRelationships(descriptor.metadataProof.packageStanza.depends);
    const preDepends = preRelationships.map(value => resolveRelationship(descriptor, value, byName, input.compareVersions));
    const depends = relationships.map(value => resolveRelationship(descriptor, value, byName, input.compareVersions));
    if ([...preDepends, ...depends].some(value => value.packageKey === descriptor.packageKey)) {
      return fail(`${descriptor.packageKey} contains a self dependency`);
    }
    const preIdentities = new Set(preDepends.map(value => referenceIdentity({ packageKey: value.packageKey, artifactId: value.artifact.id })));
    const dependsIdentities = new Set(depends.map(value => referenceIdentity({ packageKey: value.packageKey, artifactId: value.artifact.id })));
    if ([...preIdentities].some(value => dependsIdentities.has(value))) {
      return fail(`${descriptor.packageKey} dependency appears in both Pre-Depends and Depends`);
    }
    const actualPre = descriptor.dependencyClosure.preDepends.map(referenceIdentity);
    const actualDepends = descriptor.dependencyClosure.depends.map(referenceIdentity);
    const expectedPre = [...preIdentities].sort((left, right) => left.localeCompare(right));
    const expectedDepends = [...dependsIdentities].sort((left, right) => left.localeCompare(right));
    if (actualPre.length !== expectedPre.length || actualPre.some((value, index) => value !== expectedPre[index])) {
      return fail(`${descriptor.packageKey} Pre-Depends closure does not exactly match signed metadata`);
    }
    if (actualDepends.length !== expectedDepends.length || actualDepends.some((value, index) => value !== expectedDepends[index])) {
      return fail(`${descriptor.packageKey} Depends closure does not exactly match signed metadata`);
    }
    edges.set(descriptor.packageKey, { preDepends, depends });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: NativeOfflinePayloadDescriptor[] = [];
  const visit = (descriptor: NativeOfflinePayloadDescriptor): void => {
    if (visiting.has(descriptor.packageKey)) return fail(`dependency cycle includes ${descriptor.packageKey}`);
    if (visited.has(descriptor.packageKey)) return;
    visiting.add(descriptor.packageKey);
    const dependencies = edges.get(descriptor.packageKey)!;
    for (const dependency of [...dependencies.preDepends].sort((a, b) => a.packageKey.localeCompare(b.packageKey))) visit(dependency);
    for (const dependency of [...dependencies.depends].sort((a, b) => a.packageKey.localeCompare(b.packageKey))) visit(dependency);
    visiting.delete(descriptor.packageKey);
    visited.add(descriptor.packageKey);
    ordered.push(descriptor);
  };
  visit(root);
  if (visited.size !== descriptors.length) return fail('signed dependency closure contains unreachable package descriptors');
  return Object.freeze({
    installationOrder: Object.freeze(ordered),
    descriptorsByPackageKey: byKey,
  });
}
