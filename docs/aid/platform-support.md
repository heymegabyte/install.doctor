# Platform support & limitations

What Install Doctor v2 actually does on each OS/role today — marked **honestly** by how much is
proven, not by intent. The authoritative claims are the cells in
[`scripts/platform-support-matrix.json`](https://github.com/heymegabyte/install.doctor/blob/master/scripts/platform-support-matrix.json), validated by
`scripts/validate-platform-support-matrix.mjs` and mirrored as executable policy inside the signed
provisioner. The provisioner rejects absent and `unsupported` tuples before plan approval; a
`best-effort` tuple proceeds only with explicit `INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true`, and its
cell, limitation, status, tuple, and consent are bound into the normalized plan. A CI or fixture definition is only **best-effort**
evidence. A platform becomes **verified** only when a fresh passing canary receipt covers stage zero,
plan, apply, verify, unchanged reapply, interrupted resume, configuration rollback, and headless use.
The receipt must identify the exact matrix tuple and immutable release (`releaseId`, source commit, and
manifest digest), declare `real-host-canary` / `full-lifecycle` scope, and remain within the matrix's
freshness window. Hermetic tests, workflow definitions, fixtures, and receipts from a different tuple
or release can support a `best-effort` claim but cannot promote a cell to `verified`. The validator
checks these conditions dynamically; it does not enforce a permanently zero verified count. The
committed matrix currently makes no verified platform claim. The `detect_os` roles are:
`macos` · `ubuntu`/`debian` · `fedora`/`silverblue`
· `alpine` · `arch` · `qubes-dom0`/`qubes-appvm` · `proxmox` · `coolify` · `wsl` · `container`
(project `CLAUDE.md` §2).

**Capability-test legend** (this prose summarizes individual features; it does not promote a whole
platform cell)

- **✅ tested** — exercised by a named automated suite and/or live-verified for that narrow capability.
- **◐ experimental** — the code exists and is designed cross-platform, but has NOT been live-verified on
  that specific OS/shell (the real multi-host run is a standing gated blocker — no throwaway fleet in CI).
- **⬜ not yet / unsupported** — not published or not built.

## Capability status (what's proven vs gated)

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Signed Unix stage zero (`curl -fsSL app.install.doctor/start | bash`) | ⚠️ repository-verified | The launcher fails closed unless the production manifest URL, detached SSHSIG signature, pinned signer, exact provisioner/engine bytes, and selected signed Node runtime tuple verify. Clean-host runtime and adversarial root-handoff fixtures pass, but production signer/storage plus real-host release-channel evidence are still required. |
| Native **Windows PowerShell** bootstrap entrypoint | ◐ experimental | Source exists as `scripts/provision.ps1`, but no public endpoint is published. Structural checks are not runtime evidence; promote it only after signed delivery and clean-host Windows verification. |
| Lazy CLI (command-not-found) — **bash + zsh** | ✅ tested | `scripts/test-command-not-found.sh` (25) — hardened resolver, locks, no-eval, atomic index. Run on macOS; bash/zsh are cross-platform. |
| Lazy CLI — **fish** / **PowerShell** adapters | ◐ experimental | Adapters shipped (`fish_command_not_found` · pwsh `CommandNotFoundAction`) over the ONE resolver; structural gates pass (8+8) but a LIVE fish/pwsh run is unverified (neither shell on the runner). |
| `aid` CLI (pair · pull · plan · apply · report · up · exec · prewarm · installs) | ✅ tested | `scripts/test-aid-client.sh` (29) on macOS + live against prod; a POSIX-sh client, portable across Unix. |
| Headless pairing (code + approve-in-browser) | ✅ tested | `aid-pair` + `/pair`; `scripts/test-aid-pair.sh` (6) incl. a live start→approve→claim E2E. |
| Real **on-device apply** (`aid apply --yes` installs via the host pkg manager) | ◐ experimental | Dry-run tested local + prod; the real-install path is **machine-gated** (never run in CI). The control-plane **never pushes** installs — server-side `/api/device/apply` returns **501** by design. |
| chezmoi + `software.yml` + `installx` provisioning | ◐ experimental | Cross-platform by design (per-role branches); the full LIVE provisioning run on each OS is the standing gated blocker. |
| Control plane (dashboard + API at app.install.doctor) | ✅ tested | Platform-independent (Cloudflare Worker); 112 control-plane assertions live. |

## Per-role notes

- **macos** — narrow capabilities have been exercised on the dev host, while each matrix tuple remains
  `best-effort` pending a complete clean-box canary receipt.
- **ubuntu / debian** — the primary Linux + the **WSL** path for Windows. Same bash/zsh cnf + `aid`
  client (portable); apt provider wired. Debian 12 x64/ARM64 native hosts are explicitly
  consent-gated `best-effort`: the real PID1 fixture proves the bounded dpkg transaction, while a
  complete signed native-host lifecycle receipt is still required before either tuple is verified.
- **fedora / silverblue** — Fedora workflow definitions are `best-effort`; Silverblue remains
  `unsupported` until an rpm-ostree fixture, rollback test, and canary exist.
- **alpine** — musl + apk; a compatible preinstalled system Node 22/24 can run the engine, but the signed
  portable runtime tuples are glibc-only. The cell is therefore `unsupported`, not best-effort, until a
  provenance-pinned musl runtime or signed Alpine system-runtime bootstrap and full lifecycle proof exist.
- **arch** — pacman; `◐` live.
- **qubes-dom0 / qubes-appvm** — intended paths are documented, but both are `unsupported` claims
  until a safe Qubes fixture and current canary exist.
- **proxmox / coolify** — intended server roles are `unsupported` until non-production canaries prove
  service preservation, headless operation, unchanged reapply, and configuration rollback.
- **wsl** — an intended Ubuntu route, but Linux workflow definitions do not prove WSL behavior; it is
  `unsupported` until a Windows-hosted WSL2 canary exists. Native Windows also remains unsupported;
  its experimental PowerShell source is unpublished and runtime-unverified.
- **container** — minimal, headless; desktop/GUI components excluded by role.

## Real limitations (do not expect these yet)

- **Native Windows is unsupported (runtime-unverified).** The PowerShell bootstrap entrypoint is
  present in source (`provision.ps1`) + structurally verified, but unpublished and the RUNTIME on a real
  Windows host is not yet verified (no Windows CI); the pwsh command-not-found adapter is also
  live-unverified. WSL is not a verified substitute.
- **fish + PowerShell lazy-install are experimental** — present + structurally tested, not live-run.
- **The control plane never installs on your machine.** `aid apply --yes` runs the host package
  manager locally; the server-side apply is `501` (on-device supervisor, Phase B). Real multi-host /
  replacement-host provisioning + restore drills are NOT loop-verified (need throwaway machines).
- **Better Auth sign-in, per-host private repos, encrypted backups** — `⬜` (see `REQUIREMENTS.md` O/I/J).

## See also

- Getting started: `getting-started-desktop.md` · `getting-started-headless.md`.
- Repo/backup model: `repos-and-backups.md`. API: `api-reference.md`. Matrix: `REQUIREMENTS.md`.
