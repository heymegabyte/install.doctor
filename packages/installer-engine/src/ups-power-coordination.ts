import { createHash } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

const UpsHardwareSchema = z.strictObject({
  hostId: identifier,
  deviceId: identifier,
  identitySha256: digest,
  driver: z.enum(['nut', 'apcupsd']),
  state: z.enum(['online', 'on-battery', 'low-battery', 'unknown', 'offline']),
  detectedAt: timestamp,
});

const DependencyNodeSchema = z.strictObject({
  id: identifier,
  kind: z.enum(['service', 'workload', 'storage', 'network', 'ups-controller']),
  dependsOn: z.array(identifier).max(1_000),
  shutdownSupported: z.boolean(),
  recoverySupported: z.boolean(),
});

const LiveAuthoritySchema = z.strictObject({
  authorityId: identifier,
  disruptiveMaintenanceAuthorized: z.literal(true),
  maintenanceWindowId: identifier,
  hostId: identifier,
  upsDeviceId: identifier,
  upsIdentitySha256: digest,
  planDigest: digest,
  notBefore: timestamp,
  expiresAt: timestamp,
});

export const UpsShutdownRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: identifier,
  requestedAt: timestamp,
  hostId: identifier,
  upsDeviceId: identifier,
  upsIdentitySha256: digest,
  requestedMode: z.enum(['simulation', 'live']),
  trigger: z.enum(['operator-test', 'on-battery', 'low-runtime', 'low-battery']),
  hardware: UpsHardwareSchema.nullable(),
  dependencies: z.array(DependencyNodeSchema).min(1).max(10_000),
  liveAuthority: LiveAuthoritySchema.nullable(),
}).superRefine((request, context) => {
  const ids = request.dependencies.map(node => node.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['dependencies'], message: 'dependency node ids must be unique' });
  const known = new Set(ids);
  for (const [index, node] of request.dependencies.entries()) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) context.addIssue({ code: 'custom', path: ['dependencies', index, 'dependsOn'], message: 'dependencies must be unique' });
    if (node.dependsOn.includes(node.id)) context.addIssue({ code: 'custom', path: ['dependencies', index, 'dependsOn'], message: 'a node cannot depend on itself' });
    for (const dependency of node.dependsOn) if (!known.has(dependency)) context.addIssue({ code: 'custom', path: ['dependencies', index, 'dependsOn'], message: `unknown dependency ${dependency}` });
  }
});

export type UpsShutdownRequest = z.infer<typeof UpsShutdownRequestSchema>;
export type UpsShutdownPlan = Readonly<{
  schemaVersion: 1;
  planDigest: string;
  requestId: string;
  hostId: string;
  upsDeviceId: string;
  upsIdentitySha256: string;
  mode: 'simulation' | 'authorized-live';
  trigger: UpsShutdownRequest['trigger'];
  shutdownOrder: readonly string[];
  recoveryOrder: readonly string[];
}>;

const UpsShutdownPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planDigest: digest,
  requestId: identifier,
  hostId: identifier,
  upsDeviceId: identifier,
  upsIdentitySha256: digest,
  mode: z.enum(['simulation', 'authorized-live']),
  trigger: z.enum(['operator-test', 'on-battery', 'low-runtime', 'low-battery']),
  shutdownOrder: z.array(identifier).min(1).max(10_000),
  recoveryOrder: z.array(identifier).min(1).max(10_000),
});

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function dependencyOrder(nodes: UpsShutdownRequest['dependencies']): string[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`UPS dependency graph contains a cycle at ${id}`);
    visiting.add(id);
    const node = byId.get(id)!;
    for (const dependency of [...node.dependsOn].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of [...byId.keys()].sort()) visit(id);
  return ordered;
}

function planBody(request: UpsShutdownRequest, recoveryOrder: readonly string[]) {
  return {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    hostId: request.hostId,
    upsDeviceId: request.upsDeviceId,
    upsIdentitySha256: request.upsIdentitySha256,
    trigger: request.trigger,
    shutdownOrder: [...recoveryOrder].reverse(),
    recoveryOrder,
  };
}

/**
 * Produce a side-effect-free shutdown plan. Live mode is admitted only when a
 * short-lived disruptive-maintenance authority binds the exact plan and UPS.
 */
export function planUpsDependencyShutdown(input: unknown, nowInput: string): UpsShutdownPlan {
  const request = UpsShutdownRequestSchema.parse(input);
  const now = timestamp.parse(nowInput);
  if (!request.hardware) throw new Error('No supported UPS hardware was detected');
  if (request.hardware.hostId !== request.hostId
    || request.hardware.deviceId !== request.upsDeviceId
    || request.hardware.identitySha256 !== request.upsIdentitySha256) {
    throw new Error('Detected UPS hardware identity does not match the requested host and device');
  }
  if (request.hardware.state === 'unknown' || request.hardware.state === 'offline') {
    throw new Error(`Detected UPS ${request.upsDeviceId} is not usable: ${request.hardware.state}`);
  }
  const nowMs = Date.parse(now);
  const detectedMs = Date.parse(request.hardware.detectedAt);
  if (detectedMs > nowMs) throw new Error('UPS detection evidence is from the future');
  if (nowMs - detectedMs > 300_000) throw new Error('UPS detection evidence is stale');
  if (Date.parse(request.requestedAt) > nowMs) throw new Error('UPS shutdown request is from the future');
  for (const node of request.dependencies) {
    if (!node.shutdownSupported || !node.recoverySupported) throw new Error(`Node ${node.id} lacks safe shutdown or recovery support`);
  }
  const controllers = request.dependencies.filter(node => node.kind === 'ups-controller');
  if (controllers.length !== 1 || controllers[0]!.dependsOn.length !== 0) throw new Error('Exactly one root UPS controller is required');
  const byId = new Map(request.dependencies.map(node => [node.id, node]));
  const controllerId = controllers[0]!.id;
  const reachesController = (id: string, seen = new Set<string>()): boolean => {
    if (id === controllerId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return byId.get(id)!.dependsOn.some(dependency => reachesController(dependency, seen));
  };
  for (const node of request.dependencies) if (!reachesController(node.id)) throw new Error(`Node ${node.id} is not protected by the UPS controller dependency root`);
  const recoveryOrder = dependencyOrder(request.dependencies);
  const body = planBody(request, recoveryOrder);
  const planDigest = sha256(body);
  if (request.requestedMode === 'live') {
    const authority = request.liveAuthority;
    if (!authority) throw new Error('Live UPS shutdown requires explicit disruptive maintenance authority');
    if (authority.hostId !== request.hostId
      || authority.upsDeviceId !== request.upsDeviceId
      || authority.upsIdentitySha256 !== request.upsIdentitySha256
      || authority.planDigest !== planDigest) {
      throw new Error('Live authority is not bound to the exact host, UPS, and shutdown plan');
    }
    if (Date.parse(authority.notBefore) > Date.parse(now) || Date.parse(now) >= Date.parse(authority.expiresAt)) {
      throw new Error('Live UPS shutdown authority is outside its maintenance window');
    }
  } else if (request.liveAuthority) {
    throw new Error('Simulation plans must not carry live disruptive authority');
  }
  return Object.freeze({
    ...body,
    planDigest,
    mode: request.requestedMode === 'live' ? 'authorized-live' as const : 'simulation' as const,
    shutdownOrder: Object.freeze(body.shutdownOrder),
    recoveryOrder: Object.freeze([...body.recoveryOrder]),
  });
}

const ProgressSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planDigest: digest,
  completedShutdowns: z.array(identifier).max(10_000),
  activeNodeId: identifier.nullable(),
});

/**
 * Cancel only at a proven operation boundary and return the exact compensating
 * recovery order. An in-flight effect is uncertain and requires inspection.
 */
export function planUpsCancellationRecovery(planInput: unknown, progressInput: unknown) {
  const plan = UpsShutdownPlanSchema.parse(planInput);
  if (new Set(plan.shutdownOrder).size !== plan.shutdownOrder.length
    || new Set(plan.recoveryOrder).size !== plan.recoveryOrder.length
    || plan.shutdownOrder.length !== plan.recoveryOrder.length
    || plan.shutdownOrder.some((id, index) => id !== plan.recoveryOrder[plan.recoveryOrder.length - 1 - index])) {
    throw new Error('UPS shutdown and recovery orders are not exact reverses');
  }
  const { planDigest, mode: _mode, ...body } = plan;
  if (sha256(body) !== planDigest) throw new Error('UPS shutdown plan digest does not match its contents');
  const progress = ProgressSchema.parse(progressInput);
  if (progress.planDigest !== plan.planDigest) throw new Error('Shutdown progress does not match the UPS plan');
  if (progress.activeNodeId !== null) return Object.freeze({ status: 'inspection-required' as const, reason: 'shutdown-effect-in-flight' as const, recoveryOrder: [] as const });
  if (new Set(progress.completedShutdowns).size !== progress.completedShutdowns.length) throw new Error('Completed shutdown nodes must be unique');
  const expectedPrefix = plan.shutdownOrder.slice(0, progress.completedShutdowns.length);
  if (expectedPrefix.some((id, index) => id !== progress.completedShutdowns[index])) throw new Error('Completed shutdowns are not an exact plan prefix');
  const completed = new Set(progress.completedShutdowns);
  const recoveryOrder = plan.recoveryOrder.filter(id => completed.has(id));
  return Object.freeze({
    status: recoveryOrder.length === 0 ? 'cancelled-clean' as const : 'recovery-required' as const,
    reason: recoveryOrder.length === 0 ? 'no-effects-applied' as const : 'recover-completed-shutdowns' as const,
    recoveryOrder: Object.freeze(recoveryOrder),
  });
}
