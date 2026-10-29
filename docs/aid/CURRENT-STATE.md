# aid — CURRENT STATE (verified audit)

**Refreshed:** fire #106 (reconciled against the A01–X15 matrix + the live suite). **Branch:** `master`.
Full spec: `MASTER-PROMPT.md` · resume pointer: `NEXT-STEPS.md` · matrix: `REQUIREMENTS.md`. Nothing here
is inherited without evidence; every count below is from a live `scripts/test-all.sh` run.

## Headline

The UNBLOCKED functional product has **converged**: the control plane, the full `aid` CLI, the browser
dashboard, the honest-docs set, and a one-command test suite are built + live-verified at
**https://app.install.doctor**. The remaining high-value requirements are **GATED on external action**
(see § Gated). Loop fires now harden docs/tests/honesty until a gated dep is provisioned. Verified by
**`scripts/test-all.sh` → 495 assertions / 27 suites GREEN (1 OS-skipped)** with the prod URL.

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
  **App Store** (catalog live-search — now matches each tool's **description** too, so you can find a tool by WHAT IT DOES, not just its name/command (`?q=fuzzy` → fzf + 5 fuzzy/search tools); the box advertises the breadth; D-series #94 — + a **PLATFORM filter** (macOS/Linux/Windows `<select>` + `?platform=`; allowlisted server-side + echoes the applied filter; show only the tools installable on YOUR OS — linux→828, macos→981 of 1068; D05 #97) — + a per-tool **install-MODE badge** ("desktop app" / "service" / "CLI · on first use") in the list + a one-line explanation in the detail, derived from software.yml's declared `_app`/`_service` (app 224 · service 51 · cli 793), so you SEE whether a tool is a desktop app installed at setup or a CLI installed lazily on first use — the core eager-vs-lazy promise (D06 #110) — + a **DEPRECATION warning** on the 147 catalog entries the maintainer flagged `_deprecated` (an amber "deprecated" badge in the list + the full reason in the detail, e.g. altair → "Deprecated in favor of Postman"; so the App Store WARNS before a user installs an abandoned/discouraged tool + names the replacement — D14/D15 honesty #112) — + a **"Depends on" runtime-deps row** in the detail (software.yml `_deps`, 30 catalog entries, e.g. aifiles → pandoc·exiftool·poppler·csvkit; each dep LINKS to its own App Store entry — interconnected; a YAML colon-artifact is filtered; D07 #113) — + install commands + each tool's **description** (`_short`, 905/1068 entries) as a scannable sub-line + a **"Learn more" link set** in the detail — **Source** (github) + **Homepage** (`_home`) + **Docs** (`_docs`), only the links that exist so there are no dead links (489/1068 carry home/docs; D11 #92+#95); the user-facing descriptions are **verified-accurate** — 19 fabricated/slop `_short` entries (e.g. distrobox/upscayl/dialect, which described the wrong product or just named the repo) corrected against real upstream `.description` + a **hard gate** (`test-software-descriptions.sh`) now blocks fabrication meta-commentary in `_short` from regressing (D11/D14 #96)), **Environment** (a structured **"Plan at a glance"** summary — packages/machines/services/routing/privacy from `/api/environment/current`'s server-side `summary` (step-5 review, C12 #93) — **now with an eager-vs-lazy INSTALL breakdown** ("N desktop apps at setup · M services · K CLIs on first use", computed server-side over the catalog `installMode` #110 across the plan's defaults + machine packages, "other" for non-catalog packages; so plan review shows HOW provisioning will behave — C12/D06 interconnect #111) — **+ a plan DEPRECATION warning (#114): if the plan includes packages the maintainer flagged `_deprecated` (#112), the "Plan at a glance" shows a prominent amber "N deprecated package(s) in this plan — review before applying" with each name + reason (real-browser-verified on a seeded plan → "1 deprecated package … altair: Deprecated in favor of Postman"), a SAFETY win before applying; `/environment` now honors `?tenant=` to deep-link a specific tenant's plan (like the App Store's `?q=`)**, each planned **package LINKS to its App Store detail** (`/apps?q=<pkg>`, which now honors the URL param) so you can click a package in your plan to see what it is + how it installs (interconnectedness #98) — + the read-only desired-state
  ENVIRONMENT.md view + a **semantic DIFF tool** — paste a proposed ENVIRONMENT.md → color-coded
  added/removed/changed vs current, C09), **Recommendations** (rule-based: failed-last-run/drifted/never/stale, DEDUPED
  per-machine so no host is double-alerted, a `distinctDeviceCount` blast-radius summary, each card's
  repair `command` + device deep-links, U13; **+ a tenant-level `plan_deprecated` rec (#115) — if the desired PLAN
  includes packages the maintainer flagged deprecated (#112), it warns "N deprecated package(s) in the desired plan —
  Replace: altair (Deprecated in favor of Postman)", the 3rd + proactive deprecation surface after the App Store badge + the
  plan-review warning; reuses `collectDeprecated` on the blueprint**), **History** (fleet events + honest `recordingMode:events-only` note, U02; a correlation **"run" column** whose badges are CLICKABLE → filter the fleet history to one correlated run via `?correlation=`, U03 #91; and each event's **DEVICE now links to that machine's detail** (`/machines?device=`) so "what happened" → "which machine" is one click, matching the Recommendations deep-link pattern, interconnectedness #99). Admin token
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
  **O10 rate-limiting ◐ (#108): sign-in IS now rate-limited + VERIFIED.** Better Auth's limiter was INERT on prod (Workers has no
  `NODE_ENV=production` → `enabled` defaulted OFF; default "memory" storage is per-isolate → a 40x `/sign-in/social` burst all 200'd).
  Fixed in `auth.ts`: `enabled:true` + `storage:"database"` (D1 `rateLimit` table created via `/api/auth-migrate`, consistent across
  isolates) + tight `customRules` (`/sign-in/social` 10/30s; `/sign-in/email`, `/sign-up/email`, `/forget-password` pre-staged). A
  sequential burst now returns `200×10 → 429×5` with an `X-Retry-After` hint; the first attempt still succeeds (legit sign-in not
  blocked); the 429 is identical whether the account exists or not (no account-existence leak). `test-rate-limit.sh` 3/3, live-verified
  (Version 1ab34dd9). The email-ISSUANCE half is pre-staged but unverifiable until SES/an email plugin lands (⬜).
- **Honest-docs set** (each gated) — `README` + `getting-started-desktop`/`-headless` + `api-reference`
  (drift-locked to the real routes + the `/api/catalog` filter params `?q=`/`?platform=` #100) + `platform-support` + `repos-and-backups` + `operations` +
  `provenance` + `adoption`. Doc gates: README 10 · getting-started 16 · repos-backups 13 · api-reference
  6 · platform-support 19 · operations 14 · provenance 16 · adoption 11.
- **Security headers** (Q / web-security defense-in-depth; fire #106, +COOP/CORP #107) — the Worker adds a **Content-Security-Policy** + **Permissions-Policy**
  on EVERY response (CF-zone already sets HSTS/X-Frame-Options/nosniff/Referrer-Policy). CSP locks
  `frame-ancestors 'none'` (anti-clickjacking) + `base-uri 'self'` + `object-src 'none'` + `form-action 'self'`;
  script/style stay `'unsafe-inline'` (the dashboard renders inline `<script>`/`<style>` — honest, no nonces) so
  nothing breaks. **#107 completes the cross-origin header baseline: `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (browsing-context isolation, keeps future OAuth popups) + `Cross-Origin-Resource-Policy: same-origin` (no cross-origin
  no-cors hot-linking; CORS fetch + the server-to-server aid CLI unaffected). COEP `require-corp` is DELIBERATELY omitted
  (0 cross-origin subresources today → no benefit; would break future Maps/R2 embeds).**
  **#109: a conditional `Cache-Control: no-store` DEFAULT on every response — tenant-scoped data (devices · history · recommendations · environment) +
  dashboard pages are no longer shared-/disk-cacheable (was: NO Cache-Control anywhere → heuristically cacheable). Conditional (`if !has('cache-control')`) so a
  route can still opt INTO caching and Better Auth keeps its own session header.** `test-security-headers.sh` 12/12,
  real-browser-verified the `/machines` page renders styled + its inline JS still executes (the injected "forget token" control) under the headers.
  Next hardening (its OWN 2-3-fire decomposition — measured #108): strict `script-src` needs the inline `on*=` handlers → `addEventListener` FIRST
  (they're blocked even with a nonce), then nonce the `<script>` blocks → drop `'unsafe-inline'`; Trusted Types needs the 30 `innerHTML` sinks → `createElement`/`textContent` first.
  **strict-`script-src` STEP 1+2+3 COMPLETE — full XSS defense-in-depth LIVE (#117–#130): inline-handler removal + per-request nonce + ENFORCED Trusted Types.** STEP 1 (#117–#121): converted EVERY inline `on*=` handler on all 7 dashboard pages (`/login`+`/recommendations`+`/pair` #117, `/apps` #118, `/environment` #119, `/history` #120, `/machines` #121) to `addEventListener` — static fixed-button handlers (simple swaps) + DYNAMIC per-row buttons via EVENT DELEGATION (`data-act`/`data-id`/`data-corr` + one container listener reading `e.target.closest('[data-act]')`). STEP 2 (#122): dropped `script-src 'unsafe-inline'`, replaced with a **per-request NONCE** — a middleware generates a 16-byte hex nonce per request, injects `nonce="<n>"` into EVERY inline `<script>` of HTML responses (one regex in ONE place: `html.replace(/<script(?=[\s>])/g, …)` — catches page + shared-chrome scripts automatically), and sets `script-src 'self' 'nonce-<n>'`. An injected/reflected `<script>` can't guess the nonce → won't execute (and dropping unsafe-inline ALSO blocks injected inline `on*=` event handlers). `style-src 'unsafe-inline'` stays (a separate, harder slice). **Cloudflare's edge STAMPS OUR nonce onto its injected Web Analytics beacon** (reads our `script-src`), so the beacon passes too — no host allowlist needed, the CSP stays clean. Real-browser-verified: `/apps` catalog ("1068 of 1068 apps") + `/environment?tenant=_default` plan both RENDER (their inline scripts execute under the strict nonce CSP — a mismatch would've blocked them); `test-security-headers.sh` asserts header↔body nonce parity across all 4 `/` script tags (incl. the beacon). admin-token-gated pages (`/history`, `/machines`) verified WITHOUT exposing the token to an external browser (API data paths via the LOCAL token). Context-spillover #121: 2 `test-control-plane.sh` assertions on the old inline `onclick=` were updated to the `data-act` wiring. `test-security-headers.sh` 12→…→26. **→ Trusted Types arc COMPLETE (7/7 pages, #124–#130): `require-trusted-types-for 'script'` is now ENFORCED — EVERY first-party `innerHTML` sink across all 7 pages was converted to TT-safe DOM (`createElement`/`textContent`/`replaceChildren`/`append`, the `esc()` helpers removed), one page/fire smallest-first, then the directive was turned on. DONE: `/` (shared chrome #124) + `/recommendations` (#125) + `/history` (#126) + `/pair` (#127) + `/apps` (App Store string-helpers → DOM nodes #128) + `/environment` (9 sinks: `renderSummary` "Plan at a glance", `load` meta, `diffProposed` diff table, #129) + `/machines` (the LAST — 10 sinks: `load` device table, `detail` panel + `/api/history` timeline, `bundle` support-bundle card; the `healthCell`/`driftCell`/`scopeCell`/`lastActive` string-helpers → `append*` node helpers, #130). The directive carries NO `trusted-types` policy allowlist — CF's edge challenge/beacon defines its OWN default policy, so pinning one would break it; the bare `require-trusted-types-for 'script'` still enforces the sinks. `test-security-headers.sh` loops all 7 pages asserting each serves 0 first-party `innerHTML` (excluding CF's edge-injected `__CF$cv$params` challenge script) + asserts the enforced-directive header is present with no policy allowlist. `/pair`+`/apps`+`/environment` FULLY render-verified (public); `/` + `/machines` render clean under the ENFORCED directive (no blank/throw), `/machines` data-path verified via served-JS (`j.items||[]`) + API ground-truth (`/api/devices` → 100 devices) with the LOCAL token. Context-spillover: #124 `test-auth.sh` chrome → TT-safe `a.href='/login'`; #126/#129/#130 `test-control-plane.sh` assertions on old HTML literals (`/history` run-column, `/environment` pkg-links, `/machines` `data-act`/`<th>run</th>`) → updated to the createElement forms. The payoff: a FUTURE unescaped DOM-sink now THROWS instead of executing an injected payload.** SPILLOVER (#117): the Google button (`.cta2`) was cyan-on-cyan (invisible); added `background:transparent` → readable.**
- **Verification** — `scripts/test-all.sh` runs every suite (per-suite + grand total, OS-gated skips,
  exits non-zero on any fail); inline-JS parse guard over every dashboard page; **A12 ADR hygiene gate
  (`test-adr.sh` 7/7) — every `docs/aid/decisions/NNNN` ADR is well-formed (Status·Context·Decision·
  alternatives·Consequences) + the key decisions each HAVE an ADR; 0001-0006 (hiSHtory · device-token ·
  mise-lazy-tools · Better Auth #105 · the catalog-enrichment-from-declared-fields pattern #116 · **the
  O10 rate-limit STORAGE decision #123 — Better Auth's limiter on D1 (`storage:'database'`) over the estate's
  Upstash convention, for budget + reuse-existing-infra; records the #108 one-way-door + its alternatives**).** Preserved foundations:
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
