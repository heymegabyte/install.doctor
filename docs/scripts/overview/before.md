---
title: Before Scripts Overview
description: Read about how Install Doctor incorporates shell scripting languages into the provisioning process by running scripts before the Chezmoi file provisioning process.
sidebar_label: Before Scripts
slug: /scripts/before
---

Before Scripts run prior to Chezmoi applying dotfiles and configuration files. They prepare the system by installing core dependencies, decrypting secrets, and applying system-level tweaks. All Before Scripts are located in `home/.chezmoiscripts/universal/` and use the `run_before_` prefix.

## Script Inventory

| Order | Filename | Purpose |
|---|---|---|
| 01 | `run_before_01-prepare.sh.tmpl` | Pre-provisioning preparation: disconnects WARP, checks Full Disk Access on macOS, creates secret symlinks, sources temporary includes |
| 02 | `run_before_02-homebrew.sh.tmpl` | Installs Xcode Command Line Tools (macOS) and Homebrew (macOS/Linux). Configures Homebrew environment variables and PATH |
| 03 | `run_before_03-decrypt-age-key.sh.tmpl` | Installs [Age](https://github.com/FiloSottile/age) encryption tool and decrypts `home/key.txt.age` so Chezmoi can access encrypted templates |
| 04 | `run_before_04-requirements.sh.tmpl` | Installs system packages required as dependencies by other software. Package lists are defined per-distro in `home/.chezmoitemplates/` |
| 05 | `run_before_05-system.sh.tmpl` | Applies system tweaks: sets hostname, configures timezone, creates user/group, sets file permissions on `~/.gnupg` |

## Execution Order

Scripts run synchronously in filename order. The two-digit number after `run_before_` controls the sequence:

```
run_before_01-prepare.sh        → System preparation
run_before_02-homebrew.sh       → Package manager setup
run_before_03-decrypt-age-key.sh → Secret decryption
run_before_04-requirements.sh   → System dependencies
run_before_05-system.sh         → System configuration
[Chezmoi applies dotfiles]      → Dotfiles deployed to home directory
```

## Template Structure

Each Before Script follows a common structure:

```bash
#!/usr/bin/env bash
# @file Script Title
# @brief One-line description
# @description
#     Detailed multi-line description...

{{- if ne .host.distro.family "windows" -}}     # Skip on Windows
{{ includeTemplate "universal/profile" }}         # Load PATH and environment
{{ includeTemplate "universal/logg" }}            # Load logging functions

# Script logic here...
{{ end -}}
```

Key elements:
- **`{{ if ne .host.distro.family "windows" }}`** - Skips the script on Windows (PowerShell is used instead)
- **`{{ includeTemplate "universal/profile" }}`** - Sources PATH configuration from `home/.chezmoitemplates/universal/profile`
- **`{{ includeTemplate "universal/logg" }}`** - Sources the `gum log` logging wrapper

## Links

* [`universal/` scripts folder](https://github.com/heymegabyte/install.doctor/tree/master/home/.chezmoiscripts/universal)
* [Chezmoi scripting documentation](https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/)
