# Post-Installation

Provisioning is complete. You can review the installation logs at:

```shell
ls ~/.local/var/log/install.doctor/
```

If you encounter issues, have ideas, or want to contribute, [open an issue on GitHub](https://github.com/heymegabyte/install.doctor/issues) or visit the [Community page](https://install.doctor/community).

## What Just Happened

Here's a summary of what Install Doctor configured on your system:

| Component | What Was Done |
|---|---|
| **Package Manager** | Homebrew installed and configured (macOS/Linux) |
| **Software** | Packages from your selected `SOFTWARE_GROUP` installed |
| **Shell** | ZSH configured as default shell with Oh-My-ZSH, Powerlevel10k theme |
| **Dotfiles** | Configuration files deployed to `~/.config/` following XDG spec |
| **Secrets** | Age-encrypted secrets decrypted and deployed to appropriate locations |
| **Services** | Explicitly selected services (Cloudflare WARP/Tunnel, Netdata, Docker, etc.) started where applicable |
| **Security** | ClamAV, fail2ban, SSH hardening applied (depending on SOFTWARE_GROUP) |
| **System** | Hostname, timezone, user/group configuration applied |

## Next Steps

| Step | Action | Command / Link |
|---|---|---|
| 1 | **Restart your terminal** | Close and reopen to load new shell configuration |
| 2 | **Reboot** (recommended) | Some macOS `defaults write` settings require a reboot |
| 3 | **Try the CLI** | Run `task-menu` to browse available post-install tasks |
| 4 | **Fork the project** | [Fork on GitHub](https://github.com/heymegabyte/install.doctor/fork) to add your customizations |
| 5 | **Add your secrets** | See the [Secrets guide](/docs/customization/secrets) to encrypt and store your API keys |
| 6 | **Customize software** | Edit `software.yml` and `home/.chezmoidata.yaml` to tailor your software stack |
| 7 | **Re-provision safely** | Run `bash <(curl -sSL https://install.doctor/start)` again anytime — it skips already-installed software |

## Useful Post-Install Commands

```shell
# Browse and run available CLI tasks
task-menu

# Run a specific task
run browser:profile:backup

# Check Chezmoi status (what would change on next apply)
chezmoi diff

# Re-apply Chezmoi templates without full re-provision
chezmoi apply

# View Homebrew-installed packages
brew list
```

## Troubleshooting

If something doesn't look right after provisioning:

| Symptom | Solution |
|---|---|
| Shell theme not showing | Restart terminal; install a [Nerd Font](https://www.nerdfonts.com/) if icons are missing |
| macOS settings unchanged | Reboot the system (many `defaults write` changes require it) |
| Service not running | Check with `systemctl status <service>` (Linux) or `brew services list` (macOS) |
| Missing software | Re-run provisioning — it's safe and will install missing packages |
| Permission errors on macOS | Grant [Full Disk Access](/docs/terminal/full-disk-access) to your terminal app |

_Note: Some settings and applications require a reboot (or at the very least, a terminal reload) to take effect._
