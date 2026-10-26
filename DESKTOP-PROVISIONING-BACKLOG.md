# Desktop-Provisioning Mega-Build — Ledger

Brian directive 2026-10-26. Absorb **install.doctor** → a `desktop-provisioning` agent skill + observability-everywhere + `app.install.doctor` + a GA/GTM skill + secret-harvesting. Driven by the `/loop` cron **`7681625a`** (every 20 min). **Drain ONE verified slice per fire.** Status: ⬜ todo · 🔨 in-progress · ✅ done · ⏸ blocked.

## Hosts in scope
`coolify` (Coolify VM) · `proxmox` (10.0.0.114) · `observability` (LXC 110, 10.0.0.159) · `ubuntu` (VM 101, 10.0.0.156, `ssh ubuntu.megabyte.space`) · `pbs` (VM 105, 172.20.60.70, **VLAN60**). SKIP per Brian: MacBook, macOS VM 108.

## A. Observability everywhere
- ✅ Alloy on coolify, observability, proxmox, ubuntu (node + logs; cadvisor on the 2 docker hosts) → obs stack (Prometheus+Loki @ 10.0.0.159). See [[observability-stack]].
- ⏸ **Alloy on PBS** — PBS is VLAN60-isolated, can't reach 10.0.0.159 (probe = 000). NEEDS an inter-VLAN path: a route/firewall allow on the Proxmox host (vmbr0 ↔ vmbr1/VLAN60) OR a `socat`/nginx relay on the PVE host's VLAN60 IP → 10.0.0.159:9090/3100. Then install Alloy (Debian 13, apt) with `external_labels host=pbs`.
- ⬜ **Netdata on all hosts** + notifications/warnings, config from a central repo, folded into the desktop-provisioning skill (Netdata parent/child or Netdata Cloud; alerts → Slack/Healthchecks).

## B. `desktop-provisioning` skill (absorb + SIMPLIFY install.doctor)
- 🔨 Skill skeleton authored → `~/.claude/skills/desktop-provisioning/SKILL.md`.
- ⬜ Deep-absorb install.doctor: `software.yml` (12.7K lines), `home/.chezmoiscripts/`, `dot_zshrc`/`dot_bashrc`, fonts + `docs/terminal/` → a distilled, SIMPLIFIED spec + scripts (Brian: "simplify my old routine").
- ⬜ Core installs per box: Docker · Homebrew · Alloy→Loki · fail2ban · cloudflared (properly connected) · codex (installed+authed) · fonts+Nerd-Font icons.
- ✅ **command-not-found AI lazy-installer DONE 2026-10-26** → `provisioning/command-not-found/{build-index.sh,handler.sh}` (local, not yet pushed — fleet race). `build-index.sh`: yq→json|jq (robust vs array installer fields + multi-`_bin`) → `~/.cache/cnf/index.tsv` (1181 binaries). `handler.sh`: zsh `command_not_found_handler` + bash `command_not_found_handle`, software.yml lookup → OS-preferred installer (gum/glow) → AI fallback (`mods`) → re-runs the typed command; `CNF_DRY=1` dry-run. VERIFIED in both shells (rg→ripgrep, fd→fd, delta→git-delta…). Bug fixed: zsh doesn't word-split unquoted vars → manual split. ACTIVATE per box: run build-index.sh (at provision + on software.yml change) + `source handler.sh` from the rc.
- ⬜ pre-warm after chezmoi apply: nvim/vim plugins, zsh plugins, tmux plugins.
- ⬜ parallel fan-out provisioning + gum/glow gorgeous logs.
- ✅ gum/glow terminal-printing mandate already exists → [[terminal-styling]] (extend it with the command-not-found note).

## C. Per-host FQDN git-backup repos
- ✅ `coolify.megabyte.space` + `ubuntu.megabyte.space` repos exist; HC checks `coolify/ubuntu/proxmox-git-config` already exist.
- ⬜ Create the **proxmox.megabyte.space** repo (missing locally).
- ⬜ **MERGE** `coolify-configs` → coolify.megabyte.space; `proxmox-git-configs` → proxmox.megabyte.space (fold content + history).
- ⬜ Each repo: box config backup + a `SYSTEM-POSTURE.md` (software inventory + security posture), auto-committed (cron, HC-monitored via [[healthchecks-job-monitoring]]).

## D. app.install.doctor (app store + AI provisioning brain)
- ⬜ Website/app-store at `app.install.doctor` (CF-native; React 19 + Vite per stack).
- ⬜ Daemon per box: monitors posture → reports to app.install.doctor.
- ⬜ AI recommendations + questions; apply → updates `ENVIRONMENT.md` → pushes to all linked machines.
- ⬜ Cross-host intelligence: install a capability on one box (Alloy, cloudflared) → suggest/auto estate-wide.
- ⬜ Multiple ENVIRONMENT.md supported; 1 default.

## E. GA + GTM skill
- ⬜ Computer Use (user's Chrome) → GCP service-account JSON + GA4 property id (+ via Chrome Bitwarden).
- ⬜ Skill: auto-create GA4/GTM properties if missing; associate with sites by URL; auto-run on new sites.
- ⬜ 30 best GA/GTM integration ideas (web research + code analysis) → implement recursively until exhausted.

## F. Secrets / Bitwarden
- ✅ `BW_CLIENTID`/`BW_CLIENTSECRET` saved to chezmoi; `bw` CLI present.
- ⬜ `bw login --apikey` + unlock → pull estate secrets into chezmoi (prefer over Computer Use for BW-stored secrets).
- ⬜ Computer Use (Chrome) harvest of secrets/SA/OAuth NOT in Bitwarden (visual inspection).

## Guardrails
- **Check live state before mutating shared infra** — Grafana/UK are fleet-managed (prior duplicate-alert collision). See [[observability-stack]].
- Store code under this repo (install.doctor). Push reusable patterns to agentskills.
- Secrets via chezmoi/get-secret, never plaintext.
