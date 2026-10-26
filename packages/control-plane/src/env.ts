import { z } from 'zod';

// The Worker's expected bindings/secrets, validated at the boundary (Zod everywhere). All optional
// until provisioned; `providerConfigured()` is the fail-closed gate — no provider call unless EVERY
// required field is present. Keys stay backend-side (Worker secrets via `wrangler secret put`), never
// committed and never read by the client. MASTER-PROMPT §8 (keys backend-side), §15 (fail closed).
export const Env = z
  .object({
    AID_INFERENCE_TOKEN: z.string().min(1).optional(),
    AID_ADMIN_TOKEN: z.string().min(1).optional(),
    AI_GATEWAY_ACCOUNT_ID: z.string().min(1).optional(),
    AI_GATEWAY_NAME: z.string().min(1).optional(),
    DEEPSEEK_API_KEY: z.string().min(1).optional(),
    MAX_TASK_COST_MICROS: z.coerce.number().int().positive().optional(),
  })
  .passthrough();

export type AidEnv = z.infer<typeof Env>;

/** Fail-closed: a provider call is permitted only when every required binding is present. */
export function providerConfigured(env: AidEnv): boolean {
  return Boolean(
    env.AID_INFERENCE_TOKEN && env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_NAME && env.DEEPSEEK_API_KEY,
  );
}
