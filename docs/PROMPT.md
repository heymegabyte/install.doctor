---
title: Shell Script Guidelines
description: Guidelines and best practices for writing and maintaining shell scripts in the Install Doctor project.
sidebar_label: Shell Script Guidelines
slug: /prompt
---

# Shell Script Guidelines

This document describes the coding conventions and best practices used throughout the Install Doctor shell scripts.

## Variable Naming

| Pattern | Convention | Example |
|---|---|---|
| Environment variables / constants | UPPERCASE with underscores | `SUDO_PASSWORD`, `SOFTWARE_GROUP` |
| Local variables | lowercase or camelCase | `exitCode`, `tmpDir` |
| Exported variables | UPPERCASE, exported with `export` | `export PATH="..."` |
| Loop variables | UPPERCASE (matching convention) | `for PACKAGE in $PACKAGES` |

> **Critical:** Use `$HOME` not `~` in variable assignments. Tilde does not expand inside quotes.

## Error Handling

| Pattern | When to Use | Example |
|---|---|---|
| `set -eo pipefail` | Top of every script | Catch errors early |
| `\|\| EXIT_CODE=$?` | When failure should not terminate | `command \|\| EXIT_CODE=$?` |
| `\|\| true` | Commands that may legitimately fail | `pkill process \|\| true` |
| `timeout 30` | Commands that might hang | `timeout 30 curl -sSL "$URL"` |

## Non-Interactive Execution

All scripts must support fully automated, headless execution. Every interactive prompt **must** have a timeout (default: 30 seconds) or respect `HEADLESS_INSTALL`:

| Package Manager | Non-Interactive Flag | Example |
|---|---|---|
| apt-get | `-y` | `sudo apt-get install -y curl` |
| dnf / yum | `-y` | `sudo dnf install -y curl` |
| pacman | `--noconfirm` | `sudo pacman -S --noconfirm curl` |
| zypper | `-y` | `sudo zypper install -y curl` |
| makepkg | `--noconfirm` | `makepkg -si --noconfirm` |
| Homebrew | managed bootstrap | Use Install Doctor's commit-pinned, SHA-256-verified Homebrew task |
| snap | (non-interactive by default) | `sudo snap install package` |

```bash
# Example: Prompt with timeout and HEADLESS_INSTALL support
if [ "$HEADLESS_INSTALL" != 'true' ]; then
  read -t 30 -p "Continue? [Y/n] " REPLY || REPLY="Y"
else
  REPLY="Y"
fi
```

## Logging

There are two logging systems. Use the correct one depending on the script context:

| Context | Function | Example |
|---|---|---|
| `start.sh`, `provision.sh` | `logg` | `logg info "Installing Homebrew"` |
| Chezmoi scripts (`run_before_*`, `run_after_*`) | `gum log -sl` | `gum log -sl info "Installing Homebrew"` |

Available log levels:

```bash
logg info "Informational message"       # or: gum log -sl info "..."
logg warn "Warning message"             # or: gum log -sl warn "..."
logg error "Error message"              # or: gum log -sl error "..."
logg success "Success message"
logg star "Highlighted message"
logg md "file.md"                       # Render markdown
```

The `se_*` helpers belong exclusively to `prompt/source.sh` and the prompt-authoring shell. They are separate from provisioning logging: provisioning scripts use `logg` or `gum log`; do not import `se_*` into bootstrap, Chezmoi, installx, or post-install execution.

## Platform Detection

Use standard detection patterns:

```bash
# macOS
if [ -d /Applications ] && [ -d /System ]; then

# Linux distribution detection
if [ -f /etc/debian_version ]; then      # Debian/Ubuntu
if [ -f /etc/redhat-release ]; then      # RHEL/CentOS/Fedora
if [ -f /etc/arch-release ]; then        # Arch Linux
if [ -f /etc/alpine-release ]; then      # Alpine

# Package manager detection (fallback)
if command -v apt-get > /dev/null; then
if command -v dnf > /dev/null; then
if command -v pacman > /dev/null; then
```

## POSIX Compliance

| Do | Don't | Why |
|---|---|---|
| `[ $? -ne 0 ]` | `[ $? != 0 ]` | `-ne` is the POSIX numeric comparison |
| `command -v binary` | `which binary` | `which` is not POSIX; `command -v` is portable |
| `$HOME` | `~` in quotes | Tilde does not expand inside double quotes |
| `eval "$(...)"` | `eval "(...)"` | Command substitution requires `$()` |

## Documentation

| Tag | Purpose | Example |
|---|---|---|
| `# @file` | File title | `# @file Homebrew Installation` |
| `# @brief` | One-line summary | `# @brief Installs Homebrew on macOS and Linux` |
| `# @description` | Multi-line description | `# @description\n#     This script...` |
| `# @envvar` | Environment variable | `# @envvar SUDO_PASSWORD The sudo password` |
| `# @arg` | Function parameter | `# @arg $1 string The package name` |
