---
title: Qubes Customization
description: Learn about the Qubes-specific features that Install Doctor provides and find out how to customize the first-ever, batteries-included Qubes provisioning framework.
sidebar_label: Qubes
slug: /advanced/qubes
---

Install Doctor includes comprehensive support for [Qubes OS](https://www.qubes-os.org/), the security-focused operating system that uses Xen-based virtualization to isolate applications into separate virtual machines. This makes Install Doctor one of the first provisioning frameworks to support automated Qubes configuration from a single command run in dom0.

## Quick Start

From a fresh Qubes OS installation, run the following in a dom0 terminal:

```bash
curl -fsSL https://app.install.doctor/start | bash
```

This will provision dom0, install template VMs, configure AppVMs, and apply your customizations.

## What Gets Provisioned

### dom0 Configuration

The provisioning process configures dom0 with:

- **System packages** - Essential dom0 packages defined in the `.qubes.dom0Packages` data key (e.g., `qubes-repo-contrib`)
- **System updates** - dom0 is updated via `qubes-dom0-update` before any other provisioning
- **Security updates** - Applied with the `-y` flag for non-interactive operation

### Template VMs

Install Doctor installs and updates the following template VMs (configurable in `home/.chezmoidata.yaml`):

- Debian templates
- Fedora templates
- Whonix Gateway and Workstation templates

Templates are installed via `qubes-dom0-update` and updated via `qubesctl` with a 15-minute timeout to handle slow Whonix updates.

### Unofficial Templates

In addition to official Qubes templates, Install Doctor supports installing unofficial templates defined in the `.qubes.templatesUnofficial` data key. These are:

1. Downloaded in a dedicated provisioning VM (`provision` qube)
2. Transferred to dom0 via `qvm-run --pass-io`
3. Installed via `dnf install`

### Mirage Firewall

Install Doctor installs the [Mirage firewall](https://github.com/mirage/qubes-mirage-firewall), a unikernel-based firewall for Qubes:

- Downloads the pre-compiled kernel to the provisioning VM
- Transfers it to dom0 at `/var/lib/qubes/vm-kernels/mirage-firewall/`
- Creates the required dummy initramfs file

### Minimal VM Passwordless Sudo

For minimal template VMs (identified by the `-minimal` suffix), Install Doctor configures passwordless root access to enable automated provisioning within those VMs.

## Customization

### Template List

Edit the `.qubes.templates` array in `home/.chezmoidata.yaml` to control which official templates are installed:

```yaml
qubes:
  templates:
    - debian-11
    - fedora-37
    - fedora-38
    - whonix-gw-16
    - whonix-ws-16
```

### dom0 Packages

Edit the `.qubes.dom0Packages` array to add or remove dom0 packages:

```yaml
qubes:
  dom0Packages:
    - qubes-repo-contrib
    - additional-package
```

### Provisioning VM

The `.qubes.provisionVM` key defines which VM is used for downloading files during provisioning. This VM needs network access and is used as an intermediary since dom0 cannot directly access the network.

## Architecture

The Qubes provisioning scripts execute in this order:

1. **`run_before_50-update-dom0.sh.tmpl`** - Updates dom0 and installs dom0 packages
2. **`run_before_51-install-templates.sh.tmpl`** - Installs official and unofficial templates, Mirage firewall
3. **`run_before_52-ensure-minimal-vms-passwordless.sh.tmpl`** - Configures passwordless sudo in minimal VMs
4. **`run_before_54-setup-sys-gui.sh.tmpl`** - Configures sys-gui-gpu with NVIDIA GPU passthrough (if detected)

All Qubes scripts are conditionally included only when the host distribution is detected as Qubes (`{{ if eq .host.distro.id "qubes" }}`).

## Limitations

- Qubes support requires running the provisioning script from dom0
- Network access in dom0 is needed for the initial bootstrap (downloading the start script)
- Template updates may take significant time, especially for Whonix templates (15-minute timeout)
- GPU passthrough (sys-gui-gpu) currently only supports NVIDIA GPUs
