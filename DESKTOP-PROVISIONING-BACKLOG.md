# Desktop-Provisioning Mega-Build — Ledger

Brian directive 2026-10-26. Absorb **install.doctor** → a `desktop-provisioning` agent skill + observability-everywhere + `app.install.doctor` + a GA/GTM skill + secret-harvesting. Driven by the `/loop` cron **`7681625a`** (every 20 min). **Drain ONE verified slice per fire.** Status: ⬜ todo · 🔨 in-progress · ✅ done · ⏸ blocked.

## Hosts in scope
`coolify` (Coolify VM) · `proxmox` (10.0.0.114) · `observability` (LXC 110, 10.0.0.159) · `ubuntu` (VM 101, 10.0.0.156, `ssh ubuntu.megabyte.space`) · `pbs` (VM 105, 172.20.60.70, **VLAN60**). SKIP per Brian: MacBook, macOS VM 108.

## A. Observability everywhere
- ✅ Alloy on coolify, observability, proxmox, ubuntu (node + logs; cadvisor on the 2 docker hosts) → obs stack (Prometheus+Loki @ 10.0.0.159). See [[observability-stack]].
- ⏸ **Alloy on PBS** — PBS is VLAN60-isolated, can't reach 10.0.0.159 (probe = 000). NEEDS an inter-VLAN path: a route/firewall allow on the Proxmox host (vmbr0 ↔ vmbr1/VLAN60) OR a `socat`/nginx relay on the PVE host's VLAN60 IP → 10.0.0.159:9090/3100. Then install Alloy (Debian 13, apt) with `external_labels host=pbs`.
- ⬜ **Netdata on all hosts** + notifications/warnings, config from a central repo, folded into the desktop-provisioning skill (Netdata parent/child or Netdata Cloud; alerts → Slack/Healthchecks).

## B. `desktop-provisioning` skill (absorb + SIMPLIFY install.doctor)
- ✅ Skill authored + **deep-absorbed, grounded against the live repo 2026-10-26** → `~/.claude/skills/desktop-provisioning/SKILL.md`. Documents the REAL flow (not a guess): `start.sh` → chezmoi `run_*` sequence (`home/.chezmoiscripts/universal/`: prepare→homebrew→decrypt-age-key→requirements→system → *[dotfiles]* → pre-install→**10-install**→chezmoi-system→20-post-install→**22-cnf-index**→cleanup); the bulk installer is **`installx --all --lazy`** (zx-based, `~/.local/bin`, reads `software.yml`); all `gum log`-native; `run_after_20` already pre-warms bash (Bash-it/powerline/ble.sh).
- ✅ Core installs per box — delivered by `installx`/`software.yml` (the installer EXISTS); the skill now lists the capability set (Docker · Homebrew · Alloy · Netdata · fail2ban · cloudflared) + de-hardcodes the fleet-owned obs endpoint.
- ✅ **Pre-warm / fonts / codex were FALSE-ABSENCES** (verify-against-source-of-truth, 2026-10-26): fonts → `home/.chezmoiexternal.toml.tmpl` (Hack Nerd Font + Montserrat/ZillaSlab per-OS); pre-warm → the rich `home/dot_local/bin/post-installx/` AOT layer (`post-zsh-bootstrap.sh` = zinit pre-warm + `.zwc` compile + Terminal.app Nerd Font; `post-vim.sh` = coc AOT; + post-* for atuin/cloudflared/docker/gcloud/netdata/tailscale/vscode/warp…); codex → installed via `software.yml` (`cask`/`npm`), auth = documented manual OAuth. Skill corrected to document the real mechanisms (pre-warm belongs in `post-installx/post-<app>.sh`, NOT a new `run_after_*`).
- ✅ **nvim pre-warm: NOT a gap** (verified 2026-10-26) — `home/dot_config/nvim` does not exist (no nvim config ships), so there are no nvim plugins to pre-warm. `post-vim.sh` (vim/coc) is the complete editor-prewarm coverage. Item B is fully drained.
- ✅ **command-not-found AI lazy-installer DONE 2026-10-26** → the SINGLE deployed owner `home/dot_config/shell/not-found-hook.sh` + `home/dot_local/bin/executable_cnf-build-index` (fire #3; folded from provisioning/command-not-found/, pushed). `build-index.sh`: yq→json|jq (robust vs array installer fields + multi-`_bin`) → `~/.cache/cnf/index.tsv` (1181 binaries). `handler.sh`: zsh `command_not_found_handler` + bash `command_not_found_handle`, software.yml lookup → OS-preferred installer (gum/glow) → AI fallback (`mods`) → re-runs the typed command; `CNF_DRY=1` dry-run. VERIFIED in both shells (rg→ripgrep, fd→fd, delta→git-delta…). Bug fixed: zsh doesn't word-split unquoted vars → manual split. ACTIVATE per box: chezmoi apply (deploys the hook + `cnf-build-index`); the rc already sources the hook; run `cnf-build-index` at provision + on software.yml change (hook self-heals the index on first miss). Hardened fire #2 (safe AI fallback: allowlist + CNF_DRY + CNF_AI_AUTOINSTALL opt-in).
- ✅ **cnf hook v2 Phase-1 hardening (prompt category E)** — fires #32-#35, each TDD'd in `scripts/test-command-not-found.sh` (19/19 green, shellcheck clean): **E10** eliminated eval of model text (argv-exec in an isolated subshell); **E11** per-tool atomic-mkdir install lock + recursion guard (concurrent shells → ONE install); **E09/E08** all installer+status output → stderr + `</dev/null`, so `out=$(missingtool)` captures only the tool's real stdout; **E13/E14** non-interactive shells (CI/scripts/background/untrusted-project commands) return ordinary not-found (127) with NO install unless an approved job opts in via `CNF_ALLOW_NONINTERACTIVE=1` (aid exec / prewarming) — closes the "noninteractive opt-out cannot trigger unauthorized installation" golden path. **NEXT (fire #36):** index atomicity (D13 — verify `cnf-build-index` writes via temp+rename, never a half-written `index.tsv` a concurrent shell can read) + index-builder dependency robustness (B07 — builder needs yq+jq OR python3+pyyaml; a lazy resolver must not silently depend on a missing lazy resolver). Then cask-column + package-array serialization audit (D03/D06).
- ⬜ pre-warm after chezmoi apply: nvim/vim plugins, zsh plugins, tmux plugins.
- ⬜ parallel fan-out provisioning + gum/glow gorgeous logs.
- ✅ gum/glow terminal-printing mandate already exists → [[terminal-styling]] (extend it with the command-not-found note).

## C. Per-host FQDN git-backup repos
- ✅ `coolify.megabyte.space` + `ubuntu.megabyte.space` repos exist; HC checks `coolify/ubuntu/proxmox-git-config` already exist.
- ⬜ Create the **proxmox.megabyte.space** repo (missing locally).
- ⬜ **MERGE** `coolify-configs` → coolify.megabyte.space; `proxmox-git-configs` → proxmox.megabyte.space (fold content + history).
- ⬜ Each repo: box config backup + a `SYSTEM-POSTURE.md` (software inventory + security posture), auto-committed (cron, HC-monitored via [[healthchecks-job-monitoring]]).

## D. app.install.doctor (app store + AI provisioning brain) — ⚠️ FLEET-OWNED / IN PROGRESS, do NOT build from the loop
The fleet is actively building this (commits `d625f573` "deploy Phase-A control-plane skeleton, Hono Worker live on workers.dev" + `ef645229` "/api/ai/v1/resolve"). Live code in-repo: `packages/control-plane` (Hono Worker + routing endpoint), `packages/aid-core` (routing logic), `site/` (Firebase-hosted app). **The /loop must not design or duplicate this** — cross-link it from the desktop-provisioning skill and consume it.
- 🔨 (fleet) Control-plane Worker + `/api/ai/v1/resolve` live on workers.dev.
- ⬜ (fleet) Daemon per box → posture → app.install.doctor; AI recs/questions; `ENVIRONMENT.md` push to linked machines; cross-host "install on one → suggest on all"; multiple ENVIRONMENT.md (1 default).

## E. GA + GTM skill
- 🔨 **Skill authored 2026-10-26** → `~/.claude/skills/ga-gtm-integration/SKILL.md` (doctrine: cred harvest → idempotent auto-provision via Analytics Admin API v1beta + Tag Manager API v2 → associate-by-URL registry → GTM + Consent Mode v2 injection → the 30-idea recursive backlog → auto-run triggers → Zod/get-secret guardrails). EXECUTION pending below.
- ⬜ Computer Use (user's Chrome) → GCP service-account JSON + GA4 property id (+ via Chrome Bitwarden). *(needs CU session on the Mac — loop-positioned, not fleet.)*
- ⬜ Execute auto-provision: create GA4/GTM where missing; associate with sites by URL; write `install.doctor/ga-gtm/registry.json`; auto-run on new sites.
- ✅ **Client-code module authored + typechecks (2026-10-26)** → `install.doctor/ga-gtm/` (`src/consent.ts` Consent Mode v2, `src/analytics.ts` idempotent GTM loader + SSR noscript + `initAnalytics`, `src/events.ts` typed GA4 recommended events, `src/index.ts`, `registry.json` seeded, `README.md` with the full 30-idea coverage map). Dependency-light strict TS (no Zod in the browser bundle); flag-based `pnpm typecheck` passes (tsc 5.9.3, `--strict`, EXIT 0). Ships ideas #5–12/#17/#22 as code.
- ✅ **Server module `src/server.ts` (2026-10-26)** — GA4 Measurement Protocol: `sendMeasurementProtocol` (debug/prod, fetch-injectable, fail-soft), `serverPurchaseEvent` (Stripe-webhook `purchase` deduped by `transaction_id`), `assertPayload` guard, `clientIdFromGaCookie` (`_ga`→client_id). Ideas **#13/#15** as code; `./server` export kept OUT of the client bundle; full-module typecheck EXIT 0.
- ✅ **Test suite (2026-10-26)** — `ga-gtm/test/server.test.ts`: 10 `node:test` cases (assertPayload guards ×5, serverPurchaseEvent shape, clientIdFromGaCookie parse ×2, sendMeasurementProtocol prod + debug via injected fetch). **Dep-free runner**: tsc→CJS + `node --test` + a minimal ambient `test/node-builtins.d.ts` (so it needs only `typescript`, no @types/node); **23/23 pass, exit 0 on node v18.4** (`server.test.ts` 10 + `client.test.ts` 10 + `loader.test.ts` 3 — the GTM loader via a document shim: `gtmNoscriptHtml` iframe, `loadGtm` id-validation + inject-once + idempotency (module-global `loaded`), `initAnalytics` consent-default + GA4-config). `pnpm test` wired (globs all suites); `dist/` gitignored. **The GA/GTM module is now fully unit-tested — 100% of source files covered (consent/events/server/analytics).**
- ⬜ Remaining of the 30 (tracked in README coverage map): Enhanced-Measurement toggles, GTM-side config (linker/PII/versioning #2/#21/#23), server-side #14 sGTM + #16 first-party, GA4-console (dimensions/audiences/key-events/BigQuery/Looker/links) — all need the creds + live sites, i.e. gated behind the CU cred-harvest above.

## F. Secrets / Bitwarden
- ✅ `BW_CLIENTID`/`BW_CLIENTSECRET` saved to chezmoi; `bw` CLI present.
- ⬜ `bw login --apikey` + unlock → pull estate secrets into chezmoi (prefer over Computer Use for BW-stored secrets).
- ⬜ Computer Use (Chrome) harvest of secrets/SA/OAuth NOT in Bitwarden (visual inspection).

## Guardrails
- **Check live state before mutating shared infra** — Grafana/UK are fleet-managed (prior duplicate-alert collision). See [[observability-stack]].
- Store code under this repo (install.doctor). Push reusable patterns to agentskills.
- Secrets via chezmoi/get-secret, never plaintext.
