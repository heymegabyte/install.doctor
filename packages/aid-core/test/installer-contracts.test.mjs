import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompensationRecordSchema, DesiredStateInputSchema, HostFactsSchema, InstallerEventSchema,
  ImmutableArtifactDescriptorSchema,
  NativeOfflinePayloadDescriptorSchema,
  JournalSchema, NormalizedPlanSchema, OfflineBundleSchema, PlatformSupportCellSchema,
  RealHostCanaryReceiptSchema,
  parseStageZeroReleaseEnvelope, ReleaseManifestSchema, serializeStageZeroReleaseEnvelope,
  StageZeroReleaseEnvelopeSchema, TaskNodeSchema, TerminalReceiptSchema
} from '../dist/installer-contracts.js';

const sha = 'a'.repeat(64);
const at = '2026-11-05T12:00:00.000Z';
const nativeOfflinePayload = {
  schemaVersion: 1,
  kind: 'native-offline-package',
  manager: 'dpkg',
  packageKey: 'postgresql',
  platform: { os: 'linux', arch: 'x64' },
  package: { name: 'postgresql-17', version: '17.6-1.pgdg24.04+1', architecture: 'amd64' },
  artifact: {
    id: 'postgresql-17-amd64',
    sha256: sha,
    sizeBytes: 12_345_678,
    mediaType: 'application/vnd.debian.binary-package',
  },
  distro: { id: 'ubuntu', versionId: '24.04', codename: 'noble' },
  repository: { repositoryOrigin: 'https://apt.postgresql.org/pub/repos/apt', suite: 'noble-pgdg', component: 'main' },
  metadataProof: {
    inRelease: {
      artifactId: 'postgresql-noble-inrelease', path: 'dists/noble-pgdg/InRelease', sha256: 'b'.repeat(64), sizeBytes: 98_765,
      signedAt: '2026-11-01T00:00:00.000Z', validUntil: '2026-11-15T00:00:00.000Z', signingKeyFingerprint: 'C'.repeat(40),
      keyring: { artifactId: 'postgresql-keyring', sha256: 'f'.repeat(64), sizeBytes: 4096, mediaType: 'application/vnd.gnupg.keyring' },
    },
    packagesIndex: {
      artifactId: 'postgresql-noble-main-amd64-packages', path: 'dists/noble-pgdg/main/binary-amd64/Packages.xz',
      sha256: 'd'.repeat(64), sizeBytes: 2_345_678, architecture: 'amd64',
    },
    packageStanza: {
      filename: 'pool/main/p/postgresql-17/postgresql-17_17.6-1.pgdg24.04+1_amd64.deb', sha256: sha,
      sizeBytes: 12_345_678, depends: 'postgresql-client-17 (= 17.6-1.pgdg24.04+1)', preDepends: null,
      essential: 'no', multiArch: 'absent',
    },
  },
  dependencyClosure: {
    depends: [{ packageKey: 'postgresql-client', artifactId: 'postgresql-client-17-amd64' }],
    preDepends: [],
  },
  affectedServiceUnits: ['postgresql.service'],
  conffiles: ['/etc/postgresql/17/main/postgresql.conf'],
  maintainerScriptPolicy: {
    trust: 'signed-repository-metadata',
    network: 'deny',
    serviceStarts: 'suppress-and-restore',
    conffiles: 'preserve-local',
  },
};
const task = {
  schemaVersion: 1, id: 'install.git', inputDigest: sha, dependencies: [], predicate: 'package-missing',
  requiredCapabilities: [],
  operations: { check: 'check-package', apply: 'install-package', verify: 'verify-package' },
  timeoutMs: 60_000, retry: { class: 'transient', maxAttempts: 3, backoffMs: 500 },
  resources: { cpu: 1, memoryMiB: 128, network: true }, privilege: 'admin', network: 'required',
  consent: 'package-install', lockDomains: ['package-manager'], cleanup: 'none', compensation: 'none',
  lifecycle: 'operation',
  failurePolicy: 'continue-independent'
};

const canaryPhase = (executionMode = 'online', mutatedTaskIds = ['install.git'], interruptedTaskIds = [], planDigest = sha) => ({
  result: 'passed', evidenceDigest: sha, authorityDigest: sha, runId: 'run-1', planDigest, executionMode,
  selectedTaskIds: ['install.git'], attemptedTaskIds: mutatedTaskIds, mutatedTaskIds, interruptedTaskIds, postconditions: { 'install.git': 'verified' },
  serviceRestoration: { requiredTaskIds: [], restoredTaskIds: [] },
  ...(executionMode === 'offline' ? { offlineBundle: { manifestDigest: sha, bundleSignerId: 'bundle-key', invocationDigest: sha,
    networkIsolation: { kind: 'linux-network-namespace', parentNamespaceId: 'net:[1]', executionNamespaceId: 'net:[2]', startedAt: at, finishedAt: '2026-11-05T12:01:00.000Z' } } } : {}),
});
const canaryReceipt = {
  schemaVersion: 2, receiptId: 'canary-1', evidenceClass: 'real-host-canary', scope: 'full-lifecycle', cellId: 'macos-15-arm64-native',
  tuple: { os: 'macOS', version: '15', arch: 'arm64', environment: 'native', role: 'macos' },
  release: { releaseId: 'release-1', sourceCommit: 'b'.repeat(40), manifestDigest: sha }, result: 'passed', recordedAt: at,
  coverage: ['stage-zero','plan','apply','verify','unchanged-reapply','interrupted-resume','config-rollback','headless','offline'],
  proof: { provider: 'github-actions', runnerEnvironment: 'github-hosted', disposable: true, hermetic: false,
    workflowCommit: 'c'.repeat(40), workflowRunId: '12345', evidenceDigest: sha,
    phases: { cleanInstall: canaryPhase(), signedRelease: { result: 'passed', evidenceDigest: sha }, upgrade: canaryPhase(),
      interruptedResume: canaryPhase('online', ['install.git'], ['install.git']), unchangedSecondRun: canaryPhase('online', []), offlineExecution: canaryPhase('offline', [], [], 'd'.repeat(64)),
      configRollback: { result: 'passed', evidenceDigest: sha, authorityDigest: sha, rollbackRunId: 'rollback-1', planDigest: sha, restoredTaskIds: ['install.git'] } } },
};

const cases = [
  [ImmutableArtifactDescriptorSchema, { schemaVersion: 1, id: 'sysz', version: '1.4.3', platform: { os: 'linux', arch: 'x64' }, source: { url: 'https://github.com/joehillen/sysz/releases/download/1.4.3/sysz', sha256: sha, sizeBytes: 12734 }, destination: { root: 'user-bin', filename: 'sysz', mode: '0700' } }],
  [NativeOfflinePayloadDescriptorSchema, nativeOfflinePayload],
  [ReleaseManifestSchema, { schemaVersion: 1, releaseId: 'release-1', sourceCommit: 'b'.repeat(40), createdAt: at, expiresAt: '2026-12-05T12:00:00.000Z', supportedSchemaVersions: [1], artifacts: [{ id: 'provisioner', url: 'https://app.install.doctor/releases/release-1/provision.sh', sha256: sha, sizeBytes: 42, mediaType: 'text/x-shellscript', mode: '0700', originClass: 'install-doctor-release', platforms: ['darwin-arm64'] }], signature: { keyId: 'release-key-1', algorithm: 'sshsig-ed25519', namespace: 'install.doctor.release', detached: true } }],
  [HostFactsSchema, { schemaVersion: 1, hostId: 'host-1', collectedAt: at, os: 'darwin', osVersion: '15.1', arch: 'arm64', environment: 'native', roles: ['workstation'], packageManagers: ['brew'], capabilities: ['gui'] }],
  [DesiredStateInputSchema, { schemaVersion: 1, revision: 'desired-1', hostId: 'host-1', packages: ['git'], services: [], consents: ['package-install'], offline: false }],
  [TaskNodeSchema, task],
  [NormalizedPlanSchema, { schemaVersion: 1, planId: 'plan-1', digest: sha, releaseId: 'release-1', desiredRevision: 'desired-1', hostFactsDigest: sha, createdAt: at, tasks: [task], selectedTaskIds: ['install.git'], executionPolicy: { maxConcurrency: 4, resourceLimits: { cpu: 64, memoryMiB: 1_048_576, networkConcurrency: 16 } } }],
  [InstallerEventSchema, { schemaVersion: 1, sequence: 1, at, runId: 'run-1', kind: 'task-status', taskId: 'install.git', status: 'running', attempt: 1 }],
  [JournalSchema, { schemaVersion: 1, runId: 'run-1', planDigest: sha, releaseId: 'release-1', desiredRevision: 'desired-1', hostId: 'host-1', hostFactsDigest: sha, ownerId: 'owner-1', revision: 1, updatedAt: at, entries: [{ taskId: 'install.git', inputDigest: sha, status: 'verified', attempts: 1, updatedAt: at }] }],
  [CompensationRecordSchema, { schemaVersion: 1, taskId: 'install.git', kind: 'configuration', state: 'available', createdAt: at, artifactDigest: sha, restores: ['bytes', 'mode', 'service-state'] }],
  [PlatformSupportCellSchema, { schemaVersion: 1, os: 'darwin', versionRange: '>=14 <16', arch: 'arm64', environment: 'native', role: 'workstation', packageManager: 'brew', support: 'verified', evidenceIds: ['canary-2026-11'], evidenceExpiresAt: '2027-01-01T00:00:00.000Z' }],
  [OfflineBundleSchema, { schemaVersion: 1, bundleId: 'bundle-1', releaseId: 'release-1', platformCellDigest: sha, planDigest: sha, createdAt: at, expiresAt: '2026-12-05T12:00:00.000Z', artifactDigests: [sha], graphDigest: sha, containsSecrets: false, signature: { keyId: 'release-key-1', algorithm: 'sshsig-ed25519', namespace: 'install.doctor.release', detached: true } }],
  [TerminalReceiptSchema, { schemaVersion: 1, runId: 'run-1', planDigest: sha, status: 'success', startedAt: at, finishedAt: '2026-11-05T12:01:00.000Z', taskCounts: { verified: 1, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 }, evidencePaths: ['/var/lib/install-doctor/runs/run-1'], nextAction: null }]
  ,[RealHostCanaryReceiptSchema, canaryReceipt]
];

test('all installer runtime contracts accept their bounded current-version fixtures', () => {
  for (const [schema, fixture] of cases) assert.deepEqual(schema.parse(fixture), fixture);
});

test('every installer runtime contract rejects unknown fields and versions', () => {
  for (const [schema, fixture] of cases) {
    assert.throws(() => schema.parse({ ...fixture, surprise: true }));
    assert.throws(() => schema.parse({ ...fixture, schemaVersion: fixture.schemaVersion === 2 ? 1 : 2 }));
  }
});

test('bounded fields and arrays reject oversized input', () => {
  assert.throws(() => HostFactsSchema.parse({ ...cases[3][1], roles: Array.from({ length: 65 }, (_, i) => `role-${i}`) }));
  assert.throws(() => DesiredStateInputSchema.parse({ ...cases[4][1], revision: 'x'.repeat(129) }));
  assert.throws(() => ReleaseManifestSchema.parse({ ...cases[2][1], artifacts: [{ ...cases[2][1].artifacts[0], sizeBytes: 2 ** 40 }] }));
});

test('native offline dpkg payload authority rejects ambiguous or unsafe provenance', () => {
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({ ...nativeOfflinePayload, surprise: true }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    artifact: { ...nativeOfflinePayload.artifact, surprise: true },
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({ ...nativeOfflinePayload, manager: 'apt' }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({ ...nativeOfflinePayload, platform: { os: 'darwin', arch: 'x64' } }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    package: { ...nativeOfflinePayload.package, architecture: 'arm64' },
  }), /architecture/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({ ...nativeOfflinePayload, metadataProof: undefined }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({ ...nativeOfflinePayload, repository: undefined }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    repository: { ...nativeOfflinePayload.repository, repositoryOrigin: 'http://apt.example.test/debian' },
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    affectedServiceUnits: ['../escape.service'],
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    affectedServiceUnits: ['postgresql.service', 'postgresql.service'],
  }), /duplicate/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    conffiles: ['/etc/postgresql.conf', '/etc/../root-owned'],
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    conffiles: ['/etc/postgresql.conf\n/etc/shadow'],
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    conffiles: ['/etc/postgresql.conf', '/etc/postgresql.conf'],
  }), /duplicate/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    maintainerScriptPolicy: { ...nativeOfflinePayload.maintainerScriptPolicy, network: 'allow' },
  }));
  assert.doesNotThrow(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    package: { ...nativeOfflinePayload.package, architecture: 'all' },
  }));
});

test('native offline payload binds a complete ordered Debian repository proof chain', () => {
  const { inRelease: _inRelease, ...missingInRelease } = nativeOfflinePayload.metadataProof;
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    metadataProof: missingInRelease,
  }));
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    metadataProof: {
      ...nativeOfflinePayload.metadataProof,
      inRelease: { ...nativeOfflinePayload.metadataProof.inRelease, validUntil: nativeOfflinePayload.metadataProof.inRelease.signedAt },
    },
  }), /Valid-Until/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    metadataProof: {
      ...nativeOfflinePayload.metadataProof,
      packagesIndex: { ...nativeOfflinePayload.metadataProof.packagesIndex, path: 'dists/noble/main/binary-amd64/Packages.xz' },
    },
  }), /Packages index path/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    metadataProof: {
      ...nativeOfflinePayload.metadataProof,
      packageStanza: { ...nativeOfflinePayload.metadataProof.packageStanza, sha256: 'e'.repeat(64) },
    },
  }), /stanza SHA256 and Size/i);
  const alpha = { packageKey: 'alpha', artifactId: 'alpha-amd64' };
  const zeta = { packageKey: 'zeta', artifactId: 'zeta-amd64' };
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    dependencyClosure: { depends: [zeta, alpha], preDepends: [] },
  }), /sorted/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    dependencyClosure: { depends: [alpha, alpha], preDepends: [] },
  }), /duplicate/i);
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse({
    ...nativeOfflinePayload,
    dependencyClosure: { depends: [alpha], preDepends: [alpha] },
  }), /both Depends and Pre-Depends/i);
  const { dependencyClosure: _dependencyClosure, ...missingClosure } = nativeOfflinePayload;
  assert.throws(() => NativeOfflinePayloadDescriptorSchema.parse(missingClosure));
});

test('discriminated events reject fields from a different event state', () => {
  assert.throws(() => InstallerEventSchema.parse({ ...cases[7][1], kind: 'output', line: 'hello', status: 'running' }));
});

test('success receipts cannot conceal unfinished or failed tasks', () => {
  const receipt = cases[12][1];
  assert.throws(() => TerminalReceiptSchema.parse({ ...receipt, taskCounts: { ...receipt.taskCounts, failed: 1 } }));
  assert.throws(() => TerminalReceiptSchema.parse({ ...receipt, nextAction: 'retry failed task' }));
});

test('stage-zero envelope has one deterministic portable wire format', () => {
  const envelope = {
    schemaVersion: 4,
    releaseId: 'release-1',
    sourceCommit: 'b'.repeat(40),
    createdAt: 1_793_923_000,
    expiresAt: 1_793_926_600,
    keyId: 'release-key-1',
    artifactUrl: 'https://app.install.doctor/releases/release-1/provision.sh',
    artifactSha256: sha,
    artifactSize: 42,
    engineUrl: 'https://app.install.doctor/releases/release-1/install-doctor-engine.mjs',
    engineSha256: 'c'.repeat(64),
    engineSize: 1024,
    engineNodeMin: 22,
    catalogUrl: 'https://app.install.doctor/releases/release-1/catalog.json',
    catalogSha256: 'd'.repeat(64),
    catalogSize: 2048,
    runtimeNodeVersion: '24.11.0',
    runtimes: Object.fromEntries(['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'].map((platform, index) => [platform, {
      url: `https://app.install.doctor/releases/release-1/node-${platform}.tar.gz`,
      sha256: String(index + 1).repeat(64),
      size: 1024 + index,
    }])),
  };
  assert.deepEqual(parseStageZeroReleaseEnvelope(serializeStageZeroReleaseEnvelope(envelope)), envelope);
  assert.deepEqual(StageZeroReleaseEnvelopeSchema.parse(envelope), envelope);
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse({ ...envelope, schemaVersion: 3 }));
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse({ ...envelope, catalogUrl: 'https://example.com/catalog.json' }));
  const { catalogSha256: _catalogSha256, ...missingCatalogBinding } = envelope;
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse(missingCatalogBinding));
  assert.throws(() => parseStageZeroReleaseEnvelope(`${serializeStageZeroReleaseEnvelope(envelope)}unknown=value\n`));
  assert.throws(() => parseStageZeroReleaseEnvelope(serializeStageZeroReleaseEnvelope({ ...envelope, artifactUrl: 'https://example.com/provision.sh' })));
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse({ ...envelope, runtimeNodeVersion: '22' }));
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse({ ...envelope, runtimes: { ...envelope.runtimes, 'linux-x64': { ...envelope.runtimes['linux-x64'], url: 'https://example.com/node.tar.gz' } } }));
  const { ['linux-arm64']: omitted, ...incompleteRuntimes } = envelope.runtimes;
  assert.ok(omitted);
  assert.throws(() => StageZeroReleaseEnvelopeSchema.parse({ ...envelope, runtimes: incompleteRuntimes }));
});
