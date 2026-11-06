---
title: Getting Started
description: Find out how to get started with Install Doctor by running a one-liner that will transform your device into the ultimate productivity machine.
sidebar_label: Getting Started
slug: /getting-started
---

Install Doctor is designed to be incredibly easy to use. It can provision your entire operating system with a one-liner. It supports the latest x64 releases of Archlinux, CentOS, Debian, Fedora, macOS, Qubes, and Windows. It can also be adapted to run on other operating systems (pull requests encouraged).

On macOS/Linux, the only requirements are that `bash` and `curl` are installed.

## Run Install Doctor

### macOS/Linux

```shell
curl -fsSL https://app.install.doctor/start | bash
```

### Headless / Non-Interactive Mode

All prompts have 30-second timeouts and auto-proceed with sensible defaults. For fully unattended installs:

```shell
curl -fsSL https://app.install.doctor/start | HEADLESS_INSTALL=true INSTALL_DOCTOR_CONSENT_PRIVILEGED=true bash

The first unattended pass performs discovery and planning without applying changes. Review the protected plan path it prints, then rerun the same command with `INSTALL_DOCTOR_APPROVED_PLAN_DIGEST=<printed-sha256>`. Any changed selection or host fact produces a different digest and requires fresh approval.
```

For complete control over headless installations:

```shell
HEADLESS_INSTALL=true \
  INSTALL_DOCTOR_CONSENT_PRIVILEGED=true \
  INSTALL_DOCTOR_APPROVED_PLAN_DIGEST=<reviewed-sha256> \
  SOFTWARE_GROUP=Full \
  SUDO_PASSWORD=your_password \
  FULL_NAME="Your Name" \
  PRIMARY_EMAIL="you@example.com" \
  curl -fsSL https://app.install.doctor/start | bash
```

### Windows

On Windows, you can run the following from an administrator PowerShell terminal:

```powershell
# Native Windows installer is not published until its signed release path is verified.
```

### Qubes

The following one-liner should be run from Qubes dom0:

```shell
# Qubes entrypoint is not published until its signed delivery and dom0/AppVM matrix are verified.
```

## Guided Terminal Prompts

The one-liner installation methods above will interactively prompt for a few details if they are not provided via environment variables or as Chezmoi-housed secrets (see the [Integrating Secrets](/docs/customization/secrets) page for more details). These prompts will ask you for information like:

* The type of installation (i.e. a minimal set of software or all the software Install Doctor supports - see the [Customization Overview](/docs/customization) for more details)
* Your name / e-mail address (to pre-populate things like the Git configuration)

All prompts include timeouts (typically 30 seconds) and will auto-proceed with default values if no input is provided. This ensures the installation process never hangs, even when running unattended.

## Environment Variables

You can customize the provisioning process by setting environment variables before running the script:

| Variable | Description | Default |
|---|---|---|
| `START_REPO` | Git repo URL or GitHub `user/repo` shorthand | `heymegabyte/install.doctor` |
| `HEADLESS_INSTALL` | Skip all interactive prompts | unset |
| `SOFTWARE_GROUP` | Software group: `Basic`, `Server`, `Standard`, `Full` | `Full` |
| `SUDO_PASSWORD` | Sudo password for automated setup | unset |
| `CI` or `TEST_INSTALL` | Enable CI mode with test defaults | unset |
| `NO_RESTART` | Prevent automatic reboots | unset |
| `AGE_PASSWORD` | Passphrase for Age-encrypted secrets | unset |
| `DEBUG_MODE` | Enable verbose logging | unset |

See the full [Environment Variables](/docs/cli/variables) documentation for more details.

## Software Groups

The `SOFTWARE_GROUP` variable determines which set of packages to install:

| Group | Package Count | Description | Use Case |
|---|---|---|---|
| `Minimal` | ~50 | Core CLI tools, shell configuration, basic utilities | Servers, containers, minimal setups |
| `Standard` | ~200 | Minimal + development tools, editors, common GUI apps | Development workstations |
| `Full` | ~500+ | Standard + specialized tools, extra integrations, all GUI apps | Full-featured power-user setups |

You can browse and customize software groups by editing `home/.chezmoidata.yaml` in your fork. See [Software Customization](/docs/customization/software) for details.

## What Happens During Provisioning

Here's a high-level overview of each provisioning step:

```
┌─────────────────────────────────────────────────────────┐
│ 1. start.sh                                             │
│    ├── Installs Task runner                             │
│    ├── Installs basic dependencies (git, curl)          │
│    └── Runs provision.sh                                │
├─────────────────────────────────────────────────────────┤
│ 2. provision.sh                                         │
│    ├── Prompts for user info (or reads env vars)        │
│    ├── Installs Homebrew                                │
│    ├── Installs Chezmoi                                 │
│    └── Runs chezmoi init && chezmoi apply               │
├─────────────────────────────────────────────────────────┤
│ 3. Before Scripts (run_before_01 → run_before_05)       │
│    ├── Decrypts Age secrets                             │
│    ├── Installs system dependencies                     │
│    └── Applies system tweaks (hostname, timezone)       │
├─────────────────────────────────────────────────────────┤
│ 4. Chezmoi Apply                                        │
│    └── Deploys all dotfiles and config templates        │
├─────────────────────────────────────────────────────────┤
│ 5. After Scripts (run_after_01 → run_after_24)          │
│    ├── Installs all software packages                   │
│    ├── Configures explicitly selected services         │
│    ├── Applies macOS defaults / Linux dconf settings    │
│    └── Cleans up temporary files                        │
└─────────────────────────────────────────────────────────┘
```
