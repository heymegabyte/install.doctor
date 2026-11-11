---
title: Security Features
description: Browse through the technical details on the security measures that Install Doctor employs to keep your device safe from potential adversaries.
sidebar_label: Security
slug: /advanced/security
---

This page inventories historical Install Doctor security desired state. Catalog presence or a
Chezmoi template does not prove that a tool is installed, enabled, healthy, correctly authorized, or
supported on a particular host. Desktop Tools admits each effect through platform, dependency,
privilege, exposure, consent, provenance, and evidence policy. Consult the
[implementation runbook](/docs/desktop-tools/implementation-runbook) and platform matrix before
making an operational claim.

## Security Tools Overview

| Tool | Category | Intended platforms | Historical provider |
|---|---|---|---|
| ClamAV | Antivirus | All | apt/dnf/pacman/brew |
| Rkhunter | Rootkit detection | Linux | apt/dnf/pacman |
| fail2ban | Intrusion prevention | Linux | apt/dnf/pacman |
| Little Snitch | Application firewall | macOS | cask |
| OpenSnitch | Application firewall | Linux | Package manager |
| Portmaster | Application firewall | Linux/Windows | Binary download |
| Cloudflare WARP | Encrypted DNS/VPN | All | Package manager |

## Antivirus and Malware Detection

### ClamAV

[ClamAV](https://www.clamav.net/) is represented in desired state. On an admitted host, verify the
actual package, signature database, service state, permissions, and policy before relying on it:

| Component | Purpose | Command |
|---|---|---|
| `clamd` | Real-time file scanning daemon | `systemctl status clamav-daemon` |
| `freshclam` | Automatic signature database updates | `systemctl status clamav-freshclam` |
| `clamscan` | On-demand scanning | `clamscan -r ~/Downloads` |

ClamAV is installed via the system package manager (`apt`, `dnf`, `pacman`) on Linux and via Homebrew on macOS.

### Rootkit Detection

[Rkhunter](http://rkhunter.sourceforge.net/) (Rootkit Hunter) is installed on Linux systems to scan for:

- Known rootkits and backdoors
- Suspicious file permission changes
- Hidden files in common locations
- Suspicious kernel modules

Run a manual scan with:

```bash
sudo rkhunter --check
```

### Intrusion Prevention

[fail2ban](https://www.fail2ban.org/) is installed on Linux systems to monitor log files and automatically ban IP addresses that show malicious signs such as repeated failed authentication attempts.

```bash
# Check fail2ban status
sudo fail2ban-client status

# View banned IPs for the SSH jail
sudo fail2ban-client status sshd
```

## SSH Hardening

Install Doctor applies hardened SSH configurations during provisioning:

| Hardening Measure | Description | Configuration |
|---|---|---|
| Custom SSH port | Non-standard port to reduce automated scanning | Defined in `.chezmoi.yaml.tmpl` |
| SELinux integration | Registers custom port with SELinux policy | `semanage port -a -t ssh_port_t -p tcp $PORT` |
| Key-based auth | SSH key generation and import | Handled during provisioning |
| Service management | Auto-enable SSH service per distribution | `ssh` (Debian/Ubuntu), `sshd` (Fedora/Arch) |

SSH service names vary by distribution:

| Distribution | Service Name | Enable Command |
|---|---|---|
| Debian / Ubuntu | `ssh` | `sudo systemctl enable --now ssh` |
| Fedora / CentOS / Arch | `sshd` | `sudo systemctl enable --now sshd` |

## GPG Key Management

Install Doctor configures GPG with security-hardened settings:

- Downloads a hardened `gpg.conf` configuration
- Imports and trusts your GPG key (specified via the `KEYID` environment variable)
- Configures `gpg-agent` with sensible defaults
- Sets appropriate file permissions on `~/.gnupg` (700 for directory, 600 for files)

## Secrets Management

Infisical is the intended authority for online operational machine and application secrets, with a
distinct least-privilege identity and minimum values for each workload. Local encrypted material is
allowed only for declared pre-network, boot, offline, or independent-recovery exceptions. Existing
age/Chezmoi material remains migration input; its presence does not authorize copying a controller
keyring or silently falling back when Infisical is unavailable. See the
[Secrets documentation](/docs/customization/secrets) for the compatibility details.

## Application Firewalls

| Firewall | Platform | Description | Status |
|---|---|---|---|
| [Little Snitch](https://www.obdev.at/products/littlesnitch/) | macOS | Alerts when apps make network connections; rule-based filtering | Fully integrated |
| [OpenSnitch](https://github.com/evilsocket/opensnitch) | Linux | Application-level firewall inspired by Little Snitch | Package defined |
| [Portmaster](https://safing.io/portmaster/) | Linux/Windows | Privacy-focused firewall with built-in DNS filtering | Package defined |

## Network Security

| Tool | Purpose | Configuration |
|---|---|---|
| [Cloudflare WARP](https://1.1.1.1/) | Encrypted DNS and optional VPN tunneling | `CLOUDFLARE_TEAMS_*` variables |
| [WireGuard](https://www.wireguard.com/) | Modern VPN protocol | NetworkManager profiles in `~/.config/vpn/` |
| [OpenVPN](https://openvpn.net/) | Traditional VPN | `.ovpn` files in `~/.config/vpn/` |

## Security Philosophy

Install Doctor's security approach prioritizes:

1. **Layered defense** - No single point of failure. Multiple tools cover different threat vectors.
2. **Explicit admission** - Enabling a security service requires host capability, consent, and
   verified configuration; catalog membership is not activation.
3. **Usability budgets** - Background work is bounded and must preserve foreground workload health.
4. **Platform truth** - Platform-specific controls are gated explicitly rather than represented as
   equivalent across operating systems.

## Planned Features

The following security features are defined in the software catalog but not yet fully integrated into the provisioning pipeline:

- **Firejail** - Application sandboxing for Linux (profiles pending)
- **AppArmor profiles** - Mandatory access control policies for applications
- **Advanced host-based IDS** - Extended intrusion detection beyond fail2ban
