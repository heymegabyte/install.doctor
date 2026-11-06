---
title: Software Installer
description: Learn about Install Doctor's custom, multi-OS software package installer. Find out how it works, why it is fast, and why it is better than alternative methods.
sidebar_label: Installer
slug: /features/installer
---

Install Doctor leverages a custom, multi-OS capable software package installer written in [ZX](https://github.com/google/zx) to handle the bulk of the provisioning process. When passed an array of software package names, the installer leverages a growing software package map stored in the `software.yml` file found in the root of the Install Doctor repository to intelligently determine which installation method to use. It is optimized to re-provision a system as quickly as possible by determining whether software is already installed and updating outdated software.

## Root invocation prerequisite

When the launcher starts as root, `INSTALL_DOCTOR_USER` (or `SUDO_USER`) must identify a pre-existing, compatible non-root account. Its account record, standard home directory, interactive shell, home ownership and permissions, and existing `admin`, `sudo`, or `wheel` membership are validated before Install Doctor writes local run evidence or begins the sealed handoff.

Install Doctor does not currently create accounts, set passwords, or grant administrator membership automatically. Those effects cannot yet cross the root-to-user journal boundary with safe interruption and recovery semantics. Create or enroll the target account through the operating system's normal account-management path, then rerun with `INSTALL_DOCTOR_USER=<name>`. Existing accounts that do not match the required identity fail closed without being modified.

## How it Works

The installer follows this process for each software package:

1. **Package Lookup** - The package name is looked up in `software.yml`, which maps over 1,000 software packages to their installation methods across different platforms.
2. **Platform Detection** - The installer detects the current operating system and package manager (e.g., `apt` on Ubuntu, `dnf` on Fedora, `brew` on macOS).
3. **Installer Preference** - Based on the `installerPreference` configuration, the installer selects the best available installation method for the current platform.
4. **Skip Check** - Before installing, the installer checks if the software is already present on the system by looking for its binary (defined in the `_bin` field).
5. **Installation** - If not already installed, the package is installed using the preferred method.
6. **Post-Install** - Selected typed `post-installx/post-<package>.sh` hooks perform bounded configuration. Catalog shell strings are never executed.

## Installer Preference Order

Each platform has a defined order of preference for package managers. For example, on Ubuntu:

```
flatpak > snap > apt > brew > go > cargo > npm > pipx > pip > gem > appimage > script > binary
```

This is the catalog resolution order, not a promise that every legacy provider executes. `script` is rejected, and `binary` remains fail-closed until an immutable URL, digest, size, and destination are bound. You can customize the order in the `installerPreference` section of `software.yml`.

## Supported Installation Methods

| Method      | Description                                    | Platforms          |
| ----------- | ---------------------------------------------- | ------------------ |
| `apk`       | Alpine package manager                         | Alpine             |
| `apt`       | Debian/Ubuntu package manager                  | Debian, Ubuntu     |
| `appimage`  | AppImage binary                                | Linux              |
| `basher`    | Basher shell package                           | macOS, Linux       |
| `baulk`     | Baulk package manager                          | Windows            |
| `binary`    | Direct binary download                         | All                |
| `brew`      | Homebrew formula                               | macOS, Linux       |
| `cargo`     | Rust crate                                     | All                |
| `cask`      | Homebrew Cask (GUI apps)                       | macOS              |
| `choco`     | Chocolatey package                             | Windows            |
| `crew`      | Chromebrew package                             | ChromeOS           |
| `dnf`       | Fedora/RHEL package manager                    | Fedora, CentOS     |
| `emerge`    | Gentoo Portage package                         | Gentoo             |
| `eopkg`     | Solus package manager                          | Solus              |
| `flatpak`   | Flatpak package                                | Linux              |
| `gem`       | Ruby gem                                       | All                |
| `github`    | GitHub release asset (planned)                 | All                |
| `go`        | Go module                                      | All                |
| `npm`       | Node.js package                                | All                |
| `pacman`    | Arch Linux package manager                     | Arch, Manjaro      |
| `pip`       | Python package                                 | All                |
| `pipx`      | Isolated Python application                    | All                |
| `pkg_add`   | OpenBSD package manager                        | OpenBSD            |
| `pkg`       | FreeBSD package manager (planned)              | FreeBSD            |
| `pkg-darwin`| pkgsrc on macOS                                | macOS              |
| `pkg-freebsd`| FreeBSD pkg                                   | FreeBSD            |
| `pkg-termux`| Termux package manager                         | Android/Termux     |
| `pkgin`     | pkgsrc package manager                         | NetBSD/pkgsrc      |
| `sbopkg`    | SlackBuild package manager (planned)           | Slackware          |
| `scoop`     | Scoop package                                  | Windows            |
| `script`    | Legacy migration data; rejected before execution | None              |
| `snap`      | Snap package                                   | Linux              |
| `winget`    | Windows Package Manager                        | Windows            |
| `xbps`      | Void Linux package manager                     | Void Linux         |
| `yay`       | Arch User Repository helper                    | Arch, Manjaro      |
| `yum`       | RHEL-compatible package manager                | RHEL-compatible    |
| `zypper`    | OpenSUSE package manager                       | OpenSUSE           |

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

## Conditions and Post-Installation Configuration

Legacy `_when*`, `_pre*`, `_post*`, and `script*` shell fields are migration data and do not grant execution authority. Selected `_when*` and `script*` recipes fail closed with an actionable migration error; eager `_post*` metadata fails validation. Express installation through a supported package manager. Put necessary configuration in a reviewed, typed `post-installx/post-<package>.sh` hook whose selection, consent, timeout, and postconditions are owned by the provisioning graph.

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
| `_when*`, `_pre*`, `_post*` | Unsupported | Legacy shell metadata; migrate to typed conditions/hooks |
| `brew`, `apt`, etc. | At least one | Package name for each installation method |
