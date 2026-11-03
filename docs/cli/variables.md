---
title: Script Variables
description: Reference for all environment variables that control Install Doctor's provisioning behavior, from headless mode to software selection and secret management.
sidebar_label: Script Variables
slug: /cli/variables
---

This page documents the environment variables that control Install Doctor's behavior during provisioning. Variables can be set inline, exported in your shell, or stored as encrypted Chezmoi secrets.

## Provisioning Variables

These variables control the core provisioning process:

| Variable | Default | Description |
|---|---|---|
| `HEADLESS_INSTALL` | `false` | When `true`, skips all interactive prompts and uses default values |
| `SOFTWARE_GROUP` | (prompted) | Which software set to install: `Full`, `Standard`, or `Minimal` |
| `START_REPO` | `megabyte-labs` | GitHub username or org containing your Install Doctor fork |
| `START_REPO_BRANCH` | `master` | Branch to use when cloning the Install Doctor repository |
| `SUDO_PASSWORD` | (prompted) | Sudo password for automated installs (avoids sudo prompts) |
| `AGE_PASSWORD` | (prompted) | Password for decrypting Age-encrypted secrets |
| `KEEP_GOING` | `true` | Continue provisioning past individual package install failures |

### Example: Fully Headless Provisioning

```bash
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard
export START_REPO=YourGitHubUsername
export SUDO_PASSWORD=YourPassword
export AGE_PASSWORD=YourAgePassword
bash <(curl -sSL https://install.doctor/start)
```

## Integration Variables

These variables configure third-party service integrations. When set, Install Doctor automatically connects to these services during provisioning:

### Networking

| Variable | Service | Description |
|---|---|---|
| `CLOUDFLARE_TEAMS_CLIENT_ID` | CloudFlare WARP | Client ID for Zero Trust configuration |
| `CLOUDFLARE_TEAMS_CLIENT_SECRET` | CloudFlare WARP | Client secret for Zero Trust configuration |
| `CLOUDFLARE_TEAMS_ORG` | CloudFlare WARP | Organization name for Zero Trust |

### Monitoring

| Variable | Service | Description |
|---|---|---|
| `NETDATA_TOKEN` | Netdata Cloud | Claim token for enrolling in Netdata Cloud dashboard |
| `NETDATA_ROOM` | Netdata Cloud | Room ID for organizing monitored hosts |
| `HEALTHCHECKS_API_KEY` | Healthchecks.io | API key for cron job and backup monitoring |

### Developer Tools

| Variable | Service | Description |
|---|---|---|
| `GITHUB_TOKEN` | GitHub | Personal access token for authenticated API calls |
| `GITLAB_TOKEN` | GitLab | Personal access token for authenticated API calls |
| `DOCKERHUB_USER` | Docker Hub | Docker Hub username for registry authentication |
| `DOCKERHUB_TOKEN` | Docker Hub | Docker Hub access token |
| `WAKATIME_API_KEY` | Wakatime | API key for developer productivity tracking |
| `HEROKU_API_KEY` | Heroku | API key for Heroku CLI authentication |

### Security

| Variable | Service | Description |
|---|---|---|
| `KEYID` | GPG | GPG key ID to import and trust from keyservers |
| `WAZUH_MANAGER` | Wazuh | Wazuh manager address for security monitoring agent |

### Communication

| Variable | Service | Description |
|---|---|---|
| `SLACK_API_TOKEN` | Slack | API token for Slack workspace integration |
| `MATRIX_PASSWORD` | Matrix/Element | Password for Matrix account authentication |

### Infrastructure

| Variable | Service | Description |
|---|---|---|
| `JUMPCLOUD_CONNECT_KEY` | JumpCloud | Connect key for device management enrollment |
| `GCE_CREDS_FILE` | Google Cloud | Path to Google Cloud service account credentials JSON |
| `VAGRANT_CLOUD_TOKEN` | Vagrant Cloud | Token for Vagrant box publishing and downloading |

## Chezmoi Template Variables

These variables are defined in `home/.chezmoidata.yaml` and available in `.tmpl` files:

| Variable Path | Description |
|---|---|
| `.host.distro.family` | OS family: `linux`, `darwin`, `windows` |
| `.host.distro.id` | Distribution ID: `ubuntu`, `fedora`, `arch`, etc. |
| `.host.home` | User's home directory path |
| `.host.softwareGroup` | Selected software group |
| `.user.name` | User's full name |
| `.user.email` | User's email address |
| `.user.gpg.id` | User's GPG key ID |
| `.user.github.username` | GitHub username |
| `.user.cloudflare.username` | CloudFlare account username |

### Example: Using Template Variables

```bash
# In a .tmpl file
{{ if eq .host.distro.family "darwin" }}
  # macOS-specific logic
  defaults write com.apple.dock autohide -bool true
{{ else if eq .host.distro.id "ubuntu" }}
  # Ubuntu-specific logic
  sudo apt-get install -y build-essential
{{ end }}
```

## Debug Variables

| Variable | Default | Description |
|---|---|---|
| `DEBUG_MODE` | `false` | Enable verbose debug output during provisioning |
| `CI` | `false` | Set automatically in CI environments; adjusts timeouts and skips GUI apps |
| `TEST_INSTALL` | `false` | Testing mode: skips certain long-running operations |

## Variable Precedence

Variables are resolved in this order (highest priority first):

1. **Inline environment variables** - `HEADLESS_INSTALL=true bash <(curl ...)`
2. **Exported shell variables** - `export SOFTWARE_GROUP=Standard`
3. **Encrypted Chezmoi secrets** - `home/.chezmoitemplates/secrets/`
4. **chezmoi.yaml.tmpl defaults** - `home/.chezmoi.yaml.tmpl`
5. **Interactive prompts** - Prompted during provisioning (with 30-second timeout)
