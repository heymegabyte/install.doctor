/** Pure desired-state contracts for fleet protection. This module never inspects or mutates a host. */

export const RECOVERY_CAPABILITIES = ['snapshot', 'replication', 'file-backup', 'scrub', 'restore-test'] as const;
export type RecoveryCapability = typeof RECOVERY_CAPABILITIES[number];
export type RecoveryStatus = 'unknown' | 'stale' | 'running' | 'failed' | 'unverified' | 'verified';

export interface FleetRecoveryManifest {
  schemaVersion: 1;
  revision: string;
  host: {
    id: string;
    os: 'linux' | 'darwin' | 'win32';
    roles: string[];
    filesystems: string[];
    capabilities: { id: RecoveryCapability; applicable: boolean; reason: string }[];
  };
  objectives: { rpoMinutes: number; rtoMinutes: number };
  encryption: { required: true; artifactKeyRef: string; recoveryRecipient: string };
  schedules: { operation: RecoveryCapability; owner: string; expression: string }[];
  destinations: { id: string; hostId: string; dataset: string; boundary: string; encrypted: true; production: false }[];
  exclusions: Record<'file' | 'dataset' | 'snapshot' | 'replication', { pattern: string; reason: string }[]>;
}

export interface FleetRecoveryAction {
  hostId: string;
  capability: RecoveryCapability;
  idempotencyKey: string;
  steps: readonly string[];
}

export type ObservedRecoveryRun =
  | { state: 'running'; startedAt: string }
  | { state: 'failed'; finishedAt: string }
  | { state: 'succeeded'; finishedAt: string; verified: boolean };

export interface BackupSourcePolicy {
  id: string;
  path: string;
  expectedMount: string;
  allowSymlink: boolean;
  crossFilesystem: 'reject' | 'stay-on-filesystem';
  allowEmpty: boolean;
}

/** Read-only evidence supplied by a platform-specific discovery adapter. */
export interface BackupSourceEvidence {
  id: string;
  requestedPath: string;
  resolvedPath: string;
  mountPath: string;
  exists: boolean;
  readable: boolean;
  entryCount: number;
  isSymlink: boolean;
  crossesFilesystem: boolean;
}

export type BackupSourceAssessment =
  | { id: string; state: 'ready'; path: string; traversal: 'same-filesystem' | 'stay-on-filesystem' }
  | { id: string; state: 'blocked'; path: string; reasons: string[] };

export interface FleetRecoveryReconciliation {
  mode: 'discover' | 'plan' | 'status';
  hostId: string;
  mutationAllowed: false;
  actions: FleetRecoveryAction[];
  sources: BackupSourceAssessment[];
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  const record = value as Record<string, unknown>;
  invariant(Object.keys(record).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(record, key)), `${label}: missing or unknown fields`);
  return record;
}

function identifier(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value), `${label}: invalid identifier`);
}

function uniqueStrings(value: unknown, label: string): asserts value is string[] {
  invariant(Array.isArray(value) && value.length <= 10_000, `${label}: expected bounded array`);
  value.forEach(entry => identifier(entry, label));
  invariant(new Set(value).size === value.length, `${label}: duplicates`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  invariant(Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 5_256_000, `${label}: invalid duration`);
}

function capability(value: unknown, label: string): asserts value is RecoveryCapability {
  invariant(typeof value === 'string' && RECOVERY_CAPABILITIES.includes(value as RecoveryCapability), `${label}: unsupported capability`);
}

function nonempty(value: unknown, label: string, maximum = 1024): asserts value is string {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\r\n\u0000]/.test(value), `${label}: invalid text`);
}

function absolutePath(value: unknown, label: string): asserts value is string {
  nonempty(value, label, 4096);
  invariant(/^(\/|[A-Za-z]:[\\/])/.test(value as string) && !/[\r\n\u0000*?\[\]]/.test(value as string), `${label}: expected absolute literal path`);
}

/** Strict v1 validator. It rejects ambiguity instead of filling policy defaults. */
export function validateFleetRecoveryManifest(input: unknown): FleetRecoveryManifest {
  const root = exactObject(input, ['schemaVersion', 'revision', 'host', 'objectives', 'encryption', 'schedules', 'destinations', 'exclusions'], 'fleet recovery manifest');
  invariant(root.schemaVersion === 1, 'Unsupported fleet recovery schema');
  identifier(root.revision, 'revision');

  const host = exactObject(root.host, ['id', 'os', 'roles', 'filesystems', 'capabilities'], 'host');
  identifier(host.id, 'host.id');
  invariant(typeof host.os === 'string' && ['linux', 'darwin', 'win32'].includes(host.os), 'host.os: unsupported OS');
  uniqueStrings(host.roles, 'host.roles');
  uniqueStrings(host.filesystems, 'host.filesystems');
  invariant(Array.isArray(host.capabilities) && host.capabilities.length === RECOVERY_CAPABILITIES.length, 'Every capability requires explicit applicability');
  const capabilityIds: string[] = [];
  for (const entry of host.capabilities) {
    const item = exactObject(entry, ['id', 'applicable', 'reason'], 'host capability');
    capability(item.id, 'host capability id');
    invariant(typeof item.applicable === 'boolean', 'Capability applicability must be explicit');
    nonempty(item.reason, 'capability reason', 300);
    capabilityIds.push(item.id);
  }
  invariant(new Set(capabilityIds).size === capabilityIds.length && RECOVERY_CAPABILITIES.every(item => capabilityIds.includes(item)), 'Capabilities must be declared exactly once');

  const objectives = exactObject(root.objectives, ['rpoMinutes', 'rtoMinutes'], 'objectives');
  positiveInteger(objectives.rpoMinutes, 'rpoMinutes');
  positiveInteger(objectives.rtoMinutes, 'rtoMinutes');

  const encryption = exactObject(root.encryption, ['required', 'artifactKeyRef', 'recoveryRecipient'], 'encryption');
  invariant(encryption.required === true, 'Protected artifacts must be encrypted');
  invariant(typeof encryption.artifactKeyRef === 'string' && /^infisical:\/\/[a-z0-9][a-z0-9/_-]{0,240}$/i.test(encryption.artifactKeyRef), 'Use an Infisical secret reference, never a secret value');
  invariant(typeof encryption.recoveryRecipient === 'string' && /^age1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/.test(encryption.recoveryRecipient), 'Use a public age recovery recipient');

  invariant(Array.isArray(root.schedules) && root.schedules.length <= RECOVERY_CAPABILITIES.length, 'schedules: expected bounded array');
  const scheduledOperations: string[] = [];
  for (const entry of root.schedules) {
    const schedule = exactObject(entry, ['operation', 'owner', 'expression'], 'schedule');
    capability(schedule.operation, 'schedule operation');
    identifier(schedule.owner, 'schedule owner');
    nonempty(schedule.expression, 'schedule expression', 120);
    scheduledOperations.push(schedule.operation);
  }
  invariant(new Set(scheduledOperations).size === scheduledOperations.length, 'Use exactly one scheduler per operation');

  invariant(Array.isArray(root.destinations) && root.destinations.length <= 1000, 'destinations: expected bounded array');
  const destinationIds: string[] = [];
  for (const entry of root.destinations) {
    const destination = exactObject(entry, ['id', 'hostId', 'dataset', 'boundary', 'encrypted', 'production'], 'destination');
    identifier(destination.id, 'destination.id');
    identifier(destination.hostId, 'destination.hostId');
    nonempty(destination.dataset, 'destination.dataset', 512);
    nonempty(destination.boundary, 'destination.boundary', 512);
    invariant(destination.dataset === destination.boundary || destination.dataset.startsWith(`${destination.boundary}/`), 'Destination must remain inside its declared boundary');
    invariant(destination.encrypted === true, 'Every destination must be encrypted');
    invariant(destination.production === false, 'A production destination is not a backup boundary');
    destinationIds.push(destination.id);
  }
  invariant(new Set(destinationIds).size === destinationIds.length, 'destination ids: duplicates');

  const exclusions = exactObject(root.exclusions, ['file', 'dataset', 'snapshot', 'replication'], 'exclusions');
  for (const kind of ['file', 'dataset', 'snapshot', 'replication'] as const) {
    const entries = exclusions[kind];
    invariant(Array.isArray(entries) && entries.length <= 10_000, `exclusions.${kind}: expected bounded array`);
    const patterns: string[] = [];
    for (const entry of entries) {
      const exclusion = exactObject(entry, ['pattern', 'reason'], `exclusions.${kind}`);
      nonempty(exclusion.pattern, `exclusions.${kind}.pattern`, 1024);
      nonempty(exclusion.reason, `exclusions.${kind}.reason`, 300);
      patterns.push(exclusion.pattern);
    }
    invariant(new Set(patterns).size === patterns.length, `exclusions.${kind}: duplicate patterns`);
  }

  const applicable = new Set((host.capabilities as { id: RecoveryCapability; applicable: boolean }[]).filter(item => item.applicable).map(item => item.id));
  for (const operation of scheduledOperations) invariant(applicable.has(operation as RecoveryCapability), `Inapplicable operation ${operation} cannot be scheduled`);
  for (const item of applicable) {
    if (item === 'snapshot' || item === 'replication' || item === 'file-backup' || item === 'scrub') {
      invariant(scheduledOperations.includes(item), `Applicable capability ${item} requires one scheduler`);
    }
  }
  invariant(!applicable.has('replication') || destinationIds.length > 0, 'Replication requires an explicit destination');
  return structuredClone(input) as FleetRecoveryManifest;
}

const ACTION_STEPS: Record<RecoveryCapability, readonly string[]> = {
  snapshot: ['discover', 'validate-policy', 'reconcile-snapshot-schedule', 'verify-recovery-point'],
  replication: ['discover', 'validate-destination', 'reconcile-replication', 'verify-replica'],
  'file-backup': ['discover', 'validate-sources', 'reconcile-file-backup', 'verify-restore'],
  scrub: ['discover', 'check-storage-work', 'reconcile-scrub-schedule', 'verify-scrub'],
  'restore-test': ['discover', 'prepare-isolated-target', 'restore', 'verify-content']
};

/** Produces stable declarative actions; callers remain responsible for authorization and execution. */
export function planFleetRecovery(input: unknown): FleetRecoveryAction[] {
  const manifest = validateFleetRecoveryManifest(input);
  return manifest.host.capabilities
    .filter(item => item.applicable)
    .map(item => ({
      hostId: manifest.host.id,
      capability: item.id,
      idempotencyKey: JSON.stringify([manifest.schemaVersion, manifest.revision, manifest.host.id, item.id]),
      steps: ACTION_STEPS[item.id]
    }));
}

/**
 * Validates discovery evidence without touching the filesystem. Missing mounts,
 * unreadable or unexpectedly empty sources are failures, never successful backups.
 */
export function assessBackupSources(policiesInput: unknown, evidenceInput: unknown): BackupSourceAssessment[] {
  invariant(Array.isArray(policiesInput) && policiesInput.length > 0 && policiesInput.length <= 10_000, 'source policies: expected non-empty bounded array');
  invariant(Array.isArray(evidenceInput) && evidenceInput.length <= 10_000, 'source evidence: expected bounded array');
  const policies: BackupSourcePolicy[] = policiesInput.map((entry, index) => {
    const value = exactObject(entry, ['id', 'path', 'expectedMount', 'allowSymlink', 'crossFilesystem', 'allowEmpty'], `source policy ${index}`);
    identifier(value.id, 'source policy id');
    absolutePath(value.path, 'source path');
    absolutePath(value.expectedMount, 'expected mount');
    invariant(typeof value.allowSymlink === 'boolean' && typeof value.allowEmpty === 'boolean', 'source policy booleans must be explicit');
    invariant(value.crossFilesystem === 'reject' || value.crossFilesystem === 'stay-on-filesystem', 'crossFilesystem: unsupported policy');
    return structuredClone(value) as unknown as BackupSourcePolicy;
  });
  invariant(new Set(policies.map(item => item.id)).size === policies.length, 'source policy ids: duplicates');

  const evidence = new Map<string, BackupSourceEvidence>();
  for (const [index, entry] of evidenceInput.entries()) {
    const value = exactObject(entry, ['id', 'requestedPath', 'resolvedPath', 'mountPath', 'exists', 'readable', 'entryCount', 'isSymlink', 'crossesFilesystem'], `source evidence ${index}`);
    identifier(value.id, 'source evidence id');
    absolutePath(value.requestedPath, 'requested path');
    absolutePath(value.resolvedPath, 'resolved path');
    absolutePath(value.mountPath, 'mount path');
    invariant(typeof value.exists === 'boolean' && typeof value.readable === 'boolean' && typeof value.isSymlink === 'boolean' && typeof value.crossesFilesystem === 'boolean', 'source evidence booleans must be explicit');
    invariant(Number.isSafeInteger(value.entryCount) && Number(value.entryCount) >= 0, 'entryCount: expected non-negative integer');
    invariant(!evidence.has(value.id as string), 'source evidence ids: duplicates');
    evidence.set(value.id as string, structuredClone(value) as unknown as BackupSourceEvidence);
  }
  invariant([...evidence.keys()].every(id => policies.some(policy => policy.id === id)), 'Evidence supplied for undeclared source');

  return policies.map(policy => {
    const observed = evidence.get(policy.id);
    const reasons: string[] = [];
    if (!observed) reasons.push('discovery evidence missing');
    else {
      if (observed.requestedPath !== policy.path) reasons.push('requested path does not match policy');
      if (!observed.exists) reasons.push('source is missing');
      if (observed.mountPath !== policy.expectedMount) reasons.push('unexpected or unavailable mount');
      if (!observed.readable) reasons.push('source is unreadable');
      if (observed.entryCount === 0 && !policy.allowEmpty) reasons.push('source is unexpectedly empty');
      if (observed.isSymlink && !policy.allowSymlink) reasons.push('symlink source is not allowed');
      if (observed.crossesFilesystem && policy.crossFilesystem === 'reject') reasons.push('source crosses a filesystem boundary');
    }
    return reasons.length > 0
      ? { id: policy.id, state: 'blocked' as const, path: policy.path, reasons }
      : { id: policy.id, state: 'ready' as const, path: policy.path, traversal: policy.crossFilesystem === 'stay-on-filesystem' ? 'stay-on-filesystem' as const : 'same-filesystem' as const };
  });
}

/** Pure discover/plan/status orchestration. It never grants mutation authority. */
export function reconcileFleetRecovery(input: unknown, mode: 'discover' | 'plan' | 'status', policies: unknown, evidence: unknown): FleetRecoveryReconciliation {
  invariant(mode === 'discover' || mode === 'plan' || mode === 'status', 'Unsupported reconciliation mode');
  const manifest = validateFleetRecoveryManifest(input);
  const sources = assessBackupSources(policies, evidence);
  return {
    mode,
    hostId: manifest.host.id,
    mutationAllowed: false,
    actions: mode === 'plan' && sources.every(source => source.state === 'ready') ? planFleetRecovery(manifest) : [],
    sources
  };
}

export interface AtomicConfigurationPlan {
  target: string;
  candidate: string;
  previous: string;
  steps: readonly ['write-candidate', 'validate-candidate', 'preserve-current', 'atomic-replace'];
  rollbackSteps: readonly ['validate-previous', 'atomic-restore'];
}

/** Describes safe configuration replacement; an executor must implement same-filesystem atomic renames. */
export function planAtomicConfiguration(target: string, transactionId: string): AtomicConfigurationPlan {
  absolutePath(target, 'configuration target');
  identifier(transactionId, 'transaction id');
  return {
    target,
    candidate: `${target}.install-doctor-${transactionId}.candidate`,
    previous: `${target}.install-doctor-${transactionId}.previous`,
    steps: ['write-candidate', 'validate-candidate', 'preserve-current', 'atomic-replace'],
    rollbackSteps: ['validate-previous', 'atomic-restore']
  };
}

function timestamp(value: unknown, label: string): number {
  invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value), `${label}: invalid timestamp`);
  const parsed = Date.parse(value);
  invariant(Number.isFinite(parsed), `${label}: invalid timestamp`);
  return parsed;
}

/** Classifies evidence without equating a completed job with a verified recovery point. */
export function classifyFleetRecoveryStatus(observed: ObservedRecoveryRun | undefined, rpoMinutes: number, now: string): RecoveryStatus {
  positiveInteger(rpoMinutes, 'rpoMinutes');
  const currentTime = timestamp(now, 'now');
  if (observed === undefined) return 'unknown';
  if (observed.state === 'running') {
    timestamp(observed.startedAt, 'startedAt');
    return 'running';
  }
  const finishedAt = timestamp(observed.finishedAt, 'finishedAt');
  invariant(finishedAt <= currentTime, 'Observed result cannot be from the future');
  if (observed.state === 'failed') return 'failed';
  if (currentTime - finishedAt > rpoMinutes * 60_000) return 'stale';
  return observed.verified ? 'verified' : 'unverified';
}
