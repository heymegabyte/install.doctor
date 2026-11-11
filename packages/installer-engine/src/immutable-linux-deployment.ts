import { createHash } from 'node:crypto';
import { z } from 'zod';

export const IMMUTABLE_LINUX_LIFECYCLE_PHASES = [
  'clean-install',
  'unchanged-reapply',
  'upgrade',
  'interruption-recovery',
  'restart',
  'rollback',
] as const;

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true }).max(64);
const ostreeRef = z.string().min(3).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/);
const nevra = z.string().min(3).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._+~:-]*$/);
const flatpakRef = z.string().min(5).max(512).regex(/^(?:app|runtime)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);

const DeploymentSchema = z.strictObject({
  checksum: digest,
  origin: ostreeRef,
  version: z.string().min(1).max(128),
  booted: z.boolean(),
  staged: z.boolean(),
  rollbackEligible: z.boolean(),
});

const LayeredPackageSchema = z.strictObject({
  name: identifier,
  nevra,
});

const FlatpakSchema = z.strictObject({
  ref: flatpakRef,
  commit: digest,
  remote: identifier,
  scope: z.enum(['system', 'user']),
  owner: identifier.optional(),
}).superRefine((value, context) => {
  if (value.scope === 'user' && !value.owner) {
    context.addIssue({ code: 'custom', path: ['owner'], message: 'user-scoped Flatpak requires an exact owner identity' });
  }
  if (value.scope === 'system' && value.owner) {
    context.addIssue({ code: 'custom', path: ['owner'], message: 'system-scoped Flatpak cannot carry a user owner identity' });
  }
});

export const ImmutableLinuxObservationSchema = z.strictObject({
  schemaVersion: VERSION,
  observationId: identifier,
  evidenceDigest: digest,
  observedAt: instant,
  readOnly: z.literal(true),
  fixture: z.strictObject({
    fixtureId: identifier,
    isolation: z.literal('disposable-ostree-vm'),
    platform: z.literal('ostree-linux'),
    implementation: z.enum(['rpm-ostree', 'bootc']),
    osName: z.string().min(1).max(128),
    osVersion: z.string().min(1).max(128),
    architecture: z.enum(['x86_64', 'aarch64']),
  }),
  deployments: z.array(DeploymentSchema).min(1).max(32),
  layeredPackages: z.array(LayeredPackageSchema).max(4_096),
  flatpaks: z.array(FlatpakSchema).max(16_384),
  bootId: identifier,
}).superRefine((value, context) => {
  const unique = (values: readonly string[], path: string, message: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message });
  };
  unique(value.deployments.map(item => item.checksum), 'deployments', 'deployment checksums must be unique');
  unique(value.layeredPackages.map(item => item.name), 'layeredPackages', 'layered package names must be unique');
  unique(value.flatpaks.map(item => `${item.scope}:${item.owner ?? ''}:${item.ref}`), 'flatpaks',
    'Flatpak scope, owner, and ref tuples must be unique');
  if (value.deployments.filter(item => item.booted).length !== 1) {
    context.addIssue({ code: 'custom', path: ['deployments'], message: 'exactly one deployment must be booted' });
  }
  if (value.deployments.filter(item => item.staged).length > 1) {
    context.addIssue({ code: 'custom', path: ['deployments'], message: 'at most one deployment may be staged' });
  }
  if (value.deployments.some(item => item.booted && item.staged)) {
    context.addIssue({ code: 'custom', path: ['deployments'], message: 'a booted deployment cannot also be staged' });
  }
});

export const ImmutableLinuxPolicySchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: identifier,
  releaseDigest: digest,
  recipeDigest: digest,
  target: z.strictObject({ checksum: digest, origin: ostreeRef, version: z.string().min(1).max(128) }),
  layeredPackages: z.array(LayeredPackageSchema).max(4_096),
  flatpaks: z.array(FlatpakSchema).max(16_384),
  removal: z.strictObject({ layeredPackages: z.boolean(), flatpaks: z.boolean() }),
  reboot: z.strictObject({
    policy: z.enum(['defer', 'maintenance-window']),
    maintenanceWindowOpen: z.boolean(),
    activeInteractiveUsers: z.number().int().nonnegative().max(100_000),
    workloadsSafeToRestart: z.boolean(),
  }),
  rollback: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('preserve') }),
    z.strictObject({ mode: z.literal('prepare'), targetChecksum: digest }),
  ]),
}).superRefine((value, context) => {
  const packageNames = value.layeredPackages.map(item => item.name);
  if (new Set(packageNames).size !== packageNames.length) {
    context.addIssue({ code: 'custom', path: ['layeredPackages'], message: 'desired layered package names must be unique' });
  }
  const refs = value.flatpaks.map(item => `${item.scope}:${item.owner ?? ''}:${item.ref}`);
  if (new Set(refs).size !== refs.length) {
    context.addIssue({ code: 'custom', path: ['flatpaks'], message: 'desired Flatpak scope and ref pairs must be unique' });
  }
});

export const ImmutableLinuxFixtureEvidenceSchema = z.strictObject({
  schemaVersion: VERSION,
  evidenceId: identifier,
  source: z.literal('disposable-ostree-fixture'),
  fixtureId: identifier,
  implementation: z.enum(['rpm-ostree', 'bootc']),
  releaseDigest: digest,
  recipeDigest: digest,
  observedAt: instant,
  expiresAt: instant,
  independentAttestor: identifier,
  phases: z.array(z.enum(IMMUTABLE_LINUX_LIFECYCLE_PHASES)).length(IMMUTABLE_LINUX_LIFECYCLE_PHASES.length),
  outcome: z.literal('passed'),
}).superRefine((value, context) => {
  if (new Set(value.phases).size !== IMMUTABLE_LINUX_LIFECYCLE_PHASES.length
    || IMMUTABLE_LINUX_LIFECYCLE_PHASES.some(phase => !value.phases.includes(phase))) {
    context.addIssue({ code: 'custom', path: ['phases'], message: 'evidence must cover every immutable Linux lifecycle phase exactly once' });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'evidence expiry must follow observation' });
  }
});

const InputSchema = z.strictObject({
  policy: ImmutableLinuxPolicySchema,
  observation: ImmutableLinuxObservationSchema,
  evidence: z.array(ImmutableLinuxFixtureEvidenceSchema).max(1_024),
  verifiedEvidenceIds: z.array(identifier).max(1_024),
  now: instant,
}).superRefine((value, context) => {
  if (Date.parse(value.observation.observedAt) > Date.parse(value.now)) {
    context.addIssue({ code: 'custom', path: ['observation', 'observedAt'], message: 'observation cannot be from the future' });
  }
  const evidenceIds = value.evidence.map(item => item.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'evidence ids must be unique' });
  }
  if (new Set(value.verifiedEvidenceIds).size !== value.verifiedEvidenceIds.length) {
    context.addIssue({ code: 'custom', path: ['verifiedEvidenceIds'], message: 'verified evidence ids must be unique' });
  }
});

const FindingSchema = z.strictObject({
  severity: z.enum(['info', 'pending', 'blocked']),
  code: z.enum([
    'fixture-evidence-admitted', 'fixture-evidence-missing', 'deployment-change', 'layer-change',
    'flatpak-change', 'removal-not-authorized', 'reboot-deferred', 'reboot-blocked',
    'reboot-admitted', 'rollback-target-missing', 'rollback-target-ineligible',
    'rollback-origin-mismatch', 'rollback-prepared', 'unchanged',
  ]),
  subject: z.string().min(1).max(512),
  detail: z.string().min(1).max(1_024),
});

const OperationSchema = z.strictObject({
  kind: z.enum([
    'stage-deployment', 'install-layer', 'replace-layer', 'remove-layer',
    'install-flatpak', 'update-flatpak', 'remove-flatpak', 'reboot', 'prepare-rollback',
  ]),
  subject: z.string().min(1).max(512),
  from: z.string().min(1).max(512).optional(),
  to: z.string().min(1).max(512).optional(),
  requiresReboot: z.boolean(),
  mutating: z.literal(false),
  rationale: z.string().min(1).max(1_024),
});

export const ImmutableLinuxDeploymentPlanSchema = z.strictObject({
  schemaVersion: VERSION,
  policyId: identifier,
  observationId: identifier,
  fixtureId: identifier,
  planDigest: digest,
  mode: z.literal('read-only'),
  status: z.enum(['unchanged', 'ready', 'pending-reboot', 'blocked']),
  admittedEvidenceId: identifier.optional(),
  bootedChecksum: digest,
  targetChecksum: digest,
  reboot: z.strictObject({
    required: z.boolean(),
    admitted: z.boolean(),
    preBootId: identifier,
    expectedChecksum: digest,
  }),
  rollback: z.strictObject({
    mode: z.enum(['preserve', 'prepare']),
    targetChecksum: digest.optional(),
    admitted: z.boolean(),
  }),
  findings: z.array(FindingSchema).max(100_000),
  operations: z.array(OperationSchema).max(100_000),
});

export type ImmutableLinuxDeploymentPlan = z.infer<typeof ImmutableLinuxDeploymentPlanSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function operationSortKey(operation: z.infer<typeof OperationSchema>): string {
  return `${operation.kind}:${operation.subject}:${operation.from ?? ''}:${operation.to ?? ''}`;
}

/**
 * Creates a deterministic immutable-Linux reconciliation plan. This function is intentionally
 * side-effect free: evidence is admitted only after an external verifier supplies its id, and
 * every returned operation describes future work with `mutating: false`.
 */
export function planImmutableLinuxDeployment(input: unknown): ImmutableLinuxDeploymentPlan {
  const request = InputSchema.parse(input);
  const { observation, policy } = request;
  const booted = observation.deployments.find(deployment => deployment.booted)!;
  const now = Date.parse(request.now);
  const verified = new Set(request.verifiedEvidenceIds);
  const evidence = request.evidence.find(item => verified.has(item.evidenceId)
    && item.fixtureId === observation.fixture.fixtureId
    && item.implementation === observation.fixture.implementation
    && item.releaseDigest === policy.releaseDigest
    && item.recipeDigest === policy.recipeDigest
    && Date.parse(item.observedAt) <= now
    && now < Date.parse(item.expiresAt));

  const findings: z.infer<typeof FindingSchema>[] = [];
  const operations: z.infer<typeof OperationSchema>[] = [];
  if (evidence) findings.push({ severity: 'info', code: 'fixture-evidence-admitted', subject: evidence.evidenceId,
    detail: 'current externally verified disposable OSTree lifecycle evidence matches this release and recipe' });
  else findings.push({ severity: 'blocked', code: 'fixture-evidence-missing', subject: observation.fixture.fixtureId,
    detail: 'current externally verified disposable OSTree lifecycle evidence is required before deployment admission' });

  const deploymentChanged = booted.checksum !== policy.target.checksum
    || booted.origin !== policy.target.origin || booted.version !== policy.target.version;
  const stagedTarget = observation.deployments.find(item => item.staged && item.checksum === policy.target.checksum
    && item.origin === policy.target.origin && item.version === policy.target.version);
  if (deploymentChanged && !stagedTarget) {
    findings.push({ severity: 'pending', code: 'deployment-change', subject: policy.target.checksum,
      detail: `stage exact ${policy.target.origin} deployment ${policy.target.version} by checksum` });
    operations.push({ kind: 'stage-deployment', subject: policy.target.checksum, from: booted.checksum,
      to: policy.target.checksum, requiresReboot: true, mutating: false,
      rationale: 'OSTree deployment identity is checksum-bound rather than index-based' });
  }

  const observedLayers = new Map(observation.layeredPackages.map(item => [item.name, item]));
  const desiredLayers = new Map(policy.layeredPackages.map(item => [item.name, item]));
  for (const desired of policy.layeredPackages) {
    const current = observedLayers.get(desired.name);
    if (!current) operations.push({ kind: 'install-layer', subject: desired.name, to: desired.nevra,
      requiresReboot: true, mutating: false, rationale: 'layer exact desired NEVRA into a new deployment' });
    else if (current.nevra !== desired.nevra) operations.push({ kind: 'replace-layer', subject: desired.name,
      from: current.nevra, to: desired.nevra, requiresReboot: true, mutating: false,
      rationale: 'replace the observed layer with the exact desired NEVRA in a new deployment' });
  }
  for (const current of observation.layeredPackages) if (!desiredLayers.has(current.name)) {
    if (policy.removal.layeredPackages) operations.push({ kind: 'remove-layer', subject: current.name,
      from: current.nevra, requiresReboot: true, mutating: false,
      rationale: 'explicit policy permits removing a layer absent from desired state' });
    else findings.push({ severity: 'blocked', code: 'removal-not-authorized', subject: current.name,
      detail: 'observed layered package is absent from desired state but layer removal is not authorized' });
  }
  if (operations.some(item => ['install-layer', 'replace-layer', 'remove-layer'].includes(item.kind))) {
    findings.push({ severity: 'pending', code: 'layer-change', subject: policy.policyId,
      detail: 'layer reconciliation creates a deployment and takes effect only after verified reboot' });
  }

  const flatpakKey = (item: z.infer<typeof FlatpakSchema>) => `${item.scope}:${item.owner ?? ''}:${item.ref}`;
  const observedFlatpaks = new Map(observation.flatpaks.map(item => [flatpakKey(item), item]));
  const desiredFlatpaks = new Map(policy.flatpaks.map(item => [flatpakKey(item), item]));
  for (const desired of policy.flatpaks) {
    const key = flatpakKey(desired);
    const current = observedFlatpaks.get(key);
    if (!current) operations.push({ kind: 'install-flatpak', subject: key, to: `${desired.remote}@${desired.commit}`,
      requiresReboot: false, mutating: false, rationale: 'install the exact desired Flatpak commit at the declared scope' });
    else if (current.commit !== desired.commit || current.remote !== desired.remote) {
      operations.push({ kind: 'update-flatpak', subject: key, from: `${current.remote}@${current.commit}`,
        to: `${desired.remote}@${desired.commit}`, requiresReboot: false, mutating: false,
        rationale: 'reconcile Flatpak by exact remote and commit without changing the OSTree deployment' });
    }
  }
  for (const current of observation.flatpaks) {
    const key = flatpakKey(current);
    if (desiredFlatpaks.has(key)) continue;
    if (policy.removal.flatpaks) operations.push({ kind: 'remove-flatpak', subject: key,
      from: `${current.remote}@${current.commit}`, requiresReboot: false, mutating: false,
      rationale: 'explicit policy permits removing a Flatpak absent from desired state' });
    else findings.push({ severity: 'blocked', code: 'removal-not-authorized', subject: key,
      detail: 'observed Flatpak is absent from desired state but Flatpak removal is not authorized' });
  }
  if (operations.some(item => item.kind.endsWith('flatpak'))) findings.push({ severity: 'pending',
    code: 'flatpak-change', subject: policy.policyId,
    detail: 'Flatpak reconciliation is commit-bound and independent of the OSTree reboot boundary' });

  let rollbackAdmitted = policy.rollback.mode === 'preserve';
  if (policy.rollback.mode === 'prepare') {
    const rollbackTargetChecksum = policy.rollback.targetChecksum;
    const target = observation.deployments.find(item => item.checksum === rollbackTargetChecksum);
    if (!target) findings.push({ severity: 'blocked', code: 'rollback-target-missing',
      subject: rollbackTargetChecksum, detail: 'rollback target checksum is not present in observed deployments' });
    else if (!target.rollbackEligible || target.booted) findings.push({ severity: 'blocked',
      code: 'rollback-target-ineligible', subject: target.checksum,
      detail: 'rollback requires a retained non-booted deployment explicitly observed as eligible' });
    else if (target.origin !== booted.origin && target.origin !== policy.target.origin) findings.push({ severity: 'blocked',
      code: 'rollback-origin-mismatch', subject: target.checksum,
      detail: 'rollback target origin does not match the booted or desired deployment origin' });
    else {
      rollbackAdmitted = true;
      findings.push({ severity: 'info', code: 'rollback-prepared', subject: target.checksum,
        detail: 'rollback is bound to an observed eligible deployment checksum' });
      operations.push({ kind: 'prepare-rollback', subject: target.checksum, from: booted.checksum,
        to: target.checksum, requiresReboot: false, mutating: false,
        rationale: 'prepare an exact checksum-bound recovery choice without activating it or inferring a deployment index' });
    }
  }

  const rebootRequired = Boolean(stagedTarget) || operations.some(item => item.requiresReboot);
  const rebootAdmitted = rebootRequired && policy.reboot.policy === 'maintenance-window'
    && policy.reboot.maintenanceWindowOpen && policy.reboot.activeInteractiveUsers === 0
    && policy.reboot.workloadsSafeToRestart;
  if (rebootRequired) {
    if (policy.reboot.policy === 'defer') findings.push({ severity: 'pending', code: 'reboot-deferred',
      subject: observation.bootId, detail: 'deployment is staged or planned, but policy explicitly defers reboot' });
    else if (!rebootAdmitted) findings.push({ severity: 'blocked', code: 'reboot-blocked',
      subject: observation.bootId,
      detail: 'reboot requires an open maintenance window, no interactive users, and restart-safe workloads' });
    else {
      findings.push({ severity: 'pending', code: 'reboot-admitted', subject: observation.bootId,
        detail: 'reboot may proceed only through durable continuation and post-boot checksum verification' });
      operations.push({ kind: 'reboot', subject: observation.fixture.fixtureId, from: observation.bootId,
        to: policy.target.checksum, requiresReboot: true, mutating: false,
        rationale: 'reboot activation requires a new boot identity and exact expected deployment checksum' });
    }
  }

  if (operations.length === 0 && findings.every(item => item.severity === 'info')) {
    findings.push({ severity: 'info', code: 'unchanged', subject: policy.policyId,
      detail: 'booted deployment, layered packages, Flatpaks, and rollback policy already match' });
  }
  findings.sort((left, right) => `${left.severity}:${left.code}:${left.subject}:${left.detail}`
    .localeCompare(`${right.severity}:${right.code}:${right.subject}:${right.detail}`));
  operations.sort((left, right) => operationSortKey(left).localeCompare(operationSortKey(right)));
  const blocked = !evidence || !rollbackAdmitted || findings.some(item => item.severity === 'blocked');
  const status = blocked ? 'blocked' as const
    : rebootRequired && !rebootAdmitted ? 'pending-reboot' as const
      : operations.length === 0 ? 'unchanged' as const : 'ready' as const;
  const unsigned = {
    schemaVersion: 1 as const,
    policyId: policy.policyId,
    observationId: observation.observationId,
    fixtureId: observation.fixture.fixtureId,
    mode: 'read-only' as const,
    status,
    ...(evidence ? { admittedEvidenceId: evidence.evidenceId } : {}),
    bootedChecksum: booted.checksum,
    targetChecksum: policy.target.checksum,
    reboot: { required: rebootRequired, admitted: rebootAdmitted, preBootId: observation.bootId,
      expectedChecksum: policy.target.checksum },
    rollback: { mode: policy.rollback.mode, ...(policy.rollback.mode === 'prepare'
      ? { targetChecksum: policy.rollback.targetChecksum } : {}), admitted: rollbackAdmitted },
    findings,
    operations,
  };
  return ImmutableLinuxDeploymentPlanSchema.parse({ ...unsigned, planDigest: createHash('sha256')
    .update(canonical({ ...unsigned, evidenceDigest: observation.evidenceDigest })).digest('hex') });
}

export function statusImmutableLinuxDeployment(planInput: unknown) {
  const plan = ImmutableLinuxDeploymentPlanSchema.parse(planInput);
  return Object.freeze({ policyId: plan.policyId, observationId: plan.observationId,
    fixtureId: plan.fixtureId, planDigest: plan.planDigest, mode: plan.mode, status: plan.status,
    bootedChecksum: plan.bootedChecksum, targetChecksum: plan.targetChecksum,
    reboot: plan.reboot, rollback: plan.rollback, findings: plan.findings });
}

export const ImmutableLinuxActivationResultSchema = z.strictObject({
  status: z.enum(['activated', 'awaiting-reboot', 'wrong-deployment', 'fixture-mismatch']),
  verified: z.boolean(),
  reason: z.enum(['boot-and-deployment-verified', 'boot-identity-unchanged', 'target-checksum-not-booted',
    'fixture-identity-mismatch']),
  expectedChecksum: digest,
  observedChecksum: digest.optional(),
  preBootId: identifier,
  postBootId: identifier,
});

/** Verifies reboot activation from fresh read-only facts; it never invokes rpm-ostree, bootc, or reboot. */
export function inspectImmutableLinuxActivation(planInput: unknown, observationInput: unknown) {
  const plan = ImmutableLinuxDeploymentPlanSchema.parse(planInput);
  const observation = ImmutableLinuxObservationSchema.parse(observationInput);
  const booted = observation.deployments.find(item => item.booted)!;
  const base = { expectedChecksum: plan.reboot.expectedChecksum, observedChecksum: booted.checksum,
    preBootId: plan.reboot.preBootId, postBootId: observation.bootId };
  if (observation.fixture.fixtureId !== plan.fixtureId) return ImmutableLinuxActivationResultSchema.parse({
    status: 'fixture-mismatch', verified: false, reason: 'fixture-identity-mismatch', ...base,
  });
  if (observation.bootId === plan.reboot.preBootId) return ImmutableLinuxActivationResultSchema.parse({
    status: 'awaiting-reboot', verified: false, reason: 'boot-identity-unchanged', ...base,
  });
  if (booted.checksum !== plan.reboot.expectedChecksum) return ImmutableLinuxActivationResultSchema.parse({
    status: 'wrong-deployment', verified: false, reason: 'target-checksum-not-booted', ...base,
  });
  return ImmutableLinuxActivationResultSchema.parse({ status: 'activated', verified: true,
    reason: 'boot-and-deployment-verified', ...base });
}
