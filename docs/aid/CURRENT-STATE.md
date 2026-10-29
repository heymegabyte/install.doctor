# aid — CURRENT STATE (verified audit)

**Refreshed:** fire #104 (reconciled against the A01–X15 matrix + the live suite). **Branch:** `master`.
Full spec: `MASTER-PROMPT.md` · resume pointer: `NEXT-STEPS.md` · matrix: `REQUIREMENTS.md`. Nothing here
is inherited without evidence; every count below is from a live `scripts/test-all.sh` run.

## Headline

The UNBLOCKED functional product has **converged**: the control plane, the full `aid` CLI, the browser
dashboard, the honest-docs set, and a one-command test suite are built + live-verified at
**https://app.install.doctor**. The remaining high-value requirements are **GATED on external action**
(see § Gated). Loop fires now harden docs/tests/honesty until a gated dep is provisioned. Verified by
**`scripts/test-all.sh` → 430 assertions / 24 suites GREEN (1 OS-skipped)** with the prod URL.

## ✅ Built + live-verified

- **Control plane** (`packages/control-plane`, Hono Worker, D1 `aid-control-plane`) — live at
  `app.install.doctor`. Routing-policy `/resolve` + fail-closed inference pre-flight (451/402/503/405);
  ENVIRONMENT.md validate/export/import/diff + D1 read + authed `PUT` (optimistic `expectedRevision`
  lock) + apply-PREVIEW (dry-run plan; real mutation honest-501; `expectedRevision` 409 guard, §3/P09);
  the software catalog (`/api/catalog` + per-entry install commands). **`scripts/test-control-plane.sh`
  150/150 — incl. the U12 sanitized **support bundle** (admin-scoped, explicit contents/excluded manifest, never the token/secrets/detail-blob) SURFACED in the `/machines` device detail (view + download JSON; #83) — **U13 recommendations DEDUPED** (each flagged machine alerted in exactly ONE card by severity, `distinctDeviceCount` = true blast radius, per-card repair `command`; #84) — **U14 FULLY DONE** = access-control ✅ + **payload QUOTA** (`detail` capped 16 KB / body 32 KB → `413`; #85) + **RETENTION** (admin `POST /api/history/prune?tenant=&olderThanDays=` deletes old events, tenant-scoped, explicit window, invoked by the loop; prunedCount verified + history EMPTY after; #87) — **C09 semantic DIFF tool on `/environment`** (paste a proposed ENVIRONMENT.md → import both + diff → color-coded added/removed/changed; #86) — and **U03 parent/child run CORRELATION — END-TO-END** (a report carries `correlationId`/`parentRunId`, stored via migration 0008; admin `GET /api/history?correlation=` returns the correlated run tree; both history reads surface the fields #88; the **`aid` client now STAMPS a per-invocation run-id on every report** so one `aid up` groups into a correlated run — verified live via the real aid script #89; and the `/machines` device-detail timeline shows a **"run" column** (short correlationId badge + ↳ child-of-parent indicator) so an operator SEES which events belong to one run #90. **U03 FULLY DONE** — tracked, stamped, surfaced).**
- **Device lifecycle** — enroll (hashed-opaque token, ADR 0002) · `devices/me` · revoke (S27) ·
  browser-first PAIRING (code + poll-secret, claim-once) with FULL approval contract (host identity +
  REQUESTED permissions, P03) · GRANTED scope persisted at claim (P05, migration 0007) · **per-action
  scope ENFORCEMENT** (`requireScope`, 403 insufficient_scope; P05/O12) · cross-tenant isolation VERIFIED
  (W08 — a device sees only its tenant; token can't escalate to admin).
- **`aid` CLI** (`home/dot_local/bin/executable_aid` + `executable_aid-pair`) — pair → `status`
  (surfaces granted scope) → `pull` → `plan` (local/offline, `_bin`-aware) → `apply` (dry-run default,
  opt-in real install) → `report` → `up`; plus `exec`/`prewarm` (authorized lazy install), `installs`
  (telemetry), `provider` (OpenCode config). Every report STAMPS a per-invocation `correlationId` (+ optional
  `parentRunId`) so one `aid up` groups into a correlated run (U03 client, env-overridable `AID_RUN_ID`/`AID_PARENT_RUN_ID`, #89). **`test-aid-client.sh` 31/31 · `test-aid-pair.sh` 6/6.**
- **Dashboard read surfaces** (thin honest pages, NOT the Figma redesign) — **Machines** (inventory +
  last-active + drift + health + scope columns, + per-device DETAIL with a unified change timeline + a
  one-click **Support bundle** view/download (U12)),
  **App Store** (catalog live-search — now matches each tool's **description** too, so you can find a tool by WHAT IT DOES, not just its name/command (`?q=fuzzy` → fzf + 5 fuzzy/search tools); the box advertises the breadth; D-series #94 — + a **PLATFORM filter** (macOS/Linux/Windows `<select>` + `?platform=`; allowlisted server-side + echoes the applied filter; show only the tools installable on YOUR OS — linux→828, macos→981 of 1068; D05 #97) — + install commands + each tool's **description** (`_short`, 905/1068 entries) as a scannable sub-line + a **"Learn more" link set** in the detail — **Source** (github) + **Homepage** (`_home`) + **Docs** (`_docs`), only the links that exist so there are no dead links (489/1068 carry home/docs; D11 #92+#95); the user-facing descriptions are **verified-accurate** — 19 fabricated/slop `_short` entries (e.g. distrobox/upscayl/dialect, which described the wrong product or just named the repo) corrected against real upstream `.description` + a **hard gate** (`test-software-descriptions.sh`) now blocks fabrication meta-commentary in `_short` from regressing (D11/D14 #96)), **Environment** (a structured **"Plan at a glance"** summary — packages/machines/services/routing/privacy from `/api/environment/current`'s server-side `summary` (step-5 review, C12 #93), each planned **package LINKS to its App Store detail** (`/apps?q=<pkg>`, which now honors the URL param) so you can click a package in your plan to see what it is + how it installs (interconnectedness #98) — + the read-only desired-state
  ENVIRONMENT.md view + a **semantic DIFF tool** — paste a proposed ENVIRONMENT.md → color-coded
  added/removed/changed vs current, C09), **Recommendations** (rule-based: failed-last-run/drifted/never/stale, DEDUPED
  per-machine so no host is double-alerted, a `distinctDeviceCount` blast-radius summary, each card's
  repair `command` + device deep-links, U13), **History** (fleet events + honest `recordingMode:events-only` note, U02; a correlation **"run" column** whose badges are CLICKABLE → filter the fleet history to one correlated run via `?correlation=`, U03 #91; and each event's **DEVICE now links to that machine's detail** (`/machines?device=`) so "what happened" → "which machine" is one click, matching the Recommendations deep-link pattern, interconnectedness #99). Admin token
  persists in sessionStorage (enter once). Device identity/health/drift/recs all from one shared query.
- **Lazy CLI** (`home/dot_config/shell/not-found-hook.sh`) — ONE canonical resolver: no-eval argv-exec,
  install locks + recursion guard, interactive/CI gate, atomic index, mise-defer; bash+zsh tested
  (**`test-command-not-found.sh` 25/25**); fish+pwsh adapters present (structural gates 8+8, live-unverified).
- **Cua Spaces desktop provisioning gate** (`home/.chezmoiscripts/universal/run_after_21-cua-spaces.sh.tmpl`,
  Brian directive #101 "install on any 16GB+ desktop") — a chezmoi `run_after` that installs Cua Spaces
  (computer-use substrate, cua.ai) ONLY on a GUI desktop with ≥16 GiB RAM + macOS/Linux; dry-runs first,
  idempotent (skips if `cua` present), HEADLESS_INSTALL + `INSTALL_DOCTOR_CUA=0` opt-outs, and per the
  `cua-spaces` rule NEVER auto-pairs/signs-in/unlocks-the-Keyvault/copies-creds (install the app only;
  sign-in stays the user's explicit action). **`test-cua-spaces.sh` 17/17** — gates + guardrails unit-verified
  (headless + opt-out skip-before-install proven live); the real install path is machine-gated (runs at
  `chezmoi apply` on a real qualifying desktop, NOT executed on the dev box — honestly marked).
- **Better Auth sign-in** (`packages/control-plane/src/auth.ts` + `/api/auth/*`, Phase-3 keystone, fire #102) —
  Better Auth 1.7 mounted on the Worker, **GitHub + Google** social providers, backed by D1
  (`user`/`session`/`account`/`verification` tables created via the admin-guarded `POST /api/auth-migrate`;
  `nodejs_compat` on; 5 OAuth secrets bound as Worker secrets, values never in Git/context). **Authorize-
  INITIATION is LIVE + verified** (`test-auth.sh` 5/5): `POST /api/auth/sign-in/social` for github → a real
  `github.com/login/oauth/authorize` URL with the client_id + the `app.install.doctor/api/auth/callback/github`
  redirect; google → `accounts.google.com`; no client_secret ever in the response. A **`/login` page**
  (M06 — step 3) offers "Continue with GitHub/Google" buttons wired to `POST /api/auth/sign-in/social`
  (→ redirect to the provider), reachable from the landing-page "Sign in" CTA (#103). A **session-aware "who am I" status** is in the
  shared page chrome on EVERY page (#104, test-auth 9/9) — calls `GET /api/auth/get-session`
  (`credentials:include`) → signed in: the user + a **Sign out** button (`POST /api/auth/sign-out`); not
  signed in: a "Sign in" link (`get-session` returns `null` unauthenticated — honest, O13).
  **HONEST: sign-in does NOT COMPLETE yet** — the callback→session leg needs
  `https://app.install.doctor/api/auth/callback/{github,google}` registered on the OAuth apps (a one-time
  human step), and the dashboard still uses the `AID_ADMIN_TOKEN` bearer (not a user session). Magic-link ⬜ (needs SES).
- **Honest-docs set** (each gated) — `README` + `getting-started-desktop`/`-headless` + `api-reference`
  (drift-locked to the real routes + the `/api/catalog` filter params `?q=`/`?platform=` #100) + `platform-support` + `repos-and-backups` + `operations` +
  `provenance` + `adoption`. Doc gates: README 10 · getting-started 16 · repos-backups 13 · api-reference
  6 · platform-support 19 · operations 14 · provenance 16 · adoption 11.
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

- **O Better Auth** — **BUILT #102 (authorize-initiation LIVE; see § Built).** GitHub/Google sign-in INITIATES
  (verified). The remaining COMPLETION gates: (1) register `https://app.install.doctor/api/auth/callback/{github,google}`
  on the OAuth apps + confirm they're app.install.doctor's (a one-time human step); (2) wire the dashboard to use a
  user SESSION instead of the `AID_ADMIN_TOKEN` bearer (a buildable follow-up, next fire); (3) magic-link needs SES
  (`AWS_SES_ACCESS_KEY_ID` absent). Not a loop blocker anymore — (2) is the next buildable slice.
- **K/#7 the real provider CALL** — still gated: `DEEPSEEK_API_KEY` IS present (#101) but the invariant is
  routing THROUGH the shared ProjectSites/OnePrompt orchestrator + CF AI Gateway (no second stack), and
  `PROJECTSITES_API_URL`/`ONEPROMPT_URL`/`AID_INFERENCE_TOKEN` are all absent. Routing policy + pre-flight
  are live; the call is not (gated on the orchestrator URL, NOT the model key).
- **I/J per-host private repos + encrypted backups** — a `GITHUB_TOKEN` IS present (#101), so repo creation
  has a candidate credential; still needs restic/S3 + a throwaway box for the real drills. Contract in
  `repos-and-backups.md`; code ⬜.
- **Real multi-host / replacement-host restore drills** — need throwaway machines (can't run from the
  dev box; the loop must not mutate the dev shell).
- **N02 the full cinematic §16 SaaS redesign** — Figma design + approval gate.
- The on-device **aid SUPERVISOR** + privileged helper (the OpenCode-derived runtime, K01) — partly
  #7-blocked + needs a real host.

## ⬜ Not started

- 40-category × 30-idea research (`research/README.md`, 0/1200). `UPSTREAMS.lock.json` 30 candidates all
  `pending-evaluation` (none vendored; see `provenance.md`).
