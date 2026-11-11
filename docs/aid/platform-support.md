# Platform support & limitations

What the Desktop Tools bootstrap compatibility implementation actually does on each OS/role today — marked **honestly** by how much is
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
| Signed Unix stage-zero contract | ⚠️ repository-verified | Fixtures prove fail-closed signature, digest, provisioner/engine, and selected-runtime verification. The retired `app.install.doctor` hostname is not presented as the Desktop Tools launch URL, and no production release-channel receipt is claimed. |
| Native **Windows PowerShell** bootstrap entrypoint | ◐ experimental | Source exists as `scripts/provision.ps1`, but no public endpoint is published. Structural checks are not runtime evidence; promote it only after signed delivery and clean-host Windows verification. |
| Lazy CLI (command-not-found) — **bash + zsh** | ✅ tested | `scripts/test-command-not-found.sh` (25) — hardened resolver, locks, no-eval, atomic index. Run on macOS; bash/zsh are cross-platform. |
| Lazy CLI — **fish** / **PowerShell** adapters | ◐ experimental | Adapters shipped (`fish_command_not_found` · pwsh `CommandNotFoundAction`) over the ONE resolver; structural gates pass (8+8) but a LIVE fish/pwsh run is unverified (neither shell on the runner). |
| Retired `aid` compatibility CLI | ◐ experimental | Repository tests cover compatibility contracts; they do not establish a current production Desktop Tools service or portable runtime support. |
| Headless pairing contracts | ◐ experimental | Local compatibility tests cover the protocol shape; no current production Desktop Tools start→approve→claim receipt is committed. |
| Retired compatibility on-device apply | ◐ experimental | Dry-run repository tests cover the local package-manager boundary. This does not establish a production Desktop Tools apply path; the server-side compatibility endpoint returns **501** by design. |
| chezmoi + `software.yml` + `installx` provisioning | ◐ experimental | Cross-platform by design (per-role branches); the full LIVE provisioning run on each OS is the standing gated blocker. |
| Control-plane package | ✅ tested | Platform-independent worker code has automated tests; this row makes no production deployment claim. |

## Per-role notes

- **macos** — narrow capabilities have been exercised on the dev host, while each matrix tuple remains
  `best-effort` pending a complete clean-box canary receipt.
- **ubuntu / debian** — exact listed x64 tuples are consent-gated `best-effort`; apt support or a
  Linux workflow does not prove WSL. Debian 12 ARM64 container and native tuples are `unsupported`
  until architecture-matching lifecycle evidence is committed. The x64 PID1 fixture proves only its
  bounded transaction contract, not a complete native-host lifecycle.
- **fedora / silverblue** — Fedora workflow definitions are `best-effort`; Silverblue remains
  `unsupported` until an rpm-ostree fixture, rollback test, and canary exist.
- **alpine** — musl + apk; a compatible preinstalled system Node 22/24 can run the engine, but the signed
  portable runtime tuples are glibc-only. The cell is therefore `unsupported`, not best-effort, until a
  provenance-pinned musl runtime or signed Alpine system-runtime bootstrap and full lifecycle proof exist.
- **arch** — pacman; `◐` live.
- **qubes-dom0 / qubes-appvm** — strict disposable fixture contracts now cover compartment identity,
  exact qrexec authority, typed dom0/template/app/disposable/Whonix operations, offline denial, and
  DisposableVM teardown. Both matrix cells remain `unsupported`: pure fixture evidence is not a
  signed real-Qubes lifecycle receipt, and no public Qubes entrypoint is published.
- **proxmox / coolify** — intended server roles are `unsupported` until non-production canaries prove
  service preservation, headless operation, unchanged reapply, and configuration rollback.
- **wsl** — a separately detected, currently unsupported environment; ordinary Linux workflow
  definitions do not prove its init, mount, networking, reboot, or Windows-interop behavior. It is
  `unsupported` until a Windows-hosted WSL2 canary exists. Native Windows also remains unsupported;
  its experimental PowerShell source is unpublished and runtime-unverified.
- **container** — only exact named distribution tuples may be admitted. Generic Linux containers fail
  closed because libc, package manager, init, and privilege behavior are unspecified.

## Real limitations (do not expect these yet)

- **Native Windows is unsupported (runtime-unverified).** The PowerShell bootstrap entrypoint is
  present in source (`provision.ps1`) + structurally verified, but unpublished and the RUNTIME on a real
  Windows host is not yet verified (no Windows CI); the pwsh command-not-found adapter is also
  live-unverified. WSL is not a verified substitute.
- **fish + PowerShell lazy-install are experimental** — present + structurally tested, not live-run.
- **The compatibility control plane never installs on your machine.** Its server-side apply route is
  `501`; the retired local client owns any compatibility package-manager execution. Real multi-host /
  replacement-host provisioning + restore drills are NOT loop-verified (need throwaway machines).
- **Better Auth sign-in, per-host private repos, encrypted backups** — `⬜` (see `REQUIREMENTS.md` O/I/J).

## See also

- Getting started: `getting-started-desktop.md` · `getting-started-headless.md`.
- Repo/backup model: `repos-and-backups.md`. API: `api-reference.md`. Matrix: `REQUIREMENTS.md`.
