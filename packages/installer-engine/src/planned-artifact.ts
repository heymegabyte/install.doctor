import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { fetchImmutableArtifact } from './immutable-artifact.js';
import { ImmutableArtifactDescriptorSchema } from './contracts.js';
import { calculateLoadPlanReportDigest, LoadPlanItemSchema, LoadPlanReportSchema } from './lazy-plan.js';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const AbsolutePathSchema = z.string().min(1).max(4096).refine(isAbsolute, 'path must be absolute');
const DestinationRootsSchema = z.strictObject({
  'user-bin': AbsolutePathSchema.optional(),
  'docker-cli-plugin': AbsolutePathSchema.optional(),
});
const HostSchema = z.strictObject({ os: z.enum(['linux', 'darwin', 'win32']), arch: z.enum(['x64', 'arm64']) });
const ManagedArtifactAuthoritySchema = z.strictObject({ loadPlanDigest: DigestSchema, descriptorDigest: DigestSchema });
const ManagedArtifactOperationSchema = z.strictObject({
  kind: z.literal('managed-artifact'), action: z.enum(['check', 'apply', 'verify']),
  candidatePath: AbsolutePathSchema, candidateSha256: DigestSchema,
  candidateSizeBytes: z.number().int().positive().max(67_108_864), targetPath: AbsolutePathSchema,
  candidateMode: z.literal(0o700), descriptor: ImmutableArtifactDescriptorSchema,
  authority: ManagedArtifactAuthoritySchema,
});
const ManagedArtifactOperationsSchema = z.strictObject({
  check: ManagedArtifactOperationSchema.refine(value => value.action === 'check', 'check operation action must be check'),
  apply: ManagedArtifactOperationSchema.refine(value => value.action === 'apply', 'apply operation action must be apply'),
  verify: ManagedArtifactOperationSchema.refine(value => value.action === 'verify', 'verify operation action must be verify'),
});
const DerivationInputSchema = z.strictObject({
  loadPlan: LoadPlanReportSchema, item: LoadPlanItemSchema, approvedLoadPlanDigest: DigestSchema,
  host: HostSchema, cacheRoot: AbsolutePathSchema, destinationRoots: DestinationRootsSchema,
});
const PreparationInputSchema = DerivationInputSchema.extend({
  approvedEnginePlanDigest: DigestSchema,
  expectedOperations: ManagedArtifactOperationsSchema,
  offline: z.boolean().optional(),
}).strict();

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type ManagedArtifactOperations = z.infer<typeof ManagedArtifactOperationsSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function inspectRoot(path: string, kind: 'cache' | 'destination'): Promise<{ path: string; exists: boolean }> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error(`trusted ${kind} root cannot be inspected`);
    const parent = dirname(path);
    if (parent === path) throw new Error(`trusted ${kind} root must have an existing parent`);
    const parentMetadata = await lstat(parent).catch(() => undefined);
    if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink()) throw new Error(`trusted ${kind} root final leaf may be absent only beneath a real directory`);
    const canonicalParent = await realpath(parent);
    if (canonicalParent !== resolve(parent)) throw new Error(`trusted ${kind} root parent must be canonical without symbolic links`);
    if (process.platform !== 'win32') {
      const uid = process.geteuid?.();
      const forbidden = kind === 'cache' ? 0o077 : 0o022;
      if (uid === undefined || parentMetadata.uid !== uid || (parentMetadata.mode & forbidden) !== 0) {
        throw new Error(`trusted ${kind} root parent has unsafe ownership or permissions`);
      }
    }
    return { path: resolve(path), exists: false };
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`trusted ${kind} root must be a real directory`);
  const canonicalPath = await realpath(path);
  if (canonicalPath !== resolve(path)) throw new Error(`trusted ${kind} root must be a canonical real directory without symlinked ancestors`);
  if (process.platform !== 'win32') {
    const uid = process.geteuid?.();
    const forbidden = kind === 'cache' ? 0o077 : 0o022;
    if (uid === undefined || metadata.uid !== uid || (metadata.mode & forbidden) !== 0) {
      throw new Error(`trusted ${kind} root must be owned by the current user and ${kind === 'cache' ? 'private' : 'not group/world writable'}`);
    }
  }
  return { path: canonicalPath, exists: true };
}

function pathsOverlap(left: string, right: string): boolean {
  const contained = (value: string) => value === '' || (!value.startsWith('..') && !isAbsolute(value));
  return contained(relative(left, right)) || contained(relative(right, left));
}

function validateAuthority(input: z.infer<typeof DerivationInputSchema>): z.infer<typeof LoadPlanItemSchema> & { artifact: NonNullable<z.infer<typeof LoadPlanItemSchema>['artifact']> } {
  if (input.host.os === 'win32') throw new Error('managed artifact preparation is unsupported on win32');
  if (input.host.os !== process.platform || input.host.arch !== process.arch) throw new Error('host platform is not attested by the running installer process');
  const calculatedDigest = calculateLoadPlanReportDigest(input.loadPlan);
  if (calculatedDigest !== input.loadPlan.digest) throw new Error('load-plan digest does not match its contents');
  if (input.approvedLoadPlanDigest !== input.loadPlan.digest) throw new Error('exact approved load-plan digest is required');
  const plannedItem = input.loadPlan.items.find(candidate => candidate.name === input.item.name);
  if (!plannedItem || canonical(plannedItem) !== canonical(input.item)) throw new Error('exact load-plan item is required');
  if (!plannedItem.selected || !plannedItem.applicable || !plannedItem.actions.includes('install') || !plannedItem.artifact
    || !input.loadPlan.installOrder.includes(plannedItem.name)) throw new Error('a selected applicable install item with an immutable artifact is required');
  const expectedOs = input.loadPlan.platform === 'macos' ? 'darwin' : input.loadPlan.platform === 'windows' ? 'win32' : 'linux';
  if (input.host.os !== expectedOs || input.host.arch !== input.loadPlan.architecture
    || plannedItem.artifact.platform.os !== input.host.os || plannedItem.artifact.platform.arch !== input.host.arch) {
    throw new Error('host platform does not match the approved artifact and load plan');
  }
  if (plannedItem.artifact.id !== plannedItem.name) throw new Error('artifact descriptor is not bound to the load-plan item');
  return plannedItem as typeof plannedItem & { artifact: NonNullable<typeof plannedItem.artifact> };
}

export async function derivePlannedArtifactOperations(rawInput: unknown): Promise<{
  schemaVersion: 1; itemName: string; loadPlanDigest: string; descriptorDigest: string;
  candidatePath: string; targetPath: string; operations: ManagedArtifactOperations;
  directoryRequirements: Array<{ kind: 'cache' | 'destination'; targetPath: string; targetMode: 0o700; exists: boolean }>;
}> {
  const input = DerivationInputSchema.parse(rawInput);
  const item = validateAuthority(input);
  const destinationRoot = input.destinationRoots[item.artifact.destination.root];
  if (!destinationRoot) throw new Error('trusted destination root is required for the approved artifact');
  const [root, cacheRoot] = await Promise.all([
    inspectRoot(destinationRoot, 'destination'), inspectRoot(input.cacheRoot, 'cache'),
  ]);
  const canonicalRoot = root.path;
  const canonicalCacheRoot = cacheRoot.path;
  if (pathsOverlap(canonicalRoot, canonicalCacheRoot)) throw new Error('trusted destination root and private artifact cache root must be separate trust domains');
  const targetPath = join(canonicalRoot, item.artifact.destination.filename);
  const candidatePath = join(canonicalCacheRoot, item.artifact.source.sha256);
  const descriptorDigest = digest(item.artifact);
  const operation = (action: 'check' | 'apply' | 'verify') => ({
    kind: 'managed-artifact' as const, action, candidatePath,
    candidateSha256: item.artifact.source.sha256, candidateSizeBytes: item.artifact.source.sizeBytes,
    targetPath, candidateMode: 0o700 as const, descriptor: item.artifact,
    authority: { loadPlanDigest: input.loadPlan.digest, descriptorDigest },
  });
  return {
    schemaVersion: 1, itemName: item.name, loadPlanDigest: input.loadPlan.digest, descriptorDigest,
    candidatePath, targetPath,
    directoryRequirements: [
      { kind: 'cache', targetPath: canonicalCacheRoot, targetMode: 0o700, exists: cacheRoot.exists },
      { kind: 'destination', targetPath: canonicalRoot, targetMode: 0o700, exists: root.exists },
    ],
    operations: ManagedArtifactOperationsSchema.parse({ check: operation('check'), apply: operation('apply'), verify: operation('verify') }),
  };
}

export async function preparePlannedArtifact(rawInput: {
  loadPlan: unknown; item: unknown; approvedLoadPlanDigest: unknown; approvedEnginePlanDigest: unknown;
  expectedOperations: unknown; host: unknown; cacheRoot: unknown; destinationRoots: unknown;
  offline?: unknown; fetcher?: Fetcher;
}): Promise<Awaited<ReturnType<typeof derivePlannedArtifactOperations>> & { approvedEnginePlanDigest: string; cacheHit: boolean }> {
  const { fetcher, ...serializable } = rawInput;
  if (fetcher !== undefined && typeof fetcher !== 'function') throw new Error('artifact fetcher must be a function');
  let input: z.infer<typeof PreparationInputSchema>;
  try { input = PreparationInputSchema.parse(serializable); }
  catch (error) {
    if (error instanceof z.ZodError && error.issues.some(issue => issue.path[0] === 'approvedEnginePlanDigest')) {
      throw new Error('exact approved normalized engine-plan digest is required', { cause: error });
    }
    throw error;
  }
  const derived = await derivePlannedArtifactOperations({
    loadPlan: input.loadPlan, item: input.item, approvedLoadPlanDigest: input.approvedLoadPlanDigest,
    host: input.host, cacheRoot: input.cacheRoot, destinationRoots: input.destinationRoots,
  });
  if (canonical(input.expectedOperations) !== canonical(derived.operations)) {
    throw new Error('expected managed operations do not match the approved load-plan derivation');
  }
  const item = validateAuthority(input);
  const fetched = await fetchImmutableArtifact({
    descriptor: item.artifact, cacheRoot: input.cacheRoot,
    ...(input.offline === undefined ? {} : { offline: input.offline }),
    ...(fetcher === undefined ? {} : { fetcher }),
  });
  if (fetched.candidatePath !== derived.candidatePath || fetched.sha256 !== item.artifact.source.sha256
    || fetched.sizeBytes !== item.artifact.source.sizeBytes) {
    throw new Error('prepared artifact changed the approved managed operations');
  }
  return { ...derived, approvedEnginePlanDigest: input.approvedEnginePlanDigest, cacheHit: fetched.cacheHit };
}
