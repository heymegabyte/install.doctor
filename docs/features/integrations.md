---
title: Integrations
description: An overview of the various free, cloud integrations that Install Doctor officially supports along with some information regarding the philosophy that Install Doctor uses when selecting third-party services.
sidebar_label: Integrations
slug: /integrations
---

Install Doctor integrates with a range of third-party services to enhance the provisioned system with monitoring, networking, security, and developer productivity features. This page provides an overview of each integration and how to enable it.

## Integration Philosophy

When selecting third-party services for official support, Install Doctor prioritizes:

1. **Free tiers** - All integrations must offer a meaningful free tier suitable for individual use
2. **Privacy-respecting** - Services must have transparent data handling policies
3. **Cross-platform** - Integrations should work across macOS and Linux at minimum
4. **API-driven** - Services must support automated configuration through APIs or CLI tools
5. **Self-hostable** (preferred) - When possible, self-hosted alternatives are preferred

## Networking

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| Cloudflare WARP / Tunnel | Zero-Trust client and explicit service ingress | Control-plane enrollment |
| [Cloudflare](/docs/integrations/cloudflare) | DNS, tunnels, WARP, and SSL certificates | Multiple `CLOUDFLARE_*` environment variables |
| WireGuard | Modern VPN protocol via NetworkManager | VPN profiles in `~/.config/vpn/` |
| OpenVPN | Traditional VPN with automated profile import | `.ovpn` files in `~/.config/vpn/` |

## Monitoring

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| [Netdata](/docs/integrations/netdata) | Real-time system monitoring dashboard | `NETDATA_TOKEN` and `NETDATA_ROOM` |
| Healthchecks | Cron job and backup monitoring | `HEALTHCHECKS_API_KEY` environment variable |

## Security

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| ClamAV | Open-source antivirus engine | Installed and configured automatically |
| fail2ban | Intrusion prevention system | Installed and configured automatically |
| Wazuh | Security monitoring agent | `WAZUH_MANAGER` environment variable |

## Developer Tools

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| GitHub | Source control and CI/CD | `GITHUB_TOKEN` environment variable |
| GitLab | Source control and CI/CD | `GITLAB_TOKEN` environment variable |
| Wakatime | Developer productivity tracking | `WAKATIME_API_KEY` environment variable |
| Heroku | Cloud application platform | `HEROKU_API_KEY` environment variable |

## Communication

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| Slack | Team communication | `SLACK_API_TOKEN` environment variable |
| Matrix (Element) | Decentralized messaging | `MATRIX_PASSWORD` environment variable |
| IFTTT | Webhook-based automation | `IFTTT_WEBHOOK_ID` environment variable |

## Infrastructure

| Integration | Description | Configuration |
| ----------- | ----------- | ------------- |
| JumpCloud | Device management and identity | `JUMPCLOUD_CONNECT_KEY` environment variable |
| Google Cloud | Cloud platform SDK | `GCE_CREDS_FILE` environment variable |

## Enabling Integrations

Most integrations are enabled by setting the appropriate environment variable or encrypted secret. The general process is:

1. Sign up for the service and obtain your API key or token
2. Store the credential as an environment variable or encrypted Chezmoi secret
3. Run (or re-run) the provisioning process

See the [Secrets documentation](/docs/customization/secrets) for the complete list of supported variables and instructions on encrypting secrets with Age.
