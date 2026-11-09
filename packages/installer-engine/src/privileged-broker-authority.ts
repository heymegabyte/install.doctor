import { dirname, isAbsolute, normalize } from 'node:path';
import { z } from 'zod';
import {
  DesiredStateInputSchema,
  HostFactsSchema,
  NativeOfflinePayloadDescriptorSchema,
  NormalizedPlanSchema,
} from './contracts.js';
import { NativePackageOperationSchema, OfflineOperationManifestSchema } from './offline-execution.js';
import { privilegedBrokerDigest } from './privileged-broker-protocol.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolutePath = z.string().min(1).max(4096).refine(
  value => isAbsolute(value) && normalize(value) === value && dirname(value) !== value && !value.includes('\0'),
  'path must be canonical, absolute, and non-root',
);

export const PrivilegedBrokerExecutionAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  plan: NormalizedPlanSchema,
  operations: OfflineOperationManifestSchema,
  desiredState: DesiredStateInputSchema,
  hostFacts: HostFactsSchema,
  descriptor: NativeOfflinePayloadDescriptorSchema,
  releaseProof: z.strictObject({
    manifestPath: absolutePath,
    signaturePath: absolutePath,
    catalogPath: absolutePath,
    manifestSha256: digest,
    trust: z.strictObject({
      keyId: identifier,
      publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
    }),
  }),
  artifacts: z.array(z.strictObject({
    artifactId: identifier,
    sourcePath: absolutePath,
    sha256: digest,
    sizeBytes: z.number().int().positive().max(268_435_456),
    mode: z.literal('0600'),
  })).length(4),
  transactionRoot: absolutePath,
}).superRefine((value, context) => {
  if (value.hostId !== value.hostFacts.hostId || value.hostId !== value.desiredState.hostId
    || value.releaseId !== value.plan.releaseId || value.planDigest !== value.plan.digest) {
    context.addIssue({ code: 'custom', message: 'broker authority identity differs from its semantic closure' });
  }
  const operations = Object.entries(value.operations.operations)
    .filter(([, operation]) => operation.kind === 'native-package')
    .map(([operationId, operation]) => [operationId, NativePackageOperationSchema.parse(operation)] as const);
  const expectedActions = ['apply', 'check', 'verify'];
  if (operations.length !== 3
    || JSON.stringify(operations.map(([, operation]) => operation.action).sort()) !== JSON.stringify(expectedActions)
    || operations.some(([, operation]) => operation.packageKey !== value.descriptor.packageKey
      || operation.payloadArtifactId !== value.descriptor.artifact.id)) {
    context.addIssue({ code: 'custom', message: 'broker authority requires one exact native check/apply/verify operation triplet' });
  }
  const expected = new Map<string, { sha256: string; sizeBytes: number }>([
    [value.descriptor.artifact.id, value.descriptor.artifact],
    [value.descriptor.metadataProof.inRelease.artifactId, value.descriptor.metadataProof.inRelease],
    [value.descriptor.metadataProof.inRelease.keyring.artifactId, value.descriptor.metadataProof.inRelease.keyring],
    [value.descriptor.metadataProof.packagesIndex.artifactId, value.descriptor.metadataProof.packagesIndex],
  ]);
  if (expected.size !== 4 || new Set(value.artifacts.map(item => item.artifactId)).size !== 4) {
    context.addIssue({ code: 'custom', message: 'broker authority requires four unique signed release artifacts' });
  }
  for (const artifact of value.artifacts) {
    const authority = expected.get(artifact.artifactId);
    if (!authority || authority.sha256 !== artifact.sha256 || authority.sizeBytes !== artifact.sizeBytes) {
      context.addIssue({ code: 'custom', message: `broker artifact differs from descriptor authority: ${artifact.artifactId}` });
    }
  }
});

export type PrivilegedBrokerExecutionAuthority = z.infer<typeof PrivilegedBrokerExecutionAuthoritySchema>;

export function privilegedBrokerExecutionAuthorityDigest(value: unknown): string {
  return privilegedBrokerDigest(PrivilegedBrokerExecutionAuthoritySchema.parse(value));
}

export function privilegedBrokerDescriptorDigest(value: unknown): string {
  return privilegedBrokerDigest(NativeOfflinePayloadDescriptorSchema.parse(value));
}
