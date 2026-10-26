# aid-control-plane (Phase A skeleton)

Cloudflare Worker + Hono — the browser-first control plane for `app.install.doctor`. This is the
START of Phase A, a skeleton, **not production**.

## Status (honest)

- `GET /health` → `200 {status:"ok", service:"aid-control-plane", phase:"A-skeleton", routes:N}`.
- `ALL /api/ai/v1/:route` → **501** for a known aid-core route alias (provider wiring pending),
  **404** for an unknown alias.
- NO provider call, NO secrets, NO D1 / Durable Objects / Queues / Workflows yet. The route
  contract (`ROUTES`) is imported from `../aid-core` — reused, not re-implemented (MASTER-PROMPT §8).

## Dev / deploy

- `npm install` (installs `hono`).
- `npm run check` → `wrangler deploy --dry-run` (build gate; esbuild bundles the TS + aid-core).
- `npm run deploy` → needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env (via `get-secret`).
- Full gate: `scripts/test-control-plane.sh` — dry-run build + (when `CONTROL_PLANE_URL` is set)
  prod `/health` + routing E2E.

## Next (see docs/aid/NEXT-STEPS.md)

Zod env + bindings; a real ProjectSites routing adapter → one CF AI Gateway (DeepSeek-first);
tenant/device identity; D1 metadata; a strict-TS typecheck step (tsconfig via `/update-config`).
