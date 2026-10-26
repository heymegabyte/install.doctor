// Per-task cost ceiling. Matches the Blueprint's maxTaskCostMicros (aid-core fixture uses 250000 =
// $0.25/task at 1 micro = 1e-6 USD). Overridable per-deploy by the MAX_TASK_COST_MICROS env var.
export const DEFAULT_CEILING_MICROS = 250000;

export type Reservation = { ok: true } | { ok: false; reason: string };

// Cost pre-flight reservation (MASTER-PROMPT §8, §15 — "a settings number is not enforcement"; unknown
// pricing must not pick an unlimited-cost route). Fails CLOSED: a missing/invalid ceiling or an
// estimate over the ceiling is REFUSED before any provider work. (A truly atomic reservation across
// fan-out needs a durable counter — D1/DO — a later slice; this is the per-request gate.)
export function reserveBudget(estimateMicros: number, ceilingMicros: number | undefined): Reservation {
  if (!Number.isFinite(estimateMicros) || estimateMicros < 0) return { ok: false, reason: 'invalid_estimate' };
  if (!ceilingMicros || !Number.isFinite(ceilingMicros) || ceilingMicros <= 0) return { ok: false, reason: 'no_budget_ceiling' };
  if (estimateMicros > ceilingMicros) return { ok: false, reason: 'estimate_exceeds_ceiling' };
  return { ok: true };
}
