# 0006 — Auth rate-limiting backed by D1, not Upstash

**Status:** accepted · **Date:** 2026-10-29 · **Fire:** #123 (records the #108 decision) · **Seeds:** O10 (rate-limit sign-in + email issuance without leaking account existence)

## Context

O10 requires rate-limiting the authentication surface — sign-in, sign-up, email/magic-link issuance, password reset — so a burst can't brute-force credentials or enumerate accounts, and a 429 must look identical for a present vs absent account (no account-existence leak). Better Auth ships a native limiter, but on Cloudflare Workers it was INERT in two ways (both fixed in #108):

- **`enabled` defaulted OFF** — Better Auth gates its limiter on `NODE_ENV==="production"`, and there is no `NODE_ENV` on Workers, so it was never on.
- **Default `"memory"` storage is per-ISOLATE** — a burst fanned across the CF edge lands on many isolates, so counters never accumulated (verified: a 40×`/sign-in/social` burst all `200`'d before #108).

The estate's usual rate-limit convention is Upstash Redis (`@upstash/ratelimit`). The question: back the auth limiter with that, or with the control plane's existing D1?

## Decision

Use Better Auth's **native** limiter backed by **D1** (`rateLimit: { enabled: true, storage: 'database', … }` in `packages/control-plane/src/auth.ts`). The `rateLimit` table is part of the auth schema, created by `POST /api/auth-migrate` (Better Auth's `getMigrations` emits it because `storage === "database"`). Do NOT add Upstash / `@upstash/ratelimit`, nor a bespoke KV/Durable-Object rate-limit stack, for the auth surface.

Tight `customRules` on the sensitive paths (`/sign-in/social`, `/sign-in/email` → 10/30s; `/sign-up/email`, `/forget-password` → 5/60s); a generous global (100/60s) keeps the dashboard's per-page `get-session` poll well under the ceiling. The 429 is identical for a present or absent account.

## Rationale

- **Reuse existing services before adding infrastructure** (a §3 invariant) — D1 is already the control plane's database; backing the limiter with it adds ZERO new infrastructure.
- **Budget** — the estate holds a $10/mo-per-project ceiling on Neon/Upstash; adding an Upstash instance for a single auth concern Better Auth already covers via D1 spends that budget for no unique capability.
- **Zero bespoke code** — Better Auth natively supports `storage:'database'`; its own migrations create and manage the `rateLimit` table. A KV/DO limiter would reimplement what the library already does.
- **Cross-isolate correctness** — D1 is one logical store, so a burst fanned across the CF edge accumulates against a single counter (the whole reason `"memory"` failed).

## Alternatives (considered and rejected)

- **Upstash Redis (`@upstash/ratelimit`)** — the estate's usual rate-limit convention. Rejected: a second infra dependency + a budget line for a concern Better Auth already covers on D1; violates "reuse existing services before adding infrastructure" with no unique benefit at this scale.
- **A bespoke CF KV counter or Durable-Object limiter** — rejected: duplicates Better Auth's native `storage:'database'` behaviour with hand-rolled code (more surface to get wrong, e.g. the account-existence-leak requirement).
- **Default `"memory"` storage** — rejected: per-isolate on Workers, so a burst never accumulates (measured INERT pre-#108).
- **Leaving `enabled` at its default** — rejected: no `NODE_ENV=production` on Workers → the limiter was simply off.

## Consequences

- The `rateLimit` D1 table is now part of the auth schema (created by `POST /api/auth-migrate`); it must be migrated on any fresh deployment.
- Rate-limit counters live in D1 alongside the rest of the auth state — one store to reason about, back up (Time Travel), and operate.
- **Reversibility:** the counters are ephemeral (short windows), so switching to Upstash later is effectively a config swap (no durable data to migrate) — this is a soft, not hard, one-way door; D1 is the durable default.
- **Precedent:** any FUTURE non-auth rate-limiting the control plane needs (e.g. throttling the public catalog API) should follow this same D1-first pattern unless a demonstrated need (very high write rate, sub-ms latency) justifies Upstash — at which point record a follow-up ADR.
- Verified by `test-security-headers.sh` (3 rate-limit assertions, #108) + the `rateLimit` table in the auth migrations.
