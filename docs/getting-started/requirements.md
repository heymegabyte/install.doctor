---
title: Environment Requirements
description: Learn how to install bash and curl on Linux machines which are environment requirements for running the Install Doctor quick start one-liner script.
sidebar_label: Requirements
slug: /getting-started/requirements
---
Install Doctor is a batteries-included provisioning framework with minimal prerequisites. The bootstrap script handles installing everything else automatically. However, on some platforms there may be initial legwork required.

## Requirements Summary

| Platform | Prerequisites | Install Command | Notes |
|---|---|---|---|
| macOS (Ventura+) | `bash`, `curl`, current OpenSSH `ssh-keygen`, `tar`, SHA-256 tool, Xcode CLI Tools | `curl -fsSL https://app.install.doctor/start | bash` | Grant [Full Disk Access](/docs/terminal/full-disk-access) for full functionality |
| Ubuntu / Debian | `bash`, `curl`, current OpenSSH client, `tar`, SHA-256 tool | `curl -fsSL https://app.install.doctor/start | bash` | Sudo privileges required |
| Fedora / CentOS | `bash`, `curl`, current OpenSSH client, `tar`, SHA-256 tool | `curl -fsSL https://app.install.doctor/start | bash` | Sudo privileges required |
| Arch Linux | `bash`, `curl`, `openssh`, `tar`, SHA-256 tool | `curl -fsSL https://app.install.doctor/start | bash` | Install prerequisites with `pacman`; live lifecycle evidence remains pending |
| Alpine | `bash`, `curl`, `openssh-client`, `tar`, SHA-256 tool, compatible system Node 22 or 24 | `curl -fsSL https://app.install.doctor/start | bash` | The signed portable runtime is glibc-only; musl clean-host closure remains unverified |
| openSUSE | `bash`, `curl`, current OpenSSH client, `tar`, SHA-256 tool | `curl -fsSL https://app.install.doctor/start | bash` | Sudo privileges required; live lifecycle evidence remains pending |
| Windows 11 | — | Not currently published | Native PowerShell remains experimental; use a separately verified WSL2 cell |
| Qubes OS | dom0 terminal access | See [Qubes docs](/docs/advanced/qubes) | Must run from dom0 |

## Hardware Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 4 GB | 8+ GB |
| Disk Space | 20 GB free | 50+ GB free (Full software group) |
| Internet | Required for all installs | Broadband for faster provisioning |
| CPU | Any x86_64 or ARM64 | Multi-core for faster compilation |

## Linux

Stage zero intentionally stays small: it requires Bash, curl, an OpenSSH client whose `ssh-keygen`
supports SSHSIG verification, `tar`, and either `sha256sum` or `shasum`. Node is not a prerequisite on
the glibc macOS/Linux cells: the signed release carries an exact Node 24 runtime and reuses an existing
supported Node 22 or 24 when present. Alpine/musl currently requires a compatible system Node and remains
best-effort until a signed musl runtime and clean-host canary exist.

On Linux, install the prerequisites with the native package manager if they are absent:

```shell
# Arch Linux
sudo pacman -Syu --noconfirm bash curl openssh tar

# CentOS / Fedora
sudo dnf install -y bash curl openssh-clients tar

# Debian / Ubuntu
sudo apt-get install -y bash curl openssh-client tar

# Alpine
apk add bash curl openssh-client tar nodejs

# openSUSE
sudo zypper install -y bash curl openssh-clients tar
```

Then run the kickstart script:

```shell
curl -fsSL https://app.install.doctor/start | bash
```

## macOS

### Xcode Command Line Tools

The Xcode Command Line Tools are automatically prompted for installation when the provisioning script runs. You can pre-install them with:

```shell
xcode-select --install
```

If you have the full Xcode app installed, accept the license first:

```shell
sudo xcodebuild -license accept
```

### Full Disk Access

For full functionality (modifying system preferences, accessing protected directories), grant Full Disk Access to your terminal app. See the [Full Disk Access guide](/docs/terminal/full-disk-access) for step-by-step instructions.

### macFUSE Kernel Extensions (Optional)

[macFUSE](https://osxfuse.github.io/) enables mounting remote data sources as local volumes (e.g., S3 buckets as disks). It requires kernel extensions which must be explicitly enabled on Apple Silicon Macs:

1. Shut down system
2. Press and hold the Touch ID or power button to launch Startup Security Utility
3. Select "Options"
4. On the top menu bar, select "Startup Security Utility"
5. Enable kernel extensions from the Security Policy button
6. Reboot into the main environment
7. Open System Settings > Privacy & Security
8. Click "Enable System Extensions..."

> **Note:** If you enable kernel extensions before installing macFUSE, the option to enable extensions will not be available yet. Revisit this step after provisioning installs macFUSE.

## Qubes

Begin the provisioning process from a **dom0** terminal session:

```shell
# Qubes entrypoint is not published until its signed delivery and dom0/AppVM matrix are verified.
```

See the [Qubes documentation](/docs/advanced/qubes) for full details on template VMs, AppVM provisioning, and customization.

## Windows

Windows 11 requires elevated administrator privileges. Open an **Administrator PowerShell** terminal (right-click PowerShell > "Run as Administrator") and run:

```powershell
# Native Windows installer is not published until its signed release path is verified.
```

The Windows provisioning process uses [Chocolatey](https://chocolatey.org/), [Scoop](https://scoop.sh/), and [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) for package management.
