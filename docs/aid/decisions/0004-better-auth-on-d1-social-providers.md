# ADR 0004 — Sign-in: Better Auth self-hosted on D1, GitHub + Google social providers

**Status:** accepted · **Date:** 2026-10-28 · **Fire:** #102 · **Seeds:** O01 (GitHub), O02 (Google), O04 (prod callback URLs), O12/O13 (session authz + display)

## Context

Phase 3 / intended-experience step 3 needs user sign-in: "Sign in using GitHub, Google, or an email
magic link." The control plane is a Cloudflare Worker (Hono) with D1; the architecture mandates Better
Auth as the auth layer. Choosing the auth provider is a one-way door — the session model, OAuth
callback contract, and user/account tables couple deeply, so migrating later is weeks of work plus a
user-session cutover. The decision is argued before building.

## Decision

**Better Auth, self-hosted in the Worker, backed by the existing D1 (`database: env.DB`, auto-detected
D1SqliteDialect), with GitHub + Google social providers.** The handler mounts on `/api/auth/*`
(`app.on(['GET','POST'], …, c => auth.handler(c.req.raw))`); the `user`/`session`/`account`/`verification`
tables are created programmatically via an admin-guarded `POST /api/auth-migrate` (`getMigrations` /
`runMigrations` — the Better Auth CLI can't reach D1). OAuth client secrets + `BETTER_AUTH_SECRET` are
Worker secrets (never in Git/context/logs). `baseURL`/`trustedOrigins` pin `https://app.install.doctor`.

## Rationale

- **House mandate + CF-native.** Better Auth is the estate's auth layer; it runs IN the Worker on D1 —
  no extra service, no data leaving Cloudflare, no per-login egress to a SaaS auth vendor.
- **Simplicity > cost > speed** (house priority). `database: env.DB` auto-detects D1 — zero adapter
  boilerplate; social providers are a few lines; the whole surface is ~2.8 MB bundled (under the 64 MiB cap).
- **Own the user table.** `user`/`session`/`account` live in OUR D1 next to `devices`/`history` — one
  store, one backup, one jurisdiction; no cross-system join to a vendor's user directory.
- **No per-user cost / no vendor lock-in.** Auth0/Clerk bill per MAU and own the identity; Better Auth
  is MIT + self-hosted — the cost side is ~0 and there's no provider to migrate off later.
- **Sessions, not just tokens.** Better Auth gives real sessions (cookie + `get-session`) that the
  dashboard can adopt alongside the existing device-token / admin-token rails (O12/O13).

## Counterargument (and why it loses)

*"A managed provider (Auth0/Clerk/Supabase Auth, or Cloudflare Access in front of the Worker) is less
code to own and get right."* True that managed auth offloads maintenance — but (1) it adds a per-MAU
cost + a second system of record for identity, (2) CF Access gates whole hosts, not an in-app
user/session model with org/roles (O11), and (3) the estate already standardizes on Better Auth, so a
managed provider is the outlier to justify, not the default. Owning a small, well-trodden auth surface
on D1 is the cheaper long-run call for a self-hosted, CF-native control plane.

**Confidence:** 0.8.

## Consequences

- Dep `better-auth@1.7`; `compatibility_flags = ["nodejs_compat"]` (Better Auth uses `node:crypto`).
- D1 gains `user`/`session`/`account`/`verification` (created by `POST /api/auth-migrate`, additive —
  blast-radius 0 for existing tables).
- Routes: `/api/auth/*` (Better Auth handler) + admin-guarded `POST /api/auth-migrate`; a `/login` page
  (#103) + a session-aware "who am I" chrome (#104) consume it.
- **Sign-in COMPLETION is gated on a human step:** the GitHub + Google OAuth apps must register
  `https://app.install.doctor/api/auth/callback/{github,google}`. Until then sign-in INITIATES
  (verified) but the callback→session leg can't complete.
- Magic-link (O03) is deferred — it needs an SES sender (`AWS_SES_ACCESS_KEY_ID` absent).
- Admin→session authz migration (O11 org/roles, O12) is a follow-up: `requireAdmin` will accept an
  allowlisted session alongside the admin token once a real session can be verified end-to-end.
- Revisit only if a per-MAU managed provider or whole-host CF Access ever becomes a hard requirement.
