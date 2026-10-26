# ADR 0002 — Device tokens: hashed-opaque in D1, not signed JWT

**Status:** accepted · **Date:** 2026-10-26 · **Fire:** #16 · **Seeds:** S04 (enrollment), S27 (per-device revocation)

## Context

Phase B needs device identity: a machine enrolls once and thereafter authenticates to the control
plane. Two standard shapes: (a) an **opaque bearer token** whose SHA-256 is stored in a D1 `devices`
row, verified by hash lookup; (b) a **signed JWT** carrying `{deviceId, tenant}` claims, verified by
signature with no per-request DB read. This is a one-way door (the format shapes storage, revocation,
and offline validation), so the decision is argued before building.

## Decision

**Hashed-opaque token in D1.** Enrollment mints `aid_<32 random bytes hex>`; only `sha256(token)` is
stored. A request presents `Authorization: Bearer <token>`; the worker hashes it and looks up the row,
rejecting unknown or `revoked_at`-set rows with 401. The plaintext token is returned exactly once at
enrollment and is never recoverable.

## Rationale

- **Instant revocation (S27, required).** Revoking = `UPDATE devices SET revoked_at` — effective on the
  next request. A JWT is valid until expiry unless backed by a revocation blocklist, which is itself a
  per-request DB lookup — so JWT's one advantage (statelessness) is forfeited the moment revocation is
  a requirement, and it is.
- **No new signing secret.** A JWT needs a signing key to provision, store backend-side, and rotate
  (another secret in the rail). Hashed-opaque needs none.
- **The DB read is free.** Every meaningful device request already hits D1 (fetch desired blueprint,
  record History). The "extra" lookup JWT would save is already being paid.
- **Simplicity > cost > speed** (house priority). Hashed-opaque is the simplest correct option and
  reuses the existing D1 + `crypto.subtle.digest` patterns.
- **Inventory for free.** The `devices` table IS the device inventory (S05 adoption, fleet views) — a
  JWT-only scheme would need it anyway.

## Counterargument (and why it loses)

*"JWT scales to high request volume without a DB read."* True in the abstract, but (1) device request
volume here is tiny, (2) every request already reads D1, and (3) revocation forces a stateful check
regardless. The statelessness win is unrealizable for this workload.

**Confidence:** 0.85.

## Consequences

- `devices(device_id, tenant, token_sha256 UNIQUE, label, created_at, revoked_at)` (migration 0003).
- Endpoints: `POST /api/devices/enroll` (admin-gated), `GET /api/devices/me` (device bearer),
  `POST /api/devices/:id/revoke` (admin-gated).
- Future per-tenant READ/WRITE/apply key off the resolved device → tenant.
- If offline token validation ever becomes required (device verifies without the control plane), revisit
  — that is the one scenario favoring signed tokens.
