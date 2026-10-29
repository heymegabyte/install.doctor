# aid — BACKLOG (ranked remaining work)

> **X12 — improvements ranked by value / reliability / effort / recurring-cost.** The UNBLOCKED product
> is converged + live-verified at **app.install.doctor** (see `CURRENT-STATE.md`); the autonomous,
> non-human-gated, one-fire frontier is EXHAUSTED (per the #173 cell-by-cell A01–X15 scan + the #174/#175
> ledger-integrity guards). Everything below needs a **HUMAN UNBLOCK** or an **unbuilt prereq** — the loop
> cannot advance it alone. Created #177 (the master prompt names a BACKLOG as loop-state; it was absent).
>
> Scoring: **value** (product impact) · **reliability** (how proven the code behind it already is) ·
> **effort** (work to unblock) · **recurring-cost** (ongoing $/maintenance). Ranked by value ÷ effort.
> Honest: NONE of these is "done" — each is gated. Pick the top row first.

## Tier 1 — unblock FIRST (highest value ÷ effort; the code is already built + tested)

1. **O04 — register the OAuth callback URLs** · value **HIGH** · reliability **HIGH** (session-admin arc
   #131/#132 built + unit-tested) · effort **~5 min, NO code** · recurring-cost **~0**.
   - **One action:** register `https://app.install.doctor/api/auth/callback/github` + `.../callback/google`
     on the GitHub + Google OAuth apps (confirm they are app.install.doctor's apps). Then a real callback
     lands a session and the dashboard's session-aware admin path (#132) verifies end-to-end — zero further
     code. Loop can then add the real-sign-in E2E.
   - Partial/also-gated: O03/O09 email magic-link needs `AWS_SES_ACCESS_KEY_ID` (absent) for delivery.

2. **K/#7 — the real aid provider CALL** · value **HIGH** (NL→plan is aid's core intelligence) ·
   reliability **MED** (routing POLICY + fail-closed safety pre-flight + cost reservation built #7-gated;
   the live provider call is untested) · effort **LOW** (provide env vars) · recurring-cost **LOW**
   (DeepSeek-first, Neon/Upstash $10/mo-bounded).
   - **One action:** provide `PROJECTSITES_API_URL`/`PROJECTSITES_API_TOKEN` (or `ONEPROMPT_URL`) +
     `AID_INFERENCE_TOKEN` for the shared ProjectSites/OnePrompt orchestrator + CF AI Gateway. The invariant
     forbids a second routing stack, so this is gated on the orchestrator URL, NOT the model key
     (`DEEPSEEK_API_KEY` is already present).

## Tier 2 — needs infra + build (value high, effort high — not just a credential)

3. **I/J — per-host private repos + encrypted backups** · value **HIGH** (the recovery story) ·
   reliability **LOW** (contract in `repos-and-backups.md`; code ⬜) · effort **HIGH** · recurring-cost
   **MED** (S3 storage).
   - **One action to START:** a throwaway Linux box + `restic` + S3-compatible creds (the `GITHUB_TOKEN`
     for repo creation is already present). Then build + run the real replacement-host restore drill.

4. **N02 — the full cinematic SaaS redesign** · value **MED-HIGH** (unblocks M-series onboarding +
   N-series dashboard polish) · reliability **LOW** (design + build ahead) · effort **HIGH** (Figma design
   → approval → full UI build) · recurring-cost **LOW**.
   - **One action to START:** approve a reviewable Figma design (the standing gate before the replacement
     UI). Independent backend/installer/security/docs/test work continues meanwhile.

## Tier 3 — deferred (gated on a runtime or an unbuilt prereq; low value ÷ effort right now)

- **B02 Windows PowerShell entrypoint** — needs a Windows runtime; a structural-only `start.ps1` would be
  unverifiable scaffolding (the master prompt forbids claiming Windows verification from non-Windows).
- **fish/pwsh LIVE cnf semantics** — adapters are structurally gated (8+8); live verification needs a real
  fish/pwsh runtime (neither installed; a loop fire must not mutate the dev box).
- **Q01/Q10-Q15 isolation** — real filesystem/process jail for credentialed execution; needs the
  deterministic EXECUTOR consumer (Phase-2, unbuilt) + Infisical creds. `detect_sandbox_mechanisms` (#167)
  is ready to feed it.
- **C05/C07/C10/C11 + R13-verify** — need the fuller desired-state/recipe model (one-write-path exists;
  profiles/overlays/merge-rules/recipe-verify-stage ⬜).
- **U07 Alloy / S11 observability bindings** — needs an Alloy→Loki deployment (infra).
- **D08 version-pinning** — speculative; no consumer reads a pin field today. Build only on real demand.

## How the loop behaves until an unblock arrives

Per `loop-driven-development` ("loops MUST terminate — no infinite polish") + monitor-orchestration
healthy-iteration #4: with the frontier exhausted, fires default to **verification-only** (re-run
`test-all` vs live prod; the automated consistency gates — catalog-count #159, cross-ledger
assertion-count #174, headline-freshness #175 — catch drift). Do NOT fabricate product churn or add
further micro-guards. When a human unblocks a Tier-1/2 row, the loop resumes real slices there.
