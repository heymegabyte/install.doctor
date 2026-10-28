# aid — NEXT STEPS (resume pointer)

Updated every loop fire. Smallest next executable step at the top. Cadence: `/loop 15m` (cron `4002f61a` — the **v2** prompt, replaced `67cbf027` at fire #32; 7-day auto-expiry). **Advance ONE verified slice per fire**, commit + push, update this file. Full spec: `MASTER-PROMPT.md`. Verified reality: `CURRENT-STATE.md`. **v2 backlog = the A01–X15 matrix in `REQUIREMENTS.md`** (360 reqs, Phase 1→5).

> **CONVERGENCE NOTE (fire #70, still current):** the UNBLOCKED functional surface is built + live-verified at **app.install.doctor** — control plane (112 asserts) · the full `aid` CLI (pair→pull→plan→apply→report→up + exec/prewarm/installs/provider) · 5 dashboard read surfaces + per-device detail/health/timeline/scope · device identity/pairing/scope-enforcement(P05)/revocation · cross-tenant isolation (W08) · the §3 revision-mismatch guard · the complete honest-docs set · a one-command test aggregator. **The remaining HIGH-VALUE work is GATED on external action (not a loop slice)** — see `## Blockers`: **O Better Auth** (GitHub/Google/magic-link — needs OAuth apps + SES), **K/#7 the real provider CALL** (needs the CF **AI Gateway** + `AID_INFERENCE_TOKEN` + the ProjectSites/OnePrompt orchestrator contract), **I/J** per-host repos + encrypted backups (GitHub repo-creation creds + restic/S3 + a throwaway box), **real multi-host / replacement-host drills** (throwaway machines — a fire must NOT mutate the dev shell), and **N02** the Figma-gated full SaaS redesign. Loop fires now harden docs/tests/honesty — a healthy convergence — until a gated dep is provisioned.

**TOP next (fire #78+):** functional progress is GATED (see the CONVERGENCE NOTE + `## Blockers`). A fire may legitimately (a) **idle-verify** — run `scripts/test-all.sh`, confirm GREEN, change nothing, report convergence (a healthy no-op, NOT under-delivery); (b) **provision ONE external dep** then build its slice; or (c) advance a remaining tiny UNBLOCKED slice. The `aid exec` → History live-verify (paired E2E on a real-install box) is the ONE gated functional check still outstanding. Do NOT fabricate a cosmetic change to look productive.

> **Parallel session:** `d6e00879` added `packages/aid-core` (tested contracts, 52/52). BUILD ON it — reuse `validateBlueprint`/`aidProviderConfig`/`chooseRoute`/session/Loki contracts; never duplicate. Always rebase onto `origin/master` before pushing.

## Do next

**Converged build — fires #1–#72 (summary, see `git log` + `CURRENT-STATE.md` for detail).**
- **Phase A/foundations (#1–#6):** cnf hook reconciled to ONE canonical owner + hardened AI fallback + index wired at provision + atomic index build; hiSHtory adopted over Atuin (ADR 0001); fabricated-description detector; the control-plane skeleton LIVE.
- **Control plane + desired state (#7–#15):** routing POLICY + fail-closed inference pre-flight + cost reservation (provider CALL still #7-gated); ENVIRONMENT.md validate/export/import/diff + D1 read + authed `PUT` (optimistic revision lock) + apply-PREVIEW (dry-run; real mutation honest-501).
- **Device lifecycle + CLI (#16–#31):** hashed-opaque device tokens (ADR 0002) · enroll/me/revoke · device-scoped current/apply/report/history · browser-first PAIRING (code+poll-secret, claim-once) + `aid-pair` bootstrap · the full `aid` CLI (status/pull/plan/apply/report/up, `_bin`-aware) · provisioning auto-report wiring · tenant/admin history · OpenCode provider-config + the FIRST dashboard section (/history).
- **Dashboard + cnf hardening + scope (#37–#55):** Machines · App Store (1068-entry catalog + per-item install commands) · Recommendations · the P05 scope loop END-TO-END (declare→approve→grant→enforce `requireScope` 403→surface in `aid status`) · atomic cnf index + fish/pwsh adapters + `aid exec`/`prewarm` + lazy-install telemetry · landing/onboarding + pairing-approval identity.
- **Invariants + read surfaces + honest docs (#56–#72):** getting-started ×2 · the §3 revision-mismatch 409 guard · U11 health + failed-last-run recs · the `/environment` read view (5th surface) · route-derived api-reference (drift-locked) · per-device timeline + `/machines` device-detail + sessionStorage token + recs→device deep-link · W08 isolation guard · platform-support · test-all aggregator · operations · provenance · adoption. **The honest-docs set is COMPLETE.**

**Last fires (verbatim):**
- **#75 — X11 compact THIS ledger.** `NEXT-STEPS.md` was 46,951 B (a fire #16→#74 mega-paragraph read in full every fire); collapsed the blow-by-blow to the themed summary above + gate `scripts/test-next-steps-compact.sh` (size < 20 KB budget-ratchet + asserts the TOP-next/CONVERGENCE-NOTE/Blockers/matrix-pointer/gated-blockers survive) RED→GREEN; fixed a stale cron id in the guardrails (`67cbf027`→`4002f61a`). The compact gate is a NEW suite → **test-all 337 assertions / 21 suites GREEN** (1 OS-skipped), live-verified on the prod URL.
- **#76 — B03 `detect_arch` — architecture in the OS source-of-truth.** Added `detect_arch` to `scripts/lib/detect_os.sh` (normalizes `uname -m` → amd64/arm64/armv7/armv6/386/riscv64/ppc64le/s390x, raw pass-through for unknown) so the 140+ ad-hoc `uname -m` checks across start.sh + post-installx can converge on ONE primitive — paired with `detect_os` as the "what machine is this" SoT. TDD RED (`command not found` 127) → GREEN; `test-detect-os.sh` 14→19. B03 ✅ (B04/B05 env-class + service-manager still ⬜). **test-all 342 assertions / 21 suites GREEN** (1 OS-skipped), live-verified on the prod URL.
- **#77 — B05 `detect_service_manager` — init system in the OS source-of-truth.** Added `detect_service_manager` to `scripts/lib/detect_os.sh` (launchd/systemd/openrc/runit/sysvinit via PID-1 markers like `/run/systemd/system` — NOT bare-binary presence, so a box with `systemctl` installed but booting OpenRC resolves correctly) so the H-series service adapters + server-stack post-installs stop re-deriving it from the 160+ scattered `systemctl`/`launchctl` calls. TDD RED (`command not found`) → GREEN; `test-detect-os.sh` 19→24. B05 ◐ (service-manager done; graphical-session + sandbox ⬜). **test-all 347 assertions / 21 suites GREEN** (1 OS-skipped), live-verified on the prod URL.

- **Verification gotcha (durable):** do NOT rotate the `AID_ADMIN_TOKEN` Worker secret per fire — `wrangler secret put` does not propagate atomically, so rapid suite requests fan across isolates and a random subset 401s. The token is set ONCE + persisted to `packages/control-plane/.aid-admin-token` (gitignored; the suite reads it after env + get-secret). After ANY deploy, warm-up on a NEW route (e.g. `pair/start`→201) before asserting, to dodge stale-isolate false-RED.

## Blockers (external / human-gated)
- CF API token + account id for `app.install.doctor` (verify via `get-secret CLOUDFLARE_API_TOKEN`; absent ⇒ control plane design-only). ✅ zone/DNS RESOLVED (fire #29): live custom domain serves landing `/` + `/pair` + the full API.
- **O Better Auth** sign-in (GitHub/Google/magic-link) — needs OAuth apps + an SES sender for `app.install.doctor`; the dashboard uses an `AID_ADMIN_TOKEN` bearer today, not user login.
- **K/#7 the real provider CALL** — BLOCKED on `PROJECTSITES_API_URL`/`TOKEN`, `ONEPROMPT_URL`, `AID_INFERENCE_TOKEN` (all absent via get-secret) + CF **AI Gateway** BYOK provisioning + real inference cost. The safety pre-flight (policy + fail-closed + restricted + budget) is fully live; only the external chain is blocked.
- **I/J** per-host private repos + encrypted backups — need GitHub repo-creation creds + restic/S3 + a throwaway box. Contract in `repos-and-backups.md`; code ⬜.
- **command-not-found LIVE end-to-end proof** + real multi-host / replacement-host restore drills — need a real/throwaway machine; a loop fire must NOT mutate the dev shell. Code + unit coverage are green; only the live run is gated.
- **N02** the full cinematic §16 SaaS redesign — Figma design + approval gate before the replacement UI (independent backend/installer/security/docs/test work continues meanwhile).
- `test@megabyte.space` creds (get-secret) before UI acceptance tests.

## Resumable artifacts
- `docs/aid/CURRENT-STATE.md` — verified state (read FIRST each fire).
- `docs/aid/MASTER-PROMPT.md` — full spec (SSOT; the cron references it).
- `docs/aid/REQUIREMENTS.md` — the A01–X15 matrix (360 reqs, code + evidence + status).
- `docs/aid/research/README.md` — 40-category × 30-idea ledger (0/1200) + S01–S30 seed map.
- `UPSTREAMS.lock.json` — 30 upstream candidates, all `pending-evaluation`.
- Root `CONVERGENCE.md` — PRIOR arc (C1–C21); DO NOT clobber.

## Guardrails (carry every fire)
- Mark partial features honestly; never claim researched/implemented/deployed/signed-in/enrolled/restored without evidence — interfaces/routes/scaffolding do not count.
- Keep provider keys + secret VALUES backend-side (Infisical Cloud authoritative, Bitwarden for interactive creds); preserve software.yml / chezmoi / mise / hiSHtory foundations.
- Do NOT reintroduce Nix or require a GUI daemon. Budgets: Neon/Upstash $10/mo ceilings; DeepSeek-first routing through the shared ProjectSites/OnePrompt + CF AI Gateway (no second routing stack).
- One revisioned desired-state write path; ENVIRONMENT.md authoritative. Do NOT install overlapping schedulers; only cron `4002f61a` drives this loop.
