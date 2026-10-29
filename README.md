<div align="center">
  <a href="https://install.doctor">
    <img width="320" alt="Install Doctor" src="https://raw.githubusercontent.com/heymegabyte/install.doctor/master/docs/logo-full.png" />
  </a>
  <h1>Install Doctor</h1>
  <p><strong>One command brings up any computer — and keeps it that way.</strong></p>
  <p>Set up and maintain desktops, laptops, servers, and headless boxes from one place:
  <a href="https://app.install.doctor">app.install.doctor</a>.</p>
</div>

---

> **Status:** Install Doctor is evolving from a hardcoded chezmoi-and-shell provisioner into a
> **configurable system for setting up and maintaining computers**. The provisioning machinery
> (chezmoi + `software.yml` + the ZX `installx` installer) is preserved; a Cloudflare-native control
> plane (**aid**) layers configuration, a browser dashboard, lazy CLI installation, per-host
> recovery, and bounded improvement cycles on top. This README describes what actually ships today —
> see **[Honest status](#honest-status)** for what is live vs. still in progress.

## What it is

Describe the environment you want once; make each authorized machine a verified, cooperating part of
it. Selected **desktop applications** install now; optional **command-line tools install the first
time you run them**. Every host stays reconciled to its desired state, observable, and recoverable.

The browser app at **[app.install.doctor](https://app.install.doctor)** is the normal interface. A
headless supervisor and an emergency CLI (`aid`) work **without a desktop or GUI**.

## Quick start

On macOS or Linux, run the minimal bootstrap, then pair the machine from any browser:

```bash
bash <(curl -sSL https://install.doctor/start)   # bootstrap (installs base deps + the aid client)
aid-pair                                          # prints a short code + opens app.install.doctor/pair
```

- **Desktop (with a browser):** `aid-pair` opens the approval page automatically.
- **Headless / server:** `aid-pair` prints a short code + URL you approve from any other browser —
  no GUI required. Approval is an explicit, authenticated action (visiting the URL does **not**
  approve the device); the approver sees the machine's identity before granting.

> A native **Windows PowerShell** bootstrap entrypoint is not shipped yet (the lazy
> command-not-found installer already has a PowerShell adapter — see below).

## The browser app (app.install.doctor)

A server-rendered dashboard (CF Worker + Hono). Live sections — each reads **observed** state, never
optimistic success:

| Section | Route | What it shows |
| --- | --- | --- |
| **Machines** | `/machines` | Enrolled devices: identity, enrolled-at, **last activity** (fresh / stale / never), and **drift** (last-applied revision vs the tenant's desired revision). |
| **App Store** | `/apps` | The full installable catalog (**1,068 tools** generated from `software.yml`), searchable, each with the exact per-manager **install command**. |
| **Recommendations** | `/recommendations` | Actionable **rule-based** recs from observed state (drifted / never-reported / stale machines). AI enrichment is pending the provider connection. |
| **History** | `/history` | The fleet's reported events (apply / plan / report) across devices. |

Supporting JSON APIs (admin-gated where they expose fleet data; the catalog is public):
`GET /health` · `GET /api/catalog` + `/api/catalog/:name` · `GET /api/devices` ·
`GET /api/recommendations` · `GET /api/history` · `GET /api/environment/current` ·
pairing `POST /api/devices/pair/{start,approve}` + `GET /api/devices/pair/{info,poll}` ·
devices `POST /api/devices/{enroll,:id/revoke}` + `GET /api/devices/me` ·
device-scoped `GET /api/device/{current,current.md,history}` + `POST /api/device/{apply,report}`.

## The `aid` CLI

`aid` is the machine-side client. It reads the device token stored by `aid-pair` and talks to the
control plane as **that device** (headless-safe, dependency-light):

| Command | What it does |
| --- | --- |
| `aid-pair` | Pair this machine (print code → approve in browser → claim a revocable device token). |
| `aid status` | Pairing + desired-state summary (tenant / revision / digest). |
| `aid pull` | Fetch this device's desired `ENVIRONMENT.md`. |
| `aid plan` | Reconcile desired vs installed, **offline/local** (present / missing / to-install). |
| `aid apply` | Install the missing packages — **dry-run by default**; real install is opt-in (`--yes`). |
| `aid up` | One command: `pull` + `plan` (read-only; records a History event). |
| `aid exec <cmd>` | Run a command, installing it first if missing (authorized install-on-demand). |
| `aid prewarm <cmd…>` | Install tools now without running them. |
| `aid installs` | Summarize lazy-install telemetry (cold / warm latency, cache effectiveness). |
| `aid report …` | Record a run to History. |
| `aid provider` | Write the OpenCode provider config so routing goes through the control plane. |

## Eager vs. lazy install

Install Doctor installs **two ways**, on purpose:

- **Eager** — selected **desktop applications** and the few dependencies needed to bootstrap and
  recover are installed up front during provisioning (via `installx` + `software.yml` +
  `home/dot_local/bin/post-installx/*`). Example: pairing on a desktop installs your chosen GUI apps
  now.
- **Lazy** — optional **command-line tools** install **the first time you run them**. Type a CLI
  that isn't present and the `command-not-found` hook looks it up in the catalog index, installs it
  via the OS package manager, and transparently runs the command you typed:

  ```console
  $ rg "needle" .
  ⟳ 'rg' not found — resolving via install.doctor…
  ↻ installing 'rg' → brew: ripgrep (first run)…
  # …then your search runs, and `rg` is there for every future call.
  ```

  The lazy installer (`home/dot_config/shell/not-found-hook.sh`) works across **bash, zsh, fish, and
  PowerShell** over one resolver, is safe-by-default (no unauthorized installs in CI / non-interactive
  shells), serializes concurrent installs to exactly one, never consumes a command's stdin/stdout, and
  records per-install telemetry (`aid installs`). Mise-managed runtimes are deferred to mise, not
  duplicated.

## Architecture

Responsibilities are separated (Cloudflare-first: Workers/Hono + D1 + schema-validated contracts):

- **Web control plane** (`packages/control-plane`) — accounts, machines, desired state, catalog,
  plans, jobs, history, recovery. Deployed at app.install.doctor.
- **aid runtime** (`packages/aid-core` + `home/dot_local/bin/executable_aid`) — interpretation,
  recommendations, typed contracts; routes model calls through the shared ProjectSites/OnePrompt
  inference service + Cloudflare AI Gateway (DeepSeek-first).
- **Deterministic executor** — typed install / configure / inspect / verify operations on the host.
- **Installer layer** — **chezmoi** (dotfiles + per-host templates) + **`software.yml`** (the single
  authoritative catalog) + the ZX `installx` installer. **Preserved**, not replaced.

One schema-validated **desired-state manifest** per host, updated through one revisioned write path;
the portable **`ENVIRONMENT.md`** is the authoritative human-facing contract. Observed inventory and
health are kept separate and cannot silently authorize changes.

**Secrets** stay backend-side — Infisical Cloud is authoritative for machine/app secrets, Bitwarden
for selected interactive credentials; secret values never enter Git, logs, or recordings.

## Honest status

Built + verified (live on app.install.doctor, with tests):

- ✅ Landing + onboarding, browser-first **device pairing** (admin-approved, revocable device tokens).
- ✅ **Machines / App Store / Recommendations / History** dashboard (4 of 5 nav sections).
- ✅ **Lazy CLI install** across bash / zsh / fish / PowerShell + the `aid` CLI + install telemetry.
- ✅ Per-device **freshness + drift**, rule-based recommendations, the 1,068-tool catalog.

In progress / **blocked** on external configuration (tracked honestly in `docs/aid/`):

- ⛔ **Better Auth** sign-in (GitHub / Google / magic-link) — needs OAuth apps + an email sender
  provisioned; today admin actions use an `AID_ADMIN_TOKEN` bearer, not a user session.
- ⛔ The real **AI provider call** — the routing policy + cost guard are live; the call is pending a
  CF AI Gateway + token + the shared orchestrator contract.
- ⛔ The full **Figma-approved SaaS redesign** — the current UI is an honest, functional dashboard;
  the cinematic redesign is awaiting design approval.
- ◐ Per-host **private Git repos** + **encrypted backups** (restic) — designed; not yet wired end-to-end.

## Provisioning (the installer layer)

The original provisioning system is preserved and still drives eager install + host configuration.

```bash
# interactive
bash <(curl -sSL https://install.doctor/start)

# fully unattended (prompts auto-proceed with defaults)
HEADLESS_INSTALL=true bash <(curl -sSL https://install.doctor/start)
```

Key environment variables:

| Variable | Description | Default |
|---|---|---|
| `START_REPO` (or `REPO`) | Git repo URL or GitHub `user/repo` to provision from | `heymegabyte/install.doctor` |
| `HEADLESS_INSTALL` | Skip interactive prompts, use defaults | unset |
| `SOFTWARE_GROUP` | `Basic` / `Server` / `Standard` / `Full` | `Full` |
| `SUDO_PASSWORD` | Password for automated passwordless-sudo setup | unset (30s prompt) |
| `CI` / `TEST_INSTALL` | CI mode with predefined test defaults | unset |
| `FULL_NAME` / `PRIMARY_EMAIL` | Identity for git config + tools | unset |
| `AGE_PASSWORD` | Passphrase to decrypt Age-encrypted secrets | unset |
| `DEBUG_MODE` / `KEEP_GOING` / `NO_RESTART` | Verbose / continue-on-error / no auto-reboot | unset |

Supported platforms: **macOS** (Intel + Apple Silicon), **Ubuntu/Debian**, **Fedora/RHEL/CentOS**,
**Arch**, **openSUSE**, **Alpine**; **Qubes OS** in progress; **Windows** on the roadmap. Reset a
broken chezmoi state with `rm -rf ~/.config/chezmoi ~/.cache/chezmoi` then re-run the bootstrap. See
the project CLAUDE.md for the full fleet/roles model.

## Repository layout

| Path | What |
| --- | --- |
| `packages/control-plane/` | The CF Worker (app.install.doctor) + its tests. |
| `packages/aid-core/` | Shared typed contracts (blueprint, routing, provider config). |
| `home/dot_config/shell/not-found-hook.sh` | The canonical lazy command-not-found installer. |
| `home/dot_local/bin/executable_aid` · `executable_aid-pair` | The `aid` CLI + pairing bootstrap. |
| `home/dot_local/bin/executable_cnf-build-index` | Builds the catalog index from `software.yml`. |
| `home/dot_local/bin/executable_installx` | The ZX software installer. |
| `software.yml` | The authoritative software catalog. |
| `home/.chezmoiscripts/` · `home/dot_local/bin/post-installx/` | Provisioning + first-run hooks. |
| `scripts/test-*.sh` | Test suites (control-plane, cnf hook, aid client, fish/pwsh adapters, this README). |
| `docs/aid/` | v2 continuation state: `REQUIREMENTS.md` (A01–X15 matrix), `NEXT-STEPS.md`, `CURRENT-STATE.md`, `decisions/`. |

## Development

- Control plane: `cd packages/control-plane && npx wrangler deploy` (build check: `--dry-run`).
- Tests: `bash scripts/test-control-plane.sh` (set `CONTROL_PLANE_URL=https://app.install.doctor` for
  the live gates) · `bash scripts/test-command-not-found.sh` · `bash scripts/test-aid-client.sh` ·
  `bash scripts/test-readme.sh`.
- The project ships its own improvement loop under `docs/aid/` with fire-numbered commits to `master`.

## Contributing & License

Contributions welcome via the [issues page](https://github.com/heymegabyte/install.doctor/issues).
MIT licensed — see [`LICENSE`](LICENSE). Copyright © 2020–2026
[Megabyte LLC](https://megabyte.space); maintained by Brian Zalewski.
