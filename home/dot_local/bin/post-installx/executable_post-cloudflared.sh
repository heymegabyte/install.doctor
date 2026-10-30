#!/usr/bin/env bash
set -euo pipefail
# @file Cloudflared Configuration
# @brief Applies cloudflared configuration, connects to Argo tunnel with managed configuration, and enables it on system start
# @description
#     1. Skips the deletion of a tunnel when it is currently in use

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v cloudflared > /dev/null; then
  ### Show error message about ~/.cloudflared already existing
  if [ -d "$HOME/.cloudflared" ]; then
    gum log -sl error "$HOME/.cloudflared is already in the home directory - to ensure proper deployment, remove the $HOME/.cloudflared configuration folder" && exit 1
  fi

  ### Use lowercased hostname / tunnel ID
  HOSTNAME_LOWER="host-$(hostname -s | tr '[:upper:]' '[:lower:]')"

  ### Remove previous tunnels connected to host
  while read TUNNEL_ID; do
    gum log -sl info "Deleteing CloudFlared tunnel ID $TUNNEL_ID"
    unset TUNNEL_EXIT_CODE
    sudo cloudflared tunnel delete "$TUNNEL_ID" || TUNNEL_EXIT_CODE=$?
    if [ -z "${TUNNEL_EXIT_CODE:-}" ]; then
      gum log -sl info "Removing credentials for $TUNNEL_ID which is not in use"
      sudo rm -f "/usr/local/etc/cloudflared/${TUNNEL_ID}.json"
    else
      gum log -sl info "Skipping deletion of $TUNNEL_ID credentials since it is in use"
    fi
  done< <(sudo cloudflared tunnel list | grep "$HOSTNAME_LOWER" | sed 's/ .*//')

  ### Register tunnel (if not already registered)
  gum log -sl info "Creating CloudFlared tunnel named $HOSTNAME_LOWER"
  sudo cloudflared tunnel create "$HOSTNAME_LOWER" || true

  ### Acquire TUNNEL_ID and symlink credentials.json
  TUNNEL_ID="$(sudo cloudflared tunnel list | grep "$HOSTNAME_LOWER" | sed 's/ .*//')"
  gum log -sl info "Tunnel ID: $TUNNEL_ID"
  gum log -sl info "Symlinking /usr/local/etc/cloudflared/$TUNNEL_ID.json to /usr/local/etc/cloudflared/credentials.json"
  sudo rm -f /usr/local/etc/cloudflared/credentials.json
  sudo ln -s /usr/local/etc/cloudflared/$TUNNEL_ID.json /usr/local/etc/cloudflared/credentials.json

  ### Configure DNS
  ### Note: The DNS records that are added via cloudflared must be deleted manually if no longer used
  gum log -sl info 'Setting up DNS records for CloudFlare Argo tunnels'
  while read DOMAIN; do
    if [ "$DOMAIN" != 'null' ]; then
      gum log -sl info "Setting up $DOMAIN for access through cloudflared (Tunnel ID: $TUNNEL_ID)"
      gum log -sl info "Running sudo cloudflared tunnel route dns -f $TUNNEL_ID $DOMAIN"
      sudo cloudflared tunnel route dns -f "$TUNNEL_ID" "$DOMAIN"
      gum log -sl info "Successfully routed $DOMAIN to this machine's cloudflared Argo tunnel"
    fi
  done< <(yq '.ingress[].hostname' /usr/local/etc/cloudflared/config.yml)

  ### Update /usr/local/etc/cloudflared/config.yml
  gum log -sl info 'Updating /usr/local/etc/cloudflared/config.yml to reference tunnel ID'
  sudo yq eval -i ".tunnel = \"$HOSTNAME_LOWER\"" /usr/local/etc/cloudflared/config.yml

  ### Set up service
  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS
    if [ -f /Library/LaunchDaemons/com.cloudflare.cloudflared.plist ]; then
      gum log -sl info 'cloudflared service is already installed'
    else
      gum log -sl info 'Running sudo cloudflared service install'
      sudo cloudflared service install
    fi

    ### Apply patched version of the LaunchDaemon
    load-service com.cloudflare.cloudflared
  elif [ -f /etc/os-release ]; then
    ### Linux
    if systemctl --all --type service | grep -q "cloudflared" > /dev/null; then
      gum log -sl info 'cloudflared service is already available as a service'
    else
      gum log -sl info 'Running sudo cloudflared service install'
      sudo cloudflared service install
    fi

    ### Start / enabled the systemd service
    gum log -sl info 'Ensuring cloudflared service is started'
    sudo systemctl start cloudflared
    gum log -sl info 'Enabling cloudflared as a boot systemctl service'
    sudo systemctl enable cloudflared
  else
    # System is Windows
    cloudflared service install
    mkdir C:\Windows\System32\config\systemprofile\.cloudflared
    # Copy same cert.pem as being used above
    # copy C:\Users\%USERNAME%\.cloudflared\cert.pem C:\Windows\System32\config\systemprofile\.cloudflared\cert.pem
    # https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/local/as-a-service/windows/
  fi
else
  gum log -sl info 'cloudflared was not installed so CloudFlare Tunnels cannot be enabled'
fi
