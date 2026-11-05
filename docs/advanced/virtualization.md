---
title: Virtualization Features
sidebar_label: Virtualization
description: Learn about how Install Doctor integrates with virtualization platforms and container technologies to support modern development workflows.
slug: /advanced/virtualization
---

Install Doctor installs and configures a comprehensive virtualization stack suitable for development, testing, and production workloads. This page details the supported platforms and their configurations.

## Docker

[Docker](https://www.docker.com/) is fully supported with the following components installed:

- **docker-ce** - Docker Community Edition engine
- **containerd** - Container runtime
- **docker-compose-plugin** - Docker Compose v2 (integrated as a Docker CLI plugin)
- **Docker Desktop** - GUI application on macOS (via Homebrew Cask) and Linux (via Flatpak/package manager)

### Docker Plugins

Install Doctor configures additional Docker plugins:

- **Rclone Docker Volume Plugin** - Mount cloud storage as Docker volumes

### Post-Installation

After Docker is installed, the provisioning scripts:

1. Add the current user to the `docker` group (Linux)
2. Enable and start the Docker service
3. Configure Docker plugin permissions

## Vagrant

## VirtualBox

[VirtualBox](https://www.virtualbox.org/) is installed as a cross-platform hypervisor:

- Full VirtualBox installation with kernel module support
- Pre-installation of required kernel headers and development packages (Linux)
- Extension pack support for additional features (USB passthrough, RDP, etc.)

## KVM / QEMU

On Linux systems, Install Doctor installs the full KVM/QEMU virtualization stack:

- **qemu-kvm** - QEMU with KVM acceleration
- **libvirt** - Virtualization management library and daemon
- **virt-manager** - GUI for managing virtual machines
- **virt-install** - CLI tool for creating virtual machines
- **bridge-utils** - Network bridge configuration

The `libvirtd` service is enabled and started automatically.

## Qubes OS

Install Doctor includes support for [Qubes OS](https://www.qubes-os.org/), a security-focused operating system that uses Xen virtualization to isolate applications into separate VMs. See the [Qubes documentation](/docs/advanced/qubes) for details on:

- dom0 provisioning from a single command
- Template VM installation and updates
- AppVM and HVM configuration

## Customization

### Choosing Virtualization Platforms

The software groups defined in `home/.chezmoidata.yaml` control which virtualization tools are installed. You can customize this by:

1. Forking the repository
2. Editing the software group definitions to include or exclude specific virtualization tools
3. Running the provisioning process

### Environment Variables

| Variable        | Description                                           |
| --------------- | ----------------------------------------------------- |
| `DOCKER_HOST`   | Docker daemon socket path                             |
