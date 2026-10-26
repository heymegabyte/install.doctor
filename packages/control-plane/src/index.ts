import { Hono } from 'hono';
// Reuse aid-core's route contract (don't re-implement — MASTER-PROMPT §8). Relative import so
// esbuild bundles the zero-dep contracts at deploy time; no workspace link needed.
import { ROUTES } from '../../aid-core/src/core';

const app = new Hono();

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'aid-control-plane', phase: 'A-skeleton', routes: ROUTES.length }),
);

// Proposed inference proxy (MASTER-PROMPT §8): aid → this adapter → shared ProjectSites orchestrator
// → one CF AI Gateway → permitted provider. SKELETON ONLY: validates the requested route alias against
// aid-core's ROUTES but performs NO provider call (no keys here — provider keys stay backend-side).
// Known alias → 501 (wiring pending); unknown → 404. Keeps the contract honest until real routing lands.
app.all('/api/ai/v1/:route', (c) => {
  const route = c.req.param('route');
  if (!(ROUTES as readonly string[]).includes(route)) {
    return c.json({ error: 'unknown_route_alias', known: ROUTES }, 404);
  }
  return c.json(
    {
      error: 'not_implemented',
      detail: 'provider wiring pending — ProjectSites routing + one CF AI Gateway + permitted provider',
      route,
    },
    501,
  );
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
