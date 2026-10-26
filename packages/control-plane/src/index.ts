import { Hono } from 'hono';
import { z } from 'zod';
// Reuse aid-core's route contract (don't re-implement — MASTER-PROMPT §8). Relative import so
// esbuild bundles the zero-dep contracts at deploy time; no workspace link needed.
import { ROUTES, chooseRoute, validateBlueprint, exportMarkdown, importMarkdown, blueprintDigest, type Blueprint } from '../../aid-core/src/core';
import { Env, providerConfigured } from './env';
import { reserveBudget, DEFAULT_CEILING_MICROS } from './budget';

// Inference request body (Zod boundary) — estimated cost drives the budget reservation.
const InferRequest = z.object({ estimateMicros: z.number().int().nonnegative().default(0) }).passthrough();

const app = new Hono();

// Boundary schema (Zod everywhere) — mirrors aid-core chooseRoute's accepted enums.
const ResolveRequest = z
  .object({
    sensitivity: z.enum(['normal', 'restricted']).default('normal'),
    kind: z.enum(['routine', 'code', 'research', 'architecture']).default('routine'),
    verificationFailed: z.boolean().default(false),
    allowPremium: z.boolean().default(false),
  })
  .strict();

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'aid-control-plane', phase: 'A-skeleton', routes: ROUTES.length }),
);

// Routing-policy decision surface (MASTER-PROMPT §8). Reuses aid-core's tested chooseRoute at the
// HTTP boundary: restricted sensitivity fails CLOSED (never escalates to premium), and premium
// requires explicit opt-in. Performs NO inference — no provider call, no keys, no cost — it only
// returns the route it WOULD use. Registered before the :route param handler so it wins.
app.post('/api/ai/v1/resolve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResolveRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const { sensitivity, kind, verificationFailed, allowPremium } = parsed.data;
  const route = chooseRoute({ sensitivity, kind, verificationFailed }, allowPremium);
  return c.json({
    route,
    model: `dynamic/${route}`,
    provider: 'projectsites→deepseek',
    policy: { restrictedFailsClosed: sensitivity === 'restricted', premiumOptIn: allowPremium },
    wiring: 'policy-only — no inference performed (provider / AI Gateway wiring pending)',
  });
});

// Proposed inference proxy (MASTER-PROMPT §8): aid → this adapter → shared ProjectSites orchestrator
// → one CF AI Gateway → permitted provider. SKELETON ONLY: validates the requested route alias against
// aid-core's ROUTES but performs NO provider call (no keys here — provider keys stay backend-side).
// ENVIRONMENT.md — the one portable configuration authority (MASTER-PROMPT §9, seed S01). Reuses
// aid-core's tested contracts: strict schema validation (unknown fields rejected), a lossless
// single-file Markdown round-trip, and a stable key-order-independent SHA-256 content digest. Pure
// data transforms — no secrets, no persistence (projections/storage are a later slice).
const envErr = (e: unknown) => (e instanceof Error ? e.message : String(e));
app.post('/api/environment/validate', async (c) => {
  try {
    const bp = validateBlueprint(await c.req.json());
    return c.json({ valid: true, revision: bp.revision, digest: await blueprintDigest(bp) });
  } catch (e) {
    return c.json({ valid: false, error: envErr(e) }, 400);
  }
});
app.post('/api/environment/export', async (c) => {
  try {
    return c.text(exportMarkdown(await c.req.json()), 200, { 'content-type': 'text/markdown; charset=utf-8' });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});
app.post('/api/environment/import', async (c) => {
  try {
    const bp = importMarkdown(await c.req.text());
    return c.json({ blueprint: bp, digest: await blueprintDigest(bp) });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});

// Structured blueprint-vs-blueprint diff for the §9 Environment "Diff" action — added/removed/changed
// packages, machines, services, routing, skills, privacy, revision. A pure view over two validated
// blueprints (no persistence yet); `changed` reflects any difference the digests would capture.
function diffMembers(
  label: string,
  from: ReadonlyArray<{ id: string }>,
  to: ReadonlyArray<{ id: string }>,
  out: Array<{ section: string; detail: string }>,
): void {
  const fa = new Map(from.map((x) => [x.id, JSON.stringify(x)]));
  const ta = new Map(to.map((x) => [x.id, JSON.stringify(x)]));
  for (const id of ta.keys()) if (!fa.has(id)) out.push({ section: label, detail: '+' + id });
  for (const id of fa.keys()) if (!ta.has(id)) out.push({ section: label, detail: '-' + id });
  for (const id of ta.keys()) if (fa.has(id) && fa.get(id) !== ta.get(id)) out.push({ section: label, detail: '~' + id });
}
function diffBlueprints(from: Blueprint, to: Blueprint): Array<{ section: string; detail: string }> {
  const out: Array<{ section: string; detail: string }> = [];
  if (from.revision !== to.revision) out.push({ section: 'revision', detail: `${from.revision} → ${to.revision}` });
  const fp = new Set(from.defaults.packages);
  const tp = new Set(to.defaults.packages);
  const added = [...tp].filter((p) => !fp.has(p));
  const removed = [...fp].filter((p) => !tp.has(p));
  if (added.length) out.push({ section: 'defaults.packages', detail: '+' + added.join(', ') });
  if (removed.length) out.push({ section: 'defaults.packages', detail: '-' + removed.join(', ') });
  if (from.defaults.shellHistory !== to.defaults.shellHistory)
    out.push({ section: 'defaults.shellHistory', detail: `${from.defaults.shellHistory} → ${to.defaults.shellHistory}` });
  diffMembers('machines', from.machines, to.machines, out);
  diffMembers('services', from.services, to.services, out);
  for (const k of ['engine', 'preferredProvider', 'allowPremium', 'maxTaskCostMicros'] as const)
    if (from.routing[k] !== to.routing[k]) out.push({ section: 'routing.' + k, detail: `${from.routing[k]} → ${to.routing[k]}` });
  if (from.skills.commit !== to.skills.commit)
    out.push({ section: 'skills.commit', detail: `${from.skills.commit.slice(0, 8)} → ${to.skills.commit.slice(0, 8)}` });
  for (const k of ['shellAnalysis', 'screenshots', 'terminalInput', 'productLearning'] as const)
    if (from.privacy[k] !== to.privacy[k]) out.push({ section: 'privacy.' + k, detail: `${from.privacy[k]} → ${to.privacy[k]}` });
  return out;
}
app.post('/api/environment/diff', async (c) => {
  try {
    const body = (await c.req.json()) as { from?: unknown; to?: unknown };
    const from = validateBlueprint(body.from);
    const to = validateBlueprint(body.to);
    const changes = diffBlueprints(from, to);
    return c.json({ changed: changes.length > 0, fromDigest: await blueprintDigest(from), toDigest: await blueprintDigest(to), changes });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});

// Inference attempt (POST). Fail-closed pre-flight gates (MASTER-PROMPT §8, §15), in order:
//   unknown alias → 404 · restricted → 451 (approved private/local route only, never the public
//   gateway) · provider not configured → 503 (keys stay backend-side) · all gates pass → 501
//   (provider call-path still pending — the next slice).
app.post('/api/ai/v1/:route', async (c) => {
  const route = c.req.param('route');
  if (!(ROUTES as readonly string[]).includes(route)) {
    return c.json({ error: 'unknown_route_alias', known: ROUTES }, 404);
  }
  if (route === 'restricted') {
    return c.json(
      { error: 'restricted_route', detail: 'restricted data must use an approved private/local route — never the public gateway', route },
      451,
    );
  }
  const env = Env.safeParse(c.env).data ?? {};
  const parsed = InferRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  // atomic cost reservation BEFORE any provider work (fail closed on over-ceiling / unknown pricing)
  const ceilingMicros = env.MAX_TASK_COST_MICROS ?? DEFAULT_CEILING_MICROS;
  const reservation = reserveBudget(parsed.data.estimateMicros, ceilingMicros);
  if (!reservation.ok) {
    return c.json({ error: 'budget', reason: reservation.reason, ceilingMicros, estimateMicros: parsed.data.estimateMicros, route }, 402);
  }
  if (!providerConfigured(env)) {
    return c.json(
      { error: 'provider_not_configured', detail: 'AID_INFERENCE_TOKEN + AI_GATEWAY_* + DEEPSEEK_API_KEY not set (keys stay backend-side)', route },
      503,
    );
  }
  return c.json(
    { error: 'not_implemented', detail: 'provider call-path pending — DeepSeek via one CF AI Gateway through ProjectSites', route },
    501,
  );
});

// Non-POST on a route alias → 405 (inference uses POST); unknown alias → 404.
app.all('/api/ai/v1/:route', (c) => {
  const route = c.req.param('route');
  if (!(ROUTES as readonly string[]).includes(route)) {
    return c.json({ error: 'unknown_route_alias', known: ROUTES }, 404);
  }
  return c.json({ error: 'method_not_allowed', detail: 'inference uses POST', route }, 405);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
