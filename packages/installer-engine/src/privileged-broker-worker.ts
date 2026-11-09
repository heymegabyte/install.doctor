#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, constants, writeSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { deriveBoundNormalizedPlan } from './engine.js';
import type { TaskExecutionContext } from './engine.js';
import { verifyDesktopReleaseCatalog } from './offline-bundle.js';
import {
  createOfflineInstallerAdapter,
  offlineExecutionGraphDigest,
  verifyNativeDebianMetadataWithResolver,
} from './offline-execution.js';
import type { OfflineExecutionClosure } from './offline-execution.js';
import { createDefaultDebianMetadataVerifier } from './debian-gpgv.js';
import { createTrustedDebianVersionComparator } from './debian-version.js';
import { collectLinuxOfflineHostFacts } from './linux-host-facts.js';
import { createNativeDpkgTransactionRuntime } from './native-dpkg-transaction.js';
import {
  PrivilegedBrokerRequestSchema,
  createPrivilegedBrokerReceipt,
  privilegedBrokerDigest,
  validatePrivilegedBrokerRequest,
} from './privileged-broker-protocol.js';
import type { PrivilegedBrokerReceipt } from './privileged-broker-protocol.js';
import { createPrivilegedBrokerStore } from './privileged-broker-store.js';
import { createPrivilegedBrokerTransactionPersistence } from './privileged-broker-transaction-store.js';

const STORE_ROOT = '/run/desktop-tools/privileged';
const MAX_ENVELOPE_BYTES = 65_536;
const EnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  peerUid: z.number().int().nonnegative(),
  request: PrivilegedBrokerRequestSchema,
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_ENVELOPE_BYTES) throw new Error('broker worker envelope exceeds its boundary');
    chunks.push(bytes);
  }
  if (total === 0) throw new Error('broker worker envelope is empty');
  return Buffer.concat(chunks, total);
}

async function readProtectedRootFile(path: string, maximumBytes: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0
    || (before.mode & 0o022) !== 0 || before.size < 1 || before.size > maximumBytes) {
    throw new Error('broker release authority file is unsafe');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('broker release authority changed while opening');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('broker release authority changed while reading');
    }
    return bytes;
  } finally { await handle.close(); }
}

async function stagePayload(input: { readonly requestDigest: string; readonly sha256: string; readonly sizeBytes: number }): Promise<{ root: string; path: string }> {
  await mkdir(join(STORE_ROOT, 'payloads'), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(STORE_ROOT, 'payloads', `${input.requestDigest}-`));
  await chmod(root, 0o700);
  const borrowed = await open('/proc/self/fd/3', constants.O_RDONLY);
  try {
    const metadata = await borrowed.stat();
    if (!metadata.isFile() || metadata.nlink !== 0 || metadata.size !== input.sizeBytes) throw new Error('broker payload descriptor is not the admitted anonymous file');
    const bytes = await borrowed.readFile();
    if (bytes.length !== input.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
      throw new Error('broker payload bytes differ from request authority');
    }
    const path = join(root, 'payload.deb');
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    return { root, path };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  } finally { await borrowed.close(); }
}

function sameHostAuthority(left: Awaited<ReturnType<typeof collectLinuxOfflineHostFacts>>, right: Awaited<ReturnType<typeof collectLinuxOfflineHostFacts>>): boolean {
  return left.hostId === right.hostId && left.os === right.os && left.osVersion === right.osVersion
    && left.arch === right.arch && left.environment === right.environment
    && JSON.stringify(left.roles) === JSON.stringify(right.roles)
    && JSON.stringify(left.packageManagers) === JSON.stringify(right.packageManagers);
}

export async function executePrivilegedBrokerWorker(input: {
  readonly envelope: unknown;
  readonly storeRoot?: string;
  readonly now?: Date;
}): Promise<PrivilegedBrokerReceipt> {
  if (process.platform !== 'linux' || process.geteuid?.() !== 0) throw new Error('privileged broker worker requires Linux root');
  const envelope = EnvelopeSchema.parse(input.envelope);
  const storeRoot = input.storeRoot ?? STORE_ROOT;
  if (storeRoot !== STORE_ROOT) throw new Error('privileged broker worker store root is not the production root');
  const store = await createPrivilegedBrokerStore({ root: storeRoot, verifyApproval: async () => false });
  const { grant } = await store.readGrant(envelope.request.grantId);
  const validated = validatePrivilegedBrokerRequest({
    request: envelope.request, grant, peerUid: envelope.peerUid, now: input.now ?? new Date(), consumeNonce: () => true,
  });
  if (!await store.consumeNonce(grant.grantId, envelope.request.nonce, validated.requestDigest)) {
    throw new Error('broker nonce was already durably consumed');
  }
  const { authority } = await store.readAuthority(grant.grantId);
  if (envelope.request.payload.sha256 !== authority.descriptor.artifact.sha256
    || envelope.request.payload.sizeBytes !== authority.descriptor.artifact.sizeBytes) {
    throw new Error('broker payload request differs from signed descriptor authority');
  }
  const operation = authority.operations.operations[envelope.request.operationId];
  const task = authority.plan.tasks.find(candidate => candidate.id === envelope.request.taskId);
  if (!operation || operation.kind !== 'native-package' || operation.action !== envelope.request.phase || !task
    || !authority.plan.selectedTaskIds.includes(task.id) || task.operations[envelope.request.phase] !== envelope.request.operationId) {
    throw new Error('broker request is outside the selected authority operation');
  }
  const reproduced = await deriveBoundNormalizedPlan({ tasks: authority.plan.tasks, selectedTaskIds: authority.plan.selectedTaskIds,
    executionPolicy: authority.plan.executionPolicy }, authority.hostFacts, authority.desiredState, authority.releaseId, authority.plan.createdAt);
  if (JSON.stringify(canonical(reproduced)) !== JSON.stringify(canonical(authority.plan))) {
    throw new Error('broker approved plan does not reproduce from its semantic authority');
  }
  const catalogBytes = await readProtectedRootFile(authority.releaseProof.catalogPath, 8_388_608);
  const release = await verifyDesktopReleaseCatalog({
    manifestPath: authority.releaseProof.manifestPath,
    signaturePath: authority.releaseProof.signaturePath,
    trust: authority.releaseProof.trust,
    expectedReleaseId: authority.releaseId,
    catalogBytes,
    nativeAuthority: {
      descriptor: authority.descriptor,
      artifacts: authority.artifacts.map(item => ({ artifactId: item.artifactId, url: item.url,
        authority: { sha256: item.sha256, sizeBytes: item.sizeBytes, mode: item.mode } })),
    },
  });
  if (release.manifestSha256 !== authority.releaseProof.manifestSha256) throw new Error('broker release differs from bootstrap authority');
  const liveFacts = await collectLinuxOfflineHostFacts();
  if (!sameHostAuthority(liveFacts, authority.hostFacts)) throw new Error('broker live host differs from approved host authority');
  const staged = await stagePayload({ requestDigest: validated.requestDigest,
    sha256: envelope.request.payload.sha256, sizeBytes: envelope.request.payload.sizeBytes });
  try {
    const runtimeArtifacts = Object.fromEntries(authority.artifacts.map(item => [item.artifactId,
      { sha256: item.sha256, sizeBytes: item.sizeBytes, mode: item.mode }]));
    const closure: OfflineExecutionClosure = {
      plan: authority.plan, operations: authority.operations, desiredState: authority.desiredState, hostFacts: authority.hostFacts,
      graphDigest: offlineExecutionGraphDigest(authority.plan, authority.operations, authority.desiredState, authority.hostFacts),
      selectedTaskIds: [...authority.plan.selectedTaskIds], runtimeArtifactIds: Object.keys(runtimeArtifacts).sort(), runtimeArtifacts,
      nativePackageDescriptors: { [authority.descriptor.packageKey]: authority.descriptor },
    };
    const sources = new Map(authority.artifacts.map(item => [item.artifactId,
      { sourcePath: item.artifactId === authority.descriptor.artifact.id ? staged.path : item.sourcePath,
        authority: { sha256: item.sha256, sizeBytes: item.sizeBytes, mode: item.mode } }]));
    const resolver = async (artifactId: string) => {
      const source = sources.get(artifactId);
      if (!source) throw new Error(`broker release artifact is unavailable: ${artifactId}`);
      return source;
    };
    const keyring = authority.artifacts.find(item => item.artifactId === authority.descriptor.metadataProof.inRelease.keyring.artifactId)!;
    const verifiedMetadata = await verifyNativeDebianMetadataWithResolver({
      closure, resolver,
      verifier: async () => createDefaultDebianMetadataVerifier({ keyring: { kind: 'path', absolutePath: keyring.sourcePath } }),
    });
    const compareDebianVersions = await createTrustedDebianVersionComparator();
    const persistence = await createPrivilegedBrokerTransactionPersistence({ root: authority.transactionRoot,
      runId: authority.runId, hostId: authority.hostId, planDigest: authority.planDigest });
    const adapter = await createOfflineInstallerAdapter({
      closure, materializedRoot: staged.root, artifactResolver: resolver, attestedHostFacts: authority.hostFacts,
      verifiedNativeMetadata: verifiedMetadata, compareDebianVersions,
      nativePackageRuntimeFactory: claim => createNativeDpkgTransactionRuntime({
        identity: claim.identity, persistence, compareDebianVersions,
      }),
    });
    const controller = new AbortController();
    const context: TaskExecutionContext = { signal: controller.signal, attempt: 1, output: () => undefined,
      nativeDpkgTransaction: { identity: { runId: authority.runId, hostId: authority.hostId, planDigest: authority.planDigest }, persistence } };
    let observedStatus: string;
    if (envelope.request.phase === 'check') observedStatus = await adapter.check(task, context);
    else if (envelope.request.phase === 'apply') { await adapter.apply(task, context); observedStatus = 'applied'; }
    else observedStatus = await adapter.verify(task, context);
    if (!['verified', 'needed', 'inapplicable', 'pending', 'applied'].includes(observedStatus)) {
      throw new Error(`broker operation returned unsupported status: ${observedStatus}`);
    }
    const status = observedStatus as PrivilegedBrokerReceipt['status'];
    const fenceDigest = envelope.request.phase === 'apply'
      ? await persistence.evidenceDigest()
      : privilegedBrokerDigest({ requestDigest: validated.requestDigest, status, closureDigest: grant.closureDigest });
    return createPrivilegedBrokerReceipt({ request: envelope.request, grantDigest: validated.grantDigest,
      status, fenceDigest, completedAt: new Date().toISOString() });
  } finally { await rm(staged.root, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  try { closeSync(6); } catch { /* The release-pinned script descriptor may already be closed in tests. */ }
  const input = JSON.parse((await readStdin()).toString('utf8')) as unknown;
  const receipt = await executePrivilegedBrokerWorker({ envelope: input });
  const bytes = Buffer.from(JSON.stringify(receipt), 'utf8');
  if (writeSync(4, bytes) !== bytes.length) throw new Error('broker receipt packet was not written atomically');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === '/proc/self/fd/6') {
  main().catch(() => {
    try { writeSync(4, Buffer.from('{"schemaVersion":1,"status":"failed","error":"broker operation failed"}', 'utf8')); } catch { /* best effort */ }
    process.exitCode = 0;
  });
}
