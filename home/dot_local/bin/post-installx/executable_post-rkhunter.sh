#!/usr/bin/env bash
set -euo pipefail
# @file rkhunter configuration
# @brief This script applies the rkhunter integration and updates it as well

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v rkhunter > /dev/null; then
    if [ -d /Applications ] && [ -d /System ]; then
      ### macOS
      RKHUNTER_CONF="$(brew --prefix rkhunter 2>/dev/null)/etc/rkhunter.conf"
      if [ -f "$RKHUNTER_CONF" ]; then
        gum log -sl info "Updating file $RKHUNTER_CONF" && gsed -i "s/^#WEB_CMD.*$/WEB_CMD=curl\ -L/" "$RKHUNTER_CONF"
      fi
      PATH="$(echo "$PATH" | gsed 's/VMware Fusion.app/VMwareFusion.app/g')"
      PATH="$(echo "$PATH" | gsed 's/IntelliJ IDEA CE.app/IntelliJIDEACE.app/g')"
      export PATH
    else
      ### Linux
      gum log -sl info 'Updating file /etc/rkhunter.conf' && sed -i  "s/^#WEB_CMD.*$/WEB_CMD=curl\ -L/" /etc/rkhunter.conf
    fi
    sudo rkhunter --propupd || gum log -sl warn "sudo rkhunter --propupd returned non-zero exit code"
    sudo rkhunter --update || gum log -sl warn "sudo rkhunter --update returned non-zero exit code"
else
    gum log -sl info 'rkhunter is not installed'
fi
