#!/usr/bin/env bash
set -euo pipefail
# @file Tor Configuration
# @brief This script applies the Tor configuration stored at `${XDG_CONFIG_HOME:-HOME/.config}/tor/torrc` to the system and then restarts Tor
# @description
#     Tor is a network that uses onion routing, originally published by the US Navy. It is leveraged by privacy enthusiasts
#     and other characters that deal with sensitive material, like journalists and people buying drugs on the internet.
#     This script:
#
#     1. Determines the system configuration file location
#     2. Applies the configuration stored at `${XDG_CONFIG_HOME:-HOME/.config}/tor/torrc`
#     3. Enables and restarts the Tor service with the new configuration
#
#     ## Links
#
#     * [Tor configuration](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_config/tor/torrc)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Determine the Tor configuration location by checking whether the system is macOS or Linux
if [ -d /Applications ] && [ -d /System ]; then
  ### macOS
  TORRC_CONFIG_DIR=/usr/local/etc/tor
  sudo mkdir -p "$TORRC_CONFIG_DIR"
else
  ### Linux
  TORRC_CONFIG_DIR=/etc/tor
fi
TORRC_CONFIG="$TORRC_CONFIG_DIR/torrc"

### Apply the configuration if the `torrc` binary is available in the `PATH`
if command -v torify >/dev/null; then
  if [ -d "$TORRC_CONFIG_DIR" ]; then
    ### Copy the configuration from `${XDG_CONFIG_HOME:-$HOME/.config}/tor/torrc` to the system configuration file location
    gum log -sl info "Copying ${XDG_CONFIG_HOME:-$HOME/.config}/tor/torrc to $TORRC_CONFIG"
    sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/tor/torrc" "$TORRC_CONFIG"
    sudo chmod 644 "$TORRC_CONFIG"
    ### Enable and restart the Tor service
    if [ -d /Applications ] && [ -d /System ]; then
      ### macOS
      if [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor" ] && [ ! -f "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc" ]; then
        gum log -sl info "Symlinking /usr/local/etc/tor/torrc to ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc"
        ln -s /usr/local/etc/tor/torrc "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc"
      else
        if [ -L "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc" ]; then
          gum log -sl info ""${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc" already symlinked to $TORRC_CONFIG"
        else
          gum log -sl warn ""${HOMEBREW_PREFIX:-/opt/homebrew}/etc/tor/torrc" not symlinked!"
        fi
      fi
      gum log -sl info 'Running brew services restart tor'
      brew services restart tor && gum log -sl info 'Tor successfully restarted'
    else
      if [[ ! "$(test -d /proc && grep Microsoft /proc/version >/dev/null)" ]]; then
        ### Linux
        gum log -sl info 'Running sudo systemctl enable / restart tor'
        sudo systemctl enable tor
        sudo systemctl restart tor
        gum log -sl info 'Tor service enabled and restarted'
      else
        gum log -sl info 'Environment is WSL so the Tor systemd service will not be enabled / restarted'
      fi
    fi
  else
    gum log -sl warn 'The '"$TORRC_CONFIG_DIR"' directory is missing'
  fi
else
  gum log -sl warn 'torify is missing from the PATH'
fi
