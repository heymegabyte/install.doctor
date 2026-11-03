#!/usr/bin/env bash
set -euo pipefail
# @file Tailscale
# @brief Connects the Tailscale client with the Tailscale network
# @description
#     This script ensures the `tailscaled` system daemon is installed on macOS. Then, on both macOS and Linux, it connects to the Tailscale
#     network if the `TAILSCALE_AUTH_KEY` variable is provided.
#
#     If CloudFlare WARP is also installed, this script will disconnect from it and then reconnect after Tailscale is connected.
#     This is a quirk and Tailscale has no roadmap for fixing it for use alongside other VPNs. To setup Tailscale to work alongside
#     CloudFlare WARP, you will have to set up a [split tunnel](https://www.youtube.com/watch?v=eDFs8hm3xWc) for
#     [Tailscale IP addresses](https://tailscale.com/kb/1105/other-vpns).

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Disconnect from CloudFlare WARP (if connected)
if command -v warp-cli > /dev/null; then
  warp-cli disconnect && gum log -sl info 'CloudFlare WARP temporarily disconnected while Tailscale connects'
fi

### Install the Tailscale system daemon
if [ -d /Applications ] && [ -d /System ]; then
  ### macOS
  if command -v tailscaled > /dev/null; then
    gum log -sl info 'Ensuring tailscaled system daemon is installed'
    sudo tailscaled install-system-daemon
    gum log -sl info 'tailscaled system daemon is now installed and will load on boot'
  else
    gum log -sl info 'tailscaled does not appear to be installed'
  fi

  ### Open Tailscale.app
  if [ -d /Applications/Tailscale.app ]; then
    gum log -sl info 'Opening Tailscale.app menu bar widget' && open -a Tailscale
  else
    gum log -sl info '/Applications/Tailscale.app is missing from the system'
  fi
fi

### Connect to Tailscale network
if get-secret --exists TAILSCALE_AUTH_KEY; then
  if [ -f /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    gum log -sl info 'Connecting to Tailscale with user-defined authentication key (TAILSCALE_AUTH_KEY)'
    timeout 30 /Applications/Tailscale.app/Contents/MacOS/Tailscale up --authkey="$(get-secret TAILSCALE_AUTH_KEY)" --accept-routes || EXIT_CODE=$?
    if [ -n "${EXIT_CODE:-}" ]; then
      gum log -sl warn '/Applications/Tailscale.app/Contents/MacOS/Tailscale timed out'
    fi
    gum log -sl info 'Disabling update check'
    /Applications/Tailscale.app/Contents/MacOS/Tailscale set --update-check=false
  elif command -v tailscale > /dev/null; then
    gum log -sl info 'Connecting to Tailscale with user-defined authentication key (TAILSCALE_AUTH_KEY)'
    timeout 30 tailscale up --authkey="$(get-secret TAILSCALE_AUTH_KEY)" --accept-routes || EXIT_CODE=$?
    if [ -n "${EXIT_CODE:-}" ]; then
      gum log -sl warn 'tailscale up timed out'
    else
      gum log -sl info 'Connected to Tailscale network'
    fi
    gum log -sl info 'Disabling notifications about updates'
    tailscale set --update-check=false
    gum log -sl info 'Setting tailscale to auto-update'
    tailscale set --auto-update
  else
    gum log -sl info 'tailscale does not appear to be installed'
  fi
else
  gum log -sl info 'TAILSCALE_AUTH_KEY is not defined so not logging into Tailscale network'
fi

### Re-connect CloudFlare WARP after Tailscale is connected
if command -v warp-cli > /dev/null; then
  ### Register CloudFlare WARP
  if warp-cli --accept-tos status | grep 'Registration Missing' > /dev/null; then
    gum log -sl info 'Registering CloudFlare WARP'
    warp-cli --accept-tos registration new
  else
    gum log -sl info 'Either there is a misconfiguration or the device is already registered with CloudFlare WARP'
  fi

  ### Connect CloudFlare WARP
  if warp-cli --accept-tos status | grep 'Disconnected' > /dev/null; then
    gum log -sl info 'Connecting to CloudFlare WARP'
    warp-cli --accept-tos connect > /dev/null && gum log -sl info 'Connected to CloudFlare WARP'
  else
    gum log -sl info 'Either there is a misconfiguration or the device is already connected with CloudFlare WARP'
  fi
fi