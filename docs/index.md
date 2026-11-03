---
title: Install Doctor Documentation
description: Immerse yourself with everything you need to know about Install Doctor, the easy, customizable multi-OS provisioning framework that can setup workstations and servers with a simple one-liner.
slug: /
sidebar_label: Overview
---

Install Doctor is a cross-platform desktop provisioning system that transforms a fresh operating system into a fully-configured development workstation with a single command. Built on [Chezmoi](https://www.chezmoi.io/) and [Homebrew](https://brew.sh/), it manages software installation, dotfile configuration, secret management, and cloud service integration across 8+ operating systems.

## Quick Start

```bash
# macOS / Linux
bash <(curl -sSL https://install.doctor/start)

# Headless (no prompts)
HEADLESS_INSTALL=true SOFTWARE_GROUP=Standard bash <(curl -sSL https://install.doctor/start)

# Windows (PowerShell as Administrator)
iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))

# Qubes (from dom0)
qvm-run --pass-io sys-firewall "curl -sSL https://install.doctor/qubes" > ~/setup.sh && bash ~/setup.sh
```

## Platform Support

| Operating System | Architecture | Package Manager | Status |
|---|---|---|---|
| macOS (Ventura+) | x86_64, ARM64 | Homebrew, mas | Fully supported |
| Ubuntu (20.04+) | x86_64 | apt, Homebrew, Snap, Flatpak | Fully supported |
| Debian (11+) | x86_64 | apt, Homebrew, Snap, Flatpak | Fully supported |
| Fedora (36+) | x86_64 | dnf, Homebrew, Flatpak | Fully supported |
| Arch Linux | x86_64 | pacman, yay, Homebrew | Fully supported |
| CentOS Stream (8+) | x86_64 | dnf, Homebrew | Supported |
| Windows 11 | x86_64 | Chocolatey, Scoop, winget | Beta |
| Qubes OS | x86_64 | dom0 + template VMs | Beta |

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

Install Doctor includes its own [ZX-based installer](/docs/advanced/installer) that resolves the correct installation method for each package on each platform. For example, a single `imagemagick` entry in `software.yml` can specify:

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

Credentials can be passed as environment variables or encrypted with [Age](https://github.com/FiloSottile/age) and stored directly in your fork. See the [Secrets documentation](/docs/customization/secrets) for details.

Read about all the [features that Install Doctor provides](/features).
