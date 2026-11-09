#!/usr/bin/env node
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { CompensationRecordSchema, DesiredStateInputSchema, ExecutionPolicySchema, HostFactsSchema, ImmutableArtifactDescriptorSchema, NativeOfflinePayloadDescriptorSchema, NormalizedPlanSchema, TaskNodeSchema } from './contracts.js';
import type { InstallerEvent, TaskNode } from './contracts.js';
import { createInstallerEngine, deriveBoundNormalizedPlan } from './engine.js';
import { InstallerOperationError } from './engine.js';
import type { Inspection, InstallerAdapter, InstallerRunResult, TaskExecutionContext, Verification } from './engine.js';
import { RendererModeSchema, createRendererSession } from './renderers.js';
import { createTerminalController } from './terminal-controller.js';
import { createProtectedRendererSpillLog } from './renderer-spill-log.js';
import type { ProtectedRendererSpillLog } from './renderer-spill-log.js';
import { runProcess } from './process-runner.js';
import { executeSudoCredentialCleanup } from './sudo-credential-cleanup.js';
import { JournalIntegrityError, LiveOwnerError, createJournalStore } from './journal.js';
import { resolvePlatformProcessIdentity } from './process-identity.js';
import { applyOfflineBundle, createOfflineBundle, planOfflineBundle, verifyOfflineBundle } from './offline-bundle.js';
import { NativePackageOperationSchema, NativeServiceOperationSchema, validateOfflineExecutionClosure } from './offline-execution.js';
import type { NativePackageRuntime } from './offline-execution.js';
import { executeOfflineBundle } from './offline-orchestrator.js';
import { createDefaultDebianMetadataVerifier } from './debian-gpgv.js';
import { createTrustedDebianVersionComparator } from './debian-version.js';
import { createNativeDpkgTransactionRuntime } from './native-dpkg-transaction.js';
import { collectLinuxOfflineHostFacts } from './linux-host-facts.js';
import { LoadPlanInputSchema, LoadPlanItemSchema, LoadPlanReportSchema, buildLoadPlan, calculateLoadPlanReportDigest } from './lazy-plan.js';
import { composeSelectedNativeDebianPackageSlice } from './native-debian-composition.js';
import { composeSelectedNativeSystemdService } from './native-service-composition.js';
import { composeArtifactLegacyCutover, derivePlannedArtifactOperations, preparePlannedArtifact } from './planned-artifact.js';
import { CaskLauncherOperationSchema, composeSelectedCaskLaunchers } from './cask-launcher-composition.js';
import { FlatpakLauncherOperationSchema, composeSelectedFlatpakLaunchers, flatpakLauncherCandidate } from './flatpak-launcher-composition.js';
import { fetchImmutableArtifact } from './immutable-artifact.js';
import { createRollbackPlan } from './rollback.js';
import { RollbackEvidenceError, RollbackLiveOwnerError, createRollbackRunStore } from './rollback-journal.js';
import { discoverNativeServiceStateAdapters } from './service-state-adapters.js';
import type { ServiceStateAdapter, ServiceStateSnapshot } from './config-transaction.js';
import { applyConfigurationTransaction, applyManagedDirectoryTransaction, configurationCompensationArtifactDigest } from './config-transaction.js';
import { TelemetryExportConfigSchema } from './telemetry.js';
import type { TelemetryTransport } from './telemetry.js';
import { PrivilegedBrokerDerivationInputSchema, derivePrivilegedBrokerAuthority } from './privileged-broker-derivation.js';
import { PrivilegedBrokerServiceDerivationInputSchema, derivePrivilegedBrokerServiceAuthority } from './privileged-broker-service-derivation.js';
import { PrivilegedBrokerClientConfigSchema, createPrivilegedBrokerNativeRuntime, createPrivilegedBrokerServiceRuntime } from './privileged-broker-client.js';
import { PrivilegedBrokerServiceDescriptorSchema, privilegedBrokerDescriptorDigest } from './privileged-broker-authority.js';
import { openVerifiedArtifactSnapshot } from './verified-artifact-materializer.js';
import { createBrokerApprovalTransport } from './broker-approval-transport.js';
import { BrokerApprovalBootstrapBindingSchema, BrokerApprovalPollPolicySchema, orchestrateBrokerApproval } from './broker-approval-orchestrator.js';
import { PrivilegedBrokerGrantSchema } from './privileged-broker-protocol.js';
import { ProtectedAuthorizationState, TargetDeviceAuthorization } from './target-device-authorization.js';
import { createTargetAuthorizationHttpTransport } from './target-device-authorization-http.js';
import { ProtectedDeviceCredentialStore } from './target-device-credential.js';
import { fetchProfileDesiredState } from './profile-desired-state.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const argument = z.string().max(4096).refine(value => !value.includes('\0'), 'arguments cannot contain NUL');
const environmentName = z.string().min(1).max(128).regex(/^[A-Z][A-Z0-9_]*$/);
const environmentValue = z.string().max(4096).refine(value => !value.includes('\0'), 'environment values cannot contain NUL');

class CliUsageError extends Error {
  constructor(message: string) { super(message); this.name = 'CliUsageError'; }
}

type CliPhase = 'parse' | 'preflight' | 'execute' | 'record';
type MutationRisk = 'none' | 'possible';

function classifyCliFailure(error: unknown, phase: CliPhase, mutation: MutationRisk): { readonly code: number; readonly label: string } {
  const message = error instanceof Error ? error.message : 'unknown engine failure';
  if (error instanceof CliUsageError || error instanceof z.ZodError || phase === 'parse'
    || /exact (?:derived )?(?:plan |manifest )?approval|approval of the exact|approved plan digest/i.test(message)) {
    return { code: 2, label: 'invalid invocation' };
  }
  if (error instanceof LiveOwnerError || error instanceof RollbackLiveOwnerError
    || /requires (?:absent|released uncommitted|uncommitted) evidence|target changed after installation|already has a live owner/i.test(message)) {
    return { code: 3, label: 'precondition failed' };
  }
  if (error instanceof JournalIntegrityError || error instanceof RollbackEvidenceError || phase === 'preflight') {
    return { code: 4, label: 'integrity verification failed' };
  }
  if (mutation === 'possible') return { code: 8, label: 'execution outcome uncertain; inspect or resume evidence' };
  return { code: 7, label: 'execution failed' };
}
const ProcessOperationSchema = z.strictObject({
  kind: z.literal('process').optional(),
  argv: z.array(argument).min(1).max(128),
  env: z.record(environmentName, environmentValue).optional().refine(value => !value || Object.keys(value).length <= 128, 'too many operation environment values'),
  verifiedExecutable: z.strictObject({
    argvIndex: z.number().int().min(0).max(127),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).optional(),
});
const canonicalBase64 = z.string().min(1).max(87_384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(value => Buffer.from(value, 'base64').length <= 65_536, 'managed file candidate exceeds 64 KiB')
  .refine(value => Buffer.from(value, 'base64').toString('base64') === value, 'managed file candidate must use canonical base64');
const ManagedFileOperationSchema = z.strictObject({
  kind: z.literal('managed-file'),
  action: z.enum(['check', 'apply', 'verify']),
  targetPath: z.string().min(1).max(4096).refine(isAbsolute, 'managed file target must be absolute'),
  candidateBase64: canonicalBase64,
  candidateMode: z.number().int().min(0).max(0o777)
    .refine(mode => (mode & 0o400) !== 0 && (mode & 0o022) === 0, 'managed file mode must be owner-readable and not group/world-writable'),
});
const ManagedDirectoryOperationSchema = z.strictObject({
  kind: z.literal('managed-directory'),
  action: z.enum(['check', 'apply', 'verify']),
  targetPath: z.string().min(1).max(4096).refine(isAbsolute, 'managed directory target must be absolute')
    .refine(path => resolve(path) === path && dirname(path) !== path, 'managed directory target must be normalized and non-root'),
  candidateMode: z.literal(0o700),
});
const SudoCredentialCleanupOperationSchema = z.strictObject({
  kind: z.literal('sudo-credential-cleanup'),
  action: z.enum(['check', 'apply', 'verify']),
  sudoPath: z.enum(['/usr/bin/sudo', '/bin/sudo']),
  digestKind: z.enum(['content-sha256', 'stat-identity-sha256']),
  sudoSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sudoPreexisting: z.boolean(),
});
const ManagedArtifactOperationSchema = z.strictObject({
  kind: z.literal('managed-artifact'),
  action: z.enum(['check', 'apply', 'verify']),
  candidatePath: z.string().min(1).max(4096).refine(isAbsolute, 'managed artifact candidate must be absolute'),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  candidateSizeBytes: z.number().int().min(1).max(67_108_864),
  targetPath: z.string().min(1).max(4096).refine(isAbsolute, 'managed artifact target must be absolute'),
  candidateMode: z.literal(0o700),
  descriptor: ImmutableArtifactDescriptorSchema.optional(),
  authority: z.strictObject({
    loadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
    descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
}).superRefine((operation, context) => {
  if (resolve(operation.candidatePath) === resolve(operation.targetPath)) {
    context.addIssue({ code: 'custom', message: 'managed artifact candidate and target must be distinct paths' });
  }
});
const OperationSchema = z.union([ManagedFileOperationSchema, ManagedDirectoryOperationSchema, ManagedArtifactOperationSchema,
  CaskLauncherOperationSchema, FlatpakLauncherOperationSchema,
  SudoCredentialCleanupOperationSchema, NativePackageOperationSchema, NativeServiceOperationSchema, ProcessOperationSchema]);
const PlanDraftSchema = z.strictObject({
  tasks: z.array(TaskNodeSchema).max(10_000),
  selectedTaskIds: z.array(identifier).max(10_000).refine(values => new Set(values).size === values.length, 'duplicate selected task identifiers'),
  executionPolicy: ExecutionPolicySchema.default({ maxConcurrency: 4, resourceLimits: { cpu: 64, memoryMiB: 1_048_576, networkConcurrency: 16 } }),
});
const common = {
  schemaVersion: z.literal(1),
  runId: identifier,
  releaseId: identifier,
  facts: HostFactsSchema,
  desiredState: DesiredStateInputSchema,
  plan: PlanDraftSchema,
  operations: z.record(identifier, OperationSchema).refine(value => Object.keys(value).length <= 30_000, 'too many operations'),
};
const PrivilegedBrokerPackageRunBindingSchema = z.strictObject({
  client: PrivilegedBrokerClientConfigSchema,
  descriptor: NativeOfflinePayloadDescriptorSchema,
  payload: z.strictObject({
    sourcePath: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value, 'broker payload path must be canonical and absolute'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(268_435_456),
    mode: z.literal('0600'),
  }),
});
const PrivilegedBrokerServiceRunBindingSchema = z.strictObject({
  kind: z.literal('native-service'), client: PrivilegedBrokerClientConfigSchema,
  descriptor: PrivilegedBrokerServiceDescriptorSchema,
});
const PrivilegedBrokerRunBindingSchema = z.union([PrivilegedBrokerPackageRunBindingSchema, PrivilegedBrokerServiceRunBindingSchema]);
const ReadOnlyInvocationSchema = z.strictObject({ ...common, command: z.enum(['discover', 'validate', 'plan']) });
const RunInvocationSchema = z.strictObject({
  ...common, command: z.literal('run'), approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/), renderer: RendererModeSchema,
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
  telemetry: TelemetryExportConfigSchema.optional(),
  privilegedBroker: PrivilegedBrokerRunBindingSchema.optional(),
});
const ResumeInvocationSchema = z.strictObject({
  ...common, command: z.literal('resume'), planDigest: z.string().regex(/^[a-f0-9]{64}$/), renderer: RendererModeSchema,
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
  telemetry: TelemetryExportConfigSchema.optional(),
  privilegedBroker: PrivilegedBrokerRunBindingSchema.optional(),
});
const StatusInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('status'), runId: identifier, renderer: RendererModeSchema,
  plan: NormalizedPlanSchema, approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.record(identifier, OperationSchema).refine(value => Object.keys(value).length <= 30_000, 'too many operations'),
});
const EvidenceInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('evidence-verify'), runId: identifier,
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
});
const TaskEvidenceInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('task-evidence'), runId: identifier,
  planDigest: z.string().regex(/^[a-f0-9]{64}$/), taskId: identifier,
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
});
const RunsListInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('runs-list'),
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
});
const BrokerApprovalClaimInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('broker-approval-claim'),
  origin: z.string().url(),
  tokenPath: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value,
    'device token path must be canonical and absolute'),
  grant: PrivilegedBrokerGrantSchema,
  bootstrapBinding: BrokerApprovalBootstrapBindingSchema,
  poll: BrokerApprovalPollPolicySchema.optional(),
});
const privateStatePath = z.string().min(1).max(4096)
  .refine(value => isAbsolute(value) && resolve(value) === value, 'device authorization path must be canonical and absolute');
const targetAuthorizationBase = {
  schemaVersion: z.literal(1), origin: z.string().url(), statePath: privateStatePath,
};
const DeviceAuthorizationStartInvocationSchema = z.strictObject({
  ...targetAuthorizationBase, command: z.literal('device-authorization-start'),
  credentialPath: privateStatePath,
  profileId: identifier, machineLabel: z.string().min(1).max(128),
  scopes: z.array(z.string().min(1).max(128)
    .regex(/^[a-z][a-z0-9.-]*(?::[a-z][a-z0-9.-]*)?$/)).min(1).max(64),
  expiresAt: z.string().datetime({ offset: true }).max(64),
});
const DeviceAuthorizationStatusInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('device-authorization-status'),
  statePath: privateStatePath, credentialPath: privateStatePath,
});
const DeviceAuthorizationWaitInvocationSchema = z.strictObject({
  ...targetAuthorizationBase, command: z.literal('device-authorization-wait'), credentialPath: privateStatePath,
});
const DeviceAuthorizationCancelInvocationSchema = z.strictObject({
  ...targetAuthorizationBase, command: z.literal('device-authorization-cancel'),
  reason: z.string().min(1).max(64).regex(/^[a-z][a-z0-9.-]*$/).optional(),
});
const ProfileDesiredStateSyncInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('profile-desired-state-sync'),
  origin: z.string().url(), credentialPath: privateStatePath, environmentPath: privateStatePath,
  expectedProfileId: identifier, expectedProfileDigest: z.string().regex(/^[a-f0-9]{64}$/), machineId: identifier,
});
const bundlePlatform = z.strictObject({
  os: z.enum(['linux', 'darwin', 'win32']), arch: z.enum(['x64', 'arm64']),
  environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']),
});
const bundleTrust = z.strictObject({
  keyId: identifier,
  publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
});
const bundleExpected = z.strictObject({
  releaseId: identifier, planDigest: z.string().regex(/^[a-f0-9]{64}$/), platform: bundlePlatform,
  selectedTaskIds: z.array(identifier).min(1).max(10_000), artifactIds: z.array(identifier).min(1).max(4096),
});
const bundleCatalogDescriptor = z.discriminatedUnion('kind', [
  ImmutableArtifactDescriptorSchema.extend({ kind: z.literal('immutable-executable').default('immutable-executable') }),
  NativeOfflinePayloadDescriptorSchema,
]);
const BundleCreateInvocationSchema = z.strictObject({
  schemaVersion: z.literal(2), command: z.literal('bundle-create'),
  outputRoot: z.string().min(1).max(4096).refine(isAbsolute, 'output root must be absolute'),
  releaseId: identifier, planDigest: z.string().regex(/^[a-f0-9]{64}$/), graphDigest: z.string().regex(/^[a-f0-9]{64}$/),
  platform: bundlePlatform, selectedTaskIds: z.array(identifier).min(1).max(10_000),
  createdAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  signer: z.strictObject({
    keyId: identifier, privateKeyPath: z.string().min(1).max(4096).refine(isAbsolute, 'private key path must be absolute'),
  }),
  releaseTrust: bundleTrust,
  artifacts: z.array(z.strictObject({
    id: identifier, sourcePath: z.string().min(1).max(4096).refine(isAbsolute, 'artifact source path must be absolute'),
    mediaType: z.string().min(1).max(128), mode: z.enum(['0600', '0700']),
    license: z.string().min(1).max(128),
    schema: z.strictObject({ id: identifier, version: z.string().min(1).max(64) }).nullable(),
    catalogDescriptor: bundleCatalogDescriptor.nullable().optional(),
    containsSecrets: z.literal(false),
  })).min(1).max(4096),
  maxArtifactBytes: z.number().int().positive().max(268_435_456).optional(),
  maxTotalBytes: z.number().int().positive().max(1_073_741_824).optional(),
});
const BundleVerifyInvocationSchema = z.strictObject({
  schemaVersion: z.literal(2), command: z.literal('bundle-verify'),
  bundleDirectory: z.string().min(1).max(4096).refine(isAbsolute, 'bundle directory must be absolute'), trust: bundleTrust, releaseTrust: bundleTrust,
});
const BundlePlanInvocationSchema = z.strictObject({
  schemaVersion: z.literal(2), command: z.literal('bundle-plan'),
  bundleDirectory: z.string().min(1).max(4096).refine(isAbsolute, 'bundle directory must be absolute'),
  trust: bundleTrust, releaseTrust: bundleTrust, expected: bundleExpected, now: z.string().datetime({ offset: true }).optional(),
});
const BundleApplyInvocationSchema = z.strictObject({
  schemaVersion: z.literal(2), command: z.literal('bundle-apply'),
  bundleDirectory: z.string().min(1).max(4096).refine(isAbsolute, 'bundle directory must be absolute'),
  destinationDirectory: z.string().min(1).max(4096).refine(isAbsolute, 'destination directory must be absolute'),
  trust: bundleTrust, releaseTrust: bundleTrust, expected: bundleExpected, now: z.string().datetime({ offset: true }).optional(),
  approvedManifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  offline: z.literal(true), networkPolicy: z.literal('deny'),
});
const offlineExecution = {
  schemaVersion: z.literal(2), runId: identifier,
  bundleDirectory: z.string().min(1).max(4096).refine(isAbsolute, 'bundle directory must be absolute'),
  materializedRoot: z.string().min(1).max(4096).refine(isAbsolute, 'materialized root must be absolute'),
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
  trust: bundleTrust, releaseTrust: bundleTrust, expected: bundleExpected,
  approvedManifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  renderer: RendererModeSchema, offline: z.literal(true), networkPolicy: z.literal('deny'),
};
const OfflineExecuteInvocationSchema = z.strictObject({ ...offlineExecution, command: z.literal('bundle-execute') });
const OfflineResumeInvocationSchema = z.strictObject({ ...offlineExecution, command: z.literal('bundle-resume') });
const rollbackSource = {
  schemaVersion: z.literal(1),
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
  sourceRunId: identifier,
  sourcePlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
const RollbackPlanInvocationSchema = z.strictObject({ ...rollbackSource, command: z.literal('rollback-config-plan') });
const rollbackExecution = {
  ...rollbackSource, rollbackRunId: identifier,
  approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
const RollbackExecuteInvocationSchema = z.strictObject({ ...rollbackExecution, command: z.literal('rollback-config-execute') });
const RollbackResumeInvocationSchema = z.strictObject({ ...rollbackExecution, command: z.literal('rollback-config-resume') });
const RollbackStatusInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('rollback-config-status'), rollbackRunId: identifier,
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  stateRoot: z.string().min(1).max(4096).refine(isAbsolute, 'state root must be absolute'),
});
const LoadPlanInvocationSchema = LoadPlanInputSchema.extend({ command: z.literal('load-plan') }).strict();
const NativeDebianWitnessSchema = z.strictObject({
  kind: z.literal('preexisting-witness'), manager: z.literal('dpkg'), packageName: z.literal('libc6'),
  version: z.string().min(1).max(128), architecture: z.literal('amd64'), status: z.literal('installed'),
  healthy: z.literal(true), held: z.literal(false),
});
const NativeDebianDeriveInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('native-debian-derive'),
  loadPlan: LoadPlanReportSchema,
  approvedLoadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  packageKey: z.literal('tree'),
  target: z.strictObject({
    distroId: z.literal('debian'), versionId: z.literal('12'), codename: z.literal('bookworm'), architecture: z.literal('amd64'),
  }),
  installedWitnesses: z.array(NativeDebianWitnessSchema).length(1),
  desiredState: DesiredStateInputSchema,
  legacyPackages: z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9.+-]*(?::[a-z0-9][a-z0-9-]*)?$/)).max(4096),
});
const NativeServiceDeriveInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('native-service-derive'),
  loadPlan: LoadPlanReportSchema, approvedLoadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  serviceKey: z.literal('alloy'),
  legacyServices: z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/)).max(1024),
});
const CaskLauncherDeriveInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('cask-launcher-derive'),
  loadPlan: LoadPlanReportSchema, approvedLoadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  homeDirectory: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value,
    'home directory must be canonical and absolute'),
  legacyPackages: z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/)).max(4096),
});
const FlatpakLauncherDeriveInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('flatpak-launcher-derive'),
  loadPlan: LoadPlanReportSchema, approvedLoadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  homeDirectory: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value,
    'home directory must be canonical and absolute'),
  legacyPackages: z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/)).max(4096),
  flatpakExecutable: z.strictObject({
    path: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value,
      'Flatpak executable path must be canonical and absolute'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
const PrivilegedBrokerAuthorityDeriveInvocationSchema = PrivilegedBrokerDerivationInputSchema
  .extend({ command: z.literal('privileged-broker-authority-derive') });
const PrivilegedBrokerServiceAuthorityDeriveInvocationSchema = PrivilegedBrokerServiceDerivationInputSchema
  .extend({ command: z.literal('privileged-broker-service-authority-derive') });
const artifactAuthority = {
  loadPlan: LoadPlanReportSchema,
  items: z.array(LoadPlanItemSchema).max(4096),
  approvedLoadPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  host: z.strictObject({ os: z.enum(['linux', 'darwin', 'win32']), arch: z.enum(['x64', 'arm64']) }),
  cacheRoot: z.string().min(1).max(4096).refine(isAbsolute, 'artifact cache root must be absolute'),
  destinationRoots: z.strictObject({
    'user-bin': z.string().min(1).max(4096).refine(isAbsolute, 'user bin root must be absolute').optional(),
    'docker-cli-plugin': z.string().min(1).max(4096).refine(isAbsolute, 'Docker plugin root must be absolute').optional(),
  }),
};
const ArtifactDeriveInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.literal('artifact-derive'), ...artifactAuthority,
  legacyPackages: z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/)).max(4096),
});
const ArtifactPrepareInvocationSchema = z.strictObject({
  ...common, command: z.literal('artifact-prepare'), ...artifactAuthority,
  items: z.array(LoadPlanItemSchema).min(1).max(4096),
  approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/), offline: z.boolean().optional(),
});
const InvocationSchema = z.discriminatedUnion('command', [
  ReadOnlyInvocationSchema, RunInvocationSchema, ResumeInvocationSchema, StatusInvocationSchema, EvidenceInvocationSchema, TaskEvidenceInvocationSchema, RunsListInvocationSchema,
  BundleCreateInvocationSchema, BundleVerifyInvocationSchema, BundlePlanInvocationSchema, BundleApplyInvocationSchema,
  OfflineExecuteInvocationSchema, OfflineResumeInvocationSchema,
  RollbackPlanInvocationSchema, RollbackExecuteInvocationSchema, RollbackResumeInvocationSchema, RollbackStatusInvocationSchema,
  LoadPlanInvocationSchema, NativeDebianDeriveInvocationSchema, NativeServiceDeriveInvocationSchema, CaskLauncherDeriveInvocationSchema,
  FlatpakLauncherDeriveInvocationSchema, PrivilegedBrokerAuthorityDeriveInvocationSchema,
  PrivilegedBrokerServiceAuthorityDeriveInvocationSchema,
  ArtifactDeriveInvocationSchema, ArtifactPrepareInvocationSchema,
  BrokerApprovalClaimInvocationSchema,
  DeviceAuthorizationStartInvocationSchema, DeviceAuthorizationStatusInvocationSchema,
  DeviceAuthorizationWaitInvocationSchema, DeviceAuthorizationCancelInvocationSchema,
  ProfileDesiredStateSyncInvocationSchema,
]);
type Invocation = z.infer<typeof InvocationSchema>;
type OperationInvocation = Extract<Invocation, { command: 'discover' | 'validate' | 'plan' | 'run' | 'resume' | 'status' }>;
type PlanBindingInvocation = Exclude<Extract<Invocation, { plan: unknown; operations: unknown }>,
  { command: 'privileged-broker-authority-derive' | 'privileged-broker-service-authority-derive' }>;

async function presentRun(input: {
  readonly rendererMode: z.infer<typeof RendererModeSchema>;
  readonly runId: string;
  readonly stateRoot?: string;
  readonly execute: (signal: AbortSignal, observer: (event: InstallerEvent) => void) => Promise<InstallerRunResult>;
}): Promise<InstallerRunResult> {
  const controller = new AbortController();
  const cancel = (): void => { if (!controller.signal.aborted) controller.abort(new Error('process signal')); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let outputBackpressured = false;
  let spillLog: ProtectedRendererSpillLog | undefined;
  let spillCreationFailure: unknown;
  if (input.stateRoot) {
    const spillRunId = `${input.runId.slice(0, 90)}.${randomUUID()}`;
    try { spillLog = createProtectedRendererSpillLog({ stateRoot: input.stateRoot, runId: spillRunId }); }
    catch (error) { spillCreationFailure = error; }
  }
  const renderer = createRendererSession(input.rendererMode, chunk => {
    if (outputBackpressured) return false;
    const ready = process.stdout.write(chunk);
    if (!ready) outputBackpressured = true;
    return true;
  }, {}, {
    interactiveTui: input.rendererMode === 'tui'
      && process.stdin.isTTY === true
      && process.stdout.isTTY === true
      && process.env.TERM !== 'dumb',
  }, input.stateRoot ? chunk => {
    if (spillCreationFailure !== undefined) throw spillCreationFailure;
    return spillLog?.append(chunk) ?? false;
  } : undefined);
  const onDrain = (): void => {
    outputBackpressured = false;
    renderer.resumeDelivery();
  };
  process.stdout.on('drain', onDrain);
  const terminal = input.rendererMode === 'tui' ? createTerminalController({
    onIntent: intent => {
      renderer.handleIntent(intent);
      if (intent === 'cancel') cancel();
      if (intent === 'toggle-follow') renderer.updateProjectionOptions({ follow: !renderer.projectionOptions.follow });
      if (intent === 'clear-filter') renderer.updateProjectionOptions({ logFilter: '' });
    },
    onCancel: cancel,
    onWidth: width => renderer.updateProjectionOptions({ width }),
    onHeight: height => renderer.updateProjectionOptions({ height }),
    onFilter: logFilter => renderer.updateProjectionOptions({ logFilter }),
  }) : undefined;
  try {
    const result = await input.execute(controller.signal, event => renderer.onEvent(event));
    renderer.finish(result);
    return result;
  } finally {
    terminal?.close();
    renderer.close();
    try { spillLog?.close(); } catch { /* Presentation evidence must not alter engine semantics. */ }
    process.stdout.removeListener('drain', onDrain);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function assertManagedArtifactGraph(invocation: PlanBindingInvocation): void {
  const selected = new Set(invocation.plan.selectedTaskIds);
  const directoryTasks = invocation.plan.tasks.filter(task => selected.has(task.id) && Object.values(task.operations).length === 3
    && Object.values(task.operations).every(operationId => invocation.operations[operationId]?.kind === 'managed-directory'));
  for (const task of invocation.plan.tasks.filter(candidate => selected.has(candidate.id))) {
    const artifactOperations = Object.values(task.operations).map(operationId => invocation.operations[operationId])
      .filter((operation): operation is z.infer<typeof ManagedArtifactOperationSchema> => operation?.kind === 'managed-artifact');
    if (artifactOperations.length === 0) continue;
    const operation = artifactOperations[0]!;
    if (!operation.descriptor) continue; // Compatibility for already-prepared legacy operation manifests.
    const descriptorDigest = createHash('sha256').update(JSON.stringify(canonical(operation.descriptor))).digest('hex');
    if (descriptorDigest !== operation.authority.descriptorDigest
      || operation.descriptor.source.sha256 !== operation.candidateSha256
      || operation.descriptor.source.sizeBytes !== operation.candidateSizeBytes
      || basename(operation.candidatePath) !== operation.candidateSha256
      || basename(operation.targetPath) !== operation.descriptor.destination.filename
      || ('facts' in invocation && (operation.descriptor.platform.os !== invocation.facts.os
        || operation.descriptor.platform.arch !== invocation.facts.arch))) {
      usageError(`managed artifact descriptor authority is inconsistent: ${task.id}`);
    }
    for (const root of [dirname(operation.candidatePath), dirname(operation.targetPath)]) {
      const owners = directoryTasks.filter(directoryTask => Object.values(directoryTask.operations).every(operationId => {
        const directory = invocation.operations[operationId];
        return directory?.kind === 'managed-directory' && directory.targetPath === root;
      }));
      if (owners.length !== 1 || !task.dependencies.includes(owners[0]!.id)) {
        usageError(`managed artifact task ${task.id} requires one selected managed-directory dependency for ${root}`);
      }
    }
  }
}

function bindOperationsToPlan(invocation: PlanBindingInvocation): z.infer<typeof PlanDraftSchema> {
  if (!('plan' in invocation)) throw new Error('invocation cannot create a plan');
  assertManagedArtifactGraph(invocation);
  return {
    ...structuredClone(invocation.plan),
    tasks: invocation.plan.tasks.map(task => {
      const referencedOperations = Object.fromEntries(Object.entries(task.operations).map(([phase, operationId]) => {
        const operation = invocation.operations[operationId];
        if (!operation) throw new Error(`operation is not registered: ${operationId}`);
        if (operation.kind === 'managed-file' || operation.kind === 'managed-directory' || operation.kind === 'managed-artifact'
          || operation.kind === 'managed-cask-launcher' || operation.kind === 'managed-flatpak-launcher') {
          const label = operation.kind.replace('-', ' ');
          if (task.compensation !== 'configuration') usageError(`${label} task must declare configuration compensation: ${task.id}`);
          if (operation.action !== phase) usageError(`${label} operation phase mismatch: ${operationId}`);
        }
        if (operation.kind === 'sudo-credential-cleanup' && operation.action !== phase) {
          usageError(`sudo credential cleanup operation phase mismatch: ${operationId}`);
        }
        const approvalOperation = structuredClone(operation);
        if (approvalOperation.kind === 'managed-artifact') {
          if ('facts' in invocation && invocation.facts.os === 'win32') usageError('managed artifact activation is unsupported on win32');
          approvalOperation.candidatePath = `sha256:${approvalOperation.candidateSha256}`;
        }
        if ('verifiedExecutable' in approvalOperation && approvalOperation.verifiedExecutable) {
          const { argvIndex, sha256 } = approvalOperation.verifiedExecutable;
          if (argvIndex >= approvalOperation.argv.length) throw new Error(`verified executable index is outside operation argv: ${operationId}`);
          approvalOperation.argv[argvIndex] = `sha256:${sha256}`;
        }
        return [phase, { id: operationId, ...approvalOperation }];
      }));
      const managedOperations = Object.values(referencedOperations)
        .filter(operation => operation.kind === 'managed-file' || operation.kind === 'managed-directory'
          || operation.kind === 'managed-artifact' || operation.kind === 'managed-cask-launcher'
          || operation.kind === 'managed-flatpak-launcher');
      if (managedOperations.length > 0) {
        if (managedOperations.length !== 3) usageError(`managed configuration task cannot mix operation kinds: ${task.id}`);
        const [first] = managedOperations;
        if (!first || managedOperations.some(operation => operation.kind !== first.kind
          || operation.targetPath !== first.targetPath || operation.candidateMode !== first.candidateMode
          || (operation.kind === 'managed-file' && first.kind === 'managed-file' && operation.candidateBase64 !== first.candidateBase64)
          || (operation.kind === 'managed-cask-launcher' && first.kind === 'managed-cask-launcher'
            && (operation.packageKey !== first.packageKey || operation.appBundle !== first.appBundle
              || JSON.stringify(canonical(operation.appPaths)) !== JSON.stringify(canonical(first.appPaths))
              || operation.policy !== first.policy))
          || (operation.kind === 'managed-flatpak-launcher' && first.kind === 'managed-flatpak-launcher'
            && (operation.packageKey !== first.packageKey || operation.appId !== first.appId
              || operation.flatpakPath !== first.flatpakPath || operation.flatpakSha256 !== first.flatpakSha256
              || operation.homeDirectory !== first.homeDirectory || operation.policy !== first.policy))
          || (operation.kind === 'managed-artifact' && first.kind === 'managed-artifact'
            && (operation.candidateSha256 !== first.candidateSha256 || operation.candidateSizeBytes !== first.candidateSizeBytes
              || JSON.stringify(canonical(operation.descriptor)) !== JSON.stringify(canonical(first.descriptor))
              || operation.authority.loadPlanDigest !== first.authority.loadPlanDigest
              || operation.authority.descriptorDigest !== first.authority.descriptorDigest)))) {
          usageError(`managed configuration task operations must bind identical target, candidate, and mode: ${task.id}`);
        }
      }
      const sudoCleanupOperations = Object.values(referencedOperations)
        .filter(operation => operation.kind === 'sudo-credential-cleanup');
      if (sudoCleanupOperations.length > 0) {
        if (task.id !== 'system.sudo-credential-cleanup' || task.lifecycle !== 'run-finalizer'
          || task.compensation !== 'none' || sudoCleanupOperations.length !== 3) {
          usageError('sudo credential cleanup requires one non-compensating run-finalizer triplet');
        }
        const first = sudoCleanupOperations[0]!;
        if (sudoCleanupOperations.some(operation => operation.sudoPath !== first.sudoPath
          || operation.digestKind !== first.digestKind || operation.sudoSha256 !== first.sudoSha256 || operation.sudoPreexisting !== first.sudoPreexisting)) {
          usageError('sudo credential cleanup operations must bind identical executable and preexisting authority');
        }
      }
      const inputDigest = createHash('sha256').update(JSON.stringify(canonical({
        taskInputDigest: task.inputDigest,
        operations: referencedOperations,
      }))).digest('hex');
      return { ...task, inputDigest };
    }),
  };
}

async function deriveArtifactBatch(invocation: z.infer<typeof ArtifactDeriveInvocationSchema> | z.infer<typeof ArtifactPrepareInvocationSchema>) {
  if (new Set(invocation.items.map(item => item.name)).size !== invocation.items.length) {
    usageError('artifact batch contains duplicate load-plan items');
  }
  const derived: Awaited<ReturnType<typeof derivePlannedArtifactOperations>>[] = [];
  for (let offset = 0; offset < invocation.items.length; offset += 8) {
    derived.push(...await Promise.all(invocation.items.slice(offset, offset + 8).map(item => derivePlannedArtifactOperations({
      loadPlan: invocation.loadPlan, item, approvedLoadPlanDigest: invocation.approvedLoadPlanDigest,
      host: invocation.host, cacheRoot: invocation.cacheRoot, destinationRoots: invocation.destinationRoots,
    }))));
  }
  return derived;
}

function assertPreparedArtifactClosure(
  invocation: z.infer<typeof ArtifactPrepareInvocationSchema>,
  derived: readonly Awaited<ReturnType<typeof derivePlannedArtifactOperations>>[],
): void {
  const selected = new Set(invocation.plan.selectedTaskIds);
  const expected = new Map<string, string>();
  for (const item of derived) {
    for (const operation of Object.values(item.operations)) {
      const key = JSON.stringify(canonical(operation));
      if (expected.has(key)) usageError('artifact batch derives duplicate managed operations');
      expected.set(key, item.itemName);
    }
  }
  const matched = new Set<string>();
  const selectedArtifactTasks = new Set<string>();
  for (const task of invocation.plan.tasks) {
    for (const operationId of Object.values(task.operations)) {
      const operation = invocation.operations[operationId];
      if (operation?.kind !== 'managed-artifact') continue;
      if (!selected.has(task.id)) usageError(`managed artifact operation is not referenced by a selected task: ${operationId}`);
      const key = JSON.stringify(canonical(operation));
      if (!expected.has(key)) usageError(`surplus managed artifact operation is outside the approved artifact batch: ${operationId}`);
      if (matched.has(key)) usageError(`managed artifact operation is referenced more than once: ${operationId}`);
      matched.add(key);
      selectedArtifactTasks.add(task.id);
    }
  }
  if (matched.size !== expected.size) usageError('every expected managed artifact operation must be referenced by a selected task');
  for (const [operationId, operation] of Object.entries(invocation.operations)) {
    if (operation.kind === 'managed-artifact') {
      const referenced = invocation.plan.tasks.some(task => selectedArtifactTasks.has(task.id) && Object.values(task.operations).includes(operationId));
      if (!referenced) usageError(`unreferenced managed artifact operation is forbidden: ${operationId}`);
    }
  }
  for (const artifact of derived) {
    const artifactKeys = new Set(Object.values(artifact.operations).map(operation => JSON.stringify(canonical(operation))));
    const artifactTasks = invocation.plan.tasks.filter(task => selected.has(task.id)
      && Object.values(task.operations).every(operationId => {
        const operation = invocation.operations[operationId];
        return operation?.kind === 'managed-artifact' && artifactKeys.has(JSON.stringify(canonical(operation)));
      }));
    if (artifactTasks.length !== 1) usageError(`artifact ${artifact.itemName} must be owned by exactly one selected managed-artifact task`);
    const artifactTask = artifactTasks[0]!;
    for (const requirement of artifact.directoryRequirements.filter(candidate => !candidate.exists)) {
      const directoryTasks = invocation.plan.tasks.filter(task => selected.has(task.id)
        && Object.values(task.operations).length === 3
        && Object.values(task.operations).every(operationId => {
          const operation = invocation.operations[operationId];
          return operation?.kind === 'managed-directory'
            && operation.targetPath === requirement.targetPath
            && operation.candidateMode === requirement.targetMode;
        }));
      if (directoryTasks.length !== 1) {
        usageError(`absent ${requirement.kind} root requires exactly one selected managed-directory task: ${requirement.targetPath}`);
      }
      if (!artifactTask.dependencies.includes(directoryTasks[0]!.id)) {
        usageError(`artifact ${artifact.itemName} must depend on managed-directory task ${directoryTasks[0]!.id}`);
      }
    }
  }
}

function usageError(message: string): never {
  throw new CliUsageError(message);
}

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) usageError('expected --input <absolute-or-relative-json-path>');
  return resolve(argv[1]);
}

async function readInvocation(path: string): Promise<Invocation> {
  const inheritedInvocation = process.platform === 'linux' && path === '/proc/self/fd/4';
  const handle = await open(path, constants.O_RDONLY | (inheritedInvocation ? 0 : (constants.O_NOFOLLOW ?? 0)));
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > 1_048_576) {
      usageError('input must be a regular non-symlink JSON file between 2 bytes and 1 MiB');
    }
    if (process.platform !== 'win32') {
      const effectiveUserId = process.geteuid?.();
      if (effectiveUserId === undefined || metadata.uid !== effectiveUserId || (metadata.mode & 0o022) !== 0) {
        usageError('input must be owned by the current user and not writable by group or other');
      }
    }
    let input: unknown;
    try { input = JSON.parse(await handle.readFile('utf8')); }
    catch { usageError('input is not valid JSON'); }
    const parsed = InvocationSchema.safeParse(input);
    if (!parsed.success) usageError(z.prettifyError(parsed.error));
    return parsed.data;
  } finally {
    await handle.close();
  }
}

function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot',
    'CI', 'COLORTERM', 'DEBUG', 'DEBUG_MODE', 'FULL_NAME', 'HEADLESS_INSTALL', 'HOST', 'KEEP_GOING',
    'LANG', 'LC_ALL', 'NO_RESTART', 'PRIMARY_EMAIL', 'PUBLIC_SERVICES_DOMAIN', 'RESTRICTED_ENVIRONMENT',
    'START_REPO', 'TERM', 'WORK_ENVIRONMENT', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME',
    'XDG_DATA_HOME', 'XDG_STATE_HOME',
    'INSTALL_DOCTOR_CHEZMOI_SOURCE', 'INSTALL_DOCTOR_RELEASE_ID', 'INSTALL_DOCTOR_SOURCE_COMMIT',
  ] as const;
  return Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

const telemetryTransport: TelemetryTransport = async ({ endpoint, batch, signal }) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`telemetry collector returned HTTP ${response.status}`);
};

function baseAdapterFor(invocation: OperationInvocation, nativeBinding?: {
  readonly runtime: NativePackageRuntime;
  readonly descriptor: z.infer<typeof NativeOfflinePayloadDescriptorSchema>;
  readonly payload: z.infer<typeof PrivilegedBrokerPackageRunBindingSchema>['payload'];
}, serviceBinding?: {
  readonly runtime: ReturnType<typeof createPrivilegedBrokerServiceRuntime>;
  readonly descriptor: z.infer<typeof PrivilegedBrokerServiceDescriptorSchema>;
}): InstallerAdapter {
  const digestOpenFile = async (handle: Awaited<ReturnType<typeof open>>, size: number): Promise<string> => {
    if (!Number.isSafeInteger(size) || size < 1 || size > 16 * 1024 * 1024) {
      throw new Error('verified executable size is outside the 1 byte to 16 MiB boundary');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size));
    let position = 0;
    while (position < size) {
      const length = Math.min(buffer.length, size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error('verified executable changed or truncated while hashing');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  };
  const runSudoCredentialCommand = async (operation: z.infer<typeof SudoCredentialCleanupOperationSchema>,
    args: readonly string[], task: TaskNode, context?: TaskExecutionContext): Promise<number> => {
    if (process.platform === 'win32') throw new Error('sudo credential cleanup is unsupported on win32');
    if (operation.sudoPath !== '/usr/bin/sudo' && operation.sudoPath !== '/bin/sudo') throw new Error('sudo executable path is not allowed');
    const parent = dirname(operation.sudoPath);
    const parentMetadata = await lstat(parent);
    const canonicalParent = await realpath(parent);
    const uid = process.geteuid?.();
    if (uid === undefined || !parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()
      || resolve(canonicalParent) !== resolve(parent) || (parentMetadata.mode & 0o022) !== 0
      || parentMetadata.uid !== 0) {
      throw new Error('sudo executable parent directory is unsafe');
    }
    const before = await lstat(operation.sudoPath);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try { handle = await open(operation.sudoPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EACCES') throw error; }
      const metadata = handle ? await handle.stat() : before;
      if (!before.isFile() || before.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1
        || before.dev !== metadata.dev || before.ino !== metadata.ino || (metadata.mode & 0o111) === 0
        || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o4000) === 0 || metadata.uid !== 0) {
        throw new Error('sudo executable is not one executable single-linked regular file');
      }
      if ((handle && operation.digestKind !== 'content-sha256') || (!handle && operation.digestKind !== 'stat-identity-sha256')) {
        throw new Error('sudo executable digest kind does not match host readability');
      }
      const identityDigest = handle ? await digestOpenFile(handle, metadata.size) : createHash('sha256').update(JSON.stringify({
        dev: metadata.dev, ino: metadata.ino, size: metadata.size, mode: metadata.mode, uid: metadata.uid,
        mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs,
      })).digest('hex');
      if (identityDigest !== operation.sudoSha256) {
        throw new Error('sudo executable digest does not match the approved plan');
      }
      const after = await lstat(operation.sudoPath);
      if (!after.isFile() || after.isSymbolicLink() || after.dev !== metadata.dev || after.ino !== metadata.ino
        || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs || after.ctimeMs !== metadata.ctimeMs) {
        throw new Error('sudo executable identity changed during verification');
      }
      return await runProcess({
        argv: [operation.sudoPath, ...args],
        timeoutMs: task.timeoutMs, terminationGraceMs: 1_000, cwd: process.cwd(),
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        ...(context ? { signal: context.signal, onOutput: context.output } : {}),
      });
    } finally { await handle?.close(); }
  };
  const managedFileMatches = async (operation: z.infer<typeof ManagedFileOperationSchema>, path = operation.targetPath): Promise<boolean> => {
    let before;
    try { before = await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new Error('managed file target must be a single-linked regular file');
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const after = await handle.stat();
      if (!after.isFile() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino) {
        throw new Error('managed file target changed during verification');
      }
      const expected = Buffer.from(operation.candidateBase64, 'base64');
      const actual = await handle.readFile();
      return (after.mode & 0o777) === operation.candidateMode && actual.equals(expected);
    } finally {
      await handle.close();
    }
  };
  const resolveCaskLauncherCandidate = async (operation: z.infer<typeof CaskLauncherOperationSchema>): Promise<Buffer> => {
    if (process.platform !== 'darwin') throw new Error('managed cask launcher execution requires macOS');
    for (const appPath of operation.appPaths) {
      let metadata;
      try { metadata = await lstat(appPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new Error('cask application bundle cannot be inspected safely');
      }
      const canonicalPath = await realpath(appPath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || resolve(canonicalPath) !== resolve(appPath)
        || basename(appPath) !== operation.appBundle) {
        throw new Error('cask application bundle must be a canonical nonsymlink directory');
      }
      return Buffer.from(`#!/usr/bin/env bash\nopen ${JSON.stringify(appPath)} "$@"\n`, 'utf8');
    }
    throw new Error(`approved cask application bundle is unavailable: ${operation.packageKey}`);
  };
  const flatpakApplicationInstalled = async (operation: z.infer<typeof FlatpakLauncherOperationSchema>,
    context?: TaskExecutionContext): Promise<boolean> => {
    if (process.platform !== 'linux') throw new Error('managed Flatpak launcher execution requires Linux');
    const uid = process.geteuid?.();
    if (uid === undefined) throw new Error('Flatpak executable ownership cannot be proven');
    const parent = dirname(operation.flatpakPath);
    const parentMetadata = await lstat(parent);
    const canonicalParent = await realpath(parent);
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || resolve(canonicalParent) !== resolve(parent)
      || (parentMetadata.mode & 0o022) !== 0 || (parentMetadata.uid !== 0 && parentMetadata.uid !== uid)) {
      throw new Error('Flatpak executable parent directory is unsafe');
    }
    const before = await lstat(operation.flatpakPath);
    const handle = await open(operation.flatpakPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!before.isFile() || before.isSymbolicLink() || !opened.isFile() || opened.nlink !== 1
        || before.dev !== opened.dev || before.ino !== opened.ino || (opened.mode & 0o111) === 0
        || (opened.mode & 0o022) !== 0 || (opened.uid !== 0 && opened.uid !== uid)) {
        throw new Error('Flatpak executable is not one protected executable regular file');
      }
      if (await digestOpenFile(handle, opened.size) !== operation.flatpakSha256) {
        throw new Error('Flatpak executable digest does not match the approved plan');
      }
      const code = await runProcess({
        argv: [operation.flatpakPath, 'info', '--show-ref', operation.appId], cwd: operation.homeDirectory,
        env: { PATH: '/usr/bin:/bin', LANG: 'C', HOME: operation.homeDirectory,
          XDG_DATA_HOME: join(operation.homeDirectory, '.local', 'share') },
        timeoutMs: 10_000, terminationGraceMs: 1_000,
        ...(context ? { signal: context.signal } : {}),
      });
      const after = await lstat(operation.flatpakPath);
      if (!after.isFile() || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        throw new Error('Flatpak executable identity changed during inspection');
      }
      return code === 0;
    } finally { await handle.close(); }
  };
  const managedDirectoryMatches = async (operation: z.infer<typeof ManagedDirectoryOperationSchema>): Promise<boolean> => {
    if (process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number') throw new Error('managed directories require POSIX no-follow filesystem semantics');
    const uid = process.geteuid?.();
    if (uid === undefined) throw new Error('managed directory ownership cannot be proven');
    const parent = dirname(operation.targetPath);
    const parentInfo = await lstat(parent);
    const canonicalParent = await realpath(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || resolve(canonicalParent) !== resolve(parent)
      || parentInfo.uid !== uid || (parentInfo.mode & 0o022) !== 0) {
      throw new Error('managed directory parent is unsafe');
    }
    try {
      const info = await lstat(operation.targetPath);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o7777) !== operation.candidateMode) {
        throw new Error('managed directory target is incompatible');
      }
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  };
  const readManagedArtifactCandidate = async (operation: z.infer<typeof ManagedArtifactOperationSchema>): Promise<Buffer | null> => {
    let before;
    try { before = await lstat(operation.candidatePath); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw new Error('managed artifact candidate cannot be inspected safely');
    }
    if (!before.isFile() || before.isSymbolicLink() || (process.platform !== 'win32' && before.nlink !== 1)) {
      throw new Error('managed artifact candidate must be a single-linked regular file');
    }
    if (before.size !== operation.candidateSizeBytes) throw new Error('managed artifact candidate size mismatch');
    if (process.platform !== 'win32') {
      const uid = process.geteuid?.();
      if (uid === undefined || before.uid !== uid || (before.mode & 0o777) !== 0o600) {
        throw new Error('managed artifact candidate must be private and owned by the current user');
      }
    }
    const handle = await open(operation.candidatePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
        || (process.platform !== 'win32' && opened.nlink !== 1)) {
        throw new Error('managed artifact candidate changed while being opened');
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || bytes.length !== operation.candidateSizeBytes) {
        throw new Error('managed artifact candidate changed while being read');
      }
      if (createHash('sha256').update(bytes).digest('hex') !== operation.candidateSha256) {
        throw new Error('managed artifact candidate digest mismatch');
      }
      return bytes;
    } finally { await handle.close(); }
  };
  const managedArtifactMatches = async (operation: z.infer<typeof ManagedArtifactOperationSchema>, candidateBytes?: Buffer | null): Promise<boolean> => {
    let before;
    try { before = await lstat(operation.targetPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (process.platform !== 'win32' && before.nlink !== 1)) {
      throw new Error('managed artifact target must be a single-linked regular file');
    }
    const handle = await open(operation.targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
        || (process.platform !== 'win32' && opened.nlink !== 1)) {
        throw new Error('managed artifact target changed during verification');
      }
      const actual = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || (process.platform !== 'win32' && after.nlink !== 1)) {
        throw new Error('managed artifact target changed during verification');
      }
      return (after.mode & 0o777) === operation.candidateMode
        && actual.length === operation.candidateSizeBytes
        && createHash('sha256').update(actual).digest('hex') === operation.candidateSha256
        && (candidateBytes == null || actual.equals(candidateBytes));
    } finally { await handle.close(); }
  };
  const operation = async (id: string, task: TaskNode, expectedAction: 'check' | 'apply' | 'verify', context?: TaskExecutionContext): Promise<number> => {
    const selected = invocation.operations[id];
    if (!selected) throw new Error(`operation is not registered: ${id}`);
    if (selected.kind === 'managed-file') {
      if (selected.action !== expectedAction) throw new Error(`managed file operation phase mismatch: ${id}`);
      if (task.compensation !== 'configuration') throw new Error(`managed file task must declare configuration compensation: ${task.id}`);
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      if (selected.action === 'check') return await managedFileMatches(selected) ? 0 : 10;
      if (selected.action === 'verify') return await managedFileMatches(selected) ? 0 : 30;
      const persistence = context?.configurationCompensation;
      if (!persistence) throw new Error('managed file activation requires durable configuration compensation');
      await applyConfigurationTransaction({
        spec: {
          schemaVersion: 1, taskId: task.id, targetPath: selected.targetPath,
          effect: 'installer-configuration', dependencies: task.dependencies, candidateMode: selected.candidateMode,
        },
        candidateBytes: Buffer.from(selected.candidateBase64, 'base64'),
        hooks: {
          validateCandidate: async candidatePath => {
            if (!await managedFileMatches(selected, candidatePath)) throw new Error('managed file candidate validation failed');
          },
          verifyPostcondition: async targetPath => managedFileMatches(selected, targetPath),
        },
        persistence,
      });
      return 0;
    }
    if (selected.kind === 'managed-cask-launcher') {
      if (selected.action !== expectedAction) throw new Error(`managed cask launcher operation phase mismatch: ${id}`);
      if (task.compensation !== 'configuration') throw new Error(`managed cask launcher task must declare configuration compensation: ${task.id}`);
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      const candidateBytes = await resolveCaskLauncherCandidate(selected);
      const fileOperation = ManagedFileOperationSchema.parse({
        kind: 'managed-file', action: selected.action, targetPath: selected.targetPath,
        candidateBase64: candidateBytes.toString('base64'), candidateMode: selected.candidateMode,
      });
      const targetMatches = await managedFileMatches(fileOperation);
      if (!targetMatches && selected.action !== 'verify') {
        try {
          await lstat(selected.targetPath);
          throw new Error('refusing to replace an existing unowned cask launcher');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (selected.action === 'check') return targetMatches ? 0 : 10;
      if (selected.action === 'verify') return await managedFileMatches(fileOperation) ? 0 : 30;
      const persistence = context?.configurationCompensation;
      if (!persistence) throw new Error('managed cask launcher activation requires durable configuration compensation');
      await applyConfigurationTransaction({
        spec: {
          schemaVersion: 1, taskId: task.id, targetPath: selected.targetPath,
          effect: 'installer-configuration', dependencies: task.dependencies, candidateMode: selected.candidateMode,
        },
        candidateBytes,
        hooks: {
          validateCandidate: async candidatePath => {
            if (!await managedFileMatches({ ...fileOperation, targetPath: candidatePath })) {
              throw new Error('managed cask launcher candidate validation failed');
            }
            const currentCandidate = await resolveCaskLauncherCandidate(selected);
            if (!currentCandidate.equals(candidateBytes)) throw new Error('cask application selection changed before activation');
          },
          verifyPostcondition: async targetPath => {
            const currentCandidate = await resolveCaskLauncherCandidate(selected);
            return currentCandidate.equals(candidateBytes) && managedFileMatches({ ...fileOperation, targetPath });
          },
        },
        persistence,
      });
      return 0;
    }
    if (selected.kind === 'managed-flatpak-launcher') {
      if (selected.action !== expectedAction) throw new Error(`managed Flatpak launcher operation phase mismatch: ${id}`);
      if (task.compensation !== 'configuration') throw new Error(`managed Flatpak launcher task must declare configuration compensation: ${task.id}`);
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      if (!await flatpakApplicationInstalled(selected, context)) {
        throw new Error(`approved Flatpak application is unavailable: ${selected.packageKey}`);
      }
      const candidateBytes = flatpakLauncherCandidate(selected.appId, selected.flatpakPath);
      const fileOperation = ManagedFileOperationSchema.parse({
        kind: 'managed-file', action: selected.action, targetPath: selected.targetPath,
        candidateBase64: candidateBytes.toString('base64'), candidateMode: selected.candidateMode,
      });
      const targetMatches = await managedFileMatches(fileOperation);
      if (!targetMatches && selected.action !== 'verify') {
        try {
          await lstat(selected.targetPath);
          throw new Error('refusing to replace an existing unowned Flatpak launcher');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (selected.action === 'check') return targetMatches ? 0 : 10;
      if (selected.action === 'verify') return await managedFileMatches(fileOperation) ? 0 : 30;
      const persistence = context?.configurationCompensation;
      if (!persistence) throw new Error('managed Flatpak launcher activation requires durable configuration compensation');
      await applyConfigurationTransaction({
        spec: {
          schemaVersion: 1, taskId: task.id, targetPath: selected.targetPath,
          effect: 'installer-configuration', dependencies: task.dependencies, candidateMode: selected.candidateMode,
        },
        candidateBytes,
        hooks: {
          validateCandidate: async candidatePath => {
            if (!await managedFileMatches({ ...fileOperation, targetPath: candidatePath })) {
              throw new Error('managed Flatpak launcher candidate validation failed');
            }
            if (!await flatpakApplicationInstalled(selected, context)) {
              throw new Error('Flatpak application disappeared before activation');
            }
          },
          verifyPostcondition: async targetPath => await flatpakApplicationInstalled(selected, context)
            && managedFileMatches({ ...fileOperation, targetPath }),
        },
        persistence,
      });
      return 0;
    }
    if (selected.kind === 'sudo-credential-cleanup') {
      if (selected.action !== expectedAction) throw new Error(`sudo credential cleanup operation phase mismatch: ${id}`);
      if (task.id !== 'system.sudo-credential-cleanup' || task.lifecycle !== 'run-finalizer' || task.compensation !== 'none') {
        throw new Error('sudo credential cleanup is restricted to its non-compensating run finalizer');
      }
      return executeSudoCredentialCleanup({
        action: selected.action, sudoPreexisting: selected.sudoPreexisting,
        runExact: async argv => runSudoCredentialCommand(selected, argv, task, context),
      });
    }
    if (selected.kind === 'managed-directory') {
      if (selected.action !== expectedAction) throw new Error(`managed directory operation phase mismatch: ${id}`);
      if (task.compensation !== 'configuration') throw new Error(`managed directory task must declare configuration compensation: ${task.id}`);
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      if (selected.action === 'check') return await managedDirectoryMatches(selected) ? 0 : 10;
      if (selected.action === 'verify') return await managedDirectoryMatches(selected) ? 0 : 30;
      const persistence = context?.configurationCompensation;
      if (!persistence) throw new Error('managed directory activation requires durable configuration compensation');
      await applyManagedDirectoryTransaction({
        spec: { schemaVersion: 1, taskId: task.id, targetPath: selected.targetPath, effect: 'installer-configuration', dependencies: task.dependencies, candidateMode: selected.candidateMode },
        persistence,
      });
      return 0;
    }
    if (selected.kind === 'managed-artifact') {
      if (process.platform === 'win32') throw new Error('managed artifact activation is unsupported on win32');
      if (selected.action !== expectedAction) throw new Error(`managed artifact operation phase mismatch: ${id}`);
      if (task.compensation !== 'configuration') throw new Error(`managed artifact task must declare configuration compensation: ${task.id}`);
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      let candidateBytes = await readManagedArtifactCandidate(selected);
      if (selected.action === 'check') return await managedArtifactMatches(selected, candidateBytes) ? 0 : 10;
      if (selected.action === 'verify') return await managedArtifactMatches(selected, candidateBytes) ? 0 : 30;
      if (candidateBytes === null) {
        if (!selected.descriptor) throw new Error('managed artifact candidate is absent and no immutable descriptor authorizes fetch');
        if (selected.descriptor.source.sha256 !== selected.candidateSha256
          || selected.descriptor.source.sizeBytes !== selected.candidateSizeBytes) {
          throw new Error('managed artifact descriptor does not match approved candidate authority');
        }
        const fetched = await fetchImmutableArtifact({ descriptor: selected.descriptor, cacheRoot: dirname(selected.candidatePath) });
        if (fetched.candidatePath !== selected.candidatePath) throw new Error('managed artifact fetch escaped its approved candidate path');
        candidateBytes = await readManagedArtifactCandidate(selected);
        if (candidateBytes === null) throw new Error('managed artifact fetch did not publish its approved candidate');
      }
      const persistence = context?.configurationCompensation;
      if (!persistence) throw new Error('managed artifact activation requires durable configuration compensation');
      await applyConfigurationTransaction({
        spec: {
          schemaVersion: 1, taskId: task.id, targetPath: selected.targetPath,
          effect: 'installer-configuration', dependencies: task.dependencies, candidateMode: selected.candidateMode,
        },
        candidateBytes,
        hooks: {
          validateCandidate: async candidatePath => {
            const candidateOperation = { ...selected, targetPath: candidatePath };
            if (!await managedArtifactMatches(candidateOperation, candidateBytes)) throw new Error('managed artifact transaction candidate validation failed');
          },
          verifyPostcondition: async targetPath => managedArtifactMatches({ ...selected, targetPath }, candidateBytes),
        },
        persistence,
      });
      return 0;
    }
    if (selected.kind === 'native-service') {
      if (!serviceBinding || selected.action !== expectedAction || selected.manager !== serviceBinding.descriptor.manager
        || selected.unit !== serviceBinding.descriptor.unit || selected.desiredState !== serviceBinding.descriptor.desiredState) {
        throw new Error('native service operation requires matching approved privileged broker authority');
      }
      if (selected.action === 'check') {
        const status = await serviceBinding.runtime.check(selected);
        return status === 'verified' ? 0 : 10;
      }
      if (selected.action === 'apply') {
        const persistence = context?.configurationCompensation;
        if (!persistence) throw new Error('native service activation requires durable configuration compensation');
        const state = serviceBinding.runtime.preparedState();
        const serviceSnapshot = { schemaVersion: 1 as const, serviceId: selected.unit, manager: 'systemd' as const, ...state };
        const snapshot = { schemaVersion: 1 as const, kind: 'service' as const, targetPath: `systemd:${selected.unit}`,
          existed: false as const, mode: null, uid: null, gid: null, digest: null };
        const artifactDigest = configurationCompensationArtifactDigest(snapshot, null, serviceSnapshot);
        await persistence.prepare({
          record: CompensationRecordSchema.parse({ schemaVersion: 1, taskId: task.id, kind: 'configuration', state: 'available',
            createdAt: new Date().toISOString(), artifactDigest, restores: ['service-state'] }),
          snapshot, bytes: null, dependencies: task.dependencies, serviceSnapshot, appliedDigest: null,
        });
        await serviceBinding.runtime.apply(selected);
        return 0;
      }
      return await serviceBinding.runtime.verify(selected) === 'verified' ? 0 : 30;
    }
    if (selected.kind === 'native-package') {
      if (!nativeBinding || selected.action !== expectedAction || selected.packageKey !== nativeBinding.descriptor.packageKey
        || selected.payloadArtifactId !== nativeBinding.descriptor.artifact.id) {
        throw new Error('native package operation requires matching approved privileged broker authority');
      }
      const authority = Object.freeze({
        operation: selected,
        rootDescriptor: nativeBinding.descriptor,
        packages: Object.freeze([]),
        installedWitnesses: Object.freeze([...(selected.installedWitnesses ?? [])]),
        context,
        withPayload: async <R>(packageKey: string, use: (payload: Awaited<ReturnType<typeof open>>) => Promise<R>): Promise<R> => {
          if (packageKey !== nativeBinding.descriptor.packageKey) throw new Error('broker payload request differs from its descriptor');
          const payload = await openVerifiedArtifactSnapshot({
            artifactId: nativeBinding.descriptor.artifact.id,
            sourcePath: nativeBinding.payload.sourcePath,
            authority: { sha256: nativeBinding.payload.sha256, sizeBytes: nativeBinding.payload.sizeBytes, mode: nativeBinding.payload.mode },
          });
          try { return await use(payload); } finally { await payload.close(); }
        },
      });
      if (selected.action === 'check') {
        const status = await nativeBinding.runtime.check(authority);
        if (status === 'verified') return 0;
        if (status === 'needed') return 10;
        if (status === 'inapplicable') return 20;
      } else if (selected.action === 'apply') {
        await nativeBinding.runtime.apply(authority);
        return 0;
      } else {
        const status = await nativeBinding.runtime.verify(authority);
        if (status === 'verified') return 0;
        if (status === 'inapplicable') return 20;
        if (status === 'pending') return 30;
      }
      throw new Error(`privileged broker returned an unsupported ${selected.action} status`);
    }
    let verifiedHandle: Awaited<ReturnType<typeof open>> | undefined;
    const executionArgv = [...selected.argv];
    if (selected.verifiedExecutable) {
      const { argvIndex, sha256 } = selected.verifiedExecutable;
      const executablePath = selected.argv[argvIndex];
      if (!executablePath) throw new Error(`verified executable index is outside operation argv: ${id}`);
      if (process.platform === 'win32') throw new Error('verified executable descriptor execution is unsupported on win32');
      verifiedHandle = await open(executablePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const metadata = await verifiedHandle.stat();
        if (!metadata.isFile() || metadata.nlink !== 1) throw new Error(`verified executable is not a single-linked regular file: ${id}`);
        const actual = await digestOpenFile(verifiedHandle, metadata.size);
        if (actual !== sha256) throw new Error(`verified executable digest mismatch: ${id}`);
        executionArgv[argvIndex] = process.platform === 'linux' ? '/proc/self/fd/3' : '/dev/fd/3';
      } catch (error) {
        await verifiedHandle.close();
        throw error;
      }
    }
    try {
      return await runProcess({
        argv: executionArgv, timeoutMs: task.timeoutMs, terminationGraceMs: 1_000,
        cwd: process.cwd(), env: { ...childEnvironment(), ...(selected.env ?? {}) },
        ...(verifiedHandle ? { inheritedFileDescriptors: [verifiedHandle.fd] } : {}),
        ...(context ? { signal: context.signal, onOutput: context.output } : {}),
      });
    } catch (error) {
      if (context?.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
      throw error;
    } finally {
      await verifiedHandle?.close();
    }
  };
  return {
    discover: async () => {
      if (!('facts' in invocation)) throw new Error('read-only evidence invocation cannot perform discovery');
      return structuredClone(invocation.facts);
    },
    plan: async () => {
      if (!('facts' in invocation)) throw new Error('read-only evidence invocation cannot create a plan');
      return bindOperationsToPlan(invocation);
    },
    check: async (task, context) => {
      const code = await operation(task.operations.check, task, 'check', context);
      if (code === 0) return 'verified' satisfies Inspection;
      if (code === 10) return 'needed' satisfies Inspection;
      if (code === 11) return 'reboot-required' satisfies Inspection;
      if (code === 20) return 'inapplicable' satisfies Inspection;
      throw new Error(`check operation failed with exit ${code}`);
    },
    apply: async (task, context) => {
      const code = await operation(task.operations.apply, task, 'apply', context);
      if (code === 75) throw new InstallerOperationError('apply operation reported a transient failure', 'transient');
      if (code === 76) throw new InstallerOperationError('apply operation reported rate limiting', 'rate-limit');
      if (code !== 0) throw new Error(`apply operation failed with exit ${code}`);
    },
    verify: async (task, context) => {
      const code = await operation(task.operations.verify, task, 'verify', context);
      if (code === 0) return 'verified' satisfies Verification;
      if (code === 20) return 'inapplicable' satisfies Verification;
      if (code === 30) return 'pending' satisfies Verification;
      if (code === 31) return 'pending-reboot' satisfies Verification;
      throw new Error(`verify operation failed with exit ${code}`);
    },
  };
}

async function adapterFor(invocation: OperationInvocation): Promise<InstallerAdapter> {
  const nativePackageOperations = Object.entries(invocation.operations)
    .filter((entry): entry is [string, z.infer<typeof NativePackageOperationSchema>] => entry[1].kind === 'native-package');
  const nativeServiceOperations = Object.entries(invocation.operations)
    .filter((entry): entry is [string, z.infer<typeof NativeServiceOperationSchema>] => entry[1].kind === 'native-service');
  if (invocation.command !== 'run' && invocation.command !== 'resume') return baseAdapterFor(invocation);
  const binding = invocation.privilegedBroker;
  if (nativePackageOperations.length === 0 && nativeServiceOperations.length === 0) {
    if (binding) throw new Error('privileged broker authority is forbidden without native package or service operations');
    return baseAdapterFor(invocation);
  }
  if (nativePackageOperations.length > 0 && nativeServiceOperations.length > 0) {
    throw new Error('one privileged broker invocation cannot combine native package and service authority');
  }
  if (!binding) throw new Error('native package or service operations require the approved privileged broker');
  const expectedPlanDigest = invocation.command === 'run' ? invocation.approvedPlanDigest : invocation.planDigest;
  const normalized = await deriveBoundNormalizedPlan(bindOperationsToPlan(invocation), invocation.facts,
    invocation.desiredState, invocation.releaseId, new Date().toISOString());
  const grant = binding.client.grant;
  const task = invocation.plan.tasks.find(candidate => candidate.id === binding.client.taskId);
  const selected = new Set(invocation.plan.selectedTaskIds);
  if (normalized.digest !== expectedPlanDigest || grant.planDigest !== expectedPlanDigest
    || binding.client.planDigest !== expectedPlanDigest || grant.approvedPlanDigest !== expectedPlanDigest
    || binding.client.hostId !== invocation.facts.hostId || binding.client.releaseId !== invocation.releaseId
    || binding.client.runId !== invocation.runId || !task || !selected.has(task.id)
    || privilegedBrokerDescriptorDigest(binding.descriptor) !== grant.descriptorDigest) {
    throw new Error('privileged broker binding differs from the exact approved plan, host, release, run, or descriptor');
  }
  const phases = ['check', 'apply', 'verify'] as const;
  if ('kind' in binding) {
    if (nativePackageOperations.length > 0 || nativeServiceOperations.length !== 3 || phases.some(phase => {
      const operationId = task.operations[phase];
      const operation = invocation.operations[operationId];
      return operation?.kind !== 'native-service' || operation.action !== phase
        || operation.manager !== binding.descriptor.manager || operation.unit !== binding.descriptor.unit
        || operation.desiredState !== binding.descriptor.desiredState
        || !grant.operations.some(candidate => candidate.taskId === task.id && candidate.operationId === operationId && candidate.phase === phase);
    })) {
      throw new Error('privileged broker binding does not own the exact native service operation triplet');
    }
    return baseAdapterFor(invocation, undefined, {
      runtime: createPrivilegedBrokerServiceRuntime(binding.client, binding.descriptor),
      descriptor: binding.descriptor,
    });
  }
  if (nativeServiceOperations.length > 0 || binding.payload.sha256 !== binding.descriptor.artifact.sha256
    || binding.payload.sizeBytes !== binding.descriptor.artifact.sizeBytes || nativePackageOperations.length !== 3
    || phases.some(phase => {
    const operationId = task.operations[phase];
    const operation = invocation.operations[operationId];
    return operation?.kind !== 'native-package' || operation.action !== phase
      || operation.packageKey !== binding.descriptor.packageKey
      || operation.payloadArtifactId !== binding.descriptor.artifact.id
      || !grant.operations.some(candidate => candidate.taskId === task.id && candidate.operationId === operationId && candidate.phase === phase);
  })) {
    throw new Error('privileged broker binding does not own the exact native operation triplet');
  }
  return baseAdapterFor(invocation, {
    runtime: createPrivilegedBrokerNativeRuntime(binding.client),
    descriptor: binding.descriptor,
    payload: binding.payload,
  });
}

async function loadCommittedRollbackSource(input: {
  stateRoot: string; sourceRunId: string; sourcePlanDigest: string;
}): Promise<{
  hostId: string;
  planCreatedAt: string;
  compensations: Awaited<ReturnType<ReturnType<typeof createJournalStore>['readCompensations']>>;
}> {
  const source = createJournalStore({
    stateRoot: input.stateRoot, hostId: 'rollback-source-reader', bootId: 'read-only', processStart: 'read-only',
  });
  const inspection = await source.inspectCompletion(input.sourceRunId, input.sourcePlanDigest);
  if (inspection.authority !== 'committed') {
    throw new Error(`rollback source requires committed install evidence; found ${inspection.authority}`);
  }
  const plan = await source.readPlan(input.sourceRunId, input.sourcePlanDigest);
  if (!plan || plan.digest !== input.sourcePlanDigest) throw new Error('rollback source plan is unavailable or mismatched');
  const compensations = await source.readCompensations(input.sourceRunId, input.sourcePlanDigest);
  if (compensations.length === 0) throw new Error('rollback source has no installer-owned configuration compensation records');
  const unavailable = compensations.find(item => item.record.state !== 'available');
  if (unavailable) throw new Error(`rollback compensation is not available: ${unavailable.record.taskId}`);
  const unboundCurrentState = compensations.find(item => item.appliedDigest === null);
  if (unboundCurrentState) throw new Error(`rollback compensation lacks applied-state authority: ${unboundCurrentState.record.taskId}`);
  const journal = await source.read(input.sourceRunId, input.sourcePlanDigest);
  if (!journal || journal.hostId.length === 0) throw new Error('rollback source host identity is unavailable');
  if (!inspection.receipt) throw new Error('rollback source completion receipt is unavailable');
  return { hostId: journal.hostId, planCreatedAt: inspection.receipt.finishedAt, compensations };
}

async function requiredServiceAdapters(
  compensations: Awaited<ReturnType<ReturnType<typeof createJournalStore>['readCompensations']>>,
): Promise<Partial<Record<ServiceStateSnapshot['manager'], ServiceStateAdapter>>> {
  const adapters = await discoverNativeServiceStateAdapters(
    compensations.flatMap(item => item.serviceSnapshot === null ? [] : [item.serviceSnapshot]),
  );
  const managers = new Set(compensations.flatMap(item => item.serviceSnapshot === null ? [] : [item.serviceSnapshot.manager]));
  for (const manager of managers) {
    if (adapters[manager]?.manager !== manager) {
      throw new Error(`rollback service-state adapter is not configured for ${manager}`);
    }
  }
  return adapters;
}

function authorizationSignal(): { readonly signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const cancel = (): void => {
    if (!controller.signal.aborted) controller.abort(new Error('operator-cancelled'));
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  return {
    signal: controller.signal,
    close() {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    },
  };
}

async function main(): Promise<void> {
  let command = 'unknown';
  let phase: CliPhase = 'parse';
  let mutation: MutationRisk = 'none';
  try {
    const invocation = await readInvocation(inputPath(process.argv.slice(2)));
    command = invocation.command;
    phase = 'preflight';
    if (invocation.command === 'evidence-verify') {
      const evidenceStore = createJournalStore({
        stateRoot: invocation.stateRoot, hostId: 'evidence-reader', bootId: 'read-only', processStart: 'read-only',
      });
      const inspection = await evidenceStore.inspectCompletion(invocation.runId, invocation.planDigest);
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...inspection })}\n`);
      process.exitCode = inspection.authority === 'committed' ? 0 : 1;
      return;
    }
    if (invocation.command === 'task-evidence') {
      const evidenceStore = createJournalStore({
        stateRoot: invocation.stateRoot, hostId: 'evidence-reader', bootId: 'read-only', processStart: 'read-only',
      });
      const journal = await evidenceStore.read(invocation.runId, invocation.planDigest);
      const entry = journal?.entries.find(candidate => candidate.taskId === invocation.taskId);
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, runId: invocation.runId, planDigest: invocation.planDigest, taskId: invocation.taskId, status: entry?.status ?? 'absent' })}\n`);
      process.exitCode = entry?.status === 'verified' || entry?.status === 'inapplicable' ? 0 : 1;
      return;
    }
    if (invocation.command === 'runs-list') {
      const evidenceStore = createJournalStore({
        stateRoot: invocation.stateRoot, hostId: 'evidence-reader', bootId: 'read-only', processStart: 'read-only',
      });
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, runs: await evidenceStore.listRuns() })}\n`);
      return;
    }
    if (invocation.command === 'device-authorization-status') {
      const credential = await new ProtectedDeviceCredentialStore(invocation.credentialPath).load();
      if (credential) {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: Date.parse(credential.expiresAt) > Date.now() ? 'approved' : 'expired',
          requestId: credential.request.requestId, credentialId: credential.credentialId,
          profileId: credential.request.binding.profileId, targetKeyFingerprint: credential.request.binding.targetKeyFingerprint,
          scopes: credential.request.binding.scopes, expiresAt: credential.expiresAt })}\n`);
        return;
      }
      const pending = await new ProtectedAuthorizationState(invocation.statePath).load();
      process.stdout.write(`${JSON.stringify(pending ? { schemaVersion: 1, status: 'pending',
        requestId: pending.request.requestId, verificationCode: pending.request.verificationCode,
        approvalUri: pending.approvalUri, expiresAt: pending.request.binding.expiresAt,
      } : { schemaVersion: 1, status: 'absent' })}\n`);
      return;
    }
    if (invocation.command === 'device-authorization-start') {
      if (await new ProtectedDeviceCredentialStore(invocation.credentialPath).load()) {
        throw new Error('device already has a protected credential; inspect status or revoke before re-enrolling');
      }
      const authorization = new TargetDeviceAuthorization({ statePath: invocation.statePath,
        transport: createTargetAuthorizationHttpTransport({ origin: invocation.origin }) });
      phase = 'execute';
      const cancellation = authorizationSignal();
      let prompt;
      try {
        prompt = await authorization.begin({ profileId: invocation.profileId, machineLabel: invocation.machineLabel,
          scopes: invocation.scopes, expiresAt: invocation.expiresAt }, cancellation.signal);
      } finally { cancellation.close(); }
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'pending', ...prompt })}\n`);
      return;
    }
    if (invocation.command === 'device-authorization-wait') {
      const credentialStore = new ProtectedDeviceCredentialStore(invocation.credentialPath);
      const pendingStore = new ProtectedAuthorizationState(invocation.statePath);
      const alreadyStored = await credentialStore.load();
      if (alreadyStored) {
        const pending = await pendingStore.load();
        if (pending && pending.request.requestId !== alreadyStored.request.requestId) {
          throw new Error('persisted credential does not match pending authorization');
        }
        if (pending) await pendingStore.remove();
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'approved',
          requestId: alreadyStored.request.requestId, credentialId: alreadyStored.credentialId,
          expiresAt: alreadyStored.expiresAt })}\n`);
        return;
      }
      const authorization = new TargetDeviceAuthorization({ statePath: invocation.statePath,
        transport: createTargetAuthorizationHttpTransport({ origin: invocation.origin }),
        persistApproved: credential => credentialStore.save({ schemaVersion: 1, ...credential }),
      });
      phase = 'execute';
      const cancellation = authorizationSignal();
      let outcome;
      try { outcome = await authorization.resume(cancellation.signal); }
      finally { cancellation.close(); }
      if (outcome.status === 'approved') {
        const stored = await credentialStore.load();
        if (!stored) throw new Error('approved credential was not durably persisted');
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'approved',
          requestId: stored.request.requestId, credentialId: stored.credentialId, expiresAt: stored.expiresAt })}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...outcome })}\n`);
        if (outcome.status === 'cancelled') process.exitCode = 130;
      }
      return;
    }
    if (invocation.command === 'device-authorization-cancel') {
      const authorization = new TargetDeviceAuthorization({ statePath: invocation.statePath,
        transport: createTargetAuthorizationHttpTransport({ origin: invocation.origin }) });
      phase = 'execute';
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1,
        ...await authorization.cancel(invocation.reason ?? 'operator-cancelled') })}\n`);
      return;
    }
    if (invocation.command === 'profile-desired-state-sync') {
      phase = 'execute';
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...await fetchProfileDesiredState(invocation) })}\n`);
      return;
    }
    if (invocation.command === 'broker-approval-claim') {
      phase = 'execute';
      const approval = await orchestrateBrokerApproval({
        transport: createBrokerApprovalTransport({ origin: invocation.origin, tokenPath: invocation.tokenPath }),
        grant: invocation.grant, bootstrapBinding: invocation.bootstrapBinding, poll: invocation.poll,
      });
      process.stdout.write(`${JSON.stringify(approval)}\n`);
      return;
    }
    if (invocation.command === 'load-plan') {
      const { command: _command, ...loadInput } = invocation;
      process.stdout.write(`${JSON.stringify(buildLoadPlan(loadInput))}\n`);
      return;
    }
    if (invocation.command === 'native-debian-derive') {
      const calculated = calculateLoadPlanReportDigest(invocation.loadPlan);
      if (calculated !== invocation.loadPlan.digest || invocation.approvedLoadPlanDigest !== calculated) {
        throw new Error('native Debian derivation requires the exact approved load-plan digest');
      }
      const compareDebianVersions = await createTrustedDebianVersionComparator();
      const composition = composeSelectedNativeDebianPackageSlice({
        loadPlan: invocation.loadPlan, packageKey: invocation.packageKey, target: invocation.target,
        installedWitnesses: invocation.installedWitnesses, desiredState: invocation.desiredState,
        legacyPackages: invocation.legacyPackages, compareDebianVersions,
      });
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1, loadPlanDigest: calculated, descriptorDigest: composition.task.inputDigest, composition,
      })}\n`);
      return;
    }
    if (invocation.command === 'native-service-derive') {
      const calculated = calculateLoadPlanReportDigest(invocation.loadPlan);
      if (calculated !== invocation.loadPlan.digest || invocation.approvedLoadPlanDigest !== calculated) {
        throw new Error('native service derivation requires the exact approved load-plan digest');
      }
      const composition = composeSelectedNativeSystemdService({
        loadPlan: invocation.loadPlan, loadPlanDigest: calculated,
        serviceKey: invocation.serviceKey, legacyServices: invocation.legacyServices,
      });
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, loadPlanDigest: calculated, composition })}\n`);
      return;
    }
    if (invocation.command === 'cask-launcher-derive') {
      const { command: _command, schemaVersion: _schemaVersion, ...input } = invocation;
      process.stdout.write(`${JSON.stringify(composeSelectedCaskLaunchers(input))}\n`);
      return;
    }
    if (invocation.command === 'flatpak-launcher-derive') {
      const { command: _command, schemaVersion: _schemaVersion, ...input } = invocation;
      process.stdout.write(`${JSON.stringify(composeSelectedFlatpakLaunchers(input))}\n`);
      return;
    }
    if (invocation.command === 'privileged-broker-authority-derive') {
      const { command: _command, ...derivationInput } = invocation;
      process.stdout.write(`${JSON.stringify(derivePrivilegedBrokerAuthority(derivationInput))}\n`);
      return;
    }
    if (invocation.command === 'privileged-broker-service-authority-derive') {
      const { command: _command, ...derivationInput } = invocation;
      process.stdout.write(`${JSON.stringify(derivePrivilegedBrokerServiceAuthority(derivationInput))}\n`);
      return;
    }
    if (invocation.command === 'artifact-derive') {
      const artifacts = await deriveArtifactBatch(invocation);
      const cutover = composeArtifactLegacyCutover({
        loadPlan: invocation.loadPlan, artifacts, legacyPackages: invocation.legacyPackages,
      });
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1, loadPlanDigest: invocation.loadPlan.digest, artifacts, ...cutover,
      })}\n`);
      return;
    }
    if (invocation.command === 'artifact-prepare') {
      const artifacts = await deriveArtifactBatch(invocation);
      assertPreparedArtifactClosure(invocation, artifacts);
      const normalizedPlan = await deriveBoundNormalizedPlan(
        bindOperationsToPlan(invocation), invocation.facts, invocation.desiredState,
        invocation.releaseId, new Date().toISOString(),
      );
      if (normalizedPlan.digest !== invocation.approvedPlanDigest) {
        throw new Error(`artifact preparation requires exact normalized plan approval: ${normalizedPlan.digest}`);
      }
      const prepared: Awaited<ReturnType<typeof preparePlannedArtifact>>[] = [];
      for (let offset = 0; offset < artifacts.length; offset += 8) {
        prepared.push(...await Promise.all(artifacts.slice(offset, offset + 8).map((artifact, index) => preparePlannedArtifact({
          loadPlan: invocation.loadPlan, item: invocation.items[offset + index],
          approvedLoadPlanDigest: invocation.approvedLoadPlanDigest,
          approvedEnginePlanDigest: invocation.approvedPlanDigest,
          expectedOperations: artifact.operations, host: invocation.host,
          cacheRoot: invocation.cacheRoot, destinationRoots: invocation.destinationRoots,
          ...(invocation.offline === undefined ? {} : { offline: invocation.offline }),
        }))));
      }
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1, loadPlanDigest: invocation.loadPlan.digest,
        normalizedPlanDigest: normalizedPlan.digest, artifacts: prepared,
      })}\n`);
      return;
    }
    if (invocation.command === 'rollback-config-plan') {
      const source = await loadCommittedRollbackSource(invocation);
      const plan = await createRollbackPlan({
        sourceRunId: invocation.sourceRunId,
        sourcePlanDigest: invocation.sourcePlanDigest,
        compensations: source.compensations,
      }, () => source.planCreatedAt);
      process.stdout.write(`${JSON.stringify(plan)}\n`);
      return;
    }
    if (invocation.command === 'rollback-config-status') {
      const store = createRollbackRunStore({
        stateRoot: invocation.stateRoot, hostId: 'rollback-status-reader', bootId: 'read-only', processStart: 'read-only',
      });
      const inspection = await store.inspect(invocation.rollbackRunId, invocation.planDigest);
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...inspection })}\n`);
      process.exitCode = inspection.authority === 'committed' && inspection.receipt?.completed === true ? 0 : 1;
      return;
    }
    if (invocation.command === 'rollback-config-execute' || invocation.command === 'rollback-config-resume') {
      const source = await loadCommittedRollbackSource(invocation);
      const serviceAdapters = await requiredServiceAdapters(source.compensations);
      const plan = await createRollbackPlan({
        sourceRunId: invocation.sourceRunId,
        sourcePlanDigest: invocation.sourcePlanDigest,
        compensations: source.compensations,
      }, () => source.planCreatedAt);
      if (plan.digest !== invocation.approvedPlanDigest) throw new Error(`rollback requires exact derived plan approval: ${plan.digest}`);
      const processIdentity = await resolvePlatformProcessIdentity();
      const store = createRollbackRunStore({
        stateRoot: invocation.stateRoot, hostId: source.hostId,
        bootId: processIdentity.bootId, processStart: processIdentity.processStart,
        serviceAdapters,
      });
      const existing = await store.inspect(invocation.rollbackRunId, plan.digest);
      const requiredAuthority = invocation.command === 'rollback-config-resume' ? 'uncommitted' : 'absent';
      if (existing.authority !== requiredAuthority) {
        throw new Error(`rollback ${invocation.command === 'rollback-config-resume' ? 'resume' : 'execution'} requires ${requiredAuthority} evidence; found ${existing.authority}`);
      }
      phase = 'execute'; mutation = 'possible';
      const result = await store.executeUserFileRollback(
        // From this boundary onward a thrown error can follow a completed file
        // mutation whose outcome evidence was not durably committed.
        invocation.rollbackRunId, plan, invocation.approvedPlanDigest,
        async () => (await loadCommittedRollbackSource(invocation)).compensations,
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.receipt.completed ? 0 : 7;
      return;
    }
    if (invocation.command === 'bundle-create') {
      process.stdout.write(`${JSON.stringify(await createOfflineBundle({
        outputRoot: invocation.outputRoot, releaseId: invocation.releaseId,
        planDigest: invocation.planDigest, graphDigest: invocation.graphDigest,
        platform: invocation.platform, selectedTaskIds: invocation.selectedTaskIds,
        createdAt: invocation.createdAt, expiresAt: invocation.expiresAt,
        signer: invocation.signer,
        artifacts: invocation.artifacts.map(item => ({
          id: item.id, sourcePath: item.sourcePath, mediaType: item.mediaType, mode: item.mode,
          license: item.license, schema: item.schema, containsSecrets: item.containsSecrets,
          ...(item.catalogDescriptor === undefined ? {} : { catalogDescriptor: item.catalogDescriptor }),
        })),
        releaseTrust: invocation.releaseTrust,
        ...(invocation.maxArtifactBytes === undefined ? {} : { maxArtifactBytes: invocation.maxArtifactBytes }),
        ...(invocation.maxTotalBytes === undefined ? {} : { maxTotalBytes: invocation.maxTotalBytes }),
      }))}\n`);
      return;
    }
    if (invocation.command === 'bundle-verify') {
      process.stdout.write(`${JSON.stringify(await verifyOfflineBundle(invocation))}\n`);
      return;
    }
    if (invocation.command === 'bundle-plan') {
      const plan = await planOfflineBundle({
        bundleDirectory: invocation.bundleDirectory, trust: invocation.trust, releaseTrust: invocation.releaseTrust, expected: invocation.expected,
        ...(invocation.now ? { now: invocation.now } : {}),
      });
      const artifactIds = new Set(plan.manifest.artifacts.map(item => item.id));
      const executionClosure = artifactIds.has('normalized-plan') || artifactIds.has('operation-manifest')
        ? await validateOfflineExecutionClosure(plan)
        : undefined;
      process.stdout.write(`${JSON.stringify({ ...plan, ...(executionClosure ? { executionClosure } : {}) })}\n`);
      return;
    }
    if (invocation.command === 'bundle-apply') {
      const plan = await planOfflineBundle({
        bundleDirectory: invocation.bundleDirectory, trust: invocation.trust, releaseTrust: invocation.releaseTrust, expected: invocation.expected,
        ...(invocation.now ? { now: invocation.now } : {}),
      });
      const artifactIds = new Set(plan.manifest.artifacts.map(item => item.id));
      if (artifactIds.has('normalized-plan') || artifactIds.has('operation-manifest')) {
        await validateOfflineExecutionClosure(plan);
      }
      if (plan.manifestDigest !== invocation.approvedManifestDigest) {
        throw new Error(`bundle apply requires exact manifest approval: ${plan.manifestDigest}`);
      }
      phase = 'execute'; mutation = 'possible';
      process.stdout.write(`${JSON.stringify(await applyOfflineBundle({
        plan, destinationDirectory: invocation.destinationDirectory, trust: invocation.trust, releaseTrust: invocation.releaseTrust,
        ...(invocation.now ? { now: invocation.now } : {}),
      }))}\n`);
      return;
    }
    if (invocation.command === 'bundle-execute' || invocation.command === 'bundle-resume') {
      const plan = await planOfflineBundle({
        bundleDirectory: invocation.bundleDirectory, trust: invocation.trust, releaseTrust: invocation.releaseTrust, expected: invocation.expected,
      });
      const executionClosure = await validateOfflineExecutionClosure(plan);
      if (plan.manifestDigest !== invocation.approvedManifestDigest) {
        throw new Error(`offline execution requires exact manifest approval: ${plan.manifestDigest}`);
      }
      if (plan.manifest.planDigest !== invocation.approvedPlanDigest) {
        throw new Error(`offline execution requires exact plan approval: ${plan.manifest.planDigest}`);
      }
      const processIdentity = await resolvePlatformProcessIdentity();
      const hasNativePackages = Object.values(executionClosure.operations.operations)
        .some(operation => operation.kind === 'native-package');
      if (hasNativePackages && (process.platform !== 'linux' || process.geteuid?.() !== 0)) {
        throw new Error('offline native Debian execution requires Linux root authority');
      }
      const compareDebianVersions = hasNativePackages
        ? await createTrustedDebianVersionComparator()
        : undefined;
      const nativeExecution = compareDebianVersions
        ? {
            compareDebianVersions,
            debianMetadataVerifier: async ({ descriptor, keyringBytes }: {
              readonly descriptor: (typeof executionClosure.nativePackageDescriptors)[string];
              readonly keyringBytes: Buffer;
            }) => {
              const expected = executionClosure.runtimeArtifacts[descriptor.metadataProof.inRelease.keyring.artifactId];
              if (!expected || expected.sha256 !== descriptor.metadataProof.inRelease.keyring.sha256
                || expected.sizeBytes !== keyringBytes.byteLength || expected.mode !== '0600') {
                throw new Error('offline native Debian keyring is outside signed runtime authority');
              }
              return createDefaultDebianMetadataVerifier({
                keyring: {
                  kind: 'path',
                  absolutePath: join(invocation.materializedRoot, descriptor.metadataProof.inRelease.keyring.artifactId),
                },
              });
            },
            nativePackageRuntimeFactory: (claim: NonNullable<TaskExecutionContext['nativeDpkgTransaction']>) =>
              createNativeDpkgTransactionRuntime({
                identity: claim.identity,
                persistence: claim.persistence,
                compareDebianVersions,
              }),
          }
        : undefined;
      const hostAttestor = {
        platform: process.platform,
        discover: async () => {
          const facts = await collectLinuxOfflineHostFacts();
          return { immutableHostId: facts.hostId, facts };
        },
      };
      phase = 'execute'; mutation = 'possible';
      const result = await presentRun({
        rendererMode: invocation.renderer, runId: invocation.runId, stateRoot: invocation.stateRoot,
        execute: (signal, observer) => executeOfflineBundle({
          plan, trust: invocation.trust, releaseTrust: invocation.releaseTrust, materializedRoot: invocation.materializedRoot,
          runId: invocation.runId, hostAttestor,
          journalFactory: hostId => createJournalStore({
            stateRoot: invocation.stateRoot, hostId,
            bootId: processIdentity.bootId, processStart: processIdentity.processStart,
          }),
          ...(nativeExecution ?? {}),
          resume: invocation.command === 'bundle-resume', signal, observer,
        }),
      });
      process.exitCode = result.exitCode;
      return;
    }
    const mutatingRun = invocation.command === 'run' || invocation.command === 'resume';
    const processIdentity = mutatingRun ? await resolvePlatformProcessIdentity() : undefined;
    const journal = mutatingRun && processIdentity ? createJournalStore({
      stateRoot: invocation.stateRoot, hostId: invocation.facts.hostId,
      bootId: processIdentity.bootId, processStart: processIdentity.processStart,
    }) : undefined;
    const executionPolicy = invocation.plan.executionPolicy;
    const adapter = await adapterFor(invocation);
    const engine = createInstallerEngine({
      adapter, ...(journal ? { journal } : {}),
      maxConcurrency: executionPolicy.maxConcurrency,
      resourceLimits: executionPolicy.resourceLimits,
      ...('telemetry' in invocation && invocation.telemetry ? {
        telemetry: { config: invocation.telemetry, transport: telemetryTransport },
      } : {}),
    });
    if (invocation.command === 'resume') {
      if (!journal) throw new Error('resume requires protected journal ownership');
      const inspection = await journal.inspectCompletion(invocation.runId, invocation.planDigest);
      if (inspection.authority !== 'uncommitted') {
        throw new Error(`resume requires released uncommitted evidence; found ${inspection.authority}`);
      }
      const currentPlan = await engine.plan(invocation.facts, invocation.desiredState, invocation.releaseId);
      if (currentPlan.digest !== invocation.planDigest) {
        throw new Error('resume plan digest does not match the rebuilt current plan and operation manifest');
      }
    }
    if (invocation.command === 'discover') {
      process.stdout.write(`${JSON.stringify(await engine.discover())}\n`);
      return;
    }
    if (invocation.command === 'validate') {
      process.stdout.write(`${JSON.stringify(engine.validate(invocation.facts, invocation.desiredState))}\n`);
      return;
    }
    if (invocation.command === 'plan') {
      process.stdout.write(`${JSON.stringify(await engine.plan(invocation.facts, invocation.desiredState, invocation.releaseId))}\n`);
      return;
    }
    if (invocation.command !== 'run' && invocation.command !== 'resume' && invocation.command !== 'status') throw new Error('unsupported command state');
    phase = 'execute'; mutation = mutatingRun ? 'possible' : 'none';
    const result = await presentRun({
      rendererMode: invocation.renderer, runId: invocation.runId,
      ...(mutatingRun ? { stateRoot: invocation.stateRoot } : {}),
      execute: (signal, observer) => invocation.command === 'status'
        ? engine.status({ runId: invocation.runId, plan: invocation.plan, approvedPlanDigest: invocation.approvedPlanDigest }, observer)
        : engine.run(
          {
            runId: invocation.runId, releaseId: invocation.releaseId, desiredState: invocation.desiredState,
            approvedPlanDigest: invocation.command === 'resume' ? invocation.planDigest : invocation.approvedPlanDigest,
            resume: invocation.command === 'resume',
          },
          { signal, observer },
        ),
    });
    process.exitCode = result.exitCode;
  } catch (error) {
    const rawMessage = error instanceof z.ZodError
      ? error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
      : error instanceof Error ? error.message : 'unknown engine failure';
    const message = rawMessage.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 1024);
    const failure = classifyCliFailure(error, phase, mutation);
    process.stderr.write(`${failure.label} [${command}/${phase}]: ${message}\n`);
    process.exitCode = failure.code;
  }
}

await main();
