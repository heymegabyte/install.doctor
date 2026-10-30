# install.doctor — Project Context

> **Read this FIRST in every session.** This file captures the business requirements, the multi-machine fleet model, the design constraints that come from it, and the prioritized work queue. Future Claude sessions and human contributors should treat it as the source of truth for "what is this project and what are we building toward."

---

## 1. Mission

**One command brings up any of Brian's computers to a consistent, fully-configured state — workstation, server, hypervisor, or container host.**

The provisioner is multi-machine first, single-laptop never. Every design decision must answer: *"does this work the same across the entire fleet?"* If a feature only makes sense on macOS or only on a server, it is gated by detected OS + role — never deleted, never assumed.

Entry point: `bash <(curl -sSL https://install.doctor/start)` → `start.sh` → `provision.sh` → `chezmoi apply` → `installx` → per-platform post-install hooks.

---

## 2. Supported machines & roles

The fleet today (update hostnames as they're confirmed):

| Role | OS | Hostname (TBD) | Purpose |
|---|---|---|---|
| Primary workstation | macOS Tahoe 26+ | `macbook-pro` | Daily dev, this machine |
| Secondary laptop | Ubuntu 24.04 / Fedora 41 | TBD | Mobile dev |
| Anonymous workstation | Qubes 4.2 | TBD | Compartmentalized work — dom0 + AppVMs (Whonix included) |
| Hypervisor | Proxmox VE 8 | TBD | Bare-metal virtualization host running LXC + VMs |
| PaaS / app host | Coolify on Ubuntu | TBD | Self-hosted PaaS for personal services; runs Docker + Traefik |
| Minimal nodes | Alpine 3.20 / Arch | TBD | Edge boxes, build runners, throwaway test VMs |
| WSL | Ubuntu under Windows | TBD | Occasional Windows-host workflows |

**Roles, not boxes** — `detect_os()` returns the role (`macos | ubuntu | debian | fedora | silverblue | alpine | arch | qubes-dom0 | qubes-appvm | proxmox | coolify | wsl | container`) and every script branches off that. The same `software.yml` entry can have different install paths per role.

---

## 3. Hard constraints (non-negotiable)

- **Cross-platform parity** — every feature works on every relevant OS, or is explicitly gated by role with a documented reason. No silent macOS-only or Linux-only behaviour.
- **Headless-safe** — Proxmox, Coolify, Qubes dom0 boxes have no GUI; every interactive prompt (FDA pane, font config, Terminal.app AppleScript, `softwareupdate -i`, `xcode-select --install` GUI dialog) MUST respect `HEADLESS_INSTALL=1` and skip gracefully.
- **Idempotent** — re-running `bash start.sh` on a fully-provisioned box is a no-op. Every script tests for present-state before applying. Marker files (e.g., `/tmp/install-doctor-passwordless-sudo`) coordinate state across phases.
- **Settings sync** — chezmoi is the single source of truth for dotfiles + configs. Every box pulls from the same git repo and renders templates per-host via `.chezmoi.toml.tmpl`.
- **Secret encryption at rest** — `age` per-host recipients (planned; currently single key). Repo is public — every credential ships encrypted.
- **Open-source only** — no proprietary dependencies in the bootstrap path. Commercial tools (1Password, JetBrains, etc.) install as casks but are never required for provisioning to complete.
- **Reliability > speed > compatibility** — picking which tool to use, reliability always wins.

---

## 4. Architectural pillars

### detect_os() — single source of truth
Every script that branches on OS must use one shared `detect_os()`. The shared lib `scripts/lib/detect_os.sh` is BUILT + tested (14-assertion `test-detect-os.sh`; defines `detect_os`/`detect_role`/`detect_package_manager`/`is_headless`) and consumed by `provision.sh` — but ad-hoc `[ -d /Applications ]` + `[ -f /etc/redhat-release ]` + `[ -f /usr/bin/qubes-session ]` checks are STILL duplicated across ~20 other scripts/hooks/chezmoiscripts and disagree on edge cases (Silverblue, Coolify, WSL2, immutable Fedora). Finish the consumption-migration (#2) — do NOT rebuild the lib, it already exists.

### Tier system — `software.yml` install scope per role
Every `software.yml` entry carries `tier: essential | workstation | server | coolify | proxmox | qubes-dom0 | qubes-appvm | alpine-minimal`. `auto` (the default) reads `detect_os()` and picks the right subset. One bootstrap command → right software for the role.

### chezmoi templates per-host
`{{ if eq .chezmoi.hostname "coolify-prod" }}...{{ end }}` blocks render host-specific values. Hostnames listed in §2 above drive the per-host config matrix.

### post-installx hooks
`home/dot_local/bin/post-installx/post-<tool>.sh` runs after `installx` installs `<tool>`. Each script is platform-aware (early-exit on wrong OS). Examples: `post-coolify.sh`, `post-proxmox.sh`, `post-zsh-bootstrap.sh`, `post-tailscale.sh`.

### Fail-safe sudo
`scripts/provision.sh:setupPasswordlessSudo` validates the password before writing `/etc/sudoers`. `home/.chezmoitemplates/universal/profile-inline` wraps `sudo` so chezmoi scripts skip-with-warning instead of blocking on a `Password:` prompt mid-run.

---

## 5. Don't drop these (lessons learned)

Prior sessions almost removed features that ARE needed on non-laptop boxes. These stay:

- **Qubes dom0 code paths** (`handleQubesDom0`, `ensureSysWhonix*`) — needed for the Qubes machine. Improve, don't delete.
- **VNC stack** (ARDAgent / KasmVNC / TigerVNC) — needed for occasional graphical sessions into headless Proxmox/Coolify hosts. Gate behind `INSTALL_DOCTOR_VNC=1`, don't drop.
- **Server-stack post-installs** (`fail2ban`, `clamav`, `endlessh`, `postfix`, `samba`, `nginx`) — production-ready Coolify/Proxmox/Ubuntu boxes need these. Tune, don't drop.
- **`installYay` / `addFlathub` / `setupSnap` / `installCredentialSecretService` / `setupLinuxHomebrewFonts`** — needed on Arch/Fedora/Ubuntu/Coolify/Linux-laptop respectively. Gate via `detect_os()`, don't delete.
- **JumpCloud MDM** — keep gated; the user MAY want fleet-management on the laptop in the future.
- **Ansible** — keep for the historical Qubes dom0 Salt-style provisioning path.

## 6. OK to drop fleet-wide (confirmed deprecated)

- **Mackup** — chezmoi already manages every dotfile Mackup would touch; unmaintained since 2024.
- **vim+coc plugin bootstrap** — Neovim+native LSP is the modern path.
- **bash-it integration** — zsh+zinit-turbo is the everywhere shell; bash-it duplicates 80% of antigen's purpose.
- **m-cli (`m` command) wrapper** — macOS-only, unmaintained, silently no-ops on macOS 15+. Replace with native `defaults write` / `systemsetup`.
- **mas-based `installXcode`** — 40-min timeout, App Store login required, hangs on every fresh box. Keep `xcode-select --install` (CLT-only); gate full Xcode behind `INSTALL_DOCTOR_FULL_XCODE=1`.

## 7. Already removed (do not reintroduce)

| Package | Removed in | Why | Replacement |
|---|---|---|---|
| Whalebrew | `d8171e6c` | Niche; broke regularly | docker compose |
| macfuse | `2001465a` | EOL'd kernel-extension; broke macOS upgrades | FUSE-T or Mounty (macOS); libfuse (Linux) |
| java@beta | `2001465a` | Rolling beta breaks builds | temurin LTS |
| Homebrew `--no-quarantine` flag | `2001465a` | Removed by Homebrew | unset; Gatekeeper handles |
| Deprecated taps `homebrew/bundle/services/command-not-found` | `2001465a` | Tap migrated/deleted | drop |
| Nix (53 software.yml entries + 4 install branches) | `f454d9e2` | User decision | host package manager (brew/apt/dnf/apk) |
| MacPorts (110 software.yml entries + ensureMacportsInstalled) | `e42bb272` | User decision; source-build was a 8-min flake | Homebrew |
| gVisor (3-method install chain + runsc daemon.json) | `506650bf` | Niche, flaky download paths | default `runc`; install runsc from pkgs.k8s.io if needed |
| `ansible-modules-bitwarden` external | `f454d9e2` | Source repo deleted (404) | `community.general.bitwarden` Ansible collection |
| antigen plugin manager | `2f9ab27c` | Reparsed 88 bundles every shell launch | zinit turbo mode |
| macOS auto-update vectors (8 keys + brew autoupdate + automatedupdates daemon) | `722e40ff` | Background app replacement corrupts running processes | manual `softwareupdate -ia` / `brew upgrade` |

---

## 8. Current dev environment (as of latest session)

- macOS host: Tahoe 26.5 on Apple Silicon (M2)
- Active chezmoi source: `~/.local/share/chezmoi` (git remote: `heymegabyte/install.doctor`)
- Mirror clone for edits: `~/emdash/repositories/install.doctor`
- ZSH startup: 0.40s mean (was 0.65s); time-to-first-prompt <50ms via p10k instant-prompt
- Plugin manager: zinit turbo (replaces antigen)
- Font: MesloLGS Nerd Font Mono 13pt across every Terminal.app profile
- History: atuin 18.16+ (SQLite at `~/.local/share/atuin/history.db`), 28 imported entries
- Sudo: NOPASSWD line in `/etc/sudoers` (temporary, marker file at `/tmp/install-doctor-passwordless-sudo`)
- Auto-update: every macOS + brew + commerce vector OFF (manual updates only)

---

## 9. Active work queue (re-ranked for fleet provisioning)

Ranked by impact ÷ effort. `[S]` <1hr, `[M]` half-day, `[L]` multi-day. Each anchored to a specific file or function.

### Foundation (do these first — everything else depends on them)
1. **Multi-OS CI matrix** `[L]` — `.github/workflows/provision-matrix.yml` running `bash start.sh` headless across Tart (macOS 14/15/26), UTM/QEMU (Ubuntu 24.04, Fedora 41, Alpine 3.20), Proxmox VE 8 cloud-init template, Qubes 4.2 dom0 + AppVM template.
2. **`detect_os()` consumption-migration** `[M]` — ◐ the SSOT lib `scripts/lib/detect_os.sh` is BUILT + tested (returns `macos|ubuntu|debian|fedora|silverblue|alpine|arch|qubes-dom0|qubes-appvm|proxmox|coolify|wsl|container`; also `detect_role`/`detect_package_manager`/`is_headless`; 14-assertion `test-detect-os.sh`) + consumed by `provision.sh`. REMAINING: migrate the ad-hoc OS checks still duplicated across ~20 other scripts/hooks/chezmoiscripts to consume it (don't rebuild the lib — it exists).
3. **`HEADLESS_INSTALL=1` parity audit** `[M]` — Walk every interactive prompt; assert each skips gracefully on Proxmox/Coolify/Qubes dom0.
4. **Provisioning tier system** `[M]` — `tier: essential|workstation|server|coolify|proxmox|qubes-dom0|qubes-appvm|alpine-minimal` on every `software.yml` entry; `auto` default reads `detect_os()`.
5. **State-parity verifier** `[M]` — `task verify:parity` `chezmoi diff`s the current host against a per-host reference manifest.

### Per-OS correctness
6. **Split Qubes path: dom0 vs AppVM** `[M]` — `provisionQubesDom0` (Salt-based, dom0-restricted) + `provisionQubesAppVM` (TemplateVM Linux path) + `provisionWhonix`.
7. **Proxmox post-install** `[M]` — `post-proxmox.sh`: disable enterprise-repo nag, enable no-subscription repo, install `qemu-guest-agent`, set `zfs_arc_max` to half-RAM, integrate Tailscale, bind `pveproxy` to tailnet IP only.
8. **Coolify post-install** `[M]` — `post-coolify.sh`: official Coolify install on Ubuntu/Debian, Resend SMTP for transactional mail, Backblaze B2 backups, join docker network to tailnet.
9. **Fedora Silverblue / OSTree branch** `[M]` — Detect `/run/ostree-booted`; use `rpm-ostree install --apply-live`. Same path serves Bluefin/Bazzite/Universal Blue.
10. **Alpine + musl branch** `[M]` — `-musl` cargo target triples + `apk add` lines in `software.yml`.
11. **Server-stack production tuning** `[S]` — `fail2ban` jail.local with Tailscale `100.64.0.0/10` allowlist, `clamav` weekly systemd-timer scan, `endlessh` on `:22` decoy + sshd on `:2222`, `postfix` outbound-only via Resend SMTP, `samba` opt-in via `INSTALL_DOCTOR_SAMBA=1`.

### Security & secrets across the fleet
12. **Per-host age recipients** `[M]` — One age key per machine; `chezmoi.toml.tmpl` picks recipient by hostname.
13. **`SUDO_PASSWORD` per-platform** `[M]` — macOS Keychain, Linux `secret-tool`/libsecret, Qubes dom0 `qubes-pass`, Proxmox/Coolify `/root/.install-doctor/sudo.txt mode 0400`. Drop the repo-encrypted file.
14. **Per-OS NOPASSWD scope** `[S]` — Whitelist exact commands per OS instead of `ALL=(ALL) NOPASSWD: ALL`.

### Pan-machine quality of life
15. **Atuin sync hub on Coolify** `[S]` — `atuin-server` via Coolify Docker template; every machine syncs encrypted history to it.
16. **Bootstrap parity in `start.sh`** `[S]` — Linux pre-flight installs `go-task` via `apt-get`/`dnf`/`apk`/`pacman` so Linux boxes don't need brew first.
17. **Auto-dispatching `task` one-liners** `[S]` — `task update:all`, `task docker:reset`, `task atuin:sync`, `task ssh:deploy <host>`.
18. **Cross-machine deploy hook** `[S]` — `task ssh:deploy <host>` runs `chezmoi git push` locally + SSH'd `chezmoi update --apply --force` on the target.
19. **`MIGRATION.md` + `troubleshooting.md` per-OS** `[S]` — Per-OS columns for every error → fix mapping. Errors map differently per OS.
20. **Loki-on-Coolify observability** `[M]` — Each `chezmoi apply` emits JSON events to `~/.local/var/log/install.doctor/events.ndjson`; Promtail forwards via Tailscale to a Coolify Loki+Grafana stack.
21. **Re-add Firebase deploy secret** `[S]` — The standalone `install.doctor-site` repo was absorbed into `site/` and deleted; its `FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR` secret was write-only and could not be copied. `.github/workflows/site-deploy.yml` fires on `site/**` pushes and will FAIL until the secret is re-added: `gh secret set FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR -R heymegabyte/install.doctor < service-account.json`. Full-history backup at `~/backups/repos/install.doctor-site-*.bundle`.

---

## 10. Workflow conventions

- **Edit in `~/.local/share/chezmoi/`** (the live runtime clone), mirror to `~/emdash/repositories/install.doctor/` (the dev clone) when convenient. Commit + push from the live clone — its remote is `origin/master` on `heymegabyte/install.doctor`.
- **Push to `origin/master`** is the explicit user preference for side repos. No PRs, no feature branches — direct commits.
- **Side-repo auto-push**: per Brian's preferences, every commit goes to origin immediately. Don't ask; just push.
- **Validate before commit** — `bash -n <script>`, `chezmoi execute-template < <tmpl>`, `yq eval` for YAML, `python3 -c "import yaml; yaml.safe_load(...)"` for full YAML parse.
- **Always update this file** when adding/removing fleet-impacting features, removing packages, or changing core architecture. This file is what future sessions read first.

---

## 11. Useful entry points

| Task | Where to look |
|---|---|
| Add a package | `software.yml` (1,171 entries; YAML keys per package manager) |
| Add a post-install hook | `home/dot_local/bin/post-installx/post-<tool>.sh` |
| Add a chezmoi external | `home/.chezmoiexternal.toml.tmpl` |
| macOS-only defaults | `home/dot_config/shell/macos.sh.tmpl` |
| Shell config | `home/dot_zshrc` + `home/dot_config/shell/*.sh{,.tmpl}` |
| System tweaks per-OS | `home/.chezmoiscripts/universal/run_before_*.sh.tmpl` + `run_after_*.sh.tmpl` |
| Secrets | `home/.chezmoitemplates/secrets/<NAME>` (age-encrypted) |
| Provisioning entry | `start.sh` → `scripts/provision.sh:provisionLogic()` |
| Bulk installer | `home/dot_local/bin/executable_installx` (zx-based, p-limit 4) |
| Website / docs site | `site/` (Ionic Stencil — absorbed from the now-retired `install.doctor-site` repo; builds + deploys via `.github/workflows/site-deploy.yml` → Firebase project `install-doctor`) |

---

## 12. Anti-patterns (don't do these)

- ❌ "Brian uses macOS so we can drop the Linux path" — wrong; he uses Ubuntu/Fedora/Qubes/Proxmox/Coolify/Alpine too.
- ❌ "Brian is solo so we can drop the MDM/VNC/server-stack code" — wrong; he runs servers and may want MDM later.
- ❌ Ad-hoc `[ -d /Applications ]` OS checks — use `detect_os()` (when #2 lands; pattern-match the existing ad-hoc checks until then but add a TODO).
- ❌ Adding a new tool without a `tier:` annotation (when #4 lands).
- ❌ Pushing a change without testing across the fleet matrix (when #1 lands).
- ❌ Removing a code path because it's "never used on this machine" — that machine isn't every machine in the fleet.
- ❌ Hardcoding hostnames; use `.chezmoi.hostname` template var.
- ❌ Background-replacing running apps via auto-update (the #1 corruption source — see §7).

---

## 13. Reference URLs

- Public repo: https://github.com/heymegabyte/install.doctor
- Public install URL: https://install.doctor (serves `start.sh`)
- chezmoi docs: https://www.chezmoi.io
- zinit docs: https://github.com/zdharma-continuum/zinit
- atuin: https://atuin.sh
- Coolify: https://coolify.io
- Tart (macOS VMs in CI): https://tart.run
