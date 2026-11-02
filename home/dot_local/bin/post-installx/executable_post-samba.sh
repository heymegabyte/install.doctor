#!/usr/bin/env bash
set -euo pipefail
# @file Samba Configuration
# @brief This script configures Samba by applying the configuration stored in `${XDG_DATA_HOME:-$HOME/.config}/samba/config` if the `smbd` application is available
# @description
#     This script applies the Samba configuration stored in `${XDG_DATA_HOME:-$HOME/.config}/samba/config` if Samba is installed.
#     The script and default configuration set up two Samba shares.
#
#     ## Security
#
#     Both shares are configured by default to only accept connections
#     from hosts with DNS that ends in `.local.PUBLIC_SERVICES_DOMAIN`, where `PUBLIC_SERVICES_DOMAIN` is an environment variable that
#     can be passed into Install Doctor. So, if your `PUBLIC_SERVICES_DOMAIN` environment variable is set to `megabyte.space`, then
#     a device with a FQDN of `alpha.local.megabyte.space` pointing to its LAN location will be able to connect but a device
#     with a FQDN of `alpha.megabyte.space` will not be able to connect.
#
#     ## Samba Shares / S3 Backup
#
#     If CloudFlare R2 credentials are provided, Samba is configured to store its shared files in the Rclone mounts so that your
#     Samba shares are synchronized to the S3 buckets. If not, new folders are created. Either way, the folder / symlink that the
#     shares host data from are stored at `/mnt/Private` and `/mnt/Public` (*Note: Different paths are used on macOS*).
#
#     1. The **public** share (named "Public") can be accessed by anyone (including write permissions with the default settings)
#     2. The **private** share (named "Private") can be accessed by specifying the PAM credentials of anyone who has an account that is included in the `sambausers` group
#
#     ## Symlinks
#
#     Symlinks are disabled for security reasons. This is because, with symlinking enabled, people can create symlinks on the shares and use the symlinks to access system files outside of the
#     Samba shares. There are commented-out lines in the default configuration that you can uncomment to enable the symlinks in shares.
#
#     ## Printers
#
#     Printer sharing is not enabled by default. There are commented lines in the default configuration that should provide a nice stepping
#     stone if you want to use Samba for printer sharing (with CUPS).
#
#     ## Environment Variables
#
#     The following chart details some of the environment variables that are used to determine the configuration of the
#     Samba shares:
#
#     | Environment Variable        | Description                                                                                         |
#     |-----------------------------|-----------------------------------------------------------------------------------------------------|
#     | `PUBLIC_SERVICES_DOMAIN`    | Used to determine which hosts can connect to the Samba share (e.g. `.local.PUBLIC_SERVICES_DOMAIN`) |
#     | `SAMBA_NETBIOS_NAME`        | Determines the NetBIOS name (defaults to the `HOSTNAME` environment variable value)                 |
#     | `SAMBA_WORKGROUP`           | Controls Samba workgroup name (defaults to "BETELGEUSE")                                            |
#
#     ## Links
#
#     * [Default Samba configuration](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_local/samba/config.tmpl)
#     * [Secrets / Environment variables documentation](https://install.doctor/docs/customization/secrets)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Configure Samba server
if command -v smbd > /dev/null; then
  # Add user / group with script in ~/.local/bin/add-usergroup, if it is available
  if command -v add-usergroup > /dev/null; then
    sudo add-usergroup rclone rclone
    sudo add-usergroup "${USER:-$(id -un)}" rclone
  fi
  ### Define share locations
  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS does not have `/mnt` folder so use `/Volumes` location
    MNT_FOLDER='Volumes'
  else
    MNT_FOLDER='mnt'
  fi
  PRIVATE_SHARE="/$MNT_FOLDER/Private"
  PUBLIC_SHARE="/$MNT_FOLDER/Public"

  ### Private share
  gum log -sl info "Ensuring $PRIVATE_SHARE is created"
  sudo mkdir -p "$PRIVATE_SHARE"
  sudo chmod 770 "$PRIVATE_SHARE"

  ### Public share
  gum log -sl info "Ensuring $PUBLIC_SHARE is created"
  sudo mkdir -p "$PUBLIC_SHARE"
  sudo chmod 775 "$PUBLIC_SHARE"

  ### User share
  gum log -sl info "Ensuring $HOME/Shared is created"
  mkdir -p "$HOME/Shared"
  chmod 755 "$HOME/Shared"
  chown -Rf "${USER:-$(id -un)}":rclone "$HOME/Shared"

  ### Copy the Samba server configuration file
  if [ -d /Applications ] && [ -d /System ]; then
    ### System Private Samba Share
    if SMB_OUTPUT=$(sudo sharing -a "$PRIVATE_SHARE" -S "Private (System)" -n "Private (System)" -g 000 -s 001 -E 1 -R 1 2>&1); then
      gum log -sl info "Configured $PRIVATE_SHARE as a private Samba share"
    else
      if echo $SMB_OUTPUT | grep 'smb name already exists' > /dev/null; then
        gum log -sl info "$PRIVATE_SHARE Samba share already exists"
      else
        gum log -sl error 'An error occurred while running sudo sharing -a "$PRIVATE_SHARE" -S "Private (System)" -n "Private (System)" -g 000 -s 001 -E 1 -R 1'
        echo "$SMB_OUTPUT"
      fi
    fi

    ### System Public Samba Share
    if SMB_OUTPUT=$(sudo sharing -a "$PUBLIC_SHARE" -S "Public (System)" -n "Public (System)" -g 001 -s 001 -E 1 -R 0 2>&1); then
      gum log -sl info "Configured $PUBLIC_SHARE as a system public Samba share"
    else
      if echo $SMB_OUTPUT | grep 'smb name already exists' > /dev/null; then
        gum log -sl info "$PUBLIC_SHARE Samba share already exists"
      else
        gum log -sl error 'An error occurred while running sudo sharing -a "$PUBLIC_SHARE" -S "Public (System)" -n "Public (System)" -g 001 -s 001 -E 1 -R 0'
        echo "$SMB_OUTPUT"
      fi
    fi

    ### User Shared Samba Share
    if SMB_OUTPUT=$(sudo sharing -a "$HOME/Shared" -S "Shared (User)" -n "Shared (User)" -g 001 -s 001 -E 1 -R 0 2>&1); then
      gum log -sl info "Configured $HOME/Shared as a user-scoped Samba share"
    else
      if echo $SMB_OUTPUT | grep 'smb name already exists' > /dev/null; then
        gum log -sl info "$HOME/Shared Samba share already exists"
      else
        gum log -sl error 'An error occurred while running sudo sharing -a "$HOME/Shared" -S "Shared (User)" -n "Shared (User)" -g 001 -s 001 -E 1 -R 0'
        echo "$SMB_OUTPUT"
      fi
    fi
  fi
else
  gum log -sl info "Samba server is not installed"
fi
