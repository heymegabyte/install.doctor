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
});
