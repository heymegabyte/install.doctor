---
title: Network Features
description: Find information about the network features that Install Doctor implements along with details on how you can customize them.
sidebar_label: Network
slug: /advanced/network
---

Install Doctor provisions a multi-layered network stack designed to secure communications, enable remote access, and simplify VPN management across all supported platforms.

## VPN Support

### WireGuard

[WireGuard](https://www.wireguard.com/) is installed as the underlying VPN protocol. Install Doctor configures WireGuard through NetworkManager integration:

- WireGuard tools (`wg`, `wg-quick`) are installed
- NetworkManager WireGuard plugins are installed for desktop integration
- VPN profiles stored in `~/.config/vpn/` are automatically imported

### OpenVPN

OpenVPN is supported through NetworkManager plugins:

- OpenVPN client and NetworkManager plugin packages are installed
- `.ovpn` profile files from `~/.config/vpn/*.ovpn` are automatically imported into NetworkManager
- Credentials are configured using the `OVPN_USERNAME` and `OVPN_PASSWORD` variables from your Chezmoi data

### Cloudflare WARP

[Cloudflare WARP](https://developers.cloudflare.com/warp-client/) provides encrypted DNS and optional full-tunnel VPN through Cloudflare's network:

- Installed on macOS (via Homebrew Cask) and Linux (via official Cloudflare repositories)
- Provides DNS-over-HTTPS by default
- Can be configured for full-tunnel mode for complete traffic encryption

## Cloudflare Integration

Install Doctor has deep integration with Cloudflare services:

- **Cloudflare Tunnel (cloudflared)** - Expose local services securely without opening firewall ports. See the [Cloudflare integration page](/docs/features/cloudflare) for details.
- **Cloudflare WARP** - Encrypted DNS and VPN client
- **Cloudflare SSL certificates** - Automatic import of Cloudflare origin certificates into the system trust store (macOS)

## NetworkManager Configuration

On Linux systems, Install Doctor configures NetworkManager with:

- OpenVPN plugin (`NetworkManager-openvpn`)
- WireGuard plugin
- Automated VPN profile import from `~/.config/vpn/`
- Service restart after plugin installation to load new capabilities

Install types vary by distribution:

| Distribution     | Packages Installed                                         |
| ---------------- | ---------------------------------------------------------- |
| Debian/Ubuntu    | `network-manager*`, `openvpn`                              |
| Fedora/RHEL      | `openvpn`, `NetworkManager*`                               |
| Arch Linux       | `openvpn`, `networkmanager*`                               |

## Application Firewalls

Install Doctor includes application-level firewall packages in its software catalog:

- **Little Snitch** (macOS) - Per-application network monitor and firewall
- **OpenSnitch** (Linux) - Linux equivalent of Little Snitch
- **Portmaster** (Linux/Windows) - Privacy-focused application firewall with DNS filtering

## Remote Access

### SSH

Install Doctor configures SSH access with hardened defaults:

- Custom SSH port support (configurable via `.chezmoi.yaml.tmpl`)
- SELinux port registration on Fedora/RHEL systems
- Automatic service enablement based on distribution

### VNC

Remote desktop access is configured via:

- **KasmVNC** or **TigerVNC** on Linux systems
- **macOS Screen Sharing** enabled via system preferences on macOS

## Customization

### Adding VPN Profiles

Place your VPN configuration files in the appropriate locations within your Chezmoi source directory:

- **OpenVPN**: `home/dot_config/vpn/*.ovpn`
- **WireGuard**: Configure via NetworkManager or `wg-quick` configuration files

### Environment Variables

| Variable              | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `OVPN_USERNAME`       | OpenVPN authentication username                          |
| `OVPN_PASSWORD`       | OpenVPN authentication password                          |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel authentication token              |
