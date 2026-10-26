import { Hono } from 'hono';
import { z } from 'zod';
// Reuse aid-core's route contract (don't re-implement — MASTER-PROMPT §8). Relative import so
// esbuild bundles the zero-dep contracts at deploy time; no workspace link needed.
import { ROUTES, chooseRoute, validateBlueprint, exportMarkdown, importMarkdown, blueprintDigest, APP_URL, type Blueprint } from '../../aid-core/src/core';
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

// Minimal browser surface at app.install.doctor (MASTER-PROMPT §2). The full cinematic 5-section app is
// the §16 build; this is an HONEST landing + a working pairing-approval page so the domain is live and
// the `aid-pair` verifyUrl resolves end-to-end. Server-rendered HTML, no framework.
const PAGE_CSS =
  '*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#060610;color:#e6e8ef}' +
  '.wrap{max-width:680px;margin:0 auto;padding:48px 24px}a{color:#00E5FF}h1{font-size:2rem;margin:.2em 0}.mono{font-family:ui-monospace,Menlo,monospace}' +
  '.card{background:#0d0f1a;border:1px solid #1b2030;border-radius:12px;padding:20px;margin:18px 0}' +
  '.code{font-family:ui-monospace,monospace;font-size:1.6rem;letter-spacing:.15em;color:#00E5FF;background:#0a0c16;border:1px solid #1b2030;border-radius:8px;padding:12px 16px;display:inline-block}' +
  'input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #2a3147;background:#0a0c16;color:#e6e8ef}' +
  'button{background:#00E5FF;color:#060610;font-weight:700;border:0;cursor:pointer}.muted{color:#8b93a7;font-size:.9rem}';
function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_CSS}</style></head><body><div class=wrap>${body}</div></body></html>`;
}
app.get('/', (c) =>
  c.html(
    htmlPage(
      'aid · install.doctor',
      `<h1>aid <span class=muted>· install.doctor</span></h1>
<p>Browser-first environment engineer. Describe your environment once; make each authorized computer a verified, cooperating part of it.</p>
<div class=card><h3>Pair a machine</h3>
<p>On the machine, run the bootstrap, then pair:</p>
<p class=mono>bash &lt;(curl -sSL https://install.doctor/start)</p>
<p class=mono>aid-pair</p>
<p class=muted>It prints a short code and opens <span class=mono>/pair?code=…</span> here for you to approve.</p></div>
<p class=muted>API health: <a href="/health">/health</a> — control plane live. The full dashboard (Machines · App Store · Recommendations · Automations · History) is in progress.</p>`,
    ),
  ),
);
app.get('/pair', (c) => {
  const code = (c.req.query('code') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 16);
  return c.html(
    htmlPage(
      'Pair device · aid',
      `<h1>Pair this device</h1>
${code ? `<p>Approve pairing code:</p><p class=code>${code}</p>` : '<p class=muted>No code in the URL. Run <span class=mono>aid-pair</span> on the machine to get one.</p>'}
<div class=card><h3>Approve (administrator)</h3>
<p class=muted>Paste your admin token to approve this device. A signed-in owner session replaces this step soon.</p>
<p><input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:100%"></p>
<p><button onclick="approve()">Approve pairing</button></p>
<p id=out class=muted></p></div>
<script>
async function approve(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim();
  if(!tok){out.textContent='Enter the admin token.';return}
  out.textContent='Approving…';
  try{
    var r=await fetch('/api/devices/pair/approve',{method:'POST',headers:{'authorization':'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify({code:${JSON.stringify(code)}})});
    var j=await r.json();
    out.textContent=r.ok?'✓ approved — the machine will claim its token shortly.':('✗ '+(j.error||r.status));
  }catch(e){out.textContent='✗ '+e}
}
</script>`,
    ),
  );
});

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

// Shared apply-PREVIEW computation (observed → desired for a tenant) — one owner for the dry-run plan,
// reused by the tenant-in-body endpoint and the device-scoped one. Returns a {status, body} envelope so
// each caller forwards it with c.json(). Invalid observed → 400, no stored desired → 404.
async function computeApplyPreview(
  db: any,
  tenant: string,
  observedRaw: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let observed: Blueprint;
  try {
    observed = validateBlueprint(observedRaw);
  } catch (e) {
    return { status: 400, body: { error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) } };
  }
  const row = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
  if (!row) return { status: 404, body: { error: 'no_desired_state', tenant, detail: 'no stored blueprint for this tenant — PUT /api/environment/current first' } };
  const desired = importMarkdown(row.markdown);
  const changes = diffBlueprints(observed, desired);
  return {
    status: 200,
    body: {
      dryRun: true,
      applied: false,
      tenant,
      desiredRevision: desired.revision,
      desiredDigest: await blueprintDigest(desired),
      observedDigest: await blueprintDigest(observed),
      plan: planSummary(changes),
      changes,
    },
  };
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
  const result = await computeApplyPreview(db, body.tenant || '_default', body.observed);
  return c.json(result.body, result.status as any);
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
// Resolve a device Bearer token to its identity via hash lookup (rejects unknown / revoked). Returns
// null when absent/invalid/revoked so callers reply 401. One owner for device auth — shared by
// /devices/me + the device-scoped environment endpoints.
async function resolveDevice(
  db: any,
  authHeader: string | undefined,
): Promise<{ deviceId: string; tenant: string; label: string | null; createdAt: string } | null> {
  const token = (authHeader || '').startsWith('Bearer ') ? (authHeader as string).slice(7) : '';
  if (!token) return null;
  const row = await db
    .prepare('SELECT device_id, tenant, label, created_at, revoked_at FROM devices WHERE token_sha256 = ?')
    .bind(await sha256hex(token))
    .first();
  if (!row || row.revoked_at) return null;
  return { deviceId: row.device_id, tenant: row.tenant, label: row.label, createdAt: row.created_at };
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
  try {
    const dev = await resolveDevice(db, c.req.header('authorization'));
    if (!dev) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, label: dev.label, enrolledAt: dev.createdAt });
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

// --- Device-SCOPED environment access (fire #17) — the tenant is resolved FROM the device token, never
// the URL/body. A real machine authenticates with its OWN token to fetch its desired state + preview the
// reconciliation plan: no admin token, no tenant in the request. Completes the E2E loop (authenticate →
// fetch desired → preview) and closes the READ-unauthenticated gap for real tenants. ---
app.get('/api/device/current', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  try {
    const row = await db.prepare('SELECT markdown, updated_at FROM blueprints WHERE tenant = ?').bind(dev.tenant).first();
    if (!row) return c.json({ error: 'not_found', tenant: dev.tenant, deviceId: dev.deviceId }, 404);
    const bp = importMarkdown(row.markdown);
    return c.json({ tenant: dev.tenant, deviceId: dev.deviceId, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: row.updated_at, markdown: row.markdown });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
// Device-scoped RAW ENVIRONMENT.md (the §9 Export / Copy-setup surface) — a device fetches its desired
// blueprint as Markdown it writes to disk directly (no JSON decode needed on the machine).
app.get('/api/device/current.md', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  try {
    const row = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(dev.tenant).first();
    if (!row) return c.json({ error: 'not_found', tenant: dev.tenant }, 404);
    return c.text(row.markdown, 200, { 'content-type': 'text/markdown; charset=utf-8' });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
app.post('/api/device/apply', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  let body: { observed?: unknown; dryRun?: boolean };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
  }
  if (body.dryRun === false) {
    return c.json({ error: 'apply_not_implemented', applied: false, detail: 'real apply runs on the on-device supervisor (Phase B)' }, 501);
  }
  const result = await computeApplyPreview(db, dev.tenant, body.observed);
  if (result.status === 200) result.body.deviceId = dev.deviceId;
  return c.json(result.body, result.status as any);
});

// --- History (S14 run registration, S15 searchable replay) — a device REPORTS each apply/run/check
// event (the "report result" half of the E2E loop); stored per-device + per-tenant in D1, listed
// newest-first. Device-scoped: a device records + reads its OWN history. Tenant-wide/admin views +
// diff/cost correlation are later slices. ---
const ReportRequest = z
  .object({
    kind: z.enum(['apply', 'run', 'enroll', 'check', 'other']).default('run'),
    status: z.enum(['success', 'failed', 'partial', 'preview']).default('success'),
    revision: z.string().max(200).optional(),
    summary: z.string().max(500).optional(),
    detail: z.unknown().optional(),
  })
  .strict();
app.post('/api/device/report', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const parsed = ReportRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  try {
    const id = 'hist_' + Date.now().toString(36) + '_' + randHex(6);
    const now = new Date().toISOString();
    const { kind, status, revision, summary, detail } = parsed.data;
    await db
      .prepare('INSERT INTO history (id, device_id, tenant, kind, status, revision, summary, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, dev.deviceId, dev.tenant, kind, status, revision ?? null, summary ?? null, detail === undefined ? null : JSON.stringify(detail), now)
      .run();
    return c.json({ id, deviceId: dev.deviceId, tenant: dev.tenant, kind, status, createdAt: now }, 201);
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
app.get('/api/device/history', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  try {
    const rs = await db
      .prepare('SELECT id, kind, status, revision, summary, detail, created_at FROM history WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(dev.deviceId, limit)
      .all();
    const items = (rs.results || []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      revision: r.revision,
      summary: r.summary,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
    }));
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Tenant/admin HISTORY (S15) — the operator's FLEET replay: ALL devices' events for a tenant, newest
// first. Admin-gated (AID_ADMIN_TOKEN). Complements the device-scoped GET /api/device/history (one
// device's own runs); returns device_id so the operator sees WHICH machine reported.
app.get('/api/history', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  try {
    const rs = await db
      .prepare('SELECT id, device_id, kind, status, revision, summary, detail, created_at FROM history WHERE tenant = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(tenant, limit)
      .all();
    const items = (rs.results || []).map((r: any) => ({
      id: r.id,
      deviceId: r.device_id,
      kind: r.kind,
      status: r.status,
      revision: r.revision,
      summary: r.summary,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
    }));
    return c.json({ tenant, count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// --- Browser-first PAIRING (S04 one-link enrollment, MASTER-PROMPT §2) — a headless machine STARTs a
// pairing (no credentials yet: a short human `code` + a private poll-secret), a human APPROVES it in the
// browser (owner-authed), and the machine POLLs with its poll-secret to CLAIM a freshly-minted device
// token exactly once. The reusable device token is minted at claim + returned ONLY in the poll body —
// never in a URL or log; only hashes are stored. ---
const PAIR_TTL_MS = 10 * 60 * 1000;
const PairStartRequest = z.object({ tenant: z.string().max(200).optional(), label: z.string().max(200).optional() }).strict();
app.post('/api/devices/pair/start', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const parsed = PairStartRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  try {
    const code = randHex(4).toUpperCase(); // 8 hex chars, human-typable
    const pollSecret = 'aidp_' + randHex(32);
    const tenant = (parsed.data.tenant || '_default').trim() || '_default';
    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + PAIR_TTL_MS).toISOString();
    await db
      .prepare('INSERT INTO pairings (code, poll_sha256, tenant, label, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(code, await sha256hex(pollSecret), tenant, parsed.data.label ?? null, 'pending', createdAt, expiresAt)
      .run();
    return c.json(
      { code, pollSecret, tenant, verifyUrl: `${APP_URL}/pair?code=${code}`, expiresAt, note: 'show the code to the operator; keep pollSecret private (never in a URL/log)' },
      201,
    );
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
// Owner approves a pending pairing (the browser leg). Admin-gated — stands in for the owner session
// until Better Auth lands. Mints NO token (claim does), so no plaintext token is ever stored.
app.post('/api/devices/pair/approve', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const code = (body.code || '').trim().toUpperCase();
    if (!code) return c.json({ error: 'invalid_request', detail: 'code required' }, 400);
    const row = await db.prepare('SELECT status, expires_at FROM pairings WHERE code = ?').bind(code).first();
    if (!row) return c.json({ error: 'not_found', code }, 404);
    if (row.status === 'claimed') return c.json({ error: 'already_claimed', code }, 409);
    if (new Date(row.expires_at).getTime() < Date.now()) return c.json({ error: 'expired', code }, 410);
    await db.prepare("UPDATE pairings SET status='approved', approved_at=? WHERE code=? AND status='pending'").bind(new Date().toISOString(), code).run();
    return c.json({ code, status: 'approved' });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});
// Machine polls with its poll-secret. pending → {status:pending}; approved → atomically CLAIM (mint a
// device + token, deliver once, mark claimed); already-claimed/expired → 410.
app.get('/api/devices/pair/poll', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const auth = c.req.header('authorization') || '';
  const pollSecret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!pollSecret) return c.json({ error: 'unauthorized' }, 401);
  try {
    const pollHash = await sha256hex(pollSecret);
    const row = await db.prepare('SELECT code, tenant, label, status, expires_at FROM pairings WHERE poll_sha256 = ?').bind(pollHash).first();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (row.status === 'claimed') return c.json({ error: 'already_claimed' }, 410);
    if (new Date(row.expires_at).getTime() < Date.now()) return c.json({ status: 'expired' }, 410);
    if (row.status !== 'approved') return c.json({ status: 'pending' });
    // approved → claim the slot atomically; only the winner mints + delivers the token
    const deviceId = 'dev_' + Date.now().toString(36) + '_' + randHex(6);
    const now = new Date().toISOString();
    const claim = await db
      .prepare("UPDATE pairings SET status='claimed', claimed_at=?, device_id=? WHERE poll_sha256=? AND status='approved'")
      .bind(now, deviceId, pollHash)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) return c.json({ error: 'already_claimed' }, 410);
    const token = 'aid_' + randHex(32);
    await db.prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, created_at) VALUES (?,?,?,?,?)').bind(deviceId, row.tenant, await sha256hex(token), row.label ?? null, now).run();
    return c.json({ status: 'claimed', deviceId, tenant: row.tenant, token, note: 'store the token now — it is not recoverable' });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
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
