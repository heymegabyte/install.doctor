import { z } from 'zod';

export const PROXMOX_FIXTURE_BOUNDARIES = [
  'repository',
  'zfs',
  'vm-lxc-inventory',
  'guest-agent',
  'backup',
  'network-intent',
  'upgrade',
  'maintenance',
] as const;

export const PROXMOX_LIFECYCLE_PHASES = [
  'clean-install',
  'unchanged-reapply',
  'upgrade',
  'interruption-recovery',
  'restart',
  'rollback',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const port = z.number().int().min(1).max(65_535);

const RepositoryObservationSchema = z.strictObject({
  id: identifier,
  family: z.enum(['enterprise', 'no-subscription', 'test', 'ceph-enterprise', 'ceph-no-subscription']),
  enabled: z.boolean(),
  suite: identifier,
  signedByDigest: sha256,
});

const ZfsPoolObservationSchema = z.strictObject({
  name: identifier,
  guid: z.string().regex(/^\d{6,20}$/),
  health: z.enum(['ONLINE', 'DEGRADED', 'FAULTED', 'UNAVAIL', 'SUSPENDED']),
  topology: z.enum(['single', 'mirror', 'raidz1', 'raidz2', 'raidz3', 'draid']),
  encryptedDatasets: z.boolean(),
});

const GuestObservationSchema = z.strictObject({
  vmid: z.number().int().min(100).max(999_999_999),
  kind: z.enum(['qemu', 'lxc']),
  node: identifier,
  status: z.enum(['running', 'stopped', 'paused', 'suspended']),
  guestAgent: z.enum(['running', 'configured', 'absent', 'not-applicable']),
  backupEnabled: z.boolean(),
});

const BackupObservationSchema = z.strictObject({
  storageId: identifier,
  kind: z.enum(['pbs', 'vzdump-directory', 'vzdump-nfs', 'vzdump-cifs']),
  available: z.boolean(),
  encryption: z.enum(['client-side', 'storage-native', 'none', 'unknown']),
});

const NetworkObservationSchema = z.strictObject({
  bridge: identifier,
  kind: z.enum(['linux-bridge', 'ovs-bridge', 'sdn-zone']),
  vlanAware: z.boolean(),
  productionIngressObserved: z.boolean(),
});

export const ProxmoxFixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixtureId: identifier,
  isolation: z.literal('disposable-nested-lab'),
  platform: z.literal('proxmox-ve'),
  architecture: z.enum(['x86_64', 'aarch64']),
  version: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  clusterSize: z.number().int().min(1).max(32),
  repositories: z.array(RepositoryObservationSchema).max(32),
  zfsPools: z.array(ZfsPoolObservationSchema).max(64),
  guests: z.array(GuestObservationSchema).max(4_096),
  backupTargets: z.array(BackupObservationSchema).max(64),
  networks: z.array(NetworkObservationSchema).max(256),
  supportedBoundaries: z.array(z.enum(PROXMOX_FIXTURE_BOUNDARIES)).min(1).max(PROXMOX_FIXTURE_BOUNDARIES.length),
}).superRefine((fixture, context) => {
  const unique = (values: readonly (string | number)[], path: string, message: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message });
  };
  unique(fixture.supportedBoundaries, 'supportedBoundaries', 'supported boundaries must be unique');
  unique(fixture.repositories.map(item => item.id), 'repositories', 'repository ids must be unique');
  unique(fixture.zfsPools.map(item => item.guid), 'zfsPools', 'ZFS pool GUIDs must be unique');
  unique(fixture.guests.map(item => item.vmid), 'guests', 'VM/LXC ids must be unique');
  unique(fixture.backupTargets.map(item => item.storageId), 'backupTargets', 'backup storage ids must be unique');
  unique(fixture.networks.map(item => item.bridge), 'networks', 'network bridge ids must be unique');

  const requiresObserved = (boundary: typeof PROXMOX_FIXTURE_BOUNDARIES[number], count: number, message: string) => {
    if (fixture.supportedBoundaries.includes(boundary) && count === 0) {
      context.addIssue({ code: 'custom', path: [boundary], message });
    }
  };
  requiresObserved('repository', fixture.repositories.length, 'repository coverage requires an observed repository');
  requiresObserved('zfs', fixture.zfsPools.length, 'ZFS coverage requires an observed pool');
  if (fixture.supportedBoundaries.includes('vm-lxc-inventory')) {
    if (!fixture.guests.some(guest => guest.kind === 'qemu')) {
      context.addIssue({ code: 'custom', path: ['guests'], message: 'inventory coverage requires an observed QEMU VM' });
    }
    if (!fixture.guests.some(guest => guest.kind === 'lxc')) {
      context.addIssue({ code: 'custom', path: ['guests'], message: 'inventory coverage requires an observed LXC guest' });
    }
  }
  requiresObserved('guest-agent', fixture.guests.filter(guest => guest.guestAgent !== 'not-applicable').length,
    'guest-agent coverage requires an applicable observed guest');
  requiresObserved('backup', fixture.backupTargets.length, 'backup coverage requires an observed target');
  requiresObserved('network-intent', fixture.networks.length, 'network coverage requires an observed network');
});

export const ProxmoxFixtureEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceId: identifier,
  source: z.literal('real-proxmox-host'),
  fixtureId: identifier,
  boundary: z.enum(PROXMOX_FIXTURE_BOUNDARIES),
  releaseDigest: sha256,
  recipeDigest: sha256,
  observedAt: instant,
  expiresAt: instant,
  independentAttestor: identifier,
  phases: z.array(z.enum(PROXMOX_LIFECYCLE_PHASES)).length(PROXMOX_LIFECYCLE_PHASES.length),
  outcome: z.literal('passed'),
}).superRefine((evidence, context) => {
  if (new Set(evidence.phases).size !== PROXMOX_LIFECYCLE_PHASES.length
    || PROXMOX_LIFECYCLE_PHASES.some(phase => !evidence.phases.includes(phase))) {
    context.addIssue({ code: 'custom', path: ['phases'], message: 'evidence must cover every Proxmox lifecycle phase exactly once' });
  }
  if (Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'evidence expiry must follow observation' });
  }
});

const IngressIntentSchema = z.strictObject({
  protocol: z.enum(['tcp', 'udp']),
  port,
  sourceCidrs: z.array(z.string().min(3).max(64)).min(1).max(64),
  purpose: z.string().min(1).max(256),
  authority: z.literal('explicit-desired-state'),
  approvalId: identifier,
});

export const ProxmoxMutationPreflightSchema = z.strictObject({
  fixture: ProxmoxFixtureSchema,
  boundary: z.enum(PROXMOX_FIXTURE_BOUNDARIES),
  role: z.enum(['generic', 'virtualization-host', 'edge-gateway']),
  ingressIntent: z.array(IngressIntentSchema).max(64),
  releaseDigest: sha256,
  recipeDigest: sha256,
  evidence: z.array(ProxmoxFixtureEvidenceSchema).max(512),
  verifiedEvidenceIds: z.array(identifier).max(512),
  now: instant,
});

export type ProxmoxFixtureBoundary = typeof PROXMOX_FIXTURE_BOUNDARIES[number];
export type ProxmoxMutationPreflightResult = Readonly<{
  decision: 'allow' | 'deny';
  boundary: ProxmoxFixtureBoundary;
  evidenceId?: string;
  reason: 'verified-real-lifecycle-evidence' | 'unsupported-boundary'
    | 'generic-role-cannot-request-ingress' | 'ingress-requires-network-boundary'
    | 'no-current-verified-real-lifecycle-evidence';
}>;

/**
 * Pure admission only: this function performs no Proxmox operation. Parsed receipts become
 * authoritative only when their ids are supplied by an external signature/attestation verifier.
 */
export function preflightProxmoxMutation(input: unknown): ProxmoxMutationPreflightResult {
  const request = ProxmoxMutationPreflightSchema.parse(input);
  if (!request.fixture.supportedBoundaries.includes(request.boundary)) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'unsupported-boundary' });
  }
  if (request.role === 'generic' && request.ingressIntent.length > 0) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'generic-role-cannot-request-ingress' });
  }
  if (request.ingressIntent.length > 0 && request.boundary !== 'network-intent') {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'ingress-requires-network-boundary' });
  }

  const externallyVerified = new Set(request.verifiedEvidenceIds);
  const now = Date.parse(request.now);
  const evidence = request.evidence.find(item => item.fixtureId === request.fixture.fixtureId
    && item.boundary === request.boundary
    && item.releaseDigest === request.releaseDigest
    && item.recipeDigest === request.recipeDigest
    && externallyVerified.has(item.evidenceId)
    && Date.parse(item.observedAt) <= now
    && now < Date.parse(item.expiresAt));
  if (!evidence) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary,
      reason: 'no-current-verified-real-lifecycle-evidence' });
  }
  return Object.freeze({ decision: 'allow', boundary: request.boundary,
    evidenceId: evidence.evidenceId, reason: 'verified-real-lifecycle-evidence' });
}
