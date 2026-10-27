# Platform support & limitations

What Install Doctor v2 actually does on each OS/role today — marked **honestly** by how much is
PROVEN, not by intent. The `detect_os` roles are: `macos` · `ubuntu`/`debian` · `fedora`/`silverblue`
· `alpine` · `arch` · `qubes-dom0`/`qubes-appvm` · `proxmox` · `coolify` · `wsl` · `container`
(project `CLAUDE.md` §2).

**Status legend**

- **✅ tested** — exercised by the automated suites and/or live-verified against prod on this dev box.
- **◐ experimental** — the code exists and is designed cross-platform, but has NOT been live-verified on
  that specific OS/shell (the real multi-host run is a standing gated blocker — no throwaway fleet in CI).
- **⬜ not yet / unsupported** — not published or not built.

## Capability status (what's proven vs gated)

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Unix bootstrap one-liner (`bash <(curl … install.doctor/start)`) | ✅ tested | `install.doctor/start` serves 200; the landing + getting-started guides use it. |
| Native **Windows PowerShell** bootstrap entrypoint | ⬜ not published | `install.doctor/start.ps1` → 404. On Windows, use **WSL** (the `ubuntu` path). |
| Lazy CLI (command-not-found) — **bash + zsh** | ✅ tested | `scripts/test-command-not-found.sh` (25) — hardened resolver, locks, no-eval, atomic index. Run on macOS; bash/zsh are cross-platform. |
| Lazy CLI — **fish** / **PowerShell** adapters | ◐ experimental | Adapters shipped (`fish_command_not_found` · pwsh `CommandNotFoundAction`) over the ONE resolver; structural gates pass (8+8) but a LIVE fish/pwsh run is unverified (neither shell on the runner). |
| `aid` CLI (pair · pull · plan · apply · report · up · exec · prewarm · installs) | ✅ tested | `scripts/test-aid-client.sh` (29) on macOS + live against prod; a POSIX-sh client, portable across Unix. |
| Headless pairing (code + approve-in-browser) | ✅ tested | `aid-pair` + `/pair`; `scripts/test-aid-pair.sh` (6) incl. a live start→approve→claim E2E. |
| Real **on-device apply** (`aid apply --yes` installs via the host pkg manager) | ◐ experimental | Dry-run tested local + prod; the real-install path is **machine-gated** (never run in CI). The control-plane **never pushes** installs — server-side `/api/device/apply` returns **501** by design. |
| chezmoi + `software.yml` + `installx` provisioning | ◐ experimental | Cross-platform by design (per-role branches); the full LIVE provisioning run on each OS is the standing gated blocker. |
| Control plane (dashboard + API at app.install.doctor) | ✅ tested | Platform-independent (Cloudflare Worker); 112 control-plane assertions live. |

## Per-role notes

- **macos** — the dev + daily-driver host; the cnf hook, `aid` client, pairing, and control-plane are
  all tested here. Desktop GUI (cask) install is part of the installer; full first-run provisioning is
  `◐` pending a clean-box run.
- **ubuntu / debian** — the primary Linux + the **WSL** path for Windows. Same bash/zsh cnf + `aid`
  client (portable); apt provider wired. `◐` live multi-host.
- **fedora / silverblue** — dnf + the OSTree (`rpm-ostree`) branch for Silverblue; `◐` live.
- **alpine** — musl + apk; minimal-node role; `◐` live.
- **arch** — pacman; `◐` live.
- **qubes-dom0 / qubes-appvm** — distinct dom0 (Salt-based, restricted) vs AppVM (TemplateVM) paths
  are preserved; `◐` — needs the Qubes box.
- **proxmox / coolify** — server roles (post-install tuning, Tailscale, service stack); headless-safe
  (`HEADLESS_INSTALL=1`); `◐` — needs the real server.
- **wsl** — treated as the `ubuntu` role; native-Windows outside WSL is `⬜` (no PowerShell entrypoint).
- **container** — minimal, headless; desktop/GUI components excluded by role.

## Real limitations (do not expect these yet)

- **No native Windows (outside WSL).** The PowerShell bootstrap entrypoint is not published; the pwsh
  command-not-found adapter is live-unverified.
- **fish + PowerShell lazy-install are experimental** — present + structurally tested, not live-run.
- **The control plane never installs on your machine.** `aid apply --yes` runs the host package
  manager locally; the server-side apply is `501` (on-device supervisor, Phase B). Real multi-host /
  replacement-host provisioning + restore drills are NOT loop-verified (need throwaway machines).
- **Better Auth sign-in, per-host private repos, encrypted backups** — `⬜` (see `REQUIREMENTS.md` O/I/J).

## See also

- Getting started: `getting-started-desktop.md` · `getting-started-headless.md`.
- Repo/backup model: `repos-and-backups.md`. API: `api-reference.md`. Matrix: `REQUIREMENTS.md`.
