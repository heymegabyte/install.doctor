# Getting started — headless (server / VM / runner, no GUI)

Set up a machine with no desktop — a server, Proxmox/Coolify host, cloud VM, container, or CI runner
— and pair it from a browser on a *different* device. This page documents the retired `aid` and
`app.install.doctor` compatibility flow. It is not the production Desktop Tools profile bootstrap,
and its commands must not be used as evidence that a platform support cell is verified. Start with
the [Desktop Tools product boundary](../desktop-tools/README.md) for current status.

## 1. Bootstrap headless

Set `HEADLESS_INSTALL=1` so every interactive prompt (GUI dialogs, Terminal automation, FDA panes)
skips gracefully. The bootstrap installs the provisioning foundations (chezmoi, `software.yml`,
`mise`, hiSHtory), the `aid` CLI, and the command-not-found hook:

```sh
curl -fsSL https://app.install.doctor/start | HEADLESS_INSTALL=1 bash
```

Repository fixtures cover selected unchanged-reapply behavior. Do not claim a particular host is
idempotently provisioned until its exact release and platform lifecycle receipt proves that result.

## 2. Pair from another browser

A headless host has no browser, so `aid-pair` does **not** open one — it prints the code + URL for
you to open elsewhere:

```sh
aid-pair
```

It prints a short **code** and the verify URL. On your laptop/phone, open
**https://app.install.doctor/pair**, enter the code, and review the machine's identity + requested
permissions before approving. `aid-pair` polls, claims a device token exactly once, and stores it at
`~/.config/aid/device-token` (mode `0600`). Pairing is explicit approve/deny — visiting a URL alone
never authorizes a host.

## 3. Confirm the pairing and the granted scope

```sh
aid status
```

Shows `paired ✓`, the device id and tenant, and an **`authorized for:`** line with the granted scope.
The control plane enforces that scope on every device call; a scope gap is reported with the exact
missing permission so you know to re-pair to widen it.

## 4. Sync this host to its desired state

```sh
aid up        # pull desired ENVIRONMENT.md + reconcile (read-only, offline-safe)
```

`aid up` fetches the desired `ENVIRONMENT.md`, reconciles against what is installed, and records a
`check` event to History. It never installs on its own.

## 5. Install, non-interactively

```sh
aid apply            # DRY-RUN — prints the plan, changes nothing
aid apply --yes      # install the missing packages (or set AID_APPLY=1)
```

`aid apply` is headless-safe and non-interactive; real installation is opt-in. On a server you will
usually run it under automation, so it never blocks on a prompt.

## 6. Lazy installs under automation / CI

Unattended install-on-first-use is **off** unless explicitly allowed, so an untrusted project or a CI
job cannot silently trigger an install. Optional CLIs, TUIs, and language servers remain lazy; only
bootstrap-critical tools and lazy-installer substrates are installed up front:

- `CNF_ALLOW_NONINTERACTIVE=1` — allow install-on-miss in a non-interactive shell you control.
- `CNF_DRY=1` — resolve + report only, never install.
- `aid exec <command>` / `aid prewarm <command> ...` — the authorized path to install a tool in an
  unattended context; `aid installs` summarizes install latency + cache effectiveness.

## What runs where

- **This host** holds its device token, runs `aid`, performs installs locally, and records History.
- **The control plane** (app.install.doctor) stores desired state, catalog, device identity + scope,
  and History — it never pushes installs; `aid` pulls and applies.

## Not yet available

Honestly **not wired yet** — do not expect these to work on a headless host:

- **Account sign-in (Better Auth — GitHub, Google, email magic-link).** The dashboard is gated by an
  admin token today, not a user login. Planned.
- **Native Windows PowerShell bootstrap entrypoint — experimental.** The `install.doctor/start` one-liner
  is for Unix shells; `provision.ps1` exists in source but no native public endpoint is published. Its RUNTIME on a real Windows host is not yet verified (no
  Windows CI) — WSL is also unsupported pending a Windows-hosted WSL2 lifecycle canary. (fish and PowerShell command-not-found adapters exist in the repo
  but are not yet verified on a live fish/pwsh host.)
- **Per-host private Git repository + encrypted backups.** Designed, not built.
- **Server-pushed installs + real job transport.** The device apply endpoint returns `501` on
  purpose; durable job delivery/leases are still to come.
- **The full SaaS dashboard redesign.** Pending design approval.

## See also

- Desktop hosts: [getting-started-desktop.md](./getting-started-desktop.md)
- Headless provisioning constraints: the project `CLAUDE.md` (§3 Hard constraints)
- Requirement matrix + resume pointer: `REQUIREMENTS.md`, `NEXT-STEPS.md`
