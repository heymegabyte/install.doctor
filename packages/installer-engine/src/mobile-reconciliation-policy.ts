import { createHash } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const priority = z.enum(['critical', 'high', 'normal', 'low']);

export const MobileHostConditionSchema = z.strictObject({
  powerSource: z.enum(['ac', 'battery', 'unknown']),
  batteryLevel: z.number().min(0).max(1).nullable(),
  connectivity: z.enum(['offline', 'online']),
  meteredNetwork: z.boolean(),
}).superRefine((value, context) => {
  if (value.powerSource === 'battery' && value.batteryLevel === null) {
    context.addIssue({ code: 'custom', path: ['batteryLevel'], message: 'battery power requires a measured battery level' });
  }
  if (value.connectivity === 'offline' && value.meteredNetwork) {
    context.addIssue({ code: 'custom', path: ['meteredNetwork'], message: 'an offline connection cannot be metered' });
  }
});

export const MobileCatchUpPolicySchema = z.strictObject({
  maxItems: z.number().int().min(1).max(128),
  maxWorkUnits: z.number().int().min(1).max(1_000_000),
  maxUnmeteredNetworkBytes: z.number().int().nonnegative().max(1_000_000_000_000),
  maxMeteredNetworkBytes: z.number().int().nonnegative().max(1_000_000_000),
  minimumBatteryLevel: z.number().min(0).max(1),
  allowCriticalOnLowBattery: z.boolean(),
  allowCriticalMeteredAvoidanceOverride: z.boolean(),
});

export const MissedReconciliationWorkSchema = z.strictObject({
  id: identifier,
  coalesceKey: identifier,
  dueAt: timestamp,
  expiresAt: timestamp.nullable(),
  priority,
  powerPolicy: z.enum(['any', 'ac-preferred', 'ac-required']),
  connectivity: z.enum(['none', 'online']),
  meteredPolicy: z.enum(['allow', 'avoid', 'deny']),
  workUnits: z.number().int().min(1).max(1_000_000),
  networkBytes: z.number().int().nonnegative().max(1_000_000_000_000),
}).superRefine((value, context) => {
  if (value.connectivity === 'none' && value.networkBytes !== 0) {
    context.addIssue({ code: 'custom', path: ['networkBytes'], message: 'offline-capable work cannot declare network bytes' });
  }
  if (value.connectivity === 'none' && value.meteredPolicy !== 'allow') {
    context.addIssue({ code: 'custom', path: ['meteredPolicy'], message: 'offline-capable work must use the neutral metered policy' });
  }
  if (value.expiresAt !== null && new Date(value.expiresAt).getTime() <= new Date(value.dueAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'work expiry must follow its due time' });
  }
});

const InputSchema = z.strictObject({
  evaluatedAt: timestamp,
  condition: MobileHostConditionSchema,
  policy: MobileCatchUpPolicySchema,
  missedWork: z.array(MissedReconciliationWorkSchema).max(10_000),
});

const deferReason = z.enum([
  'coalesced', 'expired', 'offline', 'metered-denied', 'metered-deferred',
  'ac-required', 'battery-low', 'item-budget', 'work-budget', 'network-budget',
]);
const DeferredSchema = z.strictObject({ work: MissedReconciliationWorkSchema, reason: deferReason });
const TotalsSchema = z.strictObject({ items: z.number().int().nonnegative(), workUnits: z.number().int().nonnegative(), networkBytes: z.number().int().nonnegative() });
export const MobileCatchUpDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evaluatedAt: timestamp,
  decisionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  condition: MobileHostConditionSchema,
  policy: MobileCatchUpPolicySchema,
  inputItems: z.number().int().nonnegative(),
  coalescedItems: z.number().int().nonnegative(),
  scheduled: z.array(MissedReconciliationWorkSchema).max(128),
  deferred: z.array(DeferredSchema).max(10_000),
  totals: TotalsSchema,
  bounded: z.literal(true),
});

const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareWork(left: z.infer<typeof MissedReconciliationWorkSchema>, right: z.infer<typeof MissedReconciliationWorkSchema>): number {
  return rank[left.priority] - rank[right.priority]
    || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
    || left.id.localeCompare(right.id);
}

export function planMobileHostCatchUp(rawInput: unknown): z.infer<typeof MobileCatchUpDecisionSchema> {
  const input = InputSchema.parse(rawInput);
  const ids = new Set<string>();
  for (const work of input.missedWork) {
    if (ids.has(work.id)) throw new Error(`duplicate missed-work identifier: ${work.id}`);
    ids.add(work.id);
  }

  const retained = new Map<string, z.infer<typeof MissedReconciliationWorkSchema>>();
  const deferred: z.infer<typeof DeferredSchema>[] = [];
  for (const work of [...input.missedWork].sort((left, right) => left.id.localeCompare(right.id))) {
    const existing = retained.get(work.coalesceKey);
    if (!existing) { retained.set(work.coalesceKey, work); continue; }
    // One current operation is sufficient for a periodic stream. Preserve the
    // highest urgency, then the newest occurrence within that urgency.
    const workDue = new Date(work.dueAt).getTime();
    const existingDue = new Date(existing.dueAt).getTime();
    const keepWork = rank[work.priority] < rank[existing.priority]
      || (work.priority === existing.priority && (workDue > existingDue
        || (workDue === existingDue && work.id.localeCompare(existing.id) > 0)));
    if (keepWork) {
      deferred.push({ work: existing, reason: 'coalesced' });
      retained.set(work.coalesceKey, work);
    } else deferred.push({ work, reason: 'coalesced' });
  }

  const eligible: z.infer<typeof MissedReconciliationWorkSchema>[] = [];
  for (const work of [...retained.values()].sort(compareWork)) {
    let reason: z.infer<typeof deferReason> | null = null;
    if (work.expiresAt !== null && new Date(work.expiresAt).getTime() <= new Date(input.evaluatedAt).getTime()) reason = 'expired';
    else if (work.connectivity === 'online' && input.condition.connectivity === 'offline') reason = 'offline';
    else if (work.powerPolicy === 'ac-required' && input.condition.powerSource !== 'ac') reason = 'ac-required';
    else if (input.condition.powerSource === 'battery'
      && input.condition.batteryLevel! < input.policy.minimumBatteryLevel
      && !(work.priority === 'critical' && input.policy.allowCriticalOnLowBattery && work.powerPolicy === 'any')) reason = 'battery-low';
    else if (work.powerPolicy === 'ac-preferred' && input.condition.powerSource === 'battery'
      && work.priority !== 'critical') reason = 'battery-low';
    else if (input.condition.meteredNetwork && work.connectivity === 'online' && work.meteredPolicy === 'deny') reason = 'metered-denied';
    else if (input.condition.meteredNetwork && work.connectivity === 'online' && work.meteredPolicy === 'avoid'
      && !(work.priority === 'critical' && input.policy.allowCriticalMeteredAvoidanceOverride)) reason = 'metered-deferred';
    if (reason) deferred.push({ work, reason }); else eligible.push(work);
  }

  const scheduled: z.infer<typeof MissedReconciliationWorkSchema>[] = [];
  const totals = { items: 0, workUnits: 0, networkBytes: 0 };
  const networkLimit = input.condition.meteredNetwork
    ? input.policy.maxMeteredNetworkBytes : input.policy.maxUnmeteredNetworkBytes;
  for (const work of eligible) {
    let reason: z.infer<typeof deferReason> | null = null;
    if (totals.items + 1 > input.policy.maxItems) reason = 'item-budget';
    else if (totals.workUnits + work.workUnits > input.policy.maxWorkUnits) reason = 'work-budget';
    else if (totals.networkBytes + work.networkBytes > networkLimit) reason = 'network-budget';
    if (reason) { deferred.push({ work, reason }); continue; }
    scheduled.push(work);
    totals.items += 1;
    totals.workUnits += work.workUnits;
    totals.networkBytes += work.networkBytes;
  }

  deferred.sort((left, right) => compareWork(left.work, right.work) || left.reason.localeCompare(right.reason));
  const unsigned = {
    schemaVersion: 1 as const, evaluatedAt: input.evaluatedAt, condition: input.condition, policy: input.policy,
    inputItems: input.missedWork.length,
    coalescedItems: deferred.filter(item => item.reason === 'coalesced').length,
    scheduled, deferred, totals, bounded: true as const,
  };
  return MobileCatchUpDecisionSchema.parse({
    ...unsigned, decisionDigest: createHash('sha256').update(canonical(unsigned)).digest('hex'),
  });
}
