---
title: FAQs
description: Browse through a catalog of frequently asked questions related to Install Doctor. This page houses questions and answers to common topics that come up in our open-source community.
sidebar_label: FAQs
slug: /getting-started/faqs
---

## General

### What is Install Doctor?

Install Doctor is a cross-platform desktop provisioning system that configures a fully-featured development workstation from a single command. It supports macOS, Ubuntu, Debian, Fedora, CentOS, Arch Linux, Alpine, and OpenSUSE.

### How do I install it?

Run the following command in your terminal:

```bash
curl -fsSL https://app.install.doctor/start | bash
```

### How long does provisioning take?

The initial provisioning typically takes between 30 minutes and 2 hours depending on your internet speed and the software group selected. Re-provisioning an already-configured system is significantly faster since existing software is detected and skipped.

### Can I run it unattended?

Yes. Set the following environment variables for fully headless operation:

```bash
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard
curl -fsSL https://app.install.doctor/start | bash
```

See the [Getting Started guide](/docs/getting-started) for the full list of environment variables.

## Customization

### How do I choose what software gets installed?

The `SOFTWARE_GROUP` environment variable controls which set of software is installed. Options include `Full`, `Standard`, and `Minimal`. You can also create custom software groups by editing `home/.chezmoidata.yaml` in your fork.

### How do I add my own software?

Fork the repository and add entries to `software.yml`. Each entry maps a package name to its installation commands across different package managers. See the [Software Customization guide](/docs/customization/software) for details.

### How do I store secrets (API keys, tokens)?

Install Doctor uses [Age](https://github.com/FiloSottile/age) encryption via Chezmoi to manage secrets. Encrypted secrets are stored in `home/.chezmoitemplates/secrets/` and decrypted at provisioning time. See the [Secrets guide](/docs/customization/secrets) for step-by-step instructions.

### Can I use Install Doctor with an existing dotfiles setup?

Yes. Install Doctor uses [Chezmoi](https://www.chezmoi.io/) for dotfile management. You can fork the repository and replace or modify any configuration file in the `home/` directory to match your preferences.

## Troubleshooting

### The script hangs at a prompt

All prompts should have 30-second timeouts that auto-proceed with default values. If you encounter a hanging prompt, ensure you are running the latest version. You can also set `HEADLESS_INSTALL=true` to bypass all interactive prompts.

### Homebrew installation fails

On macOS, ensure you have accepted the Xcode Command Line Tools license:

```bash
sudo xcodebuild -license accept
```

On Linux, ensure your user has sudo privileges. The script will attempt to install Homebrew without sudo if necessary, but some features may be limited.

### A package fails to install

Install Doctor is configured with `KEEP_GOING` mode to continue past individual package failures. Check the log output for the specific error. Common causes:

- **Missing dependencies** - Some packages require system libraries not yet installed
- **Network issues** - Package repositories may be temporarily unavailable
- **Architecture mismatch** - Some packages are only available for x86_64 or ARM64

### How do I re-run provisioning?

Simply run the install command again. Install Doctor detects already-installed software and skips it, so re-provisioning is safe and much faster than the initial run.

### Where are logs stored?

Provisioning logs are written to a timestamped file in the current directory. The exact path is printed at the start of the provisioning process.

## Platform-Specific

### Does it work on Apple Silicon (M1/M2/M3)?

Yes. Install Doctor supports both Intel and Apple Silicon Macs. Homebrew is installed to `/opt/homebrew` on Apple Silicon and `/usr/local` on Intel.

### Does it work on WSL?

Install Doctor can be run inside Windows Subsystem for Linux (WSL) using the Ubuntu or Debian distributions. Native Windows support uses Chocolatey, Scoop, and winget.

### What about Qubes OS?

Yes, Install Doctor supports Qubes OS provisioning from dom0. See the [Qubes documentation](/docs/advanced/qubes) for details.

## Community

If your question is not answered here, please reach out through one of the channels on our [Community](https://install.doctor/community) page or [open an issue on GitHub](https://github.com/heymegabyte/install.doctor/issues).
