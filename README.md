<div align="center">
  <a href="https://desktop.tools">
    <img width="320" alt="Desktop Tools" src="https://raw.githubusercontent.com/heymegabyte/install.doctor/master/docs/logo-full.png" />
  </a>
  <h1>Desktop Tools</h1>
  <p><strong>One command brings up any computer — and keeps it that way.</strong></p>
  <p>Set up and maintain desktops, laptops, servers, and headless boxes from one place:
  <a href="https://desktop.tools">desktop.tools</a>.</p>
</div>

---

> **Status:** Desktop Tools is evolving from the Install Doctor chezmoi-and-shell provisioner into a
> **configurable system for setting up and maintaining computers**. The provisioning machinery
> (chezmoi + `software.yml` + the ZX `installx` installer) is preserved; a Cloudflare-native control
> plane and the canonical `desktop-tools` client layer configuration, a browser dashboard, lazy CLI installation, per-host
> recovery, and bounded improvement cycles on top. This README describes what actually ships today —
> see **[Honest status](#honest-status)** for what is live vs. still in progress.

## What it is

Describe the environment you want once; make each authorized machine a verified, cooperating part of
it. Selected **desktop applications** install now; optional **command-line tools install the first
time you run them**. Every host stays reconciled to its desired state, observable, and recoverable.

The intended browser-first product lives at **[desktop.tools](https://desktop.tools)**. The
OpenCode-derived `desktop-tools` supervisor is still pre-production; deterministic provisioning
and recovery must remain usable without a desktop, GUI, or paid inference. See the generated
[capability status](docs/desktop-tools/status.md) for evidence-backed truth.

## Quick start

On macOS or Linux, run the minimal bootstrap, then pair the machine from any browser:

```bash
curl -fsSL https://example.desktop.tools | bash
```

- **Desktop (with a browser):** `desktop-tools-pair` will open the approval page automatically.
- **Headless / server:** `desktop-tools-pair` prints a short code + URL you approve from any other browser —
  no GUI required. Approval is an explicit, authenticated action (visiting the URL does **not**
  approve the device); the approver sees the machine's identity before granting.

> A native **Windows PowerShell** bootstrap entrypoint is not shipped yet (the lazy
> command-not-found installer already has a PowerShell adapter — see below).

## Product boundary

Desktop Tools is the only product. Install Doctor remains the repository name and historical
provisioning lineage; `aid`, `aid-pair`, `app.install.doctor`, and old state paths are bounded
compatibility surfaces. Read [the operating boundary](docs/desktop-tools/README.md) before changing
naming, hosted routing, state ownership, or migration behavior.

## Legacy control-plane implementation

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

## The `desktop-tools` CLI

`desktop-tools` is the canonical machine-side client. It reads the device token stored by
`desktop-tools-pair` and talks to the
control plane as **that device** (headless-safe, dependency-light):

| Command | What it does |
| --- | --- |
| `desktop-tools-pair` | Pair this machine (print code → approve in browser → claim a revocable device token). |
| `desktop-tools status` | Pairing + desired-state summary (tenant / revision / digest). |
| `desktop-tools pull` | Fetch this device's desired `ENVIRONMENT.md`. |
| `desktop-tools plan` | Reconcile desired vs installed, **offline/local** (present / missing / to-install). |
| `desktop-tools apply` | Install missing packages; dry-run by default and mutation requires explicit consent. |
| `desktop-tools up` | One command: `pull` + `plan` (read-only; records a History event). |
| `desktop-tools exec <cmd>` | Run a command, installing it first if missing (authorized install-on-demand). |
| `desktop-tools prewarm <cmd…>` | Install tools now without running them. |
| `desktop-tools installs` | Summarize lazy-install telemetry. |
| `desktop-tools migrate --preview` | Report legacy state mappings without copying, moving, or deleting data. |

## Eager vs. lazy install

Desktop Tools installs **two ways**, on purpose:

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
  records per-install telemetry (`desktop-tools installs`). Mise-managed runtimes are deferred to mise, not
  duplicated.

## Architecture

Responsibilities are separated (Cloudflare-first: Workers/Hono + D1 + schema-validated contracts):

- **Desktop Tools control plane** (`packages/control-plane`) — accounts, machines, desired state,
  catalog, plans, jobs, history, and recovery. The current legacy deployment at
  `app.install.doctor` remains a compatibility implementation; production `desktop.tools` routing
  is not yet activated.
- **Desktop Tools core and client** (`packages/aid-core` + `home/dot_local/bin/executable_desktop-tools`) — interpretation,
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

Implemented in the legacy compatibility control plane and covered by local tests; this is not
evidence that the Desktop Tools production profile flow is live:

- ✅ Landing + onboarding, browser-first **device pairing** (admin-approved, revocable device tokens).
- ✅ **Machines / App Store / Recommendations / History** dashboard (4 of 5 nav sections).
- ✅ **Lazy CLI install** across bash / zsh / fish / PowerShell + the `desktop-tools` CLI + install telemetry.
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

The intended Desktop Tools bootstrap is shown below. It remains gated until the signed release,
profile routing, device authorization, and canary tasks in the generated status are verified.

```bash
# interactive
curl -fsSL https://example.desktop.tools | bash

# fully unattended (privileged work requires explicit consent)
# First pass validates and persists the normalized plan, then prints its digest.
curl -fsSL https://example.desktop.tools | HEADLESS_INSTALL=true INSTALL_DOCTOR_CONSENT_PRIVILEGED=true bash

# After reviewing the persisted plan, approve that exact digest (never a moving "latest" plan).
curl -fsSL https://example.desktop.tools | HEADLESS_INSTALL=true INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_APPROVED_PLAN_DIGEST=<sha256> bash
```

Key environment variables in the existing installer compatibility layer (canonical
`DESKTOP_TOOLS_*` replacements land through explicit migrations rather than undocumented aliases):

| Variable | Description | Default |
|---|---|---|
| `START_REPO` (or `REPO`) | Git repo URL or GitHub `user/repo` to provision from | `heymegabyte/install.doctor` |
| `HEADLESS_INSTALL` | Skip interactive prompts, use defaults | unset |
| `INSTALL_DOCTOR_CONSENT_PRIVILEGED` | Explicitly approve reviewed privileged plan nodes | `false` |
| `SOFTWARE_GROUP` | `Basic` / `Server` / `Standard` / `Full` | `Full` |
| `SUDO_PASSWORD` | Password for automated passwordless-sudo setup | unset (30s prompt) |
| `CI` / `TEST_INSTALL` | CI mode with predefined test defaults | unset |
| `FULL_NAME` / `PRIMARY_EMAIL` | Identity for git config + tools | unset |
| `AGE_PASSWORD` | Passphrase to decrypt Age-encrypted secrets | unset |
| `DEBUG_MODE` / `KEEP_GOING` / `NO_RESTART` | Verbose / continue-on-error / no auto-reboot | unset |

Implemented or best-effort targets include **macOS** (Intel + Apple Silicon), **Ubuntu/Debian**,
**Fedora/RHEL/CentOS**, **Arch**, **openSUSE**, and **Alpine**. Do not infer verified support from
that list: the machine-readable [platform evidence matrix](scripts/platform-support-matrix.json)
is authoritative, and currently contains no verified full-lifecycle cell. Qubes, Silverblue,
Proxmox, Coolify, WSL, and native Windows remain explicit unsupported cells until their required
canary evidence exists. Reset a
broken chezmoi state with `rm -rf ~/.config/chezmoi ~/.cache/chezmoi` then re-run the bootstrap. See
the project CLAUDE.md for the full fleet/roles model.

## Repository layout

| Path | What |
| --- | --- |
| `packages/control-plane/` | Desktop Tools CF Worker foundation and compatibility routes. |
| `packages/aid-core/` | Desktop Tools shared typed contracts. |
| `home/dot_config/shell/not-found-hook.sh` | The canonical lazy command-not-found installer. |
| `home/dot_local/bin/executable_desktop-tools` · `executable_desktop-tools-pair` | Canonical Desktop Tools client and pairing bootstrap. |
| `home/dot_local/bin/executable_aid` · `executable_aid-pair` | Deprecated behavior-free compatibility aliases. |
| `home/dot_local/bin/executable_cnf-build-index` | Builds the catalog index from `software.yml`. |
| `home/dot_local/bin/executable_installx` | The ZX software installer. |
| `software.yml` | The authoritative software catalog. |
| `home/.chezmoiscripts/` · `home/dot_local/bin/post-installx/` | Provisioning + first-run hooks. |
| `scripts/test-*.sh` | Test suites for the control plane, clients, installer, platform contracts, and docs. |
| `docs/desktop-tools/` | Current product boundary and generated capability status. |
| `docs/aid/` | Historical implementation research and compatibility-era ledgers. |

## Development

- Control plane: `cd packages/control-plane && npm ci && npm run deploy --` (build check: `npm run check`).
- Tests: `bash scripts/test-control-plane.sh` (an explicit compatibility endpoint may be supplied
  for legacy live gates) · `bash scripts/test-command-not-found.sh` · `bash scripts/test-aid-client.sh` ·
  `bash scripts/test-readme.sh`.
- Historical bounded-loop evidence remains under `docs/aid/`; current product truth lives under
  `docs/desktop-tools/` and the active OpenSpec change.

## Contributing & License

Contributions welcome via the [issues page](https://github.com/heymegabyte/install.doctor/issues).
MIT licensed — see [`LICENSE`](LICENSE). Copyright © 2020–2026
[Megabyte LLC](https://megabyte.space); maintained by Brian Zalewski.
