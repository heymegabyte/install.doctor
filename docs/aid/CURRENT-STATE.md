# aid — CURRENT STATE (verified audit)

**Refreshed:** fire #317 (VERIFICATION-ONLY HOLDs #313–#317 — NEW-gate frontier EXHAUSTED, loop CONVERGED; re-verified the CORE deliverable `/start` is LIVE (200, serves provision.sh + 23 chezmoi-apply refs), `/brew`+`/ssh` still 404 (the #305 stale Firebase deploy, human-gated → BACKLOG #0), all 3 ledgers reconcile at 868/50, full suite **868/50 GREEN** vs prod; no code change — remaining work is host-/human-gated (BACKLOG); throttle-cron-to-daily rec reaffirmed) — NEW ARC: bootstrap/provisioning QUALITY + deploy SPEED (the v2 control-plane arc converged #195–#197). The master prompt PIVOTED to: `start.sh`→chezmoi (dot configs **and** system files), minimum-install + lazy-everywhere, a preinstalled cnf-substrate toolchain, cloudflared+WARP, file cleanup/de-dup, a Monday-02:00 auto-update cron. **⚠️ app.install.doctor is being RETIRED → absorbed by https://desktop.tools** — do NOT keep hardening the control-plane surface; the suite still verifies it until the migration lands. Per-fire arc history (#198→) lives in `git log` + the §Built/§Gated sections below. Verified: full suite **868 / 50 suites GREEN** vs live prod. **Branch:** `master`.
Full spec: `MASTER-PROMPT.md` · resume pointer: `NEXT-STEPS.md` · matrix: `REQUIREMENTS.md`. Nothing here
is inherited without evidence; every count below is from a live `scripts/test-all.sh` run.

## Headline

The UNBLOCKED functional product has **converged**: the control plane, the full `aid` CLI, the browser
dashboard, the honest-docs set, and a one-command test suite are built + live-verified at
**https://app.install.doctor**. The remaining high-value requirements are **GATED on external action**
(see § Gated). Loop fires now harden docs/tests/honesty until a gated dep is provisioned. Verified by
**`scripts/test-all.sh` → 868 assertions / 50 suites GREEN (1 OS-skipped)** with the prod URL.

## ✅ Built + live-verified

- **Control plane** (`packages/control-plane`, Hono Worker, D1 `aid-control-plane`) — live at
  `app.install.doctor`. Routing-policy `/resolve` + fail-closed inference pre-flight (451/402/503/405);
  ENVIRONMENT.md validate/export/import/diff + D1 read + authed `PUT` (optimistic `expectedRevision`
  lock) + apply-PREVIEW (dry-run plan; real mutation honest-501; `expectedRevision` 409 guard, §3/P09);
  the software catalog (`/api/catalog` + per-entry install commands); **`/api/catalog/:name` returns the
  CANONICAL entry (`bin === name`) for a multi-bin package (xz→xz not unxz, bzip2/kvm/rar→namesake; #133 D02)**
  + a reusable **catalog-integrity validator** `scripts/validate-catalog.py` (D12: fixture-proven to catch a
  same-bin-overlapping-platform conflict, providers≠pkgs, bad installMode; a disjoint-platform split is legit
  + NOT flagged; committed catalog = 1069 entries, 0 conflicts) **WIRED as the `wrangler.toml` `[build]` gate
  (#134, D13) — `wrangler deploy` (and `--dry-run`) runs it before bundling, so a catalog conflict ABORTS the
  deploy (E2E-proven: an injected same-bin `ack` conflict blocked a dry-run build, then restored); an invalid
  catalog can never ship**; `test-catalog-integrity.sh` 10/10 + a **catalog-COVERAGE gate** `scripts/test-catalog-coverage.sh` 5/5 (D01-completeness #143 — every post-installx hook maps to a browseable catalog entry OR a documented exemption in `catalog-coverage-exemptions.json`: cloudflared/ntfy are custom-install no-provider, github-runner/zsh-bootstrap internal; rejects stale/redundant/reasonless exemptions; proven non-vacuous via a fake-orphan injection) + an **installer SUPPLY-CHAIN gate** `scripts/test-installer-supply-chain.sh` 6/6 (D09/D10/D15 #144-145 — every remote-code-execution site in the installer scripts, pipe-to-shell OR download-then-exec, is documented in `installer-supply-chain-allowlist.json` as sanctioned (cua: official installer + mandatory `--dry-run`) or a tracked known-gap; a new undocumented `curl|sh` OR moving-branch `/raw/master` fetch fails CI; proven non-vacuous via a fake-installer injection. #145 REMOVED the one known-gap at ROOT — the archived NGINX-Amplify dead-code remote-exec (nginx-amplify-agent is `archived:true`, service sunset by F5, D15) — so only the sanctioned cua installer remains + 0 known-gaps). **`scripts/test-control-plane.sh`
  197/197 — incl. the plan review NAMING uncatalogued packages (A10 #155 — `summary.unknownPackages`: the `_default` runner's `alloy` (Grafana Alloy, intended per the observability doctrine but not yet in software.yml) was named "1 package not in the catalog: alloy" (not a mystery "1 other") — then #156 ADDED `alloy` to software.yml with grounded install data (brew `grafana-alloy` verified via Homebrew API + apt/dnf `alloy` from Grafana's official Linux install docs; a service), so `_default` is now CLEAN (unknownPackages:[], alloy a browseable catalog entry) and the NAMING mechanism stays guarded by a durable bogus-package synthetic, surfacing the real coverage gap actionably; mirrors the NAMED deprecatedPackages/platformGaps) + eager-vs-lazy install-mode ACCURACY (a `_preload:true` CLI — which installx EAGER-installs at provisioning — now reads "installed at setup", not the wrong "on first use"; `preload` flag added to the catalog, fixed 123 mislabeled browseable CLIs incl. ripgrep/bat/fzf, #153; + the Environment plan-summary aggregate SPLIT to match — `cliPreload` (eager "preloaded CLIs at setup") vs `cli` (lazy "on first use"), so the `_default` plan reads "3 preloaded CLIs at setup" not "3 on first use", #154; + #161 the plan review now also shows **CONFIGURATION coverage** — `summary.configured` tallies how many catalog-known plan packages AUTO-CONFIGURE on install via a post-installx first-run hook (N of M, the auto-configured ones named as chips linking to the App Store), serving step-5 "review a concrete plan showing ... configuration" + F15/C12; TDD via a seeded `_cfgtest` (tailscale configured + ripgrep not → {count:1,of:2}), deployed `f863a426`, live-verified; + #162 the plan review also shows **PRIVILEGES** — `summary.privileges` flags packages that REQUIRE ELEVATION (sudo) to install (a service OR a system-PM-only tool like distrobox/docker/chromium whose only install path is apt/dnf/pacman — genuinely NEW info not in installModes), as amber chips, so step-5 "privileges" is now covered (apps/config/privileges done; recovery-coverage remains I/J-gated); TDD `_privtest` (distrobox elevated, ripgrep brew-installable not), deployed `7a7336da`, live-verified) + per-provider UNINSTALL commands (R02/B14 maintenance-lifecycle, App Store "Uninstall:" block, #152) + an INSTALL↔UPDATE command-parity drift-guard (#148) + a device-apply-501 "server-never-pushes-installs" invariant guard (#149) + a visibility-aware **self-refresh** across ALL 5 admin read surfaces — `/machines` (#140) + `/history` + `/recommendations` (#141) + `/environment` (#142) (auto-poll every 30s, pause on `document.hidden`, refetch on foreground, quiet background ticks, stop-when-nothing-to-watch, `/history` preserves its active run-filter, `/environment` polls the plan `load()` only — not the manual `diffProposed` — no manual reload; U15/real-time-data-no-manual-refresh) + a server-computed **fleet-health rollup** on `/api/devices` (`summary` = total · active · ok/stale/never-reported partition · drifted · revoked; N08/U15 #138 — **#158 ACTIVE-scoped the connectivity+drift partition: revoked/decommissioned devices are EXCLUDED from ok/stale/never (they were inflating "ok" — `_default` showed "52 ok" when 84 of 100 were revoked; now active=16, ok+stale+never==active, active+revoked==total), matching recommendations' existing `active` filter so the two fleet surfaces agree, and the render shows "N active of M" + "revoked (decommissioned)"; U15 observed-not-optimistic**) + a per-device connectivity-coloured **freshness dot** on the `/machines` last-active cell + detail (ok cyan / stale amber / never grey, from `health.connectivity`, DRY via `freshDot`; U15 #139) — incl. the U12 sanitized **support bundle** (admin-scoped, explicit contents/excluded manifest, never the token/secrets/detail-blob) SURFACED in the `/machines` device detail (view + download JSON; #83) — **U13 recommendations DEDUPED** (each flagged machine alerted in exactly ONE card by severity, `distinctDeviceCount` = true blast radius, per-card repair `command`; #84) — **U14 FULLY DONE** = access-control ✅ + **payload QUOTA** (`detail` capped 16 KB / body 32 KB → `413`; #85) + **RETENTION** (admin `POST /api/history/prune?tenant=&olderThanDays=` deletes old events, tenant-scoped, explicit window, invoked by the loop; prunedCount verified + history EMPTY after; #87) — **C09 semantic DIFF tool on `/environment`** (paste a proposed ENVIRONMENT.md → import both + diff → color-coded added/removed/changed; #86) — and **U03 parent/child run CORRELATION — END-TO-END** (a report carries `correlationId`/`parentRunId`, stored via migration 0008; admin `GET /api/history?correlation=` returns the correlated run tree; both history reads surface the fields #88; the **`aid` client now STAMPS a per-invocation run-id on every report** so one `aid up` groups into a correlated run — verified live via the real aid script #89; and the `/machines` device-detail timeline shows a **"run" column** (short correlationId badge + ↳ child-of-parent indicator) so an operator SEES which events belong to one run #90. **U03 FULLY DONE** — tracked, stamped, surfaced).**
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
  last-active + drift + health + scope columns + a server-computed **fleet-health rollup** summary
  (total · ok/stale/never-reported · drifted · revoked badges, from `/api/devices`'s `summary`; TT-safe
  DOM; N08/U15 #138) + a per-device connectivity-coloured **freshness dot** on each last-active cell
  (ok cyan / stale amber / never grey, from `health.connectivity`, DRY via `freshDot`; U15 #139) + a
  visibility-aware **self-refresh** (the inventory auto-polls every 30s, pauses on a hidden tab, refetches on
  foreground, with a "↻ live · auto-refresh 30s" affordance — no manual reload; U15/real-time #140), + per-device DETAIL with a unified change timeline + a
  one-click **Support bundle** view/download (U12)),
  **App Store** (catalog live-search — now matches each tool's **description** too, so you can find a tool by WHAT IT DOES, not just its name/command (`?q=fuzzy` → fzf + 5 fuzzy/search tools); the box advertises the breadth; D-series #94 — + a **PLATFORM filter** (macOS/Linux/Windows `<select>` + `?platform=`; allowlisted server-side + echoes the applied filter; show only the tools installable on YOUR OS — linux→829, macos→982 of 1069; D05 #97) — + the detail states platform UNAVAILABILITY EXPLICITLY (`/api/catalog/:name` carries `unavailablePlatforms` = the complement of `platforms`; a macOS-only tool shows a muted "Not available on: Linux, Windows" so availability isn't inferred from a missing tag; A10-ext #137, live-verified aerospace→[linux,windows]/ack→[]) — + a per-tool **install-MODE badge** ("desktop app" / "service" / "CLI · installed at setup" for preloaded CLIs / "CLI · on first use" for lazy ones — #153 eager-vs-lazy accuracy) in the list + a one-line explanation in the detail, derived from software.yml's declared `_app`/`_service` (app 224 · service 52 · cli 793), so you SEE whether a tool is a desktop app installed at setup or a CLI installed lazily on first use — the core eager-vs-lazy promise (D06 #110) — + a **DEPRECATION warning** on the 147 catalog entries the maintainer flagged `_deprecated` (an amber "deprecated" badge in the list + the full reason in the detail, e.g. altair → "Deprecated in favor of Postman"; so the App Store WARNS before a user installs an abandoned/discouraged tool + names the replacement — D14/D15 honesty #112) — + a **"Depends on" runtime-deps row** in the detail (software.yml `_deps`, 30 catalog entries, e.g. aifiles → pandoc·exiftool·poppler·csvkit; each dep LINKS to its own App Store entry — interconnected; a YAML colon-artifact is filtered; D07 #113) — + a **"✓ Configured on install" row** in the detail for the 28 tools with a `post-installx/post-<tool>.sh` first-run hook (atuin/netdata/rclone/tailscale/vscode/docker-desktop/gcloud/…; `gen-catalog.mjs` merges `configured`+`postInstall`, matched by name/bin; the cyan line names the concrete hook as the config action; a bare lazy CLI shows nothing — honest config coverage, R14/F15/F06 #136) — + a **DETECT-stage line** ("Check if already installed (adopt, not reinstall): `command -v <bin>`" — the R01 recipe idempotency/adoption primitive derived from the bin, so a run can adopt an existing tool (F04) instead of reinstalling (B10/W02); #157) + install commands + per-provider **UPDATE commands** ("Update (keep current):", derived from each manager's upgrade form — brew upgrade / cargo install --force / npm update -g / apt --only-upgrade — answering promise #8 "keep each host current"; D11 update-channel #147) + per-provider **UNINSTALL commands** ("Uninstall:" block — brew uninstall / apt remove / dnf remove / pacman -Rns / cargo uninstall / npm uninstall -g / …; `go` omitted — no `go uninstall` verb, honest; the maintenance-lifecycle completion alongside install+update, R02/B14 #152; live-verified ripgrep→7 forms, go-tool `act`→go excluded) + each tool's **description** (`_short`, 906/1069 entries) as a scannable sub-line + a **"Maintained by <owner>" line** (the github org/user derived server-side from the provenance URL — a trust/ownership signal, D11 #146; 961/1069 carry a github URL; no github URL → nothing shown) + a **"Learn more" link set** in the detail — **Source** (github) + **Homepage** (`_home`) + **Docs** (`_docs`), only the links that exist so there are no dead links (490/1069 carry home/docs; D11 #92+#95); the user-facing descriptions are **verified-accurate** — 19 fabricated/slop `_short` entries (e.g. distrobox/upscayl/dialect, which described the wrong product or just named the repo) corrected against real upstream `.description` + a **hard gate** (`test-software-descriptions.sh`) now blocks fabrication meta-commentary in `_short` from regressing (D11/D14 #96)), **Environment** (a structured **"Plan at a glance"** summary — packages/machines/services/routing/privacy from `/api/environment/current`'s server-side `summary` (step-5 review, C12 #93) — **now with an eager-vs-lazy INSTALL breakdown** ("N desktop apps at setup · M services · P preloaded CLIs at setup · K lazy CLIs on first use" (the #154 eager-vs-lazy split — preloaded CLIs count as eager, not on-first-use), computed server-side over the catalog `installMode` #110 across the plan's defaults + machine packages, "other" for non-catalog packages; so plan review shows HOW provisioning will behave — C12/D06 interconnect #111) — **+ a plan DEPRECATION warning (#114): if the plan includes packages the maintainer flagged `_deprecated` (#112), the "Plan at a glance" shows a prominent amber "N deprecated package(s) in this plan — review before applying" with each name + reason (real-browser-verified on a seeded plan → "1 deprecated package … altair: Deprecated in favor of Postman"), a SAFETY win before applying; **+ a plan PLATFORM-GAP warning (#135, A10): `summary.platformGaps` lists, per OS, the plan packages NOT installable there — the "Plan at a glance" renders an amber "Partial platform coverage — some packages will not install on every platform" callout ("Unavailable on Linux/Windows: <pkg>", each linked to its App Store entry) when e.g. a macOS-only app is in the plan, else "✓ all packages install on macOS, Linux + Windows"; real-browser-verified on a seeded `_platgap` (aerospace → unavailable on linux+windows, ack not flagged) + it surfaced a REAL gap on `_default` (git catalog-unavailable on Windows)**; `/environment` now honors `?tenant=` to deep-link a specific tenant's plan (like the App Store's `?q=`)**, each planned **package LINKS to its App Store detail** (`/apps?q=<pkg>`, which now honors the URL param) so you can click a package in your plan to see what it is + how it installs (interconnectedness #98) — + the read-only desired-state
  ENVIRONMENT.md view + a **semantic DIFF tool** — paste a proposed ENVIRONMENT.md → color-coded
  added/removed/changed vs current, C09), **Recommendations** (rule-based: failed-last-run/drifted/never/stale, DEDUPED
  per-machine so no host is double-alerted, a `distinctDeviceCount` blast-radius summary, each card's
  repair `command` + device deep-links, U13; **+ a tenant-level `plan_deprecated` rec (#115) — if the desired PLAN
  includes packages the maintainer flagged deprecated (#112), it warns "N deprecated package(s) in the desired plan —
  Replace: altair (Deprecated in favor of Postman)", the 3rd + proactive deprecation surface after the App Store badge + the
  plan-review warning; reuses `collectDeprecated` on the blueprint**), **History** (fleet events + honest `recordingMode:events-only` note, U02; a correlation **"run" column** whose badges are CLICKABLE → filter the fleet history to one correlated run via `?correlation=`, U03 #91; and each event's **DEVICE now links to that machine's detail** (`/machines?device=`) so "what happened" → "which machine" is one click, matching the Recommendations deep-link pattern, interconnectedness #99). Admin token
  persists in sessionStorage (enter once). Device identity/health/drift/recs all from one shared query.
- **Lazy CLI** (`home/dot_config/shell/not-found-hook.sh`) — ONE canonical resolver: no-eval argv-exec,
  install locks + recursion guard, interactive/CI gate, atomic index, mise-defer, + #163 D03/E07 ARRAY-pkg
  serialization (a space-joined multi-package installer value — docker apt:[containerd.io,docker-ce,…], 61
  catalog entries — now splits to SEPARATE argv in bash AND zsh via portable `${x%% *}` peel, never one
  unfindable quoted "a b c"; bash+zsh proven) + #164 F02/D06 CASK detection (the manager-availability check
  now tests `brew`, not the nonexistent `cask` binary — so the 253 cask-ONLY GUI apps, cask col set/brew
  empty, e.g. aerospace/alt-tab/android-studio, actually lazy-install via `brew install --cask` instead of
  silently falling through) + #170 E08/E15 STREAM+STATUS fidelity (the resolved command's piped STDIN
  reaches it — install `</dev/null` can't eat it — AND its EXIT STATUS propagates as the handler's rc, so
  `if missingtool` / `$?` behave; proven non-vacuous by break→RED→restore→GREEN + bash+zsh parity confirmed —
  a `zcat`-collides-with-a-real-binary probe artifact was ruled out, not "fixed") + #171 E07 NO-PARENT-SHELL-LEAK
  (every `__cnf_resolve`/`__cnf_do_install` working var is `local` — a dropped `local` would clobber the
  user's `$rest`/`$row`/… on EVERY missing command; guarded by an in-shell resolve + a leak-check over the
  hook-only names, non-vacuity proven by dropping a `local`→RED, bash+zsh parity) + #172 index-build ATOMICITY
  (`cnf-build-index` writes a temp `.cnf-index.*` then atomic-`mv`s it in + an EXIT trap removes it on ANY exit —
  asserted NO temp litter remains in the OUT dir after EITHER a successful OR a failed build, non-vacuity proven
  by disarming the trap→RED; complements the existing failed-build-keeps-prior-index clobber test); bash+zsh tested
  (**`test-command-not-found.sh` 35/35** — #273 fixed the rc wiring to forward `"$@"` (a lazy-installed `rg pattern`
  had re-run as bare `rg`, args lost); #274 added `apk` to the `__cnf_ai_safe` AI-fallback allowlist — the 4th place a
  manager must appear, the last gap of the #268 Alpine migration, so a valid `sudo apk add X` AI suggestion is no longer
  rejected on Alpine);
  fish+pwsh adapters present (structural gates 8+8, live-unverified).
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
  shared page chrome on EVERY page (#104, test-auth 10/10) — calls `GET /api/auth/get-session`
  (`credentials:include`) → signed in: the user + a **Sign out** button (`POST /api/auth/sign-out`); not
  signed in: a "Sign in" link (`get-session` returns `null` unauthenticated — honest, O13).
  **O11/O12 admin→session groundwork BUILT (#131):** `requireAdmin` now accepts EITHER the `AID_ADMIN_TOKEN`
  bearer (checked FIRST — a presented bearer takes the fast path, so the CLI + all 9 admin routes + the
  token-based dashboard are byte-for-byte unchanged) OR a Better Auth **session** whose verified email is in
  the `AID_ADMIN_EMAILS` allowlist (a Worker secret, set to the owner emails). The decision is the pure,
  node-unit-tested `isAllowedAdminEmail` (`src/admin-allowlist.ts`, `test-admin-allowlist.sh` 14/14). LIVE-
  verified the branch is reachable + non-throwing: `/api/devices` no-auth → 401 (not 500/503), token → 200,
  `get-session` → clean null. **HONEST: sign-in does NOT COMPLETE yet** — the callback→session leg needs
  `https://app.install.doctor/api/auth/callback/{github,google}` registered on the OAuth apps (a one-time
  human step), so the session-ACCEPT path for a signed-in allowlisted user is wired + ready but NOT yet
  end-to-end verified. **The DASHBOARD now USES the session (#132):** every admin fetch sends the
  `AID_ADMIN_TOKEN` bearer ONLY when pasted, else relies on the same-origin Better Auth session cookie
  (`aidAdminHeaders()`), the 6 blocking "Enter the admin token" guards are gone (a signed-in admin attempts
  the fetch token-free), a 401 now reads "sign in or paste your admin token", and a muted "optional if you
  are signed in" note sits by each token input — so the moment the OAuth callback is registered, the
  dashboard is token-free for a signed-in allowlisted admin with ZERO further code. The token input stays as
  the live fallback. Magic-link ⬜ (needs SES).
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
  **strict-`script-src` STEP 1+2+3 COMPLETE — full XSS defense-in-depth LIVE (#117–#130): inline-handler removal + per-request nonce + ENFORCED Trusted Types.** STEP 1 (#117–#121): converted EVERY inline `on*=` handler on all 7 dashboard pages (`/login`+`/recommendations`+`/pair` #117, `/apps` #118, `/environment` #119, `/history` #120, `/machines` #121) to `addEventListener` — static fixed-button handlers (simple swaps) + DYNAMIC per-row buttons via EVENT DELEGATION (`data-act`/`data-id`/`data-corr` + one container listener reading `e.target.closest('[data-act]')`). STEP 2 (#122): dropped `script-src 'unsafe-inline'`, replaced with a **per-request NONCE** — a middleware generates a 16-byte hex nonce per request, injects `nonce="<n>"` into EVERY inline `<script>` of HTML responses (one regex in ONE place: `html.replace(/<script(?=[\s>])/g, …)` — catches page + shared-chrome scripts automatically), and sets `script-src 'self' 'nonce-<n>'`. An injected/reflected `<script>` can't guess the nonce → won't execute (and dropping unsafe-inline ALSO blocks injected inline `on*=` event handlers). `style-src 'unsafe-inline'` stays (a separate, harder slice). **Cloudflare's edge STAMPS OUR nonce onto its injected Web Analytics beacon** (reads our `script-src`), so the beacon passes too — no host allowlist needed, the CSP stays clean. Real-browser-verified: `/apps` catalog ("1069 of 1069 apps") + `/environment?tenant=_default` plan both RENDER (their inline scripts execute under the strict nonce CSP — a mismatch would've blocked them); `test-security-headers.sh` asserts header↔body nonce parity across all 4 `/` script tags (incl. the beacon). admin-token-gated pages (`/history`, `/machines`) verified WITHOUT exposing the token to an external browser (API data paths via the LOCAL token). Context-spillover #121: 2 `test-control-plane.sh` assertions on the old inline `onclick=` were updated to the `data-act` wiring. `test-security-headers.sh` 12→…→26. **→ Trusted Types arc COMPLETE (7/7 pages, #124–#130): `require-trusted-types-for 'script'` is now ENFORCED — EVERY first-party `innerHTML` sink across all 7 pages was converted to TT-safe DOM (`createElement`/`textContent`/`replaceChildren`/`append`, the `esc()` helpers removed), one page/fire smallest-first, then the directive was turned on. DONE: `/` (shared chrome #124) + `/recommendations` (#125) + `/history` (#126) + `/pair` (#127) + `/apps` (App Store string-helpers → DOM nodes #128) + `/environment` (9 sinks: `renderSummary` "Plan at a glance", `load` meta, `diffProposed` diff table, #129) + `/machines` (the LAST — 10 sinks: `load` device table, `detail` panel + `/api/history` timeline, `bundle` support-bundle card; the `healthCell`/`driftCell`/`scopeCell`/`lastActive` string-helpers → `append*` node helpers, #130). The directive carries NO `trusted-types` policy allowlist — CF's edge challenge/beacon defines its OWN default policy, so pinning one would break it; the bare `require-trusted-types-for 'script'` still enforces the sinks. `test-security-headers.sh` loops all 7 pages asserting each serves 0 first-party `innerHTML` (excluding CF's edge-injected `__CF$cv$params` challenge script) + asserts the enforced-directive header is present with no policy allowlist. `/pair`+`/apps`+`/environment` FULLY render-verified (public); `/` + `/machines` render clean under the ENFORCED directive (no blank/throw), `/machines` data-path verified via served-JS (`j.items||[]`) + API ground-truth (`/api/devices` → 100 devices) with the LOCAL token. Context-spillover: #124 `test-auth.sh` chrome → TT-safe `a.href='/login'`; #126/#129/#130 `test-control-plane.sh` assertions on old HTML literals (`/history` run-column, `/environment` pkg-links, `/machines` `data-act`/`<th>run</th>`) → updated to the createElement forms. The payoff: a FUTURE unescaped DOM-sink now THROWS instead of executing an injected payload.** SPILLOVER (#117): the Google button (`.cta2`) was cyan-on-cyan (invisible); added `background:transparent` → readable.**
- **Verification** — `scripts/test-all.sh` runs every suite (per-suite + grand total, OS-gated skips,
  exits non-zero on any fail); inline-JS parse guard over every dashboard page; a **chezmoiscript
  RENDER-INTEGRITY gate** (`test-chezmoiscript-render.sh` 2/2, #290) — renders EVERY
  `home/.chezmoiscripts/**/*.sh.tmpl` via chezmoi + `bash -n`-parses the output, so a Go-template or bash
  break that would ABORT `chezmoi apply` mid-provision (the whole deploy dies) fails CI first; no prior
  suite rendered the WHOLE set (the 8 that touch chezmoiscripts each grep ONE for its own concern), and it
  SELF-TESTS its own detector against a planted broken fixture so it can never go vacuous (SKIPs if chezmoi
  absent — a render gate with no renderer gives no protection but must not block a chezmoi-less CI); a
  **secret-hygiene gate** (`test-secret-hygiene.sh` 2/2, #296) locks the crown-jewel age MASTER-key
  invariants — run_before_03 chmod-600's the decrypted key (`~/.config/age/chezmoi.txt`, which unlocks
  EVERY chezmoi secret) AND decrypts it DIRECTLY to its config path (never staged world-readable in /tmp);
  the secret-sweep axis (#295 post-installx `/tmp` → A12; #296 chezmoiscripts/partials — surface clean); a
  **chezmoiexternal supply-chain gate** (`test-external-integrity.sh` 2/2, #298) — a down-only ratchet on
  floating-ref downloads (`.chezmoiexternal.toml.tmpl` pulls 16 externals from moving `/master`/`/main`
  branches = a supply-chain exposure); FAILS any NEW floating external so it must be PINNED to a SHA/tag
  (pinning the existing 16 is a BACKLOG focused-session); non-vacuous (asserts the detector matches the
  known set, never a vacuous 0); a **root chezmoi-config integrity gate** (`test-chezmoi-config.sh` 3/3,
  #304) validates the init/apply bootstrap manifests — `.chezmoidata.yaml` is valid YAML (the data map every
  template reads) + `.chezmoiexternal.toml.tmpl` renders → valid TOML + `.chezmoiignore` renders cleanly; a
  broken one aborts `chezmoi init` ENTIRELY (the config template `.chezmoi.yaml.tmpl` is excluded — its
  init-context `writeToStdout` false-REDs execute-template); a **served-entrypoint canonical-ORG
  invariant** (`test-served-entrypoints.sh` 8/8, #305) — the #204 gate verified each `/start`/`/windows`/
  `/brew`/`/ssh` redirect carries the right SCRIPT filename but was BLIND to the GitHub org, so it now also
  asserts every `raw.githubusercontent.com/<org>/install.doctor/…` destination uses the canonical
  `heymegabyte` org (CLAUDE.md §13 + the git remote), never the stale pre-rename `megabyte-labs` (which
  serves a DIFFERENT repo's script that can diverge); non-vacuous (planted `megabyte-labs` + a third-party
  org both RED); a LIVE probe this fire found prod STILL 301s `/start`+`/windows`→`megabyte-labs` and 404s
  `/brew`+`/ssh` — the deployed Firebase config is STALE (site-deploy is Firebase-secret-gated, §9 #21), so
  the repo config is correct + locked and a redeploy (human-gated) is surfaced to BACKLOG;
  **A12 ADR hygiene gate
  (`test-adr.sh` 7/7) — every `docs/aid/decisions/NNNN` ADR is well-formed (Status·Context·Decision·
  alternatives·Consequences) + the key decisions each HAVE an ADR; 0001-0006 (hiSHtory · device-token ·
  mise-lazy-tools · Better Auth #105 · the catalog-enrichment-from-declared-fields pattern #116 · **the
  O10 rate-limit STORAGE decision #123 — Better Auth's limiter on D1 (`storage:'database'`) over the estate's
  Upstash convention, for budget + reuse-existing-infra; records the #108 one-way-door + its alternatives**).** Preserved foundations:
  chezmoi · software.yml · mise · hiSHtory · `detect_os()`/`detect_arch()`/`detect_release()`/`detect_service_manager()`/`detect_privilege()`/`detect_graphical_session()`/`detect_env_class()`/`detect_sandbox_mechanisms()` (OS+arch+release+init+privilege+graphical-session+env-class+sandbox-mechanisms SoT; `is_headless` is a thin consumer; **#166 `detect_env_class` → container|wsl|vm|bare-metal, B04 — the virtualization axis, container-first precedence, systemd-detect-virt/DMI/macOS-hv_vmm_present probes, `INSTALL_DOCTOR_ENV_CLASS` override; #167 `detect_sandbox_mechanisms` → the available isolation primitives (bwrap/firejail/nsjail/unshare/systemd-run/sandbox-exec/docker/podman, set or "none"), B05 — builtin-only so correct under a stripped PATH, feeds the Q10-Q12 jail choice, `INSTALL_DOCTOR_SANDBOX_MECHANISMS` override; #168 `should_provision_desktop()` — the FIRST capability ADAPTER (A5): CONSUMES detect_env_class+is_headless to decide desktop-vs-not (container OR headless → no desktop, H15) instead of a hostname/OS conditional, and `provision.sh:applyEnvClassDefaults` consumes IT; #169 `should_skip_reboot()` — the 2nd A5 adapter: CONSUMES detect_env_class → container|wsl can't safely reboot mid-provision → `applyEnvClassDefaults` now defaults `NO_RESTART` for WSL too (not just containers — the gap this closed), plus the inline-fallback `is_headless` macOS-headless misclassification fixed; test-detect-os +7+6+5+5 = 71**) · the prior `CONVERGENCE.md` arc.

## ◐ Partial (honest)

- **U02 recording** — structured events + an honest `recordingMode:events-only` marker; actual terminal
  capture/redaction ⬜ (the recorder isn't built).
- **aid apply** — dry-run + the local real-install path exist; the real install is machine-gated (never
  run in CI). Server never pushes installs (device apply = 501 by design; guarded #149 — a valid device
  token requesting a real apply (dryRun:false) is refused 501 apply_not_implemented).
- **fish/pwsh lazy install** — adapters shipped, live-unverified (no fish/pwsh on the runner).
- **post-installx hook DISPATCH** — WIRED #251: `run_after_20-post-install.sh.tmpl`'s `runPostInstallxHooks`
  loops `~/.local/bin/post-installx/post-*.sh` after installx (`run_after_10`), error-tolerant; each hook
  self-guards on OS + tool-presence + idempotency, so all 30 config hooks (cloudflared/WARP/tailscale/
  netdata/…) now dispatch (wazuh also via its `script:` entry). File-wired + gate-locked
  (`test-post-installx-dispatch.sh` 13/13; #250 detect → #251 wire → #252 headless-harden → #253 fail-fast → #254 dev-user `chown` fix+lock → #255 `$DEBUG_MODE` set-u crash fix+lock → #291 A11 TEMP-CLEANUP: a hook that `mktemp`s must `trap … EXIT`-clean it (_TEMPLATE req 5), fixed post-postfix's error-path leak RED→GREEN → #295 A12 SECRET-TO-TMP: a hook writing a get-secret value to /tmp must chmod-600 + clean it, fixed post-wazuh's plaintext WAZUH_REGISTRATION_PASSWORD leak RED→GREEN).
  **Still ◐: the LIVE run (hooks
  actually executing + configuring on a provisioned machine) is HOST-GATED** — needs a throwaway box to
  confirm, same class as cloudflared/WARP live-connect. Closed the #250 29/30-undispatched gap.

## 🚧 Gated — remaining high-value work needs EXTERNAL action (not a loop slice)

- **O Better Auth** — **BUILT #102 (authorize-initiation LIVE; see § Built).** GitHub/Google sign-in INITIATES
  (verified). (2) the dashboard is now SESSION-AWARE — `requireAdmin` accepts a Better Auth session (allowlisted
  email) OR the token, and the chrome shows the signed-in user + Sign-out (#131/#132, guarded by test-auth #8–#11
  + #150 bad-cookie graceful-degradation) — **DONE**. The remaining COMPLETION gates are HUMAN/EXTERNAL: (1) register
  `https://app.install.doctor/api/auth/callback/{github,google}` on the OAuth apps (a one-time human step) so the
  session branch's live ACCEPTANCE can be verified end-to-end; (3) magic-link needs SES (`AWS_SES_ACCESS_KEY_ID`
  absent, re-confirmed via get-secret #150). No buildable loop slice remains in O — it is gated on (1)+(3).
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
