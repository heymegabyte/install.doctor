# Control-plane HTTP API reference

Every HTTP route the aid control plane (`app.install.doctor`) serves, grouped by area. **Drift-locked:**
`scripts/test-api-reference.sh` derives the live route set from the `app.<method>('…')` registrations in
`packages/control-plane/src/index.ts` and fails CI if any route here is missing from the code or any route
in the code is missing here — so this table can't silently drift from reality.

Auth legend: **public** (no credential) · **admin** (`AID_ADMIN_TOKEN` bearer) · **device token** (an
enrolled device's bearer; scope-enforced per fire #54) · **poll-secret** (the one-time pairing poll bearer).
A "public page" serves an HTML shell anyone can load, but its in-page data fetch is admin-gated.

## Dashboard pages (HTML)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /` | public | Landing: the promise, bootstrap one-liner, how-it-works, dashboard links. |
| `GET /health` | public | Health probe → `{status:"ok", routes:N}`. |
| `GET /pair` | public | Browser pairing-approval page — shows the code + host identity + requested scope before Approve. |
| `GET /machines` | public page (data load admin) | Device inventory: last-active · drift · health (conn·sw·bkp) · scope · status. |
| `GET /apps` | public | App Store — live-search the software catalog; per-entry providers + install commands. |
| `GET /environment` | public | Read-only desired-state view — a tenant's authoritative ENVIRONMENT.md + revision. |
| `GET /recommendations` | public page (data load admin) | Rule-based recommendations from observed fleet state. |
| `GET /history` | public page (data load admin) | Fleet activity — reported events across devices. |

## Environment / desired state

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/environment/current` | public | A tenant's desired ENVIRONMENT.md + revision + digest + updatedAt. |
| `PUT /api/environment/current` | admin | The ONE revisioned write path — optimistic `expectedRevision` lock (409 on stale). |
| `POST /api/environment/validate` | public | Validate a blueprint (Zod) → ok / errors. |
| `POST /api/environment/export` | public | Blueprint → portable ENVIRONMENT.md markdown. |
| `POST /api/environment/import` | public | ENVIRONMENT.md markdown → validated blueprint. |
| `POST /api/environment/diff` | public | Semantic diff between two blueprints. |
| `POST /api/environment/apply` | public | Dry-run reconciliation plan (observed→desired) + blast-radius; `expectedRevision` 409 guard; real mutation → 501 (on-device supervisor, Phase B). |

## Software catalog

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/catalog` | public | software.yml catalog (read-only); `?q=` name/bin filter, `?limit=` 1..200. |
| `GET /api/catalog/:name` | public | One catalog entry + the exact per-manager install commands. |

## AI routing

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/ai/v1/resolve` | public | Route-policy preview — which provider/alias a task resolves to (no inference). |
| `POST /api/ai/v1/:route` | policy pre-flight | The inference route — restricted→451, over-ceiling→402, unconfigured→503; the provider CALL is #7-blocked (AI Gateway + token). |
| `GET /api/provider-config` | public | OpenCode provider config (carries only the `{env:AID_INFERENCE_TOKEN}` ref — no secret value). |

## Devices + pairing

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/devices/enroll` | admin | Mint a one-time device token (stores only its SHA-256) + optional granted `permissions`. |
| `GET /api/devices` | admin | Device inventory: drift · health · last-activity · `grantedPermissions`. |
| `GET /api/devices/me` | device token | Whoami — the device's identity + `grantedPermissions` (401 if revoked/unknown). |
| `POST /api/devices/:id/revoke` | admin | Revoke a device (idempotent; 404 if unknown/already-revoked). |
| `GET /api/devices/:id/support-bundle` | admin | Sanitized one-artifact device diagnostic (U12) — identity · scope · health · drift · recent history; explicit `contents`/`excluded` manifest, never the token/secrets/detail-blob (404 if unknown). |
| `GET /api/devices/pair/info` | public | A pending pairing's host identity + requested scope (never the poll-secret/token). |
| `POST /api/devices/pair/start` | public | Start pairing — returns a short code + a poll-secret (only hashes stored). |
| `POST /api/devices/pair/approve` | admin | Owner approves a pairing by code. |
| `GET /api/devices/pair/poll` | poll-secret | Claim the device token exactly once after approval (410 on re-claim). |

## Device-scoped (tenant resolved FROM the token; scope-enforced)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/device/current` | device token (`pull-desired-state`) | This device's desired state + revision/digest. |
| `GET /api/device/current.md` | device token (`pull-desired-state`) | This device's desired ENVIRONMENT.md (raw markdown). |
| `POST /api/device/apply` | device token (`pull-desired-state`) | Dry-run reconciliation plan; `expectedRevision` 409 guard; real mutation → 501. |
| `POST /api/device/report` | device token (`report-status`) | Record a History event (apply/run/check/…) for this device. |
| `GET /api/device/history` | device token (`report-status`) | This device's own runs, newest-first. |

## Recommendations / History (fleet, admin)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/recommendations` | admin | Rule-based recs from observed state — `failed_last_run` / `drifted` / `never_reported` / `stale` / `all_good`. |
| `GET /api/history` | admin | Tenant-wide fleet events (which device reported what), newest-first; optional `?device=<id>` scopes to one machine's timeline (N09). |
| `POST /api/history/prune` | admin | Tenant-scoped retention prune — delete events older than an EXPLICIT `?olderThanDays=N` (required, ≥0); returns `{tenant, olderThanDays, cutoff, prunedCount}` (U14 retention; invoked by the loop as maintenance). |

## See also

- Requirement matrix + status: `REQUIREMENTS.md`. Resume pointer: `NEXT-STEPS.md`.
- Getting started: `getting-started-desktop.md`, `getting-started-headless.md`.
- Repo/backup responsibility model: `repos-and-backups.md`. Device identity: `decisions/0002`.
