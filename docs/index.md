---
title: Desktop Tools Documentation
description: Desktop Tools is a profile-driven, signed provisioning system for securely configuring enrolled workstations and servers.
slug: /
sidebar_label: Overview
---

Desktop Tools is the successor to Install Doctor. It resolves a selected profile into a signed, reviewable provisioning plan and preserves existing systems unless an exact approved task owns a reversible change. Chezmoi, `software.yml`, and the legacy Install Doctor entrypoints remain compatibility foundations during the migration.

## Quick Start

The intended profile launch form is `curl -fsSL https://example.desktop.tools | bash`, where
`example` selects one immutable profile revision. It is **not yet a production installation command**:
the public Desktop Tools release channel and full-lifecycle platform promotion have not been activated.
Do not substitute the retired `app.install.doctor` compatibility hostname or an unverified source checkout.

Native Windows, WSL, Qubes, and every other unsupported matrix cell remain unpublished.

## Platform Support

The authoritative source is [`scripts/platform-support-matrix.json`](https://github.com/heymegabyte/install.doctor/blob/master/scripts/platform-support-matrix.json), summarized in [Platform support and limitations](/docs/aid/platform-support).
The committed matrix currently contains **no verified full-lifecycle platform cells**.

| Platform group | Current admission | Important limitation |
|---|---|---|
| Named macOS 14/15/26 x64 and ARM64 native cells | Best effort, explicit consent required | No current clean-host full-lifecycle promotion receipt |
| Ubuntu 22.04/24.04 x64 containers | Best effort, explicit consent required | Workflow evidence is not a durable full-lifecycle canary receipt |
| Debian 12 x64 container/native | Best effort, explicit consent required | PID1/native-package evidence does not prove the complete host lifecycle |
| Fedora 44 and Arch rolling x64 containers | Best effort, explicit consent required | No current full-lifecycle promotion receipt; rolling Arch may drift |
| Debian ARM64, Alpine, generic Linux and Silverblue | Unsupported | Missing architecture/libc/package-manager-specific signed runtime or lifecycle evidence |
| Qubes, Proxmox, Coolify, WSL2 and native Windows | Unsupported | Missing safe role-specific and real-host lifecycle evidence |

## What Does Install Doctor Do?

Install Doctor makes it as easy as possible to:

1. **Define your devices as code** - Software lists, configurations, and secrets stored in version-controlled YAML
2. **Provision with a one-liner** - A single command installs everything, configures settings, and integrates cloud services
3. **Add software with minimal effort** - Adding a package is as simple as adding a YAML entry with package manager names
4. **Re-use configurations across OSes** - The same dotfiles and settings work on macOS, Ubuntu, Fedora, and more

## Provisioning Flow

The provisioning process follows this sequence:

| Step | Component | Description |
|---|---|---|
| 1 | `start.sh` | Bootstrap script: installs Task runner and basic dependencies |
| 2 | `provision.sh` | Main orchestrator: installs Homebrew, system dependencies, initializes Chezmoi |
| 3 | `run_before_*` scripts | Pre-apply: decrypts Age keys, installs system packages, configures Homebrew |
| 4 | Chezmoi apply | Renders and deploys all dotfiles, configs, and templates to the home directory |
| 5 | `run_after_*` scripts | Post-apply: installs software packages, configures services, sets up integrations |
| 6 | Cleanup | Logs results, optionally reboots the system |

## Multi-OS Provisioning

Install Doctor includes its own [ZX-based installer](/docs/features/installer) that resolves the correct installation method for each package on each platform. For example, a single `imagemagick` entry in `software.yml` can specify:

```yaml
imagemagick:
  brew: imagemagick       # macOS and Linux via Homebrew
  apt: imagemagick        # Debian/Ubuntu
  dnf: ImageMagick        # Fedora/CentOS
  pacman: imagemagick     # Arch Linux
  choco: imagemagick      # Windows
```

The installer consults a configurable `installerPreference` ordering to decide which method to use on each platform, falling back through alternatives if the preferred method is unavailable.

## Pre-Configured Dotfiles

Install Doctor ships with a curated, opinionated set of dotfiles that integrate hundreds of tools into a cohesive environment:

| Category | What's Configured | Key Tools |
|---|---|---|
| Shell | Bash and ZSH with frameworks, auto-completions, themes | Oh-My-ZSH, Powerlevel10k, Bash-It |
| Editor | Keybindings, themes, plugin lists, linter integration | VS Code, Neovim (NvChad), VIM |
| Git | User identity, delta diff viewer, aliases, GPG signing | delta, bat, git-extras |
| Terminal | Profiles, fonts, themes, consistent styling | iTerm2, GNOME Terminal, Tabby, Alacritty |
| Navigation | Smart directory jumping, fuzzy finding, colored output | zoxide, fzf, LS_COLORS |
| XDG Compliance | Clean home directory following the XDG Base Directory spec | All config in `~/.config/`, data in `~/.local/` |

## Automated Feature Integration

Many tools require post-install configuration to be useful. Install Doctor handles this automatically when the appropriate API keys or tokens are provided:

| Integration | What It Does | Required Variable |
|---|---|---|
| Cloudflare WARP / Tunnel | Explicit, consented device or service enrollment | Control-plane enrollment |
| [CloudFlare](/docs/integrations/cloudflare) | Sets up tunnels, WARP, DNS, and SSO-protected services | `CLOUDFLARE_*` variables |
| [Netdata](/docs/integrations/netdata) | Enrolls device in cloud monitoring dashboard | `NETDATA_TOKEN`, `NETDATA_ROOM` |
| Docker Hub | Authenticates Docker with your registry account | `DOCKERHUB_USER`, `DOCKERHUB_TOKEN` |
| GPG | Imports and trusts your GPG key from keyservers | `KEYID` |

Infisical is preferred for online operational secrets and must issue only the minimum values required by each workload. Local encrypted material is reserved for explicitly documented offline recovery paths; secrets must not be stored directly in a fork. See the [Secrets documentation](/docs/customization/secrets) for details.

Read about all the [features that Install Doctor provides](/features).
