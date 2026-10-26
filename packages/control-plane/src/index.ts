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

// Persistence read path (MASTER-PROMPT §9) — the stored "current" blueprint for a tenant, from D1.
// The Markdown is the authority; revision + digest are DERIVED on read. 404 when none (with the live
// row count as proof the store was queried); 503 if the binding is missing / the query errors.
// Write + revision-check + auth are a later fire.
app.get('/api/environment/current', async (c) => {
  const tenant = c.req.query('tenant') || '_default';
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const row = await db.prepare('SELECT markdown, updated_at FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (!row) {
      const cnt = await db.prepare('SELECT count(*) AS n FROM blueprints').first();
      return c.json({ error: 'not_found', tenant, stored: cnt?.n ?? 0 }, 404);
    }
    const bp = importMarkdown(row.markdown);
    return c.json({ tenant, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: row.updated_at, markdown: row.markdown });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Constant-time bearer comparison (avoid timing leaks on the admin token).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Persistence WRITE path (MASTER-PROMPT §9) — store a tenant's "current" blueprint in D1 with
// OPTIMISTIC revision-check. Fail-closed auth: requires a configured AID_ADMIN_TOKEN (Worker secret,
// backend-side) AND a matching Bearer. Changing desired state is gated; a stale expectedRevision
// (concurrent edit) → 409 conflict. The Markdown is stored (the authority); the row is a projection.
app.put('/api/environment/current', async (c) => {
  const env = c.env as Record<string, any>;
  const configured = env.AID_ADMIN_TOKEN as string | undefined;
  if (!configured) return c.json({ error: 'write_auth_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !safeEqual(presented, configured)) return c.json({ error: 'unauthorized' }, 401);
  const db = env.DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json()) as { tenant?: string; blueprint?: unknown; expectedRevision?: string };
    const tenant = body.tenant || '_default';
    const bp = validateBlueprint(body.blueprint);
    const existing = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (existing) {
      const current = importMarkdown(existing.markdown);
      if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision)
        return c.json({ error: 'revision_conflict', storedRevision: current.revision, expectedRevision: body.expectedRevision }, 409);
    }
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO blueprints (tenant, markdown, updated_at) VALUES (?,?,?) ON CONFLICT(tenant) DO UPDATE SET markdown=excluded.markdown, updated_at=excluded.updated_at')
      .bind(tenant, exportMarkdown(bp), now)
      .run();
    return c.json({ tenant, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: now });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// Bucket a diff (observed → desired) into reconciliation actions + a blast-radius count.
// '+' = desired has it, observed lacks it → install; '-' = observed has it, desired drops it →
// remove; '~' and scalar 'X → Y' changes → reconfigure.
function planSummary(changes: ReadonlyArray<{ section: string; detail: string }>) {
  let install = 0,
    remove = 0,
    reconfigure = 0;
  for (const ch of changes) {
    const c0 = ch.detail[0];
    if (c0 === '+') install++;
    else if (c0 === '-') remove++;
    else reconfigure++;
  }
  return { total: changes.length, install, remove, reconfigure, noop: changes.length === 0 };
}

// Apply-PREVIEW (dry-run) — MASTER-PROMPT §9, seeds S02 (desired-vs-observed diff) / S03 (restore
// preview) / S12 (impact + blast-radius before mutation). Given a machine's OBSERVED blueprint, compute
// the PLAN to reconcile it to the tenant's STORED desired blueprint (install / remove / reconfigure)
// with a blast-radius summary. NO mutation here: real apply runs on the on-device supervisor (Phase B)
// and fail-closes to 501. Reuses the tested diff engine with from=observed, to=desired.
app.post('/api/environment/apply', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  let body: { tenant?: string; observed?: unknown; dryRun?: boolean };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
  }
  // Mutation cannot run in a Worker — only the device supervisor applies to a real machine. Fail closed.
  if (body.dryRun === false) {
    return c.json(
      { error: 'apply_not_implemented', applied: false, detail: 'real apply runs on the on-device supervisor (Phase B); only dryRun preview is available from the control plane' },
      501,
    );
  }
  const tenant = body.tenant || '_default';
  try {
    const observed = validateBlueprint(body.observed);
    const row = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (!row) return c.json({ error: 'no_desired_state', tenant, detail: 'no stored blueprint for this tenant — PUT /api/environment/current first' }, 404);
    const desired = importMarkdown(row.markdown);
    const changes = diffBlueprints(observed, desired);
    return c.json({
      dryRun: true,
      applied: false,
      tenant,
      desiredRevision: desired.revision,
      desiredDigest: await blueprintDigest(desired),
      observedDigest: await blueprintDigest(observed),
      plan: planSummary(changes),
      changes,
    });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// --- Device identity (Phase B / S04 enrollment, S27 revocation) — ADR docs/aid/decisions/0002 ---
// Opaque bearer tokens; only the SHA-256 is stored, so a DB read never reveals the secret. Revocation
// is a row update (revoked_at), effective on the next request — no blocklist, no signing key.
function randHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Shared admin-bearer gate (reused by enroll + revoke + the PUT write path's pattern). Returns a
// Response to short-circuit on failure, or null when authorized.
function requireAdmin(c: any): Response | null {
  const configured = (c.env as Record<string, any>).AID_ADMIN_TOKEN as string | undefined;
  if (!configured) return c.json({ error: 'write_auth_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !safeEqual(presented, configured)) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

// Enroll a device (admin-gated). Mints a device id + a one-time opaque token; stores only its hash.
app.post('/api/devices/enroll', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { tenant?: string; label?: string };
    const tenant = (body.tenant || '_default').trim();
    if (!tenant) return c.json({ error: 'invalid_request', detail: 'tenant required' }, 400);
    const deviceId = 'dev_' + Date.now().toString(36) + '_' + randHex(6);
    const token = 'aid_' + randHex(32);
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, created_at) VALUES (?,?,?,?,?)')
      .bind(deviceId, tenant, await sha256hex(token), body.label ?? null, now)
      .run();
    return c.json({ deviceId, tenant, token, label: body.label ?? null, createdAt: now, note: 'store the token now — it is not recoverable' }, 201);
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// Device whoami — a device presents its own Bearer token; resolve to its identity (hash lookup,
// rejects unknown/revoked). The primitive later endpoints key per-tenant access on.
app.get('/api/devices/me', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  try {
    const row = await db
      .prepare('SELECT device_id, tenant, label, created_at, revoked_at FROM devices WHERE token_sha256 = ?')
      .bind(await sha256hex(token))
      .first();
    if (!row || row.revoked_at) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ deviceId: row.device_id, tenant: row.tenant, label: row.label, enrolledAt: row.created_at });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Revoke a device (admin-gated, S27). Idempotent: already-revoked or unknown id → 404.
app.post('/api/devices/:id/revoke', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const id = c.req.param('id');
    const now = new Date().toISOString();
    const res = await db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').bind(now, id).run();
    const changed = res.meta?.changes ?? 0;
    if (!changed) return c.json({ error: 'not_found_or_already_revoked', deviceId: id }, 404);
    return c.json({ deviceId: id, revokedAt: now });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
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
