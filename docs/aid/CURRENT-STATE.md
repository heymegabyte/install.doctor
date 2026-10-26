# aid — CURRENT STATE (verified audit)

**Audited:** 2026-10-26 · **Base commit:** `5ef3f031` · **Branch:** `master` · **By:** loop fire #1 (`/loop 15m`, cron `67cbf027`)

**Reconciled** this fire against a PARALLEL session's push `d6e00879` (`feat(aid): add tested blueprint, routing, history and Alloy foundations`) — rebased onto it before pushing. A second agent is actively building aid; coordinate (see NEXT-STEPS). Nothing here is inherited without evidence. Full spec: `MASTER-PROMPT.md`. Resume pointer: `NEXT-STEPS.md`. Research ledger: `research/README.md`.

## Headline finding (do not skip)

At the audit **base** `5ef3f031`, the aid program did not exist here (no `packages/aid-core`, no `docs/aid/`, no `AGENTS.md`). During this fire a **parallel session** pushed `d6e00879`, adding `packages/aid-core/` + root `AGENTS.md`. After rebasing onto it, the master prompt's "aid-core foundation" premise is now **TRUE on `master`**, and its "52 tests" claim is **VERIFIED by rerunning, not inherited: `npm test` → 52/52 pass** (TypeScript 5.8.3, Node ≥22) this fire.

`packages/aid-core` is a **pre-production tested-contracts library** — per its own README, explicitly **NOT** a deployed daemon, OpenCode fork, web app, or hosted routing service. So the aid *contracts* exist + pass; the aid *product* (running control plane, UI, daemon, deployed `/api/ai/v1`) is still **absent**. Also present: the mature install.doctor provisioning system + a new command-not-found lazy-installer prototype.

## Capability ledger

### ✅ Verified (exists + inspected this fire)
- **`packages/aid-core`** (added by parallel session `d6e00879`, rebased + reverified here) — `@install-doctor/aid-core` v0.1.0, pre-production **tested contracts**, zero runtime deps, TS 5.8.3. `npm test` → **52/52 pass**. Exports: `validateBlueprint` (strict v1 desired-state schema: unknown-field reject, Atuin-reintroduction block, full-commit pin, SSRF/secret-in-URL reject), `exportMarkdown`/`importMarkdown` (single-file ENVIRONMENT.md round-trip), `blueprintDigest` (SHA-256, key-order-stable), `aidProviderConfig` (OpenCode provider for `{APP_URL}/api/ai/v1` + 8 route aliases + `{env:AID_INFERENCE_TOKEN}`), `chooseRoute` (restricted-wins, premium-opt-in), `newSession`/`transitionSession` (tenant-scoped, legal lifecycle), `CastWriter` (asciicast v3 formatter — NOT a PTY/recorder/redactor), `planLokiIntegration`+`renderAlloy` (plans + Alloy fragments, credential refs not inline secrets). README boundaries: no deploy, no OpenCode fork, no live provider calls, `/api/ai/v1` proposed-not-deployed.
- `software.yml` — 12,690-line package catalog. `opencode`, `mise`, `chezmoi`, `hishtory` all present as installable entries (`hishtory` flagged deprecated in-repo — conflicts with the master-prompt "use hiSHtory" mandate; see NEXT-STEPS #4).
- chezmoi dotfiles + `scripts/provision.sh` + `start.sh` + `home/dot_local/bin/executable_installx` (zx-based).
- Centralized `detect_os()` at `scripts/lib/detect_os.sh` (prior arc C1) → the 13 roles.
- Prior convergence arc in root `CONVERGENCE.md` (C1–C21, 2026-07-23) — SEPARATE from this aid program. **Do not clobber it.**
- 4 runnable shell test suites: `scripts/test-{detect-os,linux,macos,templates}.sh`. (`npm test` = `task donothing`, a no-op — do not count it as coverage.)
- Stencil docs site at `site/` (Firebase deploy via `.github/workflows/site-deploy.yml`).

### 🟡 Partial (started, not complete / not wired)
- **command-not-found lazy installer** — `provisioning/command-not-found/handler.sh` (`__cnf_resolve`: software.yml-index lookup → per-OS `installerPreference` → install → `mods` AI fallback) + `build-index.sh` (software.yml → TSV via yq/jq or python3+pyyaml). **Handler HARDENED fire #2** — safe AI fallback (allowlist guard + `CNF_DRY`/opt-in gates) + a latent `set -u` crash fixed; 9/9 tested; ShellCheck clean. Still **UNWIRED** (drift below).
  - **DRIFT:** an OLDER, already-tracked impl `home/dot_config/shell/not-found-hook.sh` (`handle_command_not_found`) is what the rc files actually source (`home/dot_zshrc:577`, `home/dot_bashrc:215`). The new richer prototype is **built-but-UNWIRED**. One-owner reconciliation = top NEXT-STEP.
- Multi-host observability + FQDN git-backup wiring (per `DESKTOP-PROVISIONING-BACKLOG.md`) — in flight, NOT aid.

### ❌ Absent (DEPLOYED product, beyond aid-core's pure-function contracts)
- The DEPLOYED `app.install.doctor` control plane (CF Workers/Hono/D1/DO/Queues/Workflows/R2) — aid-core holds the schema/routing/session/Loki CONTRACTS but nothing is wired into a running/deployed Worker; `/api/ai/v1` is proposed, not live.
- `aid` OpenCode fork/runtime (aid-core only proposes the provider CONFIG); one-link pairing/enrollment; device identity; routing adapter tested against the real ProjectSites service.
- ENVIRONMENT.md as a LIVE authority (aid-core has the v1 schema + import/export + digest; no UI/editor/diff surface, no migrations past v1); the 5 nav sections (Machines / App Store / Recommendations / Automations / History).
- Fleet/osquery inventory; Activepieces connector runtime; browser terminals (xterm.js + node-pty) + mandatory History recording.
- `UPSTREAMS.lock.json` reuse manifest (only a candidate skeleton exists — all 30 `pending-evaluation`); `THIRD_PARTY_NOTICES`.
- The 40-category × 30-idea research — **0 of 1,200 candidates researched** (see `research/README.md`).

### ⚫ Blocked (needs external access / decision)
- CF account + `wrangler` auth for the control plane — control plane stays **design-only** until `get-secret CLOUDFLARE_API_TOKEN` + a target account/zone are confirmed.
- `app.install.doctor` DNS/zone.
- Design approval (Figma gate, master-prompt §16) before full SaaS UI.
- `test@megabyte.space` seed-tenant creds (via get-secret) before UI acceptance tests.

## Defects (status)
- **P1 — `__cnf_ai_fallback` arbitrary-execution — ✅ FIXED (fire #2).** Was: `eval`'d the AI-suggested install string unconditionally, ignoring `CNF_DRY`. Now safe-by-default: logged + validated by a deterministic allowlist guard `__cnf_ai_safe` (rejects shell metachars/substitution + any non-installer leading token), never runs under `CNF_DRY`, and requires explicit `CNF_AI_AUTOINSTALL=1` opt-in (`CNF_AI_CMD` = manual/test seam). Locked by `scripts/test-command-not-found.sh` 3a–3e. Satisfies master-prompt §10 + the §17 "hostile names do not execute" golden path.
- **Latent `set -u` crash — ✅ FIXED (fire #2).** `handler.sh` had `…on $os…"` (a multibyte ellipsis glued to `$os`) → under `set -u` the name parsed as `os…` → "unbound variable" crash even with `os` set. Fixed to `${os}`; exposed by the new `set -uo pipefail` test.
- **Drift — two command-not-found implementations — OPEN.** New richer `provisioning/command-not-found/handler.sh` (now hardened) vs older wired `home/dot_config/shell/not-found-hook.sh` (`handle_command_not_found`). Reconciliation = NEXT-STEPS #1.

## Tests rerun / added this fire
- `packages/aid-core` `npm test` (TS 5.8.3 build + `node --test`) → **52 passed, 0 failed** — verifies the README's "52 tests" claim by RERUNNING, not inheriting.
- `bash -n` both new scripts → OK.
- `scripts/test-command-not-found.sh` → **9 passed, 0 failed** (fire #1: syntax ×2, dry-run resolve, index builder → **1,181 rows**; fire #2: AI-fallback safety contract 3a–3e — guard allowlist, default-off, `CNF_DRY`-blocks, metachar-refused, opt-in-runs). ShellCheck clean.
