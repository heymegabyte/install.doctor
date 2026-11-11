import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const DriftItemSchema = z.strictObject({
  id,
  cohort: id,
  dependencies: z.array(id).max(256).refine(values => new Set(values).size === values.length, 'dependencies must be unique'),
  effect: z.enum(['configuration', 'package', 'service', 'access', 'destructive']),
  observedDigest: digest,
  desiredDigest: digest,
  rollbackEvidenceDigest: digest.nullable(),
  exception: z.strictObject({ id, reason: z.string().min(1).max(512), expiresAt: timestamp }).nullable(),
}).superRefine((value, context) => {
  if (value.effect !== 'configuration' && value.rollbackEvidenceDigest !== null) {
    context.addIssue({ code: 'custom', path: ['rollbackEvidenceDigest'], message: 'only configuration repair may bind automatic rollback evidence' });
  }
});

const InputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evaluatedAt: timestamp,
  cohortOrder: z.array(id).min(1).max(128).refine(values => new Set(values).size === values.length, 'cohort order must be unique'),
  approvedConfigurationIds: z.array(id).max(10_000).refine(values => new Set(values).size === values.length, 'configuration approvals must be unique'),
  priorOutcomes: z.array(z.strictObject({ itemId: id, outcome: z.enum(['succeeded', 'failed']) })).max(10_000),
  items: z.array(DriftItemSchema).max(10_000),
}).superRefine((value, context) => {
  const itemIds = value.items.map(item => item.id);
  if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: 'custom', path: ['items'], message: 'drift item ids must be unique' });
  if (new Set(value.priorOutcomes.map(item => item.itemId)).size !== value.priorOutcomes.length) {
    context.addIssue({ code: 'custom', path: ['priorOutcomes'], message: 'prior outcomes must be unique' });
  }
  const known = new Set(itemIds);
  for (const [index, item] of value.items.entries()) {
    if (!value.cohortOrder.includes(item.cohort)) context.addIssue({ code: 'custom', path: ['items', index, 'cohort'], message: 'item cohort is not ordered' });
    for (const dependency of item.dependencies) if (!known.has(dependency)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'dependencies'], message: `unknown dependency ${dependency}` });
    }
  }
});

const disposition = z.enum(['automatic-repair', 'intentional-exception', 'manual-approval', 'blocked-dependency', 'later-cohort', 'converged']);
export const StagedDriftRepairDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decisionDigest: digest,
  evaluatedAt: timestamp,
  activeCohort: id.nullable(),
  items: z.array(z.strictObject({
    id, cohort: id, effect: DriftItemSchema.shape.effect, disposition,
    reason: z.string().min(1).max(512), rollbackEvidenceDigest: digest.nullable(),
  })).max(10_000),
});
export type StagedDriftRepairDecision = z.infer<typeof StagedDriftRepairDecisionSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function assertAcyclic(items: z.infer<typeof DriftItemSchema>[]): void {
  const byId = new Map(items.map(item => [item.id, item]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (itemId: string): void => {
    if (visited.has(itemId)) return;
    if (visiting.has(itemId)) throw new Error(`drift dependency cycle includes ${itemId}`);
    visiting.add(itemId);
    for (const dependency of byId.get(itemId)?.dependencies ?? []) visit(dependency);
    visiting.delete(itemId); visited.add(itemId);
  };
  for (const item of items) visit(item.id);
}

export function planStagedDriftRepair(input: unknown): StagedDriftRepairDecision {
  const parsed = InputSchema.parse(input);
  assertAcyclic(parsed.items);
  const evaluatedAt = Date.parse(parsed.evaluatedAt);
  const prior = new Map(parsed.priorOutcomes.map(item => [item.itemId, item.outcome]));
  const drifted = parsed.items.filter(item => item.observedDigest !== item.desiredDigest);
  const isActiveException = (item: z.infer<typeof DriftItemSchema>) => item.exception !== null
    && Date.parse(item.exception.expiresAt) > evaluatedAt;
  const activeCohort = parsed.cohortOrder.find(cohort => drifted.some(item => item.cohort === cohort && !isActiveException(item))) ?? null;
  const items = [...parsed.items].sort((left, right) => left.id.localeCompare(right.id)).map(item => {
    let itemDisposition: z.infer<typeof disposition>;
    let reason: string;
    if (item.observedDigest === item.desiredDigest) {
      itemDisposition = 'converged'; reason = 'observed state already matches desired state';
    } else if (isActiveException(item)) {
      itemDisposition = 'intentional-exception'; reason = `active exception ${item.exception!.id}: ${item.exception!.reason}`;
    } else if (item.cohort !== activeCohort) {
      itemDisposition = 'later-cohort'; reason = `cohort ${item.cohort} waits for ${activeCohort ?? 'no active cohort'}`;
    } else if (item.dependencies.some(dependency => prior.get(dependency) === 'failed')) {
      itemDisposition = 'blocked-dependency'; reason = 'a required dependency failed';
    } else if (item.effect !== 'configuration') {
      itemDisposition = 'manual-approval';
      reason = item.effect === 'access' || item.effect === 'destructive'
        ? `${item.effect} drift is never automatically authorized` : `${item.effect} drift requires a separately approved typed operation`;
    } else if (!parsed.approvedConfigurationIds.includes(item.id) || item.rollbackEvidenceDigest === null) {
      itemDisposition = 'manual-approval'; reason = 'configuration repair lacks exact approval or rollback evidence';
    } else {
      itemDisposition = 'automatic-repair'; reason = 'approved configuration repair has exact rollback evidence';
    }
    return {
      id: item.id, cohort: item.cohort, effect: item.effect, disposition: itemDisposition, reason,
      rollbackEvidenceDigest: itemDisposition === 'automatic-repair' ? item.rollbackEvidenceDigest : null,
    };
  });
  const unsigned = { schemaVersion: 1 as const, evaluatedAt: parsed.evaluatedAt, activeCohort, items };
  return StagedDriftRepairDecisionSchema.parse({
    ...unsigned, decisionDigest: createHash('sha256').update(canonical(unsigned)).digest('hex'),
  });
}
