#!/usr/bin/env bash
set -euo pipefail
# @file hiSHtory Initialization
# @brief Configures hiSHtory shell history backend with Infisical / Chezmoi secret sync or offline mode (ADR 0001)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v hishtory > /dev/null 2>&1; then
  if [ ! -f "$HOME/.hishtory/hishtory.db" ]; then
    if command -v get-secret > /dev/null 2>&1 && get-secret --exists HISHTORY_SECRET > /dev/null 2>&1; then
      gum log -sl info 'Initializing hiSHtory with secret from Infisical / host vault'
      hishtory init "$(get-secret HISHTORY_SECRET)" || hishtory init --offline || true
    else
      gum log -sl info 'Initializing hiSHtory in offline local-first mode'
      hishtory init --offline || true
    fi
    hishtory import > /dev/null 2>&1 || true
  else
    gum log -sl info 'hiSHtory is already initialized'
  fi
else
  gum log -sl info 'hishtory is not available in the PATH'
fi
