---
title: Utility Scripts Overview
description: Read about how you can invoke special scripts provided by the Install Doctor repository by leveraging curl. These scripts include features like fully automating the provisioning process and setting up SSO-based SSH certificates for improved security.
sidebar_label: Utility Scripts
slug: /scripts/utility
---

Install Doctor exposes one public installer endpoint. Repository utility scripts remain available to audited local checkouts, but are not executed from mutable branch URLs.

## Script Summary

| Script | Short URL | Purpose |
|---|---|---|
| Signed release bootstrap | `https://app.install.doctor/start` | Verifies and runs an immutable `scripts/provision.sh` release |
| `scripts/homebrew.sh` | local checkout only | Standalone Homebrew installer for macOS and Linux |
| `scripts/cloudflared-ssh.sh` | local checkout only | Sets up Cloudflare Access SSH with short-lived certificates |
| `start.sh` | (used internally) | Bootstrap: installs Task runner and basic dependencies before `provision.sh` |

## Kickstart Script

The signed stage-zero endpoint verifies an immutable release of `scripts/provision.sh` before it executes:

```shell
curl -fsSL https://app.install.doctor/start | bash
```

You can customize the provisioning with environment variables:

```shell
# Headless with custom software group and fork
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard
export START_REPO=YourGitHubUsername
export SUDO_PASSWORD=YourPassword
curl -fsSL https://app.install.doctor/start | bash
```

| Variable | Default | Description |
|---|---|---|
| `HEADLESS_INSTALL` | `false` | Skip all interactive prompts |
| `SOFTWARE_GROUP` | (prompted) | Software group: `Full`, `Standard`, or `Minimal` |
| `START_REPO` | `megabyte-labs` | GitHub username/org for the Install Doctor fork |
| `SUDO_PASSWORD` | (prompted) | Sudo password for non-interactive installs |
| `AGE_PASSWORD` | (prompted) | Password for decrypting Age-encrypted secrets |

## Local utility scripts

The Homebrew and Cloudflare SSH helpers no longer have public `curl | bash` aliases. Run them only from an existing authenticated, reviewed checkout pinned to the release you approved:

```shell
cd install.doctor
bash scripts/homebrew.sh
bash scripts/cloudflared-ssh.sh
```

This script:
1. Installs `cloudflared` if not already present
2. Configures the SSH client to proxy connections through CloudFlare
3. Sets up short-lived certificates that rotate automatically
4. Authenticates via your SSO provider (Google, GitHub, etc.)

**Prerequisite:** You must have a CloudFlare Teams account with an access policy configured for SSH. See the [CloudFlare integration docs](/docs/integrations/cloudflare) for setup details.
