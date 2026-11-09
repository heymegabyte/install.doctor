import { z } from 'zod';
import { DesiredStateInputSchema, HostFactsSchema, NativeOfflinePayloadDescriptorSchema, NormalizedPlanSchema } from './contracts.js';
import { NativePackageOperationSchema, OfflineOperationManifestSchema } from './offline-execution.js';
import { PrivilegedBrokerExecutionAuthoritySchema, PrivilegedBrokerPackageExecutionAuthoritySchema,
  privilegedBrokerDescriptorDigest, privilegedBrokerExecutionAuthorityDigest } from './privileged-broker-authority.js';
import { PrivilegedBrokerControllerDraftInputSchema } from './privileged-broker-controller-contract.js';
import { PrivilegedBrokerClientConfigSchema } from './privileged-broker-client.js';
import { PrivilegedBrokerGrantSchema, privilegedBrokerDigest } from './privileged-broker-protocol.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const authorityPath = z.string().regex(/^\/run\/desktop-tools\/authority\/[a-z0-9][a-z0-9._-]{0,127}\/[A-Za-z0-9._-]+$/);

export const PrivilegedBrokerDerivationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvalMode: z.enum(['trusted-local', 'signed-device']),
  runId: identifier,
  approvedPlanDigest: digest,
  plan: NormalizedPlanSchema,
  operations: z.record(identifier, z.unknown()).refine(value => Object.keys(value).length <= 30_000, 'too many operations'),
  desiredState: DesiredStateInputSchema,
  hostFacts: HostFactsSchema,
  descriptor: NativeOfflinePayloadDescriptorSchema,
  releaseProof: PrivilegedBrokerPackageExecutionAuthoritySchema.shape.releaseProof,
  artifacts: PrivilegedBrokerPackageExecutionAuthoritySchema.shape.artifacts,
  transactionRoot: PrivilegedBrokerPackageExecutionAuthoritySchema.shape.transactionRoot,
  enrolledUid: z.number().int().positive(),
  socketGid: z.number().int().nonnegative(),
  helperPath: authorityPath,
  helperDigest: digest,
  runtimePath: authorityPath,
  runtimeDigest: digest,
  workerPath: authorityPath,
  workerDigest: digest,
  socketPath: z.string().regex(/^\/run\/desktop-tools\/broker\/[a-z0-9][a-z0-9._-]{0,127}\/broker\.sock$/),
  issuedAt: timestamp,
  expiresAt: timestamp,
  operationTimeoutMs: z.number().int().min(1_000).max(30 * 60 * 1_000).default(120_000),
});

export type PrivilegedBrokerDerivationInput = z.infer<typeof PrivilegedBrokerDerivationInputSchema>;

export function derivePrivilegedBrokerAuthority(inputValue: unknown) {
  const input = PrivilegedBrokerDerivationInputSchema.parse(inputValue);
  if (input.plan.digest !== input.approvedPlanDigest || input.hostFacts.hostId !== input.desiredState.hostId
    || input.runId !== input.socketPath.split('/').at(-2)) {
    throw new Error('broker derivation identity differs from the approved semantic authority');
  }
  const selected = new Set(input.plan.selectedTaskIds);
  const candidates = input.plan.tasks.flatMap(task => {
    if (!selected.has(task.id)) return [];
    const phases = ['check', 'apply', 'verify'] as const;
    const parsed = phases.map(phase => {
      const operationId = task.operations[phase];
      const operation = operationId ? NativePackageOperationSchema.safeParse(input.operations[operationId]) : undefined;
      return operationId && operation?.success ? { operationId, phase, operation: operation.data } : null;
    });
    return parsed.every(Boolean) ? [{ task, operations: parsed as Array<NonNullable<(typeof parsed)[number]>> }] : [];
  });
  if (candidates.length !== 1) throw new Error('broker derivation requires one selected native-package task');
  const candidate = candidates[0]!;
  if (candidate.task.compensation !== 'none' || candidate.task.privilege !== 'admin'
    || !candidate.task.lockDomains.includes('package-manager.dpkg')) {
    throw new Error('broker native task lacks exact privilege, lock, or compensation authority');
  }
  const operationIds = new Set(candidate.operations.map(item => item.operationId));
  for (const [operationId, operation] of Object.entries(input.operations)) {
    if (NativePackageOperationSchema.safeParse(operation).success && !operationIds.has(operationId)) {
      throw new Error('broker derivation found a surplus native-package operation');
    }
  }
  for (const item of candidate.operations) {
    if (item.operation.action !== item.phase || item.operation.packageKey !== input.descriptor.packageKey
      || item.operation.payloadArtifactId !== input.descriptor.artifact.id) {
      throw new Error('broker native operation differs from the signed descriptor or task phase');
    }
  }
  const operations = OfflineOperationManifestSchema.parse({
    schemaVersion: 5,
    configurationRoots: [],
    operations: Object.fromEntries(candidate.operations.map(item => [item.operationId, item.operation])),
  });
  const authority = PrivilegedBrokerExecutionAuthoritySchema.parse({
    schemaVersion: 1,
    hostId: input.hostFacts.hostId,
    releaseId: input.plan.releaseId,
    runId: input.runId,
    planDigest: input.plan.digest,
    plan: input.plan,
    operations,
    desiredState: input.desiredState,
    hostFacts: input.hostFacts,
    descriptor: input.descriptor,
    releaseProof: input.releaseProof,
    artifacts: input.artifacts,
    transactionRoot: input.transactionRoot,
  });
  const descriptorDigest = privilegedBrokerDescriptorDigest(input.descriptor);
  const closureDigest = privilegedBrokerExecutionAuthorityDigest(authority);
  const consentDigest = privilegedBrokerDigest({
    schemaVersion: 1,
    method: input.approvalMode,
    hostId: input.hostFacts.hostId,
    releaseId: input.plan.releaseId,
    runId: input.runId,
    planDigest: input.plan.digest,
    enrolledUid: input.enrolledUid,
    taskId: candidate.task.id,
    operations: candidate.operations.map(({ operationId, phase }) => ({ operationId, phase })),
    descriptorDigest,
  });
  const grantId = `grant-${privilegedBrokerDigest({ closureDigest, consentDigest, issuedAt: input.issuedAt }).slice(0, 24)}`;
  const grant = PrivilegedBrokerGrantSchema.parse({
    schemaVersion: 1,
    grantId,
    hostId: input.hostFacts.hostId,
    releaseId: input.plan.releaseId,
    runId: input.runId,
    planDigest: input.plan.digest,
    approvedPlanDigest: input.approvedPlanDigest,
    enrolledUid: input.enrolledUid,
    brokerExecutableDigest: input.helperDigest,
    runtimeDigest: input.runtimeDigest,
    workerDigest: input.workerDigest,
    operations: candidate.operations.map(({ operationId, phase }) => ({ taskId: candidate.task.id, operationId, phase })),
    descriptorDigest,
    closureDigest,
    consentDigest,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  });
  const controllerInput = PrivilegedBrokerControllerDraftInputSchema.parse({
    schemaVersion: 1,
    approvalMode: input.approvalMode,
    grant,
    authority,
    helperPath: input.helperPath,
    runtimePath: input.runtimePath,
    workerPath: input.workerPath,
    socketPath: input.socketPath,
    socketGid: input.socketGid,
    requestLimit: 3,
    operationTimeoutMs: input.operationTimeoutMs,
    helperDigest: input.helperDigest,
    runtimeDigest: input.runtimeDigest,
    workerDigest: input.workerDigest,
  });
  const clientConfig = PrivilegedBrokerClientConfigSchema.parse({
    helperPath: input.helperPath,
    socketPath: input.socketPath,
    hostId: input.hostFacts.hostId,
    releaseId: input.plan.releaseId,
    runId: input.runId,
    planDigest: input.plan.digest,
    taskId: candidate.task.id,
    grant,
  });
  return Object.freeze({ schemaVersion: 1 as const, taskId: candidate.task.id, grant, authority, controllerInput, clientConfig,
    grantDigest: privilegedBrokerDigest(grant), authorityDigest: closureDigest });
}
