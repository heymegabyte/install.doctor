#!/usr/bin/env bash
set -euo pipefail
# @file Rclone S3 Mounts
# @brief This script configures Rclone to provide several S3-compliant mounts by leveraging CloudFlare R2
# @description
#     Install Doctor leverages Rclone and CloudFlare R2 to provide S3-compliant bucket mounts that allow you to retain stateful files and configurations.
#     In general, these buckets are used for backing up files like your browser profiles, Docker backup files, and other files that cannot be stored as
#     as code in your Install Doctor fork.
#
#     This script sets up Rclone to provide several folders that are synchronized with S3-compliant buckets (using CloudFlare R2 by default).
#     The script ensures required directories are created and that proper permissions are applied. This script will only run if `rclone` is
#     available in the `PATH`. It also requires the user to provide `CLOUDFLARE_R2_SECRET` and `CLOUDFLARE_R2_SECRET` as either environment variables
#     or through the encrypted repository-fork-housed method detailed in the [Secrets documentation](https://install.doctor/docs/customization/secrets).
#
#     ## Mounts
#
#     The script will setup five mounts by default and enable / start `systemd` services on Linux systems so that the mounts are available
#     whenever the device is turned on. The mounts are:
#
#     | Mount Location        | Description                                                                                                           |
#     |-----------------------|-----------------------------------------------------------------------------------------------------------------------|
#     | `/mnt/Private`        | Private system-wide bucket used for any private files that should not be able to be accessed publicly over HTTPS      |
#     | `/mnt/Public`         | Public system-wide bucket that can be accessed by anyone over HTTPS with the bucket's URL (provided by CloudFlare R2) |
#     | N/A                   | Private system-wide bucket used for storing Docker-related backups / files                                            |
#     | N/A                   | Private system-wide bucket similar to `/mnt/Private` but intended for system file backups                             |
#     | `$HOME/Public` | Private user-specific bucket (used for backing up application settings)                                               |
#
#     ## Permissions
#
#     The system files are all assigned proper permissions and are owned by the user `rclone` with the group `rclone`. The exception to this is the
#     user-specific mount which uses the user's user name and user group.
#
#     ## Samba
#
#     If Samba is installed, then by default Samba will create two shares that are symlinked to the `/mnt/s3-private` and `/mnt/s3-public`
#     buckets. This feature allows you to easily access the two buckets from other devices in your local network. If Rclone buckets are not
#     available then the Samba setup script will just create regular empty folders as shares.
#
#     ## Notes
#
#     * The mount services all leverage the executable found at `$HOME/.local/bin/rclone-mount` to mount the shares.
#
#     ## Links
#
#     * [Rclone mount script](https://github.com/megabyte-labs/install.doctor/tree/master/home/dot_local/bin/executable_rclone-mount)
#     * [Rclone default configurations](https://github.com/megabyte-labs/install.doctor/tree/master/home/dot_config/rclone)
#     * [Rclone documentation](https://rclone.org/docs/)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Begin configuration
if command -v rclone >/dev/null; then
  R2_ENDPOINT="$(yq '.data.user.cloudflare.r2' "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml")"
  CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/rclone/rclone.conf"
  gum log -sl info 'Ensuring proper permissions on user rclone.conf file' && sudo chown -Rf apple:staff "$CONFIG_FILE"
  if [ "$R2_ENDPOINT" != 'null' ] && get-secret --exists CLOUDFLARE_R2_ID_USER CLOUDFLARE_R2_SECRET_USER; then
    gum log -sl info 'Removing ~/.config/rclone/rclone.conf Install Doctor managed block'
    if cat "$CONFIG_FILE" | grep '# INSTALL DOCTOR MANAGED S3 START' >/dev/null; then
      # TODO: Remove old block
      START_LINE="$(grep -n -m 1 "# INSTALL DOCTOR MANAGED S3 START" "$CONFIG_FILE" | cut -f1 -d ":")"
      END_LINE="$(grep -n -m 1 "# INSTALL DOCTOR MANAGED S3 END" "$CONFIG_FILE" | cut -f1 -d ":")"
      if command -v gsed >/dev/null; then
        gsed -i "$START_LINE,${END_LINE}d" "$CONFIG_FILE" >/dev/null
      else
        sed -i "$START_LINE,${END_LINE}d" "$CONFIG_FILE" >/dev/null
      fi
    fi
    gum log -sl info 'Adding ~/.config/rclone/rclone.conf INSTALL DOCTOR managed block'
    tee -a "$CONFIG_FILE" >/dev/null <<EOT
# INSTALL DOCTOR MANAGED S3 START
[$USER-s3]
access_key_id = $(get-secret CLOUDFLARE_R2_ID_USER)
acl = private
endpoint = ${R2_ENDPOINT}.r2.cloudflarestorage.com
provider = Cloudflare
region = auto
secret_access_key = $(get-secret CLOUDFLARE_R2_SECRET_USER)
type = s3
# INSTALL DOCTOR MANAGED S3 END
EOT
  fi

  ### Add user / group with script in ~/.local/bin/add-usergroup, if it is available
  if command -v add-usergroup >/dev/null; then
    sudo add-usergroup rclone rclone
    sudo add-usergroup "$USER" rclone
  fi

  ### User config file permissions
  if get-secret --exists CLOUDFLARE_R2_ID_USER CLOUDFLARE_R2_SECRET_USER; then
    sudo chmod -f 600 "$CONFIG_FILE"
    sudo chown -f "$USER:rclone" "$CONFIG_FILE"
  fi

  ### Setup /var/cache/rclone
  gum log -sl info 'Ensuring /var/cache/rclone exists'
  sudo mkdir -p /var/cache/rclone
  sudo chmod 750 /var/cache/rclone
  sudo chown -Rf :rclone /var/cache/rclone

  ### Setup /var/log/rclone
  gum log -sl info 'Ensuring /var/log/rclone exists'
  sudo mkdir -p /var/log/rclone
  sudo chmod 750 /var/log/rclone
  sudo chown -Rf rclone:rclone /var/log/rclone

  ### Setup /etc/rcloneignore
  gum log -sl info 'Adding ~/.config/rclone/rcloneignore to /etc/rcloneignore'
  sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/rclone/rcloneignore" /etc/rcloneignore
  sudo chown -Rf rclone:rclone /etc/rcloneignore
  sudo chmod 640 /etc/rcloneignore

  ### Setup /etc/rclone.conf
  gum log -sl info 'Setting permissions on /etc/rclone.conf'
  sudo chown -Rf rclone:rclone /etc/rclone.conf
  sudo chmod 600 /etc/rclone.conf

  if [ -d /Applications ] && [ -d /System ]; then
    if get-secret --exists CLOUDFLARE_R2_ID CLOUDFLARE_R2_SECRET; then
      ### Ensure mount folders are created
      gum log -sl info "Ensuring /Volumes/Private is created with proper permissions"
      sudo mkdir -p "/Volumes/Private"
      sudo chmod 775 "/Volumes/Private"
      sudo chown -f "$USER:rclone" "/Volumes/Private"

      gum log -sl info "Ensuring /Volumes/Public is created with proper permissions"
      sudo mkdir -p "/Volumes/Public"
      sudo chmod 775 "/Volumes/Public"
      sudo chown -f "$USER:rclone" "/Volumes/Public"

      ### Enable Rclone mounts
      gum log -sl info 'Ensuring Rclone mount-on-reboot definitions are in place'
      sudo mkdir -p /Library/LaunchDaemons

      ### rclone.private.plist
      sudo load-service rclone.private

      ### rclone.public.plist
      sudo load-service rclone.public
    fi

    # if get-secret --exists CLOUDFLARE_R2_ID_USER CLOUDFLARE_R2_SECRET_USER; then
    #   ### rclone.user.plist
    #   load-service rclone.user
    # fi
  elif [ -d /etc/systemd/system ]; then
    if get-secret --exists CLOUDFLARE_R2_ID CLOUDFLARE_R2_SECRET; then
      ### Ensure mount folder is created
      gum log -sl info "Ensuring /mnt/Private is created with proper permissions"
      sudo mkdir -p "/mnt/Private"
      sudo chmod 775 "/mnt/Private"
      sudo chown -f "$USER:rclone" "/mnt/Private"

      ### Ensure mount folder is created
      gum log -sl info "Ensuring /mnt/Public is created with proper permissions"
      sudo mkdir -p "/mnt/Public"
      sudo chmod 775 "/mnt/Public"
      sudo chown -f "$USER:rclone" "/mnt/Public"

      ### Enable / restart the service
      gum log -sl info "Enabling / restarting the s3-private S3 service"
      sudo systemctl enable s3-private
      sudo systemctl restart s3-private

      ### Enable / restart the service
      gum log -sl info "Enabling / restarting the s3-public S3 service"
      sudo systemctl enable s3-public
      sudo systemctl restart s3-public
    fi

    ### Add user Rclone mount
    # if get-secret --exists CLOUDFLARE_R2_ID_USER CLOUDFLARE_R2_SECRET_USER; then
    #   gum log -sl info 'Enabling / restarting the S3 user mount'
    #   sudo systemctl enable s3-user
    #   sudo systemctl restart s3-user
    # fi
  fi
else
  gum log -sl info 'rclone is not available'
fi
