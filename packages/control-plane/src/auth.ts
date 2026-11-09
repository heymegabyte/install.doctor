// Better Auth — O-series sign-in (Phase 3 keystone, fire #102). Framework-agnostic auth backed by the
// existing D1 (`DB`): Better Auth AUTO-DETECTS the D1 binding and uses its internal D1SqliteDialect, so we
// pass the binding directly as `database` (no kysely boilerplate). Credentials are Worker SECRETS read from
// the `cloudflare:workers` module env at module scope — they never enter Git, the client, or logs (the
// browser only ever sees the provider authorize URL, never a client_secret).
//
// Honest scope: this wires the GitHub + Google authorize-INITIATION. Sign-in COMPLETION (callback → session)
// additionally requires each canonical callback origin below to be registered on the OAuth apps — a human
// step on the OAuth-app settings, NOT claimable from this code alone. Profile wildcard hosts are deliberately
// excluded: owner authorization happens on the Desktop Tools apex, never on caller-selected profile origins.
import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { Env } from './env';
import { createBetterAuthOptions } from './better-auth-options';
import { DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN, DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS } from './auth-origin-policy';

const e = Env.parse(env);

export const auth = betterAuth(createBetterAuthOptions(e.DB, e, {
  baseURL: DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN,
  trustedOrigins: DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
}));
