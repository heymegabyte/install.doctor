import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const catalogKey = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const text = z.string().min(1).max(512);
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const boundedIds = z.array(id).max(256).refine(values => new Set(values).size === values.length, 'duplicate identifiers');
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const signature = strict({ keyId: id, algorithm: z.literal('sshsig-ed25519'), namespace: z.literal('install.doctor.release'), detached: z.literal(true) });

const immutableGithubReleaseUrl = z.string().url().max(2048).superRefine((value, context) => {
  const parsed = new URL(value);
  const match = parsed.pathname.match(/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/([^/]+)\/[A-Za-z0-9_.+-]+$/);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password
    || parsed.search || parsed.hash || !match || /^(?:latest|continuous|nightly|main|master)$/i.test(match[1] ?? '')) {
    context.addIssue({ code: 'custom', message: 'source must be an immutable release URL without credentials, query, or fragment' });
  }
});

export const ImmutableArtifactDescriptorSchema = strict({
  schemaVersion: VERSION,
  id,
  version: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
  platform: strict({ os: z.enum(['linux', 'darwin', 'win32']), arch: z.enum(['x64', 'arm64']) }),
  source: strict({
    url: immutableGithubReleaseUrl,
    sha256: digest,
    // Direct executable artifacts are read once into the bounded activation
    // transaction. Keep this identical to the managed-artifact operation cap.
    sizeBytes: z.number().int().positive().max(67_108_864),
  }),
  destination: strict({
    root: z.enum(['user-bin', 'docker-cli-plugin']),
    filename: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*(?:\.exe)?$/),
    mode: z.literal('0700'),
  }),
});
export type ImmutableArtifactDescriptor = z.infer<typeof ImmutableArtifactDescriptorSchema>;

const debianPackageName = z.string().min(2).max(128).regex(/^[a-z0-9][a-z0-9+.-]*$/);
const debianPackageVersion = z.string().min(1).max(128).regex(/^[0-9][A-Za-z0-9.+:~-]*$/);
const repositoryToken = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._+~-]*$/);
const repositoryRelativePath = z.string().min(1).max(1024).superRefine((value, context) => {
  if (value.startsWith('/') || /[\0-\x20\x7f]/.test(value) || value.includes('//')) {
    context.addIssue({ code: 'custom', message: 'repository path must be a canonical relative path without control characters' });
    return;
  }
  if (value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'repository path must not contain empty, current, or parent segments' });
  }
});
const safeSystemdServiceUnit = z.string().min(9).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.service$/);
const canonicalPosixFile = z.string().min(2).max(4096).superRefine((value, context) => {
  if (!value.startsWith('/') || /[\0-\x1f\x7f]/.test(value) || value.includes('//')) {
    context.addIssue({ code: 'custom', message: 'conffile must be a canonical absolute POSIX file path' });
    return;
  }
  const segments = value.slice(1).split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'conffile must not contain empty, current, or parent path segments' });
  }
});
const uniqueBounded = <T extends z.ZodTypeAny>(item: T, maximum: number, label: string) => z.array(item).max(maximum)
  .refine(values => new Set(values).size === values.length, `duplicate ${label}`);
const immutableRepositoryOrigin = z.string().url().max(2048).superRefine((value, context) => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    context.addIssue({ code: 'custom', message: 'repository origin must be credential-free HTTPS without query or fragment' });
  }
});
const nativePayloadDependency = strict({ packageKey: catalogKey, artifactId: id });
const nativePayloadDependencies = z.array(nativePayloadDependency).max(4096).superRefine((values, context) => {
  const identities = values.map(value => `${value.packageKey}/${value.artifactId}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: 'custom', message: 'duplicate native payload dependency reference' });
  }
  if (identities.some((identity, index) => index > 0 && identities[index - 1]!.localeCompare(identity) >= 0)) {
    context.addIssue({ code: 'custom', message: 'native payload dependency references must be unique and sorted' });
  }
});

/**
 * Release-catalog authority for one exact Debian payload that may eventually
 * participate in a native offline installation. This contract grants no
 * execution authority by itself; the offline executor continues to reject
 * package-manager effects until a separately verified runtime exists.
 */
export const NativeOfflinePayloadDescriptorSchema = strict({
  schemaVersion: VERSION,
  kind: z.literal('native-offline-package'),
  manager: z.literal('dpkg'),
  packageKey: catalogKey,
  platform: strict({ os: z.literal('linux'), arch: z.enum(['x64', 'arm64']) }),
  package: strict({
    name: debianPackageName,
    version: debianPackageVersion,
    architecture: z.enum(['amd64', 'arm64', 'all']),
  }),
  artifact: strict({
    id,
    sha256: digest,
    sizeBytes: z.number().int().positive().max(268_435_456),
    mediaType: z.literal('application/vnd.debian.binary-package'),
  }),
  distro: strict({
    id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
    versionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
    codename: repositoryToken,
  }),
  repository: strict({ repositoryOrigin: immutableRepositoryOrigin, suite: repositoryRelativePath, component: repositoryToken }),
  metadataProof: strict({
    inRelease: strict({
      artifactId: id,
      path: repositoryRelativePath,
      sha256: digest,
      sizeBytes: z.number().int().positive().max(16_777_216),
      signedAt: timestamp,
      validUntil: timestamp.nullable(),
      maximumDateAgeSeconds: z.number().int().positive().max(15_552_000).nullable(),
      signingKeyFingerprint: z.string().regex(/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/),
      keyring: strict({
        artifactId: id,
        sha256: digest,
        sizeBytes: z.number().int().positive().max(16_777_216),
        mediaType: z.literal('application/vnd.gnupg.keyring'),
      }),
    }),
    packagesIndex: strict({
      artifactId: id,
      path: repositoryRelativePath,
      sha256: digest,
      sizeBytes: z.number().int().positive().max(268_435_456),
      architecture: z.enum(['amd64', 'arm64']),
    }),
    packageStanza: strict({
      filename: repositoryRelativePath.refine(value => value.endsWith('.deb'), 'package Filename must identify a .deb payload'),
      sha256: digest,
      sizeBytes: z.number().int().positive().max(268_435_456),
      depends: z.string().min(1).max(16_384).nullable(),
      preDepends: z.string().min(1).max(16_384).nullable(),
      essential: z.enum(['absent', 'no', 'yes']),
      multiArch: z.enum(['absent', 'foreign', 'same', 'allowed']),
    }),
  }),
  dependencyClosure: strict({ depends: nativePayloadDependencies, preDepends: nativePayloadDependencies }),
  affectedServiceUnits: uniqueBounded(safeSystemdServiceUnit, 128, 'affected service unit'),
  conffiles: uniqueBounded(canonicalPosixFile, 1024, 'conffile'),
  maintainerScriptPolicy: strict({
    trust: z.literal('signed-repository-metadata'),
    network: z.literal('deny'),
    serviceStarts: z.literal('suppress-and-restore'),
    conffiles: z.literal('preserve-local'),
  }),
}).superRefine((value, context) => {
  const proofArtifactIds = [
    value.artifact.id,
    value.metadataProof.inRelease.artifactId,
    value.metadataProof.inRelease.keyring.artifactId,
    value.metadataProof.packagesIndex.artifactId,
  ];
  if (new Set(proofArtifactIds).size !== proofArtifactIds.length) {
    context.addIssue({ code: 'custom', path: ['metadataProof'], message: 'payload, keyring, InRelease, and Packages proof artifacts must be distinct' });
  }
  const expectedArchitecture = value.platform.arch === 'x64' ? 'amd64' : 'arm64';
  if (value.package.architecture !== expectedArchitecture && value.package.architecture !== 'all') {
    context.addIssue({
      code: 'custom', path: ['package', 'architecture'],
      message: `Debian package architecture must match platform architecture (${expectedArchitecture})`,
    });
  }
  if (value.metadataProof.packagesIndex.architecture !== expectedArchitecture) {
    context.addIssue({
      code: 'custom', path: ['metadataProof', 'packagesIndex', 'architecture'],
      message: `Packages index architecture must match platform architecture (${expectedArchitecture})`,
    });
  }
  const freshness = value.metadataProof.inRelease;
  if ((freshness.validUntil === null) === (freshness.maximumDateAgeSeconds === null)) {
    context.addIssue({ code: 'custom', path: ['metadataProof', 'inRelease'], message: 'InRelease freshness must bind exactly one of Valid-Until or a maximum Date age' });
  }
  if (freshness.validUntil !== null
    && new Date(freshness.validUntil).getTime() <= new Date(freshness.signedAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['metadataProof', 'inRelease', 'validUntil'], message: 'InRelease Valid-Until must follow Date' });
  }
  const expectedInReleasePath = `dists/${value.repository.suite}/InRelease`;
  if (value.metadataProof.inRelease.path !== expectedInReleasePath) {
    context.addIssue({ code: 'custom', path: ['metadataProof', 'inRelease', 'path'], message: 'InRelease path must match repository Suite' });
  }
  const packagesPrefix = `dists/${value.repository.suite}/${value.repository.component}/binary-${expectedArchitecture}/Packages`;
  if (value.metadataProof.packagesIndex.path !== packagesPrefix
    && value.metadataProof.packagesIndex.path !== `${packagesPrefix}.gz`
    && value.metadataProof.packagesIndex.path !== `${packagesPrefix}.xz`) {
    context.addIssue({ code: 'custom', path: ['metadataProof', 'packagesIndex', 'path'], message: 'Packages index path must match Suite, Component, and Architecture' });
  }
  if (value.metadataProof.packageStanza.sha256 !== value.artifact.sha256
    || value.metadataProof.packageStanza.sizeBytes !== value.artifact.sizeBytes) {
    context.addIssue({ code: 'custom', path: ['metadataProof', 'packageStanza'], message: 'Packages stanza SHA256 and Size must match the payload artifact' });
  }
  const dependencyIdentities = [...value.dependencyClosure.depends, ...value.dependencyClosure.preDepends]
    .map(dependency => `${dependency.packageKey}/${dependency.artifactId}`);
  if (new Set(dependencyIdentities).size !== dependencyIdentities.length) {
    context.addIssue({ code: 'custom', path: ['dependencyClosure'], message: 'dependency references cannot appear in both Depends and Pre-Depends closure' });
  }
});
export type NativeOfflinePayloadDescriptor = z.infer<typeof NativeOfflinePayloadDescriptorSchema>;

export const ReleaseManifestSchema = strict({
  schemaVersion: VERSION, releaseId: id, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), createdAt: timestamp, expiresAt: timestamp,
  supportedSchemaVersions: z.array(VERSION).length(1),
  artifacts: z.array(strict({ id, url: z.string().url().max(2048).refine(value => value.startsWith('https://app.install.doctor/releases/')), sha256: digest, sizeBytes: z.number().int().positive().max(2 ** 32), mediaType: z.literal('text/x-shellscript'), mode: z.literal('0700'), originClass: z.literal('install-doctor-release'), platforms: boundedIds })).min(1).max(512),
  signature
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/**
 * Minimal signed envelope consumed before a JSON runtime is available. This is
 * deliberately distinct from the engine manifest above: it binds the one
 * bootstrap artifact using a deterministic, line-oriented wire format that a
 * fresh Bash host can parse without jq, Python, or Node.
 */
const runtimePlatform = z.enum(['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']);
const runtimeTuple = strict({
  url: z.string().url().max(2048),
  sha256: digest,
  size: z.number().int().positive().max(100_663_296),
});
const runtimeTuples = strict({
  'macos-x64': runtimeTuple,
  'macos-arm64': runtimeTuple,
  'linux-x64': runtimeTuple,
  'linux-arm64': runtimeTuple,
});

export const StageZeroReleaseEnvelopeSchema = strict({
  schemaVersion: z.literal(4),
  releaseId: id,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  createdAt: z.number().int().nonnegative().max(4_102_444_800),
  expiresAt: z.number().int().positive().max(4_102_444_800),
  keyId: id,
  artifactUrl: z.string().url().max(2048),
  artifactSha256: digest,
  artifactSize: z.number().int().positive().max(8_388_608),
  engineUrl: z.string().url().max(2048),
  engineSha256: digest,
  engineSize: z.number().int().positive().max(8_388_608),
  engineNodeMin: z.literal(22),
  catalogUrl: z.string().url().max(2048),
  catalogSha256: digest,
  catalogSize: z.number().int().positive().max(8_388_608),
  runtimeNodeVersion: z.string().regex(/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
  runtimes: runtimeTuples,
}).superRefine((value, context) => {
  if (value.expiresAt <= value.createdAt) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiry must follow creation' });
  }
  if (value.artifactUrl !== `https://app.install.doctor/releases/${value.releaseId}/provision.sh`) {
    context.addIssue({ code: 'custom', path: ['artifactUrl'], message: 'artifact URL must match the immutable release' });
  }
  if (value.engineUrl !== `https://app.install.doctor/releases/${value.releaseId}/install-doctor-engine.mjs`) {
    context.addIssue({ code: 'custom', path: ['engineUrl'], message: 'engine URL must match the immutable release' });
  }
  if (value.catalogUrl !== `https://app.install.doctor/releases/${value.releaseId}/catalog.json`) {
    context.addIssue({ code: 'custom', path: ['catalogUrl'], message: 'catalog URL must match the immutable release' });
  }
  for (const platform of runtimePlatform.options) {
    if (value.runtimes[platform].url !== `https://app.install.doctor/releases/${value.releaseId}/node-${platform}.tar.gz`) {
      context.addIssue({ code: 'custom', path: ['runtimes', platform, 'url'], message: 'runtime URL must match the immutable release and platform' });
    }
  }
});
export type StageZeroReleaseEnvelope = z.infer<typeof StageZeroReleaseEnvelopeSchema>;

const stageZeroWireKeys = [
  'schema_version', 'release_id', 'source_commit', 'created_at', 'expires_at',
  'key_id', 'artifact_url', 'artifact_sha256', 'artifact_size',
  'engine_url', 'engine_sha256', 'engine_size', 'engine_node_min',
  'catalog_url', 'catalog_sha256', 'catalog_size',
  'runtime_node_version',
  'runtime_macos_x64_url', 'runtime_macos_x64_sha256', 'runtime_macos_x64_size',
  'runtime_macos_arm64_url', 'runtime_macos_arm64_sha256', 'runtime_macos_arm64_size',
  'runtime_linux_x64_url', 'runtime_linux_x64_sha256', 'runtime_linux_x64_size',
  'runtime_linux_arm64_url', 'runtime_linux_arm64_sha256', 'runtime_linux_arm64_size',
] as const;

export function parseStageZeroReleaseEnvelope(input: string): StageZeroReleaseEnvelope {
  const values = new Map<string, string>();
  for (const line of input.split('\n')) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('invalid stage-zero envelope line');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!stageZeroWireKeys.includes(key as typeof stageZeroWireKeys[number]) || value === '' || values.has(key)) {
      throw new Error('unknown, empty, or duplicate stage-zero envelope field');
    }
    values.set(key, value);
  }
  if (values.size !== stageZeroWireKeys.length) throw new Error('incomplete stage-zero envelope');
  const integer = (key: string): number => {
    const value = values.get(key) ?? '';
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`invalid integer field: ${key}`);
    return Number(value);
  };
  return StageZeroReleaseEnvelopeSchema.parse({
    schemaVersion: integer('schema_version'),
    releaseId: values.get('release_id'),
    sourceCommit: values.get('source_commit'),
    createdAt: integer('created_at'),
    expiresAt: integer('expires_at'),
    keyId: values.get('key_id'),
    artifactUrl: values.get('artifact_url'),
    artifactSha256: values.get('artifact_sha256'),
    artifactSize: integer('artifact_size'),
    engineUrl: values.get('engine_url'),
    engineSha256: values.get('engine_sha256'),
    engineSize: integer('engine_size'),
    engineNodeMin: integer('engine_node_min'),
    catalogUrl: values.get('catalog_url'),
    catalogSha256: values.get('catalog_sha256'),
    catalogSize: integer('catalog_size'),
    runtimeNodeVersion: values.get('runtime_node_version'),
    runtimes: {
      'macos-x64': { url: values.get('runtime_macos_x64_url'), sha256: values.get('runtime_macos_x64_sha256'), size: integer('runtime_macos_x64_size') },
      'macos-arm64': { url: values.get('runtime_macos_arm64_url'), sha256: values.get('runtime_macos_arm64_sha256'), size: integer('runtime_macos_arm64_size') },
      'linux-x64': { url: values.get('runtime_linux_x64_url'), sha256: values.get('runtime_linux_x64_sha256'), size: integer('runtime_linux_x64_size') },
      'linux-arm64': { url: values.get('runtime_linux_arm64_url'), sha256: values.get('runtime_linux_arm64_sha256'), size: integer('runtime_linux_arm64_size') },
    },
  });
}

export function serializeStageZeroReleaseEnvelope(input: unknown): string {
  const value = StageZeroReleaseEnvelopeSchema.parse(input);
  return [
    `schema_version=${value.schemaVersion}`,
    `release_id=${value.releaseId}`,
    `source_commit=${value.sourceCommit}`,
    `created_at=${value.createdAt}`,
    `expires_at=${value.expiresAt}`,
    `key_id=${value.keyId}`,
    `artifact_url=${value.artifactUrl}`,
    `artifact_sha256=${value.artifactSha256}`,
    `artifact_size=${value.artifactSize}`,
    `engine_url=${value.engineUrl}`,
    `engine_sha256=${value.engineSha256}`,
    `engine_size=${value.engineSize}`,
    `engine_node_min=${value.engineNodeMin}`,
    `catalog_url=${value.catalogUrl}`,
    `catalog_sha256=${value.catalogSha256}`,
    `catalog_size=${value.catalogSize}`,
    `runtime_node_version=${value.runtimeNodeVersion}`,
    `runtime_macos_x64_url=${value.runtimes['macos-x64'].url}`,
    `runtime_macos_x64_sha256=${value.runtimes['macos-x64'].sha256}`,
    `runtime_macos_x64_size=${value.runtimes['macos-x64'].size}`,
    `runtime_macos_arm64_url=${value.runtimes['macos-arm64'].url}`,
    `runtime_macos_arm64_sha256=${value.runtimes['macos-arm64'].sha256}`,
    `runtime_macos_arm64_size=${value.runtimes['macos-arm64'].size}`,
    `runtime_linux_x64_url=${value.runtimes['linux-x64'].url}`,
    `runtime_linux_x64_sha256=${value.runtimes['linux-x64'].sha256}`,
    `runtime_linux_x64_size=${value.runtimes['linux-x64'].size}`,
    `runtime_linux_arm64_url=${value.runtimes['linux-arm64'].url}`,
    `runtime_linux_arm64_sha256=${value.runtimes['linux-arm64'].sha256}`,
    `runtime_linux_arm64_size=${value.runtimes['linux-arm64'].size}`,
    '',
  ].join('\n');
}

export const HostFactsSchema = strict({
  schemaVersion: VERSION, hostId: id, collectedAt: timestamp, os: z.enum(['linux', 'darwin', 'win32']),
  osVersion: text, arch: z.enum(['x64', 'arm64']), environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']),
  roles: boundedIds.max(64), packageManagers: boundedIds.max(16), capabilities: boundedIds.max(256)
});
export type HostFacts = z.infer<typeof HostFactsSchema>;

export const DesiredStateInputSchema = strict({
  schemaVersion: VERSION, revision: id, hostId: id, packages: boundedIds.max(4096), services: boundedIds.max(512),
  consents: boundedIds.max(256), offline: z.boolean()
});
export type DesiredStateInput = z.infer<typeof DesiredStateInputSchema>;

export const TaskNodeSchema = strict({
  schemaVersion: VERSION, id, inputDigest: digest, dependencies: boundedIds.max(512), predicate: id,
  requiredCapabilities: boundedIds.max(64).default([]),
  operations: strict({ check: id, apply: id, verify: id }), timeoutMs: z.number().int().min(100).max(86_400_000),
  retry: strict({ class: z.enum(['never', 'transient', 'rate-limit']), maxAttempts: z.number().int().min(1).max(10), backoffMs: z.number().int().min(0).max(300_000) }),
  resources: strict({ cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(1).max(1_048_576), network: z.boolean() }),
  privilege: z.enum(['user', 'admin']), network: z.enum(['none', 'optional', 'required']), consent: z.union([id, z.literal('none')]),
  lockDomains: boundedIds.max(64), cleanup: z.enum(['none', 'always']), compensation: z.enum(['none', 'configuration']),
  lifecycle: z.enum(['operation', 'run-finalizer']).default('operation'),
  failurePolicy: z.enum(['continue-independent', 'abort-run']).default('continue-independent')
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const ExecutionPolicySchema = strict({
  maxConcurrency: z.number().int().min(1).max(64),
  resourceLimits: strict({
    cpu: z.number().int().min(1).max(4096),
    memoryMiB: z.number().int().min(1).max(1_048_576),
    networkConcurrency: z.number().int().min(0).max(64),
  }),
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const NormalizedPlanSchema = strict({
  schemaVersion: VERSION, planId: id, digest, releaseId: id, desiredRevision: id, hostFactsDigest: digest,
  createdAt: timestamp, tasks: z.array(TaskNodeSchema).max(10_000), selectedTaskIds: boundedIds.max(10_000),
  executionPolicy: ExecutionPolicySchema.default({ maxConcurrency: 4, resourceLimits: { cpu: 64, memoryMiB: 1_048_576, networkConcurrency: 16 } }),
});
export type NormalizedPlan = z.infer<typeof NormalizedPlanSchema>;

const eventBase = { schemaVersion: VERSION, sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), at: timestamp, runId: id };
export const InstallerEventSchema = z.discriminatedUnion('kind', [
  strict({ ...eventBase, kind: z.literal('run-status'), status: z.enum(['started', 'redirected', 'success', 'failed', 'cancelled', 'rejected']) }),
  strict({ ...eventBase, kind: z.literal('phase-status'), phase: z.enum(['discover', 'validate', 'plan', 'approve', 'apply', 'verify', 'record']), status: z.enum(['started', 'succeeded', 'failed', 'skipped']) }),
  strict({ ...eventBase, kind: z.literal('task-status'), taskId: id, status: z.enum(['queued', 'running', 'retrying', 'verified', 'inapplicable', 'pending', 'pending-reboot', 'interrupted', 'blocked', 'failed']), attempt: z.number().int().min(0).max(10) }),
  strict({ ...eventBase, kind: z.literal('output'), taskId: id, stream: z.enum(['stdout', 'stderr']), line: z.string().max(16_384) }),
  strict({ ...eventBase, kind: z.literal('lock'), taskId: id, domain: id, state: z.enum(['waiting', 'acquired', 'released']) })
]);
export type InstallerEvent = z.infer<typeof InstallerEventSchema>;

export const JournalSchema = strict({
  schemaVersion: VERSION, runId: id, planDigest: digest, releaseId: id, desiredRevision: id, hostId: id, hostFactsDigest: digest,
  ownerId: id, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), updatedAt: timestamp,
  entries: z.array(strict({ taskId: id, inputDigest: digest, status: z.enum(['running', 'verified', 'inapplicable', 'pending', 'pending-reboot', 'blocked', 'failed', 'interrupted']), attempts: z.number().int().min(0).max(10), updatedAt: timestamp })).max(10_000).refine(entries => new Set(entries.map(entry => entry.taskId)).size === entries.length, 'duplicate journal task identifiers')
});
export type Journal = z.infer<typeof JournalSchema>;

export const CompensationRecordSchema = strict({
  schemaVersion: VERSION, taskId: id, kind: z.literal('configuration'), state: z.enum(['available', 'applied', 'failed']),
  createdAt: timestamp, artifactDigest: digest, restores: z.array(z.enum(['bytes', 'mode', 'ownership', 'service-state'])).min(1).max(4)
});
export type CompensationRecord = z.infer<typeof CompensationRecordSchema>;

export const PlatformSupportCellSchema = strict({
  schemaVersion: VERSION, os: z.enum(['linux', 'darwin', 'win32']), versionRange: text, arch: z.enum(['x64', 'arm64']),
  environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']), role: id, packageManager: id,
  support: z.enum(['verified', 'best-effort', 'unsupported']), evidenceIds: boundedIds.max(64), evidenceExpiresAt: timestamp.nullable()
});
export type PlatformSupportCell = z.infer<typeof PlatformSupportCellSchema>;

const canaryTaskIds = z.array(id).max(10_000).superRefine((values, context) => {
  if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && values[index - 1]!.localeCompare(value) >= 0)) {
    context.addIssue({ code: 'custom', message: 'canary task identifiers must be unique and sorted' });
  }
});
const canaryInstallPhaseProof = strict({
  result: z.literal('passed'), evidenceDigest: digest, authorityDigest: digest, runId: id, planDigest: digest,
  executionMode: z.enum(['online', 'offline']), selectedTaskIds: canaryTaskIds, attemptedTaskIds: canaryTaskIds, mutatedTaskIds: canaryTaskIds,
  interruptedTaskIds: canaryTaskIds,
  postconditions: z.record(id, z.enum(['verified', 'inapplicable'])),
  serviceRestoration: strict({ requiredTaskIds: canaryTaskIds, restoredTaskIds: canaryTaskIds }),
  offlineBundle: strict({
    manifestDigest: digest, bundleSignerId: id, invocationDigest: digest,
    networkIsolation: strict({ kind: z.literal('linux-network-namespace'), parentNamespaceId: z.string().regex(/^net:\[[1-9][0-9]*\]$/),
      executionNamespaceId: z.string().regex(/^net:\[[1-9][0-9]*\]$/), startedAt: timestamp, finishedAt: timestamp }),
  }).optional(),
}).superRefine((value, context) => {
  if (JSON.stringify(Object.keys(value.postconditions).sort()) !== JSON.stringify(value.selectedTaskIds)) {
    context.addIssue({ code: 'custom', path: ['postconditions'], message: 'postconditions must cover the exact selected task closure' });
  }
  if (value.mutatedTaskIds.some(taskId => !value.selectedTaskIds.includes(taskId))) {
    context.addIssue({ code: 'custom', path: ['mutatedTaskIds'], message: 'mutations must belong to selected tasks' });
  }
  if (value.attemptedTaskIds.some(taskId => !value.selectedTaskIds.includes(taskId))) {
    context.addIssue({ code: 'custom', path: ['attemptedTaskIds'], message: 'attempts must belong to selected tasks' });
  }
  if (value.mutatedTaskIds.some(taskId => !value.attemptedTaskIds.includes(taskId))) {
    context.addIssue({ code: 'custom', path: ['mutatedTaskIds'], message: 'committed mutations must have an attributable apply attempt' });
  }
  if (value.interruptedTaskIds.some(taskId => !value.selectedTaskIds.includes(taskId))) {
    context.addIssue({ code: 'custom', path: ['interruptedTaskIds'], message: 'interruptions must belong to selected tasks' });
  }
  if (JSON.stringify(value.serviceRestoration.requiredTaskIds) !== JSON.stringify(value.serviceRestoration.restoredTaskIds)) {
    context.addIssue({ code: 'custom', path: ['serviceRestoration'], message: 'every required service restoration must be proven' });
  }
});
const canaryRollbackPhaseProof = strict({
  result: z.literal('passed'), evidenceDigest: digest, authorityDigest: digest, rollbackRunId: id, planDigest: digest,
  restoredTaskIds: canaryTaskIds,
});
const canarySignedReleaseProof = strict({ result: z.literal('passed'), evidenceDigest: digest });
const canaryInteractiveSessionProof = strict({
  transcriptDigest: digest, runsListDigest: digest, planArtifactDigest: digest, journalHeadDigest: digest, journalObjectDigest: digest,
  exitStatus: z.literal(130), altScreenEntered: z.literal(true), terminalRestored: z.literal(true),
  desktopToolsIdentity: z.literal(true), workerAttribution: z.literal(true), runId: id, planDigest: digest, resumeCandidate: z.literal(true),
});
const canaryInteractiveTuiProof = strict({
  result: z.literal('passed'), evidenceDigest: digest, releaseId: id,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), manifestDigest: digest,
  directUser: canaryInteractiveSessionProof, rootHandoff: canaryInteractiveSessionProof,
});

export const RealHostCanaryReceiptSchema = strict({
  schemaVersion: z.literal(2),
  receiptId: id,
  evidenceClass: z.literal('real-host-canary'),
  scope: z.literal('full-lifecycle'),
  cellId: id,
  tuple: strict({
    os: text, version: text, arch: z.enum(['x64', 'arm64']), environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']), role: id,
  }),
  release: strict({ releaseId: id, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), manifestDigest: digest }),
  result: z.literal('passed'),
  recordedAt: timestamp,
  coverage: z.tuple([
    z.literal('stage-zero'), z.literal('plan'), z.literal('apply'), z.literal('verify'),
    z.literal('unchanged-reapply'), z.literal('interrupted-resume'), z.literal('config-rollback'), z.literal('headless'),
    z.literal('interactive-tui'), z.literal('offline'),
  ]),
  proof: strict({
    provider: z.literal('github-actions'), runnerEnvironment: z.literal('github-hosted'), disposable: z.literal(true), hermetic: z.literal(false),
    workflowCommit: z.string().regex(/^[a-f0-9]{40}$/), workflowRunId: z.string().regex(/^[1-9][0-9]{0,19}$/), evidenceDigest: digest,
    phases: strict({
      cleanInstall: canaryInstallPhaseProof,
      signedRelease: canarySignedReleaseProof,
      upgrade: canaryInstallPhaseProof,
      interruptedResume: canaryInstallPhaseProof,
      unchangedSecondRun: canaryInstallPhaseProof,
      offlineExecution: canaryInstallPhaseProof,
      configRollback: canaryRollbackPhaseProof,
      interactiveTui: canaryInteractiveTuiProof,
    }),
  }),
}).superRefine((value, context) => {
  const interactive = value.proof.phases.interactiveTui;
  if (interactive.releaseId !== value.release.releaseId || interactive.sourceCommit !== value.release.sourceCommit
    || interactive.manifestDigest !== value.release.manifestDigest) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'interactiveTui'], message: 'interactive TUI proof must bind the promoted release' });
  }
  if (interactive.directUser.runId === interactive.rootHandoff.runId) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'interactiveTui'], message: 'interactive TUI sessions must bind distinct interrupted runs' });
  }
  if (value.proof.phases.offlineExecution.executionMode !== 'offline') {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'offlineExecution', 'executionMode'], message: 'offline phase must be marked offline' });
  }
  if (value.proof.phases.offlineExecution.offlineBundle === undefined) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'offlineExecution', 'offlineBundle'], message: 'offline execution requires signed bundle and network-isolation proof' });
  }
  for (const phase of ['cleanInstall', 'upgrade', 'interruptedResume', 'unchangedSecondRun'] as const) {
    if (value.proof.phases[phase].executionMode !== 'online') {
      context.addIssue({ code: 'custom', path: ['proof', 'phases', phase, 'executionMode'], message: 'online phase must be marked online' });
    }
    if (value.proof.phases[phase].offlineBundle !== undefined) {
      context.addIssue({ code: 'custom', path: ['proof', 'phases', phase, 'offlineBundle'], message: 'online phases cannot claim offline-bundle proof' });
    }
  }
  if (value.proof.phases.unchangedSecondRun.mutatedTaskIds.length !== 0) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'unchangedSecondRun', 'mutatedTaskIds'], message: 'unchanged reapply cannot contain committed mutations' });
  }
  for (const phase of ['cleanInstall', 'upgrade'] as const) {
    if (value.proof.phases[phase].mutatedTaskIds.length === 0) {
      context.addIssue({ code: 'custom', path: ['proof', 'phases', phase, 'mutatedTaskIds'], message: 'clean install and upgrade require committed mutation evidence' });
    }
  }
  if (value.proof.phases.offlineExecution.planDigest === value.proof.phases.upgrade.planDigest) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'offlineExecution', 'planDigest'], message: 'offline execution requires a distinct desired-state-bound plan' });
  }
  if (value.proof.phases.interruptedResume.interruptedTaskIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['proof', 'phases', 'interruptedResume', 'interruptedTaskIds'], message: 'interrupted resume requires committed interrupted journal evidence' });
  }
});
export type RealHostCanaryReceipt = z.infer<typeof RealHostCanaryReceiptSchema>;

export const OfflineBundleSchema = strict({
  schemaVersion: VERSION, bundleId: id, releaseId: id, platformCellDigest: digest, planDigest: digest,
  createdAt: timestamp, expiresAt: timestamp, artifactDigests: z.array(digest).min(1).max(4096), graphDigest: digest,
  containsSecrets: z.literal(false), signature
});
export type OfflineBundle = z.infer<typeof OfflineBundleSchema>;

const taskCounts = strict({ verified: z.number().int().nonnegative(), inapplicable: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative() });
export const TerminalReceiptSchema = strict({
  schemaVersion: VERSION, runId: id, planDigest: digest,
  status: z.enum(['success', 'failed', 'cancelled', 'rejected', 'redirected', 'pending-reboot', 'pending-verification']),
  startedAt: timestamp, finishedAt: timestamp, taskCounts, evidencePaths: z.array(z.string().min(1).max(1024)).min(1).max(64), nextAction: z.string().min(1).max(1024).nullable()
}).superRefine((receipt, context) => {
  if (receipt.status === 'success' && (receipt.taskCounts.skipped + receipt.taskCounts.blocked + receipt.taskCounts.pending + receipt.taskCounts.failed !== 0 || receipt.nextAction !== null)) {
    context.addIssue({ code: 'custom', message: 'success requires no unfinished tasks or next action' });
  }
  if (receipt.status !== 'success' && receipt.nextAction === null) context.addIssue({ code: 'custom', message: 'non-success receipt requires a next action' });
});
export type TerminalReceipt = z.infer<typeof TerminalReceiptSchema>;

export const InstallerContractSchemas = Object.freeze({
  releaseManifest: ReleaseManifestSchema, stageZeroReleaseEnvelope: StageZeroReleaseEnvelopeSchema,
  immutableArtifact: ImmutableArtifactDescriptorSchema,
  hostFacts: HostFactsSchema, desiredState: DesiredStateInputSchema,
  plan: NormalizedPlanSchema, task: TaskNodeSchema, event: InstallerEventSchema, journal: JournalSchema,
  compensation: CompensationRecordSchema, platformSupport: PlatformSupportCellSchema, offlineBundle: OfflineBundleSchema,
  terminalReceipt: TerminalReceiptSchema
});
