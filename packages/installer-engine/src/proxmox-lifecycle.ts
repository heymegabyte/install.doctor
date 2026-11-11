import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  ProxmoxFixtureEvidenceSchema,
  ProxmoxFixtureSchema,
  preflightProxmoxMutation,
  type ProxmoxFixtureBoundary,
} from './proxmox-fixture-contract.js';

export const PROXMOX_LIFECYCLE_OPERATION_KINDS = [
  'repository',
  'host-configuration',
  'vm-lxc-metadata',
  'guest',
  'backup',
  'network-intent',
  'upgrade',
  'maintenance',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const boundedText = z.string().min(1).max(1_024).refine(value => !/[\r\n\0]/u.test(value));
const cidr = z.string().min(3).max(64).regex(/^[0-9a-f:.]+\/\d{1,3}$/i);

const baseOperation = {
  schemaVersion: z.literal(1),
  operationId: identifier,
  dependsOn: z.array(identifier).max(128),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
};

const repositoryOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('repository'),
  repositoryId: identifier,
  enabled: z.boolean(),
  family: z.enum(['enterprise', 'no-subscription', 'test', 'ceph-enterprise', 'ceph-no-subscription']),
  suite: identifier,
  signedByDigest: sha256,
});

const hostConfigurationOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('host-configuration'),
  key: z.enum(['firewall.enabled', 'journald.max-use-bytes', 'ksm.enabled', 'zfs.arc-max-bytes']),
  value: z.union([z.boolean(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
});

const metadataOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('vm-lxc-metadata'),
  vmid: z.number().int().min(100).max(999_999_999),
  guestKind: z.enum(['qemu', 'lxc']),
  description: boundedText,
  tags: z.array(identifier).max(64),
  protected: z.boolean(),
});

const guestOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('guest'),
  vmid: z.number().int().min(100).max(999_999_999),
  desiredStatus: z.enum(['running', 'stopped']),
  guestAgent: z.enum(['running', 'configured', 'absent', 'not-applicable']),
});

const backupOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('backup'),
  backupId: identifier,
  vmid: z.number().int().min(100).max(999_999_999),
  storageId: identifier,
  mode: z.enum(['snapshot', 'suspend', 'stop']),
  encryptionRequired: z.literal(true),
});

const ingressIntent = z.strictObject({
  protocol: z.enum(['tcp', 'udp']),
  port: z.number().int().min(1).max(65_535),
  sourceCidrs: z.array(cidr).min(1).max(64),
  purpose: boundedText,
  authority: z.literal('explicit-desired-state'),
  approvalId: identifier,
});

const networkOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('network-intent'),
  bridge: identifier,
  vlanAware: z.boolean(),
  ingressIntent: z.array(ingressIntent).max(64),
});

const upgradeOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('upgrade'),
  fromVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  toVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  packageClosureDigest: sha256,
  requiresMaintenance: z.literal(true),
});

const maintenanceOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('maintenance'),
  action: z.enum(['enter', 'exit']),
  reason: boundedText,
});

export const ProxmoxLifecycleOperationSchema = z.discriminatedUnion('kind', [
  repositoryOperation,
  hostConfigurationOperation,
  metadataOperation,
  guestOperation,
  backupOperation,
  networkOperation,
  upgradeOperation,
  maintenanceOperation,
]);

const boundaryForOperation: Record<typeof PROXMOX_LIFECYCLE_OPERATION_KINDS[number], ProxmoxFixtureBoundary> = {
  repository: 'repository',
  'host-configuration': 'maintenance',
  'vm-lxc-metadata': 'vm-lxc-inventory',
  guest: 'guest-agent',
  backup: 'backup',
  'network-intent': 'network-intent',
  upgrade: 'upgrade',
  maintenance: 'maintenance',
};

export const ProxmoxLifecyclePlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: identifier,
  fixture: ProxmoxFixtureSchema,
  role: z.enum(['generic', 'virtualization-host', 'edge-gateway']),
  releaseDigest: sha256,
  recipeDigest: sha256,
  evidence: z.array(ProxmoxFixtureEvidenceSchema).max(512),
  verifiedEvidenceIds: z.array(identifier).max(512),
  now: instant,
  expectedVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  operations: z.array(ProxmoxLifecycleOperationSchema).min(1).max(2_048),
}).superRefine((plan, context) => {
  if (plan.expectedVersion !== plan.fixture.version) {
    context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'plan must bind the observed fixture version' });
  }
  const ids = new Set(plan.operations.map(operation => operation.operationId));
  if (ids.size !== plan.operations.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: 'operation identifiers must be unique' });
  }
  const seen = new Set<string>();
  let maintenanceActive = false;
  for (const [index, operation] of plan.operations.entries()) {
    for (const dependency of operation.dependsOn) {
      if (!ids.has(dependency) || dependency === operation.operationId || !seen.has(dependency)) {
        context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'],
          message: 'dependencies must name earlier distinct operations in this plan' });
      }
    }
    if (operation.kind === 'repository') {
      const observed = plan.fixture.repositories.find(item => item.id === operation.repositoryId);
      if (!observed) context.addIssue({ code: 'custom', path: ['operations', index, 'repositoryId'],
        message: 'repository operation must target an observed repository' });
    }
    if (operation.kind === 'vm-lxc-metadata' || operation.kind === 'guest' || operation.kind === 'backup') {
      const observed = plan.fixture.guests.find(item => item.vmid === operation.vmid);
      if (!observed) context.addIssue({ code: 'custom', path: ['operations', index, 'vmid'],
        message: 'operation must target an observed guest' });
      if (operation.kind === 'vm-lxc-metadata' && observed && observed.kind !== operation.guestKind) {
        context.addIssue({ code: 'custom', path: ['operations', index, 'guestKind'],
          message: 'metadata guest kind must match observed inventory' });
      }
      if (operation.kind === 'guest' && observed?.kind === 'lxc' && operation.guestAgent !== 'not-applicable') {
        context.addIssue({ code: 'custom', path: ['operations', index, 'guestAgent'],
          message: 'LXC guest-agent state must remain not-applicable' });
      }
    }
    if (operation.kind === 'backup') {
      const target = plan.fixture.backupTargets.find(item => item.storageId === operation.storageId);
      if (!target?.available || target.encryption === 'none' || target.encryption === 'unknown') {
        context.addIssue({ code: 'custom', path: ['operations', index, 'storageId'],
          message: 'backup target must be observed, available, and encrypted' });
      }
    }
    if (operation.kind === 'network-intent'
      && !plan.fixture.networks.some(item => item.bridge === operation.bridge)) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'bridge'],
        message: 'network intent must target an observed bridge' });
    }
    if (operation.kind === 'maintenance') maintenanceActive = operation.action === 'enter';
    if (operation.kind === 'upgrade') {
      if (!maintenanceActive) context.addIssue({ code: 'custom', path: ['operations', index],
        message: 'upgrade must follow maintenance entry in the same plan' });
      if (operation.fromVersion !== plan.expectedVersion) context.addIssue({ code: 'custom',
        path: ['operations', index, 'fromVersion'], message: 'upgrade must bind the observed version' });
    }
    seen.add(operation.operationId);
  }
});

export type ProxmoxLifecyclePlan = z.infer<typeof ProxmoxLifecyclePlanSchema>;
export type ProxmoxLifecycleOperation = z.infer<typeof ProxmoxLifecycleOperationSchema>;

export type DisposableProxmoxState = {
  fixtureId: string;
  version: string;
  maintenance: boolean;
  repositories: Map<string, string>;
  hostConfiguration: Map<string, string>;
  metadata: Map<number, string>;
  guests: Map<number, string>;
  backups: Map<string, string>;
  networks: Map<string, string>;
};

export type ProxmoxLifecycleReceipt = Readonly<{
  schemaVersion: 1;
  planId: string;
  fixtureId: string;
  outcome: 'verified';
  finalVersion: string;
  maintenance: boolean;
  operationReceipts: readonly Readonly<{
    operationId: string;
    kind: typeof PROXMOX_LIFECYCLE_OPERATION_KINDS[number];
    boundary: ProxmoxFixtureBoundary;
    outcome: 'applied' | 'unchanged';
    evidenceId: string;
    evidenceDigest: string;
  }>[];
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Executes only against caller-owned in-memory state for a strict disposable Proxmox fixture.
 * Host adapters must independently attest the same typed lifecycle before a support claim is made.
 */
export function executeDisposableProxmoxLifecycle(
  input: unknown,
  state: DisposableProxmoxState,
): ProxmoxLifecycleReceipt {
  const plan = ProxmoxLifecyclePlanSchema.parse(input);
  if (state.fixtureId !== plan.fixture.fixtureId) throw new Error('Proxmox fixture identity changed before apply');
  if (state.version !== plan.expectedVersion) throw new Error('Proxmox version changed before apply');

  const admissions = new Map<string, { boundary: ProxmoxFixtureBoundary; evidenceId: string }>();
  for (const operation of plan.operations) {
    const boundary = boundaryForOperation[operation.kind];
    const decision = preflightProxmoxMutation({ fixture: plan.fixture, boundary, role: plan.role,
      ingressIntent: operation.kind === 'network-intent' ? operation.ingressIntent : [],
      releaseDigest: plan.releaseDigest, recipeDigest: plan.recipeDigest,
      evidence: plan.evidence, verifiedEvidenceIds: plan.verifiedEvidenceIds, now: plan.now });
    if (decision.decision !== 'allow' || !decision.evidenceId) {
      throw new Error(`Proxmox ${operation.operationId} denied: ${decision.reason}`);
    }
    admissions.set(operation.operationId, { boundary, evidenceId: decision.evidenceId });
  }

  const receipts: Array<ProxmoxLifecycleReceipt['operationReceipts'][number]> = [];
  const hasUpgrade = plan.operations.some(operation => operation.kind === 'upgrade');
  const upgradeRequired = plan.operations.some(operation => operation.kind === 'upgrade'
    && state.version !== operation.toVersion);
  for (const operation of plan.operations) {
    let changed = false;
    if (operation.kind === 'repository') {
      const desired = canonical({ enabled: operation.enabled, family: operation.family, suite: operation.suite,
        signedByDigest: operation.signedByDigest });
      changed = state.repositories.get(operation.repositoryId) !== desired;
      state.repositories.set(operation.repositoryId, desired);
    } else if (operation.kind === 'host-configuration') {
      const desired = canonical(operation.value);
      changed = state.hostConfiguration.get(operation.key) !== desired;
      state.hostConfiguration.set(operation.key, desired);
    } else if (operation.kind === 'vm-lxc-metadata') {
      const desired = canonical({ kind: operation.guestKind, description: operation.description,
        tags: [...operation.tags].sort(), protected: operation.protected });
      changed = state.metadata.get(operation.vmid) !== desired;
      state.metadata.set(operation.vmid, desired);
    } else if (operation.kind === 'guest') {
      const desired = canonical({ status: operation.desiredStatus, guestAgent: operation.guestAgent });
      changed = state.guests.get(operation.vmid) !== desired;
      state.guests.set(operation.vmid, desired);
    } else if (operation.kind === 'backup') {
      const desired = canonical({ vmid: operation.vmid, storageId: operation.storageId, mode: operation.mode,
        encrypted: operation.encryptionRequired });
      changed = state.backups.get(operation.backupId) !== desired;
      state.backups.set(operation.backupId, desired);
    } else if (operation.kind === 'network-intent') {
      const desired = canonical({ vlanAware: operation.vlanAware, ingressIntent: operation.ingressIntent });
      changed = state.networks.get(operation.bridge) !== desired;
      state.networks.set(operation.bridge, desired);
    } else if (operation.kind === 'upgrade') {
      changed = state.version !== operation.toVersion;
      state.version = operation.toVersion;
    } else if (hasUpgrade && !upgradeRequired) {
      // An already-satisfied upgrade must not flap the host through maintenance on reapply.
      changed = false;
    } else {
      const desired = operation.action === 'enter';
      changed = state.maintenance !== desired;
      state.maintenance = desired;
    }
    const admission = admissions.get(operation.operationId)!;
    receipts.push(Object.freeze({ operationId: operation.operationId, kind: operation.kind,
      boundary: admission.boundary, outcome: changed ? 'applied' : 'unchanged', evidenceId: admission.evidenceId,
      evidenceDigest: digest({ operation, outcome: changed ? 'applied' : 'unchanged' }) }));
  }
  return Object.freeze({ schemaVersion: 1, planId: plan.planId, fixtureId: plan.fixture.fixtureId,
    outcome: 'verified', finalVersion: state.version, maintenance: state.maintenance,
    operationReceipts: Object.freeze(receipts) });
}
