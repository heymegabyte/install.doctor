---
title: Software Installer
description: Learn about Install Doctor's custom, multi-OS software package installer. Find out how it works, why it is fast, and why it is better than alternative methods.
sidebar_label: Installer
slug: /features/installer
---

Install Doctor leverages a custom, multi-OS capable software package installer written in [ZX](https://github.com/google/zx) to handle the bulk of the provisioning process. When passed an array of software package names, the installer leverages a growing software package map stored in the `software.yml` file found in the root of the Install Doctor repository to intelligently determine which installation method to use. It is optimized to re-provision a system as quickly as possible by determining whether software is already installed and updating outdated software.

## How it Works

The installer follows this process for each software package:

1. **Package Lookup** - The package name is looked up in `software.yml`, which maps over 1,000 software packages to their installation methods across different platforms.
2. **Platform Detection** - The installer detects the current operating system and package manager (e.g., `apt` on Ubuntu, `dnf` on Fedora, `brew` on macOS).
3. **Installer Preference** - Based on the `installerPreference` configuration, the installer selects the best available installation method for the current platform.
4. **Skip Check** - Before installing, the installer checks if the software is already present on the system by looking for its binary (defined in the `_bin` field).
5. **Installation** - If not already installed, the package is installed using the preferred method.
6. **Post-Install** - Any post-installation scripts defined in `_post` or `_post:<installer>` fields are executed.

## Installer Preference Order

Each platform has a defined order of preference for package managers. For example, on Ubuntu:

```
snap > flatpak > whalebrew > apt > brew > go > cargo > npm > pipx > pip > gem > appimage > script > ansible > binary
```

This means the installer will prefer Snap packages over Flatpak, Flatpak over apt, and so on. You can customize this order in the `installerPreference` section of `software.yml`.

## Supported Installation Methods

| Method      | Description                                    | Platforms          |
| ----------- | ---------------------------------------------- | ------------------ |
| `apt`       | Debian/Ubuntu package manager                  | Debian, Ubuntu     |
| `dnf`       | Fedora/RHEL package manager                    | Fedora, CentOS     |
| `pacman`    | Arch Linux package manager                     | Arch, Manjaro      |
| `zypper`    | OpenSUSE package manager                       | OpenSUSE           |
| `apk`       | Alpine package manager                         | Alpine             |
| `brew`      | Homebrew formula                               | macOS, Linux       |
| `cask`      | Homebrew Cask (GUI apps)                       | macOS              |
| `snap`      | Snap package                                   | Most Linux distros |
| `flatpak`   | Flatpak package                                | Most Linux distros |
| `choco`     | Chocolatey package                             | Windows            |
| `scoop`     | Scoop package                                  | Windows            |
| `winget`    | Windows Package Manager                        | Windows            |
| `cargo`     | Rust crate                                     | All                |
| `go`        | Go module                                      | All                |
| `npm`       | Node.js package                                | All                |
| `pip`/`pipx`| Python package                                 | All                |
| `gem`       | Ruby gem                                       | All                |
| `appimage`  | AppImage binary                                | Linux              |
| `script`    | Custom installation script                     | All                |
| `binary`    | Direct binary download                         | All                |

## Software Definition Format

Each entry in `software.yml` follows this structure:

```yaml
package-name:
  _name: Display Name
  _short: Brief one-line description
  _desc: Detailed description of the software
  _github: https://github.com/owner/repo
  _bin: binary-name
  _home: https://project-website.com
  _docs: https://docs-url.com
  # Eager installation is exceptional. Omit both fields for the default lazy behavior.
  _preload: true
  _preloadReason: bootstrap-critical
  # Installation methods
  brew: homebrew-formula-name
  apt: apt-package-name
  dnf: dnf-package-name
  pacman: pacman-package-name
  cask: cask-name
  choco: choco-package-name
  snap: snap-name
  flatpak: org.example.App
  cargo: crate-name
  npm: npm-package-name
  pip: pip-package-name
```

## Platform-Specific Variants

Installation methods can be qualified with platform suffixes to handle cases where a package name differs across distributions:

```yaml
example-tool:
  dnf: example-tool          # Default for all dnf-based distros
  dnf:fedora: example-fedora  # Override specifically for Fedora
  brew: example-tool
  brew:darwin: example-mac    # Override specifically for macOS
```

## Conditional Installation

The `_when:<installer>` field allows you to define shell conditions that must be true before installation proceeds:

```yaml
example-app:
  _when:cask: '! test -d "/Applications/Example.app"'
  cask: example-app
```

## Post-Installation Scripts

The `_post` and `_post:<installer>` fields allow running commands after a package is installed:

```yaml
python:
  brew: python
  _post:brew: python3 -m pip install --upgrade setuptools && python3 -m pip install --upgrade pip
```

## Complete Real-World Example

Here's a full `software.yml` entry for Docker, showing multiple install methods and platform-specific handling:

```yaml
docker:
  _name: Docker
  _short: Container runtime for building and running applications
  _desc: >
    Docker is a platform for developing, shipping, and running applications
    in containers. It enables consistent environments across development,
    testing, and production.
  _github: https://github.com/moby/moby
  _home: https://www.docker.com
  _bin: docker
  apt: docker-ce
  dnf: docker-ce
  pacman: docker
  brew: docker
  cask: docker
  choco: docker-desktop
  _when:cask: '! test -d "/Applications/Docker.app"'
  _post: |
    if command -v docker > /dev/null; then
      sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
    fi
```

## Software Definition Fields Reference

| Field | Required | Description |
|---|---|---|
| `_name` | Recommended | Human-readable display name |
| `_short` | Optional | Brief one-line description |
| `_desc` | Optional | Detailed multi-line description |
| `_github` | Optional | GitHub repository URL |
| `_home` | Optional | Project homepage URL |
| `_docs` | Optional | Documentation URL |
| `_bin` | Recommended | Binary name to check if already installed |
| `_preload` | Optional | Eagerly install instead of using command-not-found; requires `_preloadReason` |
| `_preloadReason` | Required with `_preload` | One of `bootstrap-critical`, `lazy-installer-substrate`, `security-recovery-prerequisite`, or `desired-state-service` |
| `_when:<method>` | Optional | Shell condition that must be true before installing |
| `_post` | Optional | Shell command to run after installation (any method) |
| `_post:<method>` | Optional | Shell command to run after installation (specific method) |
| `brew`, `apt`, etc. | At least one | Package name for each installation method |
