#!/usr/bin/env bash
set -euo pipefail
# @file Volta initialization
# @brief Configure an admitted Volta installation without acquiring mutable runtimes

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

export VOLTA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/volta"
export PATH="$VOLTA_HOME/bin:$PATH"

### Disconnect from CloudFlare WARP (if connected)
if command -v warp-cli > /dev/null; then
  warp-cli disconnect && gum log -sl info 'CloudFlare WARP temporarily disconnected while Volta installs Node / Yarn'
fi

### Configure Volta if it is installed
if command -v volta > /dev/null; then
    gum log -sl info 'Running volta setup'
    volta setup
    volta list node 2>/dev/null | grep -q . || gum log -sl warn 'No Volta-managed Node runtime is installed; select an exact version in desired state'
    volta list yarn 2>/dev/null | grep -q . || gum log -sl warn 'No Volta-managed Yarn runtime is installed; select an exact version in desired state'
else
    gum log -sl info 'Volta is not installed'
fi
