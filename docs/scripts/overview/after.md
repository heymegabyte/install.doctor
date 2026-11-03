---
title: After Scripts Overview
description: Read about how Install Doctor incorporates shell scripting languages into the provisioning process by running scripts after the configuration files have been applied. Learn about our integration of Bash and PowerShell.
sidebar_label: After Scripts
slug: /scripts/after
---

After Scripts run once Chezmoi has finished applying dotfiles and configuration files to the system. They handle the bulk of the provisioning work: installing software packages, applying system-level configuration files, configuring services, and cleaning up. All After Scripts are located in `home/.chezmoiscripts/universal/` and use the `run_after_` prefix.

## Script Inventory

| Order | Filename | Purpose |
|---|---|---|
| 01 | `run_after_01-pre-install.sh.tmpl` | Early bootstrapping: runs scripts that can safely execute before the main software installation (e.g., GPG key import, SSH key setup) |
| 10 | `run_after_10-install.sh.tmpl` | **Main software installation**: invokes the ZX-based installer to install all packages for the selected `SOFTWARE_GROUP`. This is the longest-running script |
| 15 | `run_after_15-chezmoi-system.sh.tmpl` | Copies system-level config files from `~/.config/system/` to their target locations on the filesystem (e.g., `/etc/`, `/usr/local/etc/`) |
| 20 | `run_after_20-post-install.sh.tmpl` | Post-install tasks: configures installed services (Cloudflare WARP, Netdata, Docker, etc.), sets up integrations, applies macOS `defaults write` settings |
| 24 | `run_after_24-cleanup.sh.tmpl` | Removes temporary files, cleans up dotfiles clutter from the home directory, final housekeeping |

## Execution Order

Scripts run synchronously in filename order. The numbering gaps (01, 10, 15, 20, 24) leave room for adding custom scripts:

```
[Chezmoi applies dotfiles]          → Dotfiles deployed to home directory
run_after_01-pre-install.sh         → Early bootstrapping (GPG, SSH)
run_after_10-install.sh             → Main software installation (longest step)
run_after_15-chezmoi-system.sh      → System config file deployment
run_after_20-post-install.sh        → Service configuration and integrations
run_after_24-cleanup.sh             → Cleanup and final housekeeping
```

## Adding Custom After Scripts

To add your own script that runs between existing steps, create a file with a number between the existing scripts:

```bash
# Example: run_after_12-my-custom-setup.sh.tmpl
# This runs after software installation (10) but before system files (15)
{{- if ne .host.distro.family "windows" -}}
{{ includeTemplate "universal/profile" }}
{{ includeTemplate "universal/logg" }}

gum log -sl info 'Running custom setup...'
# Your custom logic here

{{ end -}}
```

## Provision Completion

After all After Scripts have executed, the Chezmoi-based provisioning process is finished. If you launched via `bash <(curl -sSL https://install.doctor/start)`, the `provision.sh` wrapper performs additional cleanup, prints log file locations, and may trigger a reboot.

## Links

* [`universal/` scripts folder](https://github.com/heymegabyte/install.doctor/tree/master/home/.chezmoiscripts/universal)
* [Chezmoi scripting documentation](https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/)
