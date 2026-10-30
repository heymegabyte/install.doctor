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

- **🟠 #187 (NEXT) — site/src/store.ts user-facing landing-page org links point at the LEGACY megabyte-labs org (a user FORKS THE WRONG REPO)**: the landing page shows "Fork"/github/discussions links reading `github.com/megabyte-labs/install.doctor` (`store.ts` lines 238 fork · 277 github · 278 githubDiscussions · 279 gitlab · 927 github · 1484 discussions) + `site/docs/scripts/markdown.sh` emits megabyte-labs github/script locations into generated docs. Migrate github/fork/discussions → heymegabyte; the `gitlab` ref (279) has NO heymegabyte equivalent (the project left gitlab) → drop the key or point at github. Firebase-deploy-gated (served site data) → add a `test-landing-page.sh` assertion + build-verify at deploy. This is the SERVED-site sibling of the #186 installer-clone-URL glob provenance gate.
- **🟠 local/provision.sh — possibly VESTIGIAL (operator decision)**: an unreferenced 940-line older variant of the 1213-line `scripts/provision.sh` (nothing invokes it; `local/` holds config samples + `sync.sh` + `yarn.lock` — maybe an old self-contained local-install dir). #186 fixed its clone URL + the provenance gate now globs it, but it may be dead code (drift-detection) ~270 lines behind `scripts/provision.sh`. Confirm remove-vs-keep; if kept, reconcile it with the current `provision.sh`.
- **✅ DONE (#182 + #183) — dead Vagrant fully removed**: #182 removed the 2 dead `/vagrant` + `/vagrant-windows` firebase redirects + extended `test-bootstrap-provenance.sh` 8→10 (no-dangling-redirect guard); #183 removed the landing-page surfaces (`landing-page.tsx` `panels[2]` + `store.ts` `started__list[2]` + renumbered 04→03..07→06) + a spillover PowerShell `HEADLESS_INSTALL` true-string fix, guarded by new `test-landing-page.sh` 4/4. Goes live on the next Firebase deploy (secret-gated); the authoritative Stencil build-verify runs on the deploy CI (node downloads fine there).
- **🟠 NEW FINDING (#183) — the site pins EOL node 16.20.2** (`site/package.json` `volta.node`): node 16 is EOL (April 2024 — a maintenance/security concern), and volta's downloader is broken on the dev Mac (fails for node 16 AND 20, so it is the downloader, not the pin), so `site/node_modules` can't be installed locally → no local Stencil build-verify. It still builds in CI (clean network downloads node 16). **Real unblocking slice**: modernize the pin to a current LTS (Stencil `^3.2.0` supports node 18/20) + verify `npm ci` + `npm run build` + the Firebase-deploy CI on the new node. Its OWN careful fire (a one-way-ish CI-affecting change), not a rushed pin-bump. Would also unblock any future local site-build work.
- **~85 stale doc-COMMENT org links (low priority)** — the **consequential** user-facing refs are DONE: README banner logo + `package.json` `repository`/`bugs` migrated to canonical heymegabyte (#185, X01 gate 10→15). REMAINING (non-executed, resolve via the GitHub transfer-redirect, low value): post-installx `@doc`-comment header links + the nested `package.json` `project.github`/`project.gitlab` keys + the `overview`-prose `software.yml` gitlab link. The gitlab ones have no clean heymegabyte equivalent (the project left gitlab) → decide per-ref (github-or-drop) when sweeping. Big mechanical sweep; migrate opportunistically when touching those files.

- **B02 ✅ SHIPPED (#180)** — `scripts/provision.ps1` now exists (the exact file the live `/windows` redirect
  returned 404 for). The prior "unverifiable scaffolding" deferral was WRONG: the `test-pwsh-cnf.sh` precedent
  (structural contract asserts + a `pwsh` parse-check that SKIPs honestly when absent) makes it verifiable
  WITHOUT a Windows runtime. Native-Windows RUNTIME execution stays honestly-unverified; live `/windows` serving
  awaits the next Firebase deploy (FIREBASE secret-gated).
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

The frontier is THINNER, not exhausted — #180 disproved the "exhausted" verdict by shipping B02 (a real
non-gated slice earlier fires missed). So each fire first **RE-SCANS GENERATIVELY** (the loop is generative;
there is almost always real work — dangling redirects/404s, user-visible "coming" promises, other
structurally-testable surfaces) BEFORE concluding there is nothing to do. ONLY when a genuine re-scan finds
no non-gated slice does a fire default to **verification-only** (re-run `test-all` vs live prod; the
consistency gates — catalog-count #159, cross-ledger assertion-count #174, headline-freshness #175 — catch
drift). Never fabricate churn. When a human unblocks a Tier-1/2 row, the loop resumes real slices there.
