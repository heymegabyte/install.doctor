import { z } from 'zod';
import {
  ReviewedPlanBindingSchema,
  type ReviewedPlanBinding,
} from '../../installer-engine/src/reviewed-plan-binding.ts';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
type D1Result = { readonly meta?: { readonly changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1DatabaseLike = { prepare(sql: string): D1Statement };
type Row = { run_intent_id: string; review_id: string; binding_digest: string; binding_json: string };

const INSERT = `INSERT OR IGNORE INTO broker_reviewed_plan_bindings
  (run_intent_id, review_id, binding_digest, binding_json, recorded_at) VALUES (?, ?, ?, ?, ?)`;
const LOAD = `SELECT run_intent_id, review_id, binding_digest, binding_json
  FROM broker_reviewed_plan_bindings WHERE run_intent_id = ? LIMIT 1`;

function fromRow(row: Row): ReviewedPlanBinding {
  const binding = ReviewedPlanBindingSchema.parse(JSON.parse(row.binding_json));
  if (binding.reviewId !== row.review_id || binding.bindingDigest !== row.binding_digest) {
    throw new Error('persisted reviewed plan index differs from immutable binding');
  }
  return binding;
}

export function createBrokerReviewedPlanD1Store(database: D1DatabaseLike, options: {
  readonly now?: () => Date;
} = {}) {
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async persist(runIntentIdValue: string, rawBinding: unknown): Promise<boolean> {
      const runIntentId = id.parse(runIntentIdValue);
      const binding = ReviewedPlanBindingSchema.parse(rawBinding);
      const json = JSON.stringify(binding);
      const result = await database.prepare(INSERT).bind(runIntentId, binding.reviewId,
        binding.bindingDigest, json, now().toISOString()).run();
      if (result.meta?.changes === 1) return true;
      const row = await database.prepare(LOAD).bind(runIntentId).first<Row>();
      if (!row || JSON.stringify(fromRow(row)) !== json) throw new Error('reviewed plan binding collision');
      return false;
    },
    async load(runIntentIdValue: string): Promise<ReviewedPlanBinding | null> {
      const row = await database.prepare(LOAD).bind(id.parse(runIntentIdValue)).first<Row>();
      return row ? fromRow(row) : null;
    },
  });
}
