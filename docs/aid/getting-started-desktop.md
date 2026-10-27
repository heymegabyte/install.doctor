# Getting started — desktop (macOS / Linux with a browser)

Set up a desktop machine with Install Doctor and connect it to the control plane at
**https://app.install.doctor**. Every command below is real and shipping today; the
["Not yet available"](#not-yet-available) section at the end is the honest list of what is still coming.

## 1. Bootstrap

Run the minimal bootstrap on the machine. It installs the provisioning foundations
(chezmoi, the `software.yml` catalog, `mise`, hiSHtory), the `aid` CLI, and the
command-not-found hook — nothing that needs a GUI:

```sh
bash <(curl -sSL https://install.doctor/start)
```

Re-running it on an already-set-up machine is a no-op (idempotent).

## 2. Pair this machine with the control plane

On a desktop (a usable browser is present), pairing opens the approval page for you:

```sh
aid-pair
```

`aid-pair` prints a short **code** and a verify URL, then opens
**https://app.install.doctor/pair** in your browser. The approval page shows the machine's
identity (hostname), the tenant, and the permissions it is **requesting** before you approve.
Approve it, and `aid-pair` claims a device token exactly once and stores it at
`~/.config/aid/device-token` (mode `0600`).

## 3. Confirm the pairing and see what the token can do

```sh
aid status
```

You will see `paired ✓`, the device id and tenant, and an **`authorized for:`** line listing the
granted scope (e.g. `pull-desired-state, report-status`). The control plane enforces that scope on
every device call; if a command reports a scope gap, `aid status` tells you which permission is
missing and to re-pair to widen it.

## 4. Sync this machine to its desired state

```sh
aid up        # pull the desired ENVIRONMENT.md + reconcile (read-only, offline-safe)
```

`aid up` fetches your desired `ENVIRONMENT.md`, compares it against what is installed, prints
present/missing, and records a `check` event to History. It never installs anything on its own.

## 5. Install the desktop applications and tools

```sh
aid apply            # DRY-RUN — shows exactly what it would install, changes nothing
aid apply --yes      # actually install the missing packages via the host package manager
```

`aid apply` is dry-run by default; real installation is opt-in (`--yes` or `AID_APPLY=1`). It
detects the host package manager (brew / apt / dnf / pacman / apk) and resolves per-manager package
names from the shared catalog index.

## 6. Optional CLIs install themselves on first use

You do not pre-install every command-line tool. The command-not-found hook installs a missing CLI
the first time you run it, then runs your command — argv, stdin/stdout/stderr, exit status, and
signals all preserved. For authorized unattended installs:

```sh
aid exec <command> [args...]   # install-if-missing, then run it
aid prewarm <command> ...      # install now, do not run
aid installs                   # cold/warm install latency + cache effectiveness
```

## What runs where

- **This machine** holds its device token, runs `aid`, and performs installs locally.
- **The control plane** (app.install.doctor) stores the desired state, the catalog, device identity
  + granted scope, and History. It never pushes installs to your machine — `aid` pulls and applies.

## Not yet available

These are honestly **not wired yet** — do not expect them to work:

- **Account sign-in (Better Auth — GitHub, Google, email magic-link).** The dashboard at
  app.install.doctor is currently gated by an admin token, not a user login. Provider sign-in is planned.
- **A "describe your environment" + plan-review UI.** Desired state is edited today via the
  `ENVIRONMENT.md` contract and the control-plane API, not a visual builder.
- **Per-host private Git repository + encrypted backups.** Designed, not built.
- **Server-pushed installs.** The control plane's device apply endpoint returns `501` on purpose —
  real mutation happens on the machine through `aid apply`, not from the server.
- **The full SaaS dashboard redesign.** Pending design approval; the current pages (Machines, App
  Store, Recommendations, History) are the honest interim surfaces.

## See also

- Headless / server hosts: [getting-started-headless.md](./getting-started-headless.md)
- The product + live-vs-blocked status: the repo `README.md`
- Requirement matrix + resume pointer: `REQUIREMENTS.md`, `NEXT-STEPS.md`
