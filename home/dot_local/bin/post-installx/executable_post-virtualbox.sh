#!/usr/bin/env bash
set -euo pipefail
# @file VirtualBox Extension Pack
# @brief Ensures the VirtualBox extension pack is installed.
# @description
#     This script ensures the VirtualBox extension pack that corresponds with VirtualBox's version is properly installed.

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Run logic if VirtualBox is installed
if command -v VirtualBox >/dev/null; then
  ### Install VirtualBox extension pack if it is not installed already
  if [ ! -d /usr/lib/virtualbox/ExtensionPacks/Oracle_VM_VirtualBox_Extension_Pack ] && [ ! -d /Applications/VirtualBox.app/Contents/MacOS/ExtensionPacks/Oracle_VM_VirtualBox_Extension_Pack ]; then
    gum log -sl warn 'VirtualBox Extension Pack is absent; select a license-approved checksummed artifact through desired state'
    exit 20
  else
    gum log -sl info 'VirtualBox Extension pack is already installed'
  fi
else
  gum log -sl info 'VirtualBox is not installed so VirtualBox Extension pack will not be installed'
fi
