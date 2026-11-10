#!/usr/bin/env bash
set -euo pipefail
# @file VS Code extensions
# @brief Installs approved extensions from the deployed extensions.json when VS Code is present.
# @description
#     This script loops through all the extensions listed in the [`home/dot_config/Code/User/extensions.json`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/extensions.json)
#     file and installs missing entries when Visual Studio Code is available.
#
#     The `extensions.json` file is used to house the plugin list so that if you decide to remove this auto-installer script then
#     VSCode will retain some functionality from the file. It will show a popover card that recommends installing any plugins in the
#     list that are not already installed.
#
#     ## Links
#
#     * [Visual Studio Code settings folder](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User)
#     * [Visual Studio Code `extensions.json`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/extensions.json)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Hides useless error during extension installations
# Error looks like:
#     (node:53151) [DEP0005] DeprecationWarning: Buffer() is deprecated due to security and usability issues. Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.
#     (Use `Electron --trace-deprecation ...` to show where the warning was created)
export NODE_OPTIONS=--throw-deprecation

# Package installation belongs to the signed selected desired-state closure.
# This hook only configures an already admitted editor.

# @description Install Visual Studio Code extensions if they are not already installed (by checking the `code --list-extensions` output)
if command -v code > /dev/null; then
  EXTENSIONS="$(code --list-extensions)"
  jq -r '.recommendations[]' "${XDG_CONFIG_HOME:-$HOME/.config}/Code/User/extensions.json" | while read EXTENSION; do
    if ! echo "$EXTENSIONS" | grep -iF "$EXTENSION" > /dev/null; then
      gum log -sl info 'Installing Visual Studio Code extension '"$EXTENSION"'' && code --install-extension "$EXTENSION" || gum log -sl error "Failed to install VSCode extension: $EXTENSION"
      gum log -sl info 'Installed '"$EXTENSION"''
    else
      gum log -sl info ''"$EXTENSION"' already installed'
    fi
  done
else
  gum log -sl info 'code executable not available - skipping plugin install process for it'
fi

# Linter/runtime packages are selected by desired state and resolved lazily.
# This editor hook never writes package manifests to / or $HOME and never runs
# an ambient lockfile-free npm installation.
