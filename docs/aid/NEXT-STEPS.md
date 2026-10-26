# aid — NEXT STEPS (resume pointer)

Updated every loop fire. Smallest next executable step at the top. Cadence: `/loop 15m` (cron `67cbf027`, 7-day auto-expiry). **Advance ONE verified slice per fire**, commit + push, update this file. Full spec: `MASTER-PROMPT.md`. Reality: `CURRENT-STATE.md`.

> **Parallel session active:** `d6e00879` added `packages/aid-core` (tested contracts, 52/52 green). BUILD ON it — reuse its `validateBlueprint`/`aidProviderConfig`/`chooseRoute`/session/Loki contracts; do NOT duplicate them. Always rebase onto `origin/master` before pushing (push was rejected + rebased this fire).

## Do next (Phase A order — smallest first)

1. ✅ **DONE (fire #3) — command-not-found reconciled to ONE canonical deployed owner.** `home/dot_config/shell/not-found-hook.sh` (hardened handler + `handle_command_not_found` rc entry point + on-demand index self-heal) + `home/dot_local/bin/executable_cnf-build-index` (→ `~/.local/bin/cnf-build-index`); `provisioning/command-not-found/` deleted; the old brew-only + `sgpt`-`eval` hook replaced. 10/10 tested; `bash -n`+`zsh -n`+ShellCheck clean. The rc already sources the deployed hook.
2. ✅ **DONE (fire #2) — P1 `__cnf_ai_fallback` hardened + latent `set -u` crash fixed.** Safe-by-default (allowlist `__cnf_ai_safe` + `CNF_DRY` honored + `CNF_AI_AUTOINSTALL=1` opt-in + `CNF_AI_CMD` seam); 9/9 green; ShellCheck clean. See CURRENT-STATE § Defects.
3. **(TOP actionable) Wire + PROVE the index at provision** `[S]` — run `cnf-build-index` at provision time + on `software.yml` change (Taskfile target / post-install hook; the hook already self-heals on first miss). Then PROVE end-to-end on a real machine: `chezmoi apply`, trigger a genuine missing command, confirm resolve→install→re-run in BOTH shells. (container test ≠ proof for macOS.)
4. **Resolve the hiSHtory conflict** `[S]` — master prompt mandates hiSHtory over Atuin; `software.yml` marks `hishtory` deprecated. Decide, record via a stack-decision doc, migrate if adopting (preserve history — no deletion).
5. **Phase-A control-plane skeleton — build ON `packages/aid-core`, DESIGN-ONLY until CF auth** `[M]` — reuse aid-core's `validateBlueprint`/`aidProviderConfig`/`chooseRoute` contracts (import, don't re-implement). First run `get-secret CLOUDFLARE_API_TOKEN` (+ account id). Present → scaffold a Hono Worker serving `/api/ai/v1` + `/health` that imports aid-core; deploy skeleton to `*.workers.dev`. Absent → ADR + wire contracts only; deploy BLOCKED. Never fabricate a deploy.

## Blockers (external / human-gated)
- CF API token + account id for `app.install.doctor` (verify via `get-secret CLOUDFLARE_API_TOKEN`; absent ⇒ control plane design-only).
- `app.install.doctor` zone / DNS.
- Design approval (Figma) before full SaaS UI (master-prompt §16).
- `test@megabyte.space` creds (get-secret) before UI acceptance tests.

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
