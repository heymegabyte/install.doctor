# aid — v2 Requirement Matrix (A01–X15)

The Install Doctor v2 backlog = 24 categories (A–X) × 15 = **360 requirements**, driven by `/loop` cron
`4002f61a` (every 15m). Full prose spec: `MASTER-PROMPT.md`. Reality: `CURRENT-STATE.md`. Resume
pointer: `NEXT-STEPS.md`. **Advance ONE verified slice per fire.**

Status legend: ✅ implemented+verified · ◐ partial · ⬜ remaining · ⚫ blocked (external) · 🔬 needs real
multi-host/disposable-env test. Evidence = fire number + artifact. Honest: a route/interface is NOT ✅
until exercised live.

## Already satisfied (mapped from fires #1–32)

- **A Architecture/migration** — ◐ A02 extend-v2-packages (`packages/{aid-core,control-plane}` extended, not forked), A03 shared TS schemas (aid-core `Blueprint`/`ROUTES` contracts), A04 separate plan/authorize/execute/evidence (control-plane: resolve→apply-preview→report/History), A10 partial-success modelled (apply plan), A11 standalone-local (aid plan offline, S23), A13 dedup (one canonical cnf owner, fire #3), A14 ledgers-from-evidence (CURRENT-STATE). Rest ⬜.
- **B Bootstrap/platform** — ◐ B08 open pairing page + B09 short-lived code (`aid-pair` + `/pair`, fires #19–20), B10 resume (token-present skip). B02 Windows PowerShell ⬜, B03/B04/B05 env detection ⬜ (partial via `detect_os.sh`).
- **C Desired state** — ◐ C01 schema manifest (aid-core v1 `Blueprint`), C02 ENVIRONMENT.md generate (export/import, fire #11), C09 semantic diff (`/api/environment/diff`, #12), C13 schema-version (schemaVersion:1), C14 export portable. C05/C07/C10/C11 ⬜.
- **D Catalog/supply-chain** — ◐ D01 software.yml authoritative (+ served read-only via `GET /api/catalog` #38, 1068 entries), D02 exec names+aliases, **D03 ✅ typed provider arrays (space-joined, `_bin` multi-row — audited correct #39)**, D04 shared provider-selection, **D06 ✅ cask mode (TSV field 7 — audited correct #39)**, **D13 ✅ ATOMIC index — `cnf-build-index` temp+rename + fail-soft 0-row guard; a failed/concurrent rebuild never torns/clobbers the live index (#39, RED before=3/after=0 → GREEN 20/20)**, R13 ◐ App-Store-details-from-catalog (#38). D08 pin / D09 verify-sig / D10 unsafe-path-reject ⬜.
- **E Lazy CLI/shell** — ◐ E01 harden hook (#2/#27), E03 bash+zsh adapters (one resolver), **E10 eliminate eval of model text (#32 — argv-exec subshell)**, E07 argv boundaries (#32 test), **E11 install locks + recursion guard (#33 — atomic lockdir + bounded wait + stale reap + `__CNF_RESOLVING` guard; concurrent-shell golden path: 2 shells→1 install, RED HEAD=2→GREEN=1)**, E13 unattended-off-by-default (`CNF_AI_AUTOINSTALL` opt-in), E14 ordinary not-found (127). E02 mise-lazy-eval / E04 fish+pwsh / E09 progress-to-stderr ⬜.
- **I Per-host git** — ⬜ (host repos not built). Device IDENTITY exists (`devices` table, fire #16) → partial I01-adjacent.
- **K aid/routing** — ◐ K03 OnePrompt/ProjectSites provider (provider-config, #30), K04/K05 route policy (`chooseRoute` restricted-wins/premium-opt-in), K06 keys backend-side (`{env:AID_INFERENCE_TOKEN}`, no secret), K08 deterministic validation pre-exec (apply revision-check). K01 aid OpenCode fork / K07 NL→typed-proposal / the real provider CALL ⚫ (#7 — AI Gateway + token).
- **M Homepage/onboarding** — ◐ M01 explanatory landing (`/`, #29). Rest ⬜ (needs the approved SaaS UI).
- **N Dashboard** — ◐ N03 nav (History `/history` #31 + Machines `/machines`+`GET /api/devices` #37 + **App Store `/apps`+`GET /api/catalog` #38, 1068 entries, live search** — control-plane 73/73 live), N07 dense view ◐ (device table + searchable catalog). N02 Figma ⬜ (gate), N08 health/drift ⬜, N05/N06 theme ⬜, Recommendations ⚫(#7) / Automations ⬜.
- **O Better Auth** — ⬜ ALL (today `/pair` + admin endpoints use an `AID_ADMIN_TOKEN` bearer, NOT Better Auth). The headline Phase-3 gap; needs GitHub/Google/magic-link + SES email.
- **P Host enrollment** — ◐ P01-P03 device pairing (pair/start/approve/poll, #19; approval shows the code), P04 pairing≠session (poll-secret vs admin), P05 revocable scoped creds (device token + revoke, S27), P08 job-binding partial (tenant/revision in apply). P06-P15 (durable journal, leases, offline lease expiry) ⬜.
- **Q Secrets/privilege** — ◐ Q06 short-lived creds (hashed-opaque device tokens, ADR 0002). Q01 Infisical authority / isolation (Q10-Q15) ⬜.
- **U Observability/History** — ◐ U01 History per aid invocation (report + plan/apply auto-register, #18/#23/#24), U02 structured events, U15 observed-state-not-optimistic (`/history`, GET current). U04 offline-protected / U07 Alloy ⬜ (Alloy plan exists in aid-core).
- **V/W/X** — ◐ V01 no-network shell startup (index prebuilt), V02 build-index-at-provision (#4), W-series tests (62 control-plane + 22 aid-client + 14 cnf assertions live), X-series docs (docs/aid/* ledgers). Most ⬜.

## How to use (per fire)

1. Pick the smallest highest-value ⬜/◐ item advancing the real E2E (Phase 1→5 order in `MASTER-PROMPT.md` §5).
2. Implement with a failing test first → verify live → flip the ID to ✅/◐ with the fire# + artifact.
3. ⚫-blocked items keep their blocker noted (e.g., O/K provider-call need external creds — #7).

## Known external blockers (gate whole categories)

- **#7 — the real aid provider CALL** (K01/K07 execution, O-series AI): needs a CF AI Gateway + `AID_INFERENCE_TOKEN` + the ProjectSites orchestrator contract provisioned. Config is wired (#30); the call is not.
- **Better Auth (O)** — needs GitHub/Google OAuth apps + SES (or provider) email sender provisioned for `https://app.install.doctor`.
- **Figma approval (N02)** — the full SaaS UI replacement gate; minimal honest pages (`/`, `/pair`, `/history`) ship meanwhile.
- **Real multi-host / disposable-env tests (W, J restore drills)** — need throwaway machines; not runnable from this dev box.
