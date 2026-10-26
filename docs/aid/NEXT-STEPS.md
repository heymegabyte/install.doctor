# aid — NEXT STEPS (resume pointer)

Updated every loop fire. Smallest next executable step at the top. Cadence: `/loop 15m` (cron `67cbf027`, 7-day auto-expiry). **Advance ONE verified slice per fire**, commit + push, update this file. Full spec: `MASTER-PROMPT.md`. Reality: `CURRENT-STATE.md`.

> **Parallel session active:** `d6e00879` added `packages/aid-core` (tested contracts, 52/52 green). BUILD ON it — reuse its `validateBlueprint`/`aidProviderConfig`/`chooseRoute`/session/Loki contracts; do NOT duplicate them. Always rebase onto `origin/master` before pushing (push was rejected + rebased this fire).

## Do next (Phase A order — smallest first)

1. ✅ **DONE (fire #3) — command-not-found reconciled to ONE canonical deployed owner.** `home/dot_config/shell/not-found-hook.sh` (hardened handler + `handle_command_not_found` rc entry point + on-demand index self-heal) + `home/dot_local/bin/executable_cnf-build-index` (→ `~/.local/bin/cnf-build-index`); `provisioning/command-not-found/` deleted; the old brew-only + `sgpt`-`eval` hook replaced. 10/10 tested; `bash -n`+`zsh -n`+ShellCheck clean. The rc already sources the deployed hook.
2. ✅ **DONE (fire #2) — P1 `__cnf_ai_fallback` hardened + latent `set -u` crash fixed.** Safe-by-default (allowlist `__cnf_ai_safe` + `CNF_DRY` honored + `CNF_AI_AUTOINSTALL=1` opt-in + `CNF_AI_CMD` seam); 9/9 green; ShellCheck clean. See CURRENT-STATE § Defects.
3. ✅ **DONE (fire #4) — index build wired at provision.** `home/.chezmoiscripts/universal/run_after_22-cnf-index.sh.tmpl` rebuilds the index via `cnf-build-index` after every `chezmoi apply` (a superset of on-`software.yml`-change — apply is how it reaches a box; idempotent, headless-safe, best-effort; runtime hook self-heals as backstop; `CNF_BUILD_INDEX_BIN` override seam). 12/12 tested; `chezmoi execute-template` renders clean; ShellCheck clean. Live-machine proof is now a Blocker (below).
4. ✅ **DONE (fire #5) — hiSHtory adopted over Atuin (ADR `docs/aid/decisions/0001`).** `software.yml` reconciled (hiSHtory un-deprecated + installable; Atuin `_deprecated`/superseded, preserved as institutional knowledge) + **3 fabricated descriptions corrected** (hishtory "browsing history"; atuin "macOS windows"/"AWS infrastructure" — master-prompt §10). `scripts/test-shell-history-policy.sh` 6/6; aid-core already rejects `atuin` in the blueprint. No shell-history DATA deleted.
5. ✅ **DONE (fire #6) — Phase-A control-plane skeleton LIVE.** `packages/control-plane/` Hono Worker deployed + prod-verified at `https://aid-control-plane.manhattan.workers.dev` (`/health` 200 `routes:8`; `/api/ai/v1/<alias>` 501; bogus 404; imports aid-core `ROUTES` — reused, not re-implemented). `scripts/test-control-plane.sh` 5/5. Deployed via the global key (the API token lacks Workers perms — CURRENT-STATE § Defects).
7. **(TOP actionable) Make `/api/ai/v1` do real work** `[M]` — Zod env + bindings; a tested ProjectSites/OnePrompt routing adapter → one CF AI Gateway (DeepSeek-first; route aliases via aid-core `chooseRoute`/`aidProviderConfig`); provider keys backend-side; atomic cost reservation before fan-out; blocked restricted-data case. Add a strict-TS typecheck (tsconfig via `/update-config`) + register the Worker in Uptime Kuma once it serves real traffic + gets the `app.install.doctor` custom domain.
6. **Audit + correct fabricated `software.yml` descriptions** `[M]` — the atuin/hishtory `_desc`/`_short` were egregious AI-slop ("macOS windows", "AWS infrastructure", "browsing history") contradicting their own `_github`; likely MANY more across ~1179 entries. Correct against canonical sources (master-prompt §10); a lint check could flag a `_desc` whose purpose contradicts the repo name.

## Blockers (external / human-gated)
- CF API token + account id for `app.install.doctor` (verify via `get-secret CLOUDFLARE_API_TOKEN`; absent ⇒ control plane design-only).
- `app.install.doctor` zone / DNS.
- Design approval (Figma) before full SaaS UI (master-prompt §16).
- `test@megabyte.space` creds (get-secret) before UI acceptance tests.
- **command-not-found LIVE end-to-end proof** (chezmoi apply + a real missing command, resolve→install→re-run, BOTH shells) — needs a real/throwaway machine; a loop fire must NOT mutate the dev shell's startup. Code + unit coverage are green; only the live run is gated.

## Resumable artifacts
- `docs/aid/CURRENT-STATE.md` — verified state.
- `docs/aid/MASTER-PROMPT.md` — full spec (SSOT; the cron references it).
- `docs/aid/research/README.md` — 40-category × 30-idea ledger (0/1200 done) + S01–S30 seed map.
- `UPSTREAMS.lock.json` — 30 upstream candidates, all `pending-evaluation`.
- Root `CONVERGENCE.md` — PRIOR arc (C1–C21); DO NOT clobber.

## Guardrails (carry every fire)
- Mark partial features honestly; never claim researched/implemented/deployed without evidence.
- Keep provider keys backend-side; preserve software.yml / chezmoi / mise / hiSHtory foundations.
- Do NOT reintroduce Nix or require a GUI daemon. Budgets: Neon/Upstash $10/mo ceilings; DeepSeek-first routing.
- Do NOT install overlapping schedulers; only cron `67cbf027` drives this loop.
