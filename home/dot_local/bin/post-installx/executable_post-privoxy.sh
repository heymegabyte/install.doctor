#!/usr/bin/env bash
set -euo pipefail
# @file Privoxy Configuration
# @brief This script applies the Privoxy configuration stored at `${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config` to the system and then restarts Privoxy
# @description
#     Privoxy is a web proxy that can be combined with Tor to provide an HTTPS / HTTP proxy that can funnel all traffic
#     through Tor. This script:
#
#     1. Determines the system configuration file location
#     2. Applies the configuration stored at `${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config`
#     3. Enables and restarts the Privoxy service with the new configuration
#
#     ## Links
#
#     * [Privoxy configuration](https://github.com/megabyte-labs/install.doctor/tree/master/home/dot_config/privoxy/config)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Configure variables
if [ -d /Applications ] && [ -d /System ]; then
  ### macOS
  PRIVOXY_CONFIG_DIR=/usr/local/etc/privoxy
else
  ### Linux
  PRIVOXY_CONFIG_DIR=/etc/privoxy
fi
PRIVOXY_CONFIG="$PRIVOXY_CONFIG_DIR/config"

if command -v privoxy > /dev/null; then
  if [ -f "${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config" ]; then
    sudo mkdir -p "$PRIVOXY_CONFIG_DIR"
    gum log -sl info "Copying ${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config to $PRIVOXY_CONFIG"
    sudo cp -f "${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config" "$PRIVOXY_CONFIG"
    gum log -sl info "Running sudo chmod 600 $PRIVOXY_CONFIG"
    sudo chmod 600 "$PRIVOXY_CONFIG"
    if command -v add-usergroup > /dev/null; then
      sudo add-usergroup privoxy privoxy
      sudo add-usergroup "$USER" privoxy
    fi
    gum log -sl info 'Applying proper permissions to Privoxy configuration'
    sudo chown privoxy:privoxy "$PRIVOXY_CONFIG" 2> /dev/null || sudo chown "privoxy:$(id -g -n)" "$PRIVOXY_CONFIG"
    if [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/privoxy" ] && [ ! -f "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/privoxy/config" ]; then
      gum log -sl info "Symlinking $PRIVOXY_CONFIG to ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/privoxy/config"
      ln -s "$PRIVOXY_CONFIG" "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/privoxy/config"
    fi
    ### Restart Privoxy after configuration is applied
    if [ -d /Applications ] && [ -d /System ]; then
      ### macOS
      gum log -sl info 'Running brew services restart privoxy'
      brew services restart privoxy
    else
      ### Linux
      if [[ ! "$(test -d /proc && grep Microsoft /proc/version > /dev/null)" ]]; then
        gum log -sl info 'Running sudo systemctl enable / restart privoxy'
        sudo systemctl enable privoxy
        sudo systemctl restart privoxy
      else
        gum log -sl info 'The system is a WSL environment so the Privoxy systemd service will not be enabled / restarted'
      fi
    fi
  else
    gum log -sl info "${XDG_CONFIG_HOME:-HOME/.config}/privoxy/config is missing so skipping set up of Privoxy"
  fi
else
  gum log -sl info 'privoxy is not installed or not available in the PATH'
fi
