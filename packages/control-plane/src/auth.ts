// Better Auth — O-series sign-in (Phase 3 keystone, fire #102). Framework-agnostic auth backed by the
// existing D1 (`DB`): Better Auth AUTO-DETECTS the D1 binding and uses its internal D1SqliteDialect, so we
// pass the binding directly as `database` (no kysely boilerplate). Credentials are Worker SECRETS read from
// the `cloudflare:workers` module env at module scope — they never enter Git, the client, or logs (the
// browser only ever sees the provider authorize URL, never a client_secret).
//
// Honest scope: this wires the GitHub + Google authorize-INITIATION. Sign-in COMPLETION (callback → session)
// additionally requires `https://app.install.doctor/api/auth/callback/{github,google}` to be registered on
// the OAuth apps — a human step on the OAuth-app settings, NOT claimable from this code alone.
import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';

const e = env as Record<string, any>;

export const auth = betterAuth({
  // D1 binding (auto-detected). The user/session/account/verification tables are created by the
  // admin-guarded POST /api/auth-migrate endpoint (getMigrations/runMigrations) — the CLI can't reach D1.
  database: e.DB,
  baseURL: 'https://app.install.doctor',
  secret: e.BETTER_AUTH_SECRET,
  // Only our own origin may drive the auth flow (CSRF / open-redirect defense, O14).
  trustedOrigins: ['https://app.install.doctor'],
  socialProviders: {
    github: {
      clientId: e.GITHUB_CLIENT_ID,
      clientSecret: e.GITHUB_CLIENT_SECRET,
    },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
    },
  },
  // O10 — rate-limit sign-in + email issuance (fire #108). Better Auth's limiter was INERT on prod: on
  // Workers there is no NODE_ENV=production so `enabled` defaulted OFF, and the default "memory" storage is
  // per-ISOLATE, so a burst fanned across the CF edge never accumulated (a 40x /sign-in/social burst all
  // 200'd). Two fixes: force it on, and back it with D1 (`storage:"database"` → the `rateLimit` table,
  // consistent across every isolate). The sensitive paths get tight customRules; the generous global keeps
  // the dashboard's per-page get-session poll well under the ceiling. 429 returns the SAME for a present or
  // absent account → no account-existence leak. The `rateLimit` table is created by POST /api/auth-migrate
  // (getMigrations now emits it because storage==="database").
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/social': { window: 30, max: 10 },
      '/sign-in/email': { window: 30, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/forget-password': { window: 60, max: 5 },
    },
  },
});
