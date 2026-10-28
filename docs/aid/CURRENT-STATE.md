# aid — CURRENT STATE (verified audit)

**Refreshed:** fire #81 (reconciled against the A01–X15 matrix + the live suite). **Branch:** `master`.
Full spec: `MASTER-PROMPT.md` · resume pointer: `NEXT-STEPS.md` · matrix: `REQUIREMENTS.md`. Nothing here
is inherited without evidence; every count below is from a live `scripts/test-all.sh` run.

## Headline

The UNBLOCKED functional product has **converged**: the control plane, the full `aid` CLI, the browser
dashboard, the honest-docs set, and a one-command test suite are built + live-verified at
**https://app.install.doctor**. The remaining high-value requirements are **GATED on external action**
(see § Gated). Loop fires now harden docs/tests/honesty until a gated dep is provisioned. Verified by
**`scripts/test-all.sh` → 362 assertions / 22 suites GREEN (1 OS-skipped)** with the prod URL.

## ✅ Built + live-verified

- **Control plane** (`packages/control-plane`, Hono Worker, D1 `aid-control-plane`) — live at
  `app.install.doctor`. Routing-policy `/resolve` + fail-closed inference pre-flight (451/402/503/405);
  ENVIRONMENT.md validate/export/import/diff + D1 read + authed `PUT` (optimistic `expectedRevision`
  lock) + apply-PREVIEW (dry-run plan; real mutation honest-501; `expectedRevision` 409 guard, §3/P09);
  the software catalog (`/api/catalog` + per-entry install commands). **`scripts/test-control-plane.sh`
  112/112.**
- **Device lifecycle** — enroll (hashed-opaque token, ADR 0002) · `devices/me` · revoke (S27) ·
  browser-first PAIRING (code + poll-secret, claim-once) with FULL approval contract (host identity +
  REQUESTED permissions, P03) · GRANTED scope persisted at claim (P05, migration 0007) · **per-action
  scope ENFORCEMENT** (`requireScope`, 403 insufficient_scope; P05/O12) · cross-tenant isolation VERIFIED
  (W08 — a device sees only its tenant; token can't escalate to admin).
- **`aid` CLI** (`home/dot_local/bin/executable_aid` + `executable_aid-pair`) — pair → `status`
  (surfaces granted scope) → `pull` → `plan` (local/offline, `_bin`-aware) → `apply` (dry-run default,
  opt-in real install) → `report` → `up`; plus `exec`/`prewarm` (authorized lazy install), `installs`
  (telemetry), `provider` (OpenCode config). **`test-aid-client.sh` 29/29 · `test-aid-pair.sh` 6/6.**
- **Dashboard read surfaces** (thin honest pages, NOT the Figma redesign) — **Machines** (inventory +
  last-active + drift + health + scope columns, + per-device DETAIL with a unified change timeline),
  **App Store** (catalog live-search + install commands), **Environment** (read-only desired-state
  ENVIRONMENT.md view), **Recommendations** (rule-based: failed-last-run/drifted/never/stale, device
  deep-links), **History** (fleet events + honest `recordingMode:events-only` note, U02). Admin token
  persists in sessionStorage (enter once). Device identity/health/drift/recs all from one shared query.
- **Lazy CLI** (`home/dot_config/shell/not-found-hook.sh`) — ONE canonical resolver: no-eval argv-exec,
  install locks + recursion guard, interactive/CI gate, atomic index, mise-defer; bash+zsh tested
  (**`test-command-not-found.sh` 25/25**); fish+pwsh adapters present (structural gates 8+8, live-unverified).
- **Honest-docs set** (each gated) — `README` + `getting-started-desktop`/`-headless` + `api-reference`
  (drift-locked to the real routes) + `platform-support` + `repos-and-backups` + `operations` +
  `provenance` + `adoption`. Doc gates: README 10 · getting-started 16 · repos-backups 13 · api-reference
  5 · platform-support 19 · operations 14 · provenance 16 · adoption 11.
- **Verification** — `scripts/test-all.sh` runs every suite (per-suite + grand total, OS-gated skips,
  exits non-zero on any fail); inline-JS parse guard over every dashboard page. Preserved foundations:
  chezmoi · software.yml · mise · hiSHtory · `detect_os()`/`detect_arch()`/`detect_release()`/`detect_service_manager()`/`detect_privilege()` (OS+arch+release+init+privilege SoT) · the prior `CONVERGENCE.md` arc.

## ◐ Partial (honest)

- **U02 recording** — structured events + an honest `recordingMode:events-only` marker; actual terminal
  capture/redaction ⬜ (the recorder isn't built).
- **aid apply** — dry-run + the local real-install path exist; the real install is machine-gated (never
  run in CI). Server never pushes installs (device apply = 501 by design).
- **fish/pwsh lazy install** — adapters shipped, live-unverified (no fish/pwsh on the runner).

## 🚧 Gated — remaining high-value work needs EXTERNAL action (not a loop slice)

- **O Better Auth** (GitHub/Google/magic-link sign-in) — needs OAuth apps + an SES sender for
  `app.install.doctor`. The dashboard uses an `AID_ADMIN_TOKEN` bearer today, not user login.
- **K/#7 the real provider CALL** — needs the CF **AI Gateway** + `AID_INFERENCE_TOKEN` + the shared
  ProjectSites/OnePrompt orchestrator contract. Routing policy + pre-flight are live; the call is not.
- **I/J per-host private repos + encrypted backups** — need GitHub repo-creation creds + restic/S3 + a
  throwaway box. Contract documented in `repos-and-backups.md`; code ⬜.
- **Real multi-host / replacement-host restore drills** — need throwaway machines (can't run from the
  dev box; the loop must not mutate the dev shell).
- **N02 the full cinematic §16 SaaS redesign** — Figma design + approval gate.
- The on-device **aid SUPERVISOR** + privileged helper (the OpenCode-derived runtime, K01) — partly
  #7-blocked + needs a real host.

## ⬜ Not started

- 40-category × 30-idea research (`research/README.md`, 0/1200). `UPSTREAMS.lock.json` 30 candidates all
  `pending-evaluation` (none vendored; see `provenance.md`).
