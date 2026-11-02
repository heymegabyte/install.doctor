#!/usr/bin/env bash
set -euo pipefail
# @file juicefs_home_mount.sh
# @description Ensures JuiceFS mounts the user's home directory on boot.
# This script supports both macOS (LaunchDaemon) and Linux (systemd service).

set -euo pipefail

LOG_FILE="/var/log/juicefs_mount.log"
JUICEFS_CMD="/usr/local/bin/juicefs"
MOUNT_POINT="$HOME"
FILESYSTEM_NAME="private"
BACKUP_DIR="/tmp/juicefs_backups"
BACKUP_FILE="$BACKUP_DIR/home_backup.tar.gz"
BACKUP_FLAG="$HOME/.cache/juicefs_backup_done"
RESTORE_FLAG="$HOME/.cache/juicefs_restore_done"

# @description Logs messages with timestamp and outputs to log file.
# @param $1 The message to log.
logMessage() {
    gum log -sl info "$(date '+%Y-%m-%d %H:%M:%S') - $1" | sudo tee -a "$LOG_FILE"
}

# @description Ensures the JuiceFS service is running.
# On macOS, uses launchctl to load LaunchDaemon.
# On Linux, enables and starts systemd service if not already running.
ensureServiceRunning() {
    if [[ "$(uname)" == "Darwin" ]]; then
        if ! launchctl list | grep -q "com.juicefs.home.mount"; then
            logMessage "JuiceFS service not running. Loading LaunchDaemon..."
            load-service com.juicefs.home.mount
        fi
    elif [[ -f "/etc/systemd/system/juicefs-home-mount.service" ]]; then
        if ! systemctl is-active --quiet juicefs-home-mount; then
            logMessage "JuiceFS service not running. Enabling and starting systemd service..."
            sudo systemctl enable juicefs-home-mount
            sudo systemctl start juicefs-home-mount
        fi
    fi
}

# @description Creates a compressed backup of the home directory.
# Skips backup if already completed.
backupHomeDirectory() {
    if [[ -f "$BACKUP_FLAG" ]]; then
        logMessage "Backup already exists. Skipping backup."
        return
    fi
    logMessage "Backing up home directory to $BACKUP_FILE..."
    mkdir -p "$BACKUP_DIR"
    tar -czf "$BACKUP_FILE" -C "$MOUNT_POINT" .
    touch "$BACKUP_FLAG"
    logMessage "Home directory backup completed."
}

# @description Restores the home directory from backup after syncing JuiceFS metadata.
# Skips restore if already completed or no backup is found.
restoreHomeDirectory() {
    if [[ -f "$RESTORE_FLAG" ]]; then
        logMessage "Restore already completed. Skipping restore."
        return
    fi
    if [[ -f "$BACKUP_FILE" ]]; then
        logMessage "Waiting for JuiceFS to sync file system meta..."
        sudo "$JUICEFS_CMD" sync "$FILESYSTEM_NAME"
        logMessage "Restoring home directory from backup..."
        sudo tar -xzf "$BACKUP_FILE" -C "$MOUNT_POINT"
        sudo touch "$RESTORE_FLAG"
        logMessage "Home directory restore completed."
        logMessage "Removing backed up home directory"
        sudo rm -f "$BACKUP_FILE"
    else
        logMessage "No backup found, skipping restore."
    fi
}

# @description Mounts JuiceFS to the home directory if not already mounted.
mountJuicefs() {
    if mount | grep -q " $MOUNT_POINT "; then
        logMessage "JuiceFS already mounted on $MOUNT_POINT"
        return 0
    fi

    logMessage "Mounting JuiceFS on $MOUNT_POINT..."
    UPDATE_FSTAB="--update-fstab"
    if [ -d /Applications ] && [ -d /System ]; then
      UPDATE_FSTAB=""
    fi
    sudo "$JUICEFS_CMD" mount --enable-xattr -o user_id="$(id -u "${USER:-$(id -un)}")",group_id="$(id -g "${USER:-$(id -un)}")" --conf-dir "${XDG_CONFIG_HOME:-$HOME/.config}/juicefs" -b $UPDATE_FSTAB "$FILESYSTEM_NAME" "$MOUNT_POINT" --no-ui &
    sleep 2
    if mount | grep -q " $MOUNT_POINT "; then
        logMessage "JuiceFS mounted successfully on $MOUNT_POINT"
        logMessage "Running JuiceFS sync after mount..."
        sudo "$JUICEFS_CMD" sync "$FILESYSTEM_NAME"
        logMessage "JuiceFS sync completed."
    else
        logMessage "ERROR: Failed to mount JuiceFS on $MOUNT_POINT"
        exit 1
    fi
}

logMessage "Starting JuiceFS home directory mount script..."
backupHomeDirectory
mountJuicefs
restoreHomeDirectory
ensureServiceRunning

### Linux systemd
if command -v systemctl > /dev/null && [ ! -f /etc/systemd/system/docker.service.d/override.conf ]; then
  gum log -sl info 'Ensuring /etc/systemd/system/docker.service.d exists as a directory' && sudo mkdir -p /etc/systemd/system/docker.service.d
  gum log -sl info 'Creating /etc/systemd/system/docker.service.d/override.conf which ensures JuiceFS is loaded before Docker starts'
  echo '[Unit]' | sudo tee /etc/systemd/system/docker.service.d/override.conf
  echo 'After=network-online.target firewalld.service containerd.service jfs.mount' | sudo tee -a /etc/systemd/system/docker.service.d/override.conf
fi
