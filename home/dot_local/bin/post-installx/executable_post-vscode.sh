#!/usr/bin/env bash
set -euo pipefail
# @file VSCode Extensions / Global NPM Modules Fallback
# @brief Installs all of the Visual Studio Code extensions specified in the [`home/dot_config/Code/User/extensions.json`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/extensions.json) file and installs NPM packages to the system `/` directory as a catch-all for tools that recursively search upwards for shared NPM configurations.
# @description
#     This script loops through all the extensions listed in the [`home/dot_config/Code/User/extensions.json`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/extensions.json)
#     file. It installs the extensions when either Visual Studio Code or VSCodium is installed. If both are installed, then both will
#     have the plugins automatically installed.
#
#     The `extensions.json` file is used to house the plugin list so that if you decide to remove this auto-installer script then
#     VSCode will retain some functionality from the file. It will show a popover card that recommends installing any plugins in the
#     list that are not already installed.
#
#     ## Plugin Settings
#
#     Most of the plugin settings have been configured and optimized to work properly with the other default settings
#     included by Install Doctor. These settings can be found in the [`home/dot_config/Code/User/settings.json` file](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/settings.json).
#     If you manage to come up with an improvement, please open a pull request so other users can benefit from your work.
#
#     ## Default Extensions
#
#     The default plugins in the `extensions.json` list are catered mostly towards full-stack web development. The technologies
#     that are catered to by the default extensions relate to TypeScript, JavaScript, Go, Python, Rust, and many more technologies.
#     Most of the plugins are not language-specific.
#
#     ## Global NPM Modules Fallback
#
#     This script makes fallback linter and code auto-fixer configurations globally available. Normally, configurations, like
#     the ones used for ESLint, are installed at the project level by specifying the NPM package configuration
#     in the `package.json` file (or via an `.eslintrc` file). However, whenever no configuration is present, IDEs like
#     Visual Studio Code will recursively search upwards in the directory tree, trying to find an ESLint configuration.
#
#     This script addresses this issue by installing a set of shared NPM packages that enhance the functionality of tools like ESLint
#     by placing a `package.json` with all the necessary settings into the highest directory possible and then installing the package's
#     modules. This normally results in a `package.json` file and `node_modules/` folder at the root of the system.
#
#     ## NPM Packages Included
#
#     To reduce clutter, all the configurations are mapped out in the `package.json` file. Our default `package.json` file includes
#     the following configuration:
#
#     ```json
#     <!-- AUTO-GENERATED:START (REMOTE:url=https://raw.githubusercontent.com/heymegabyte/install.doctor/master/home/dot_config/Code/User/package.json) -->
#     {
#       ...
#       // Notable dependencies listed below
#       "dependencies": {
#         "eslint-config-strictlint": "latest",
#         "jest-preset-ts": "latest",
#         "prettier-config-strictlint": "latest",
#         "remark-preset-strictlint": "latest",
#         "stylelint-config-strictlint": "latest"
#       },
#       ...
#     }
#     <!-- AUTO-GENERATED:END -->
#     ```
#
#     ## Strict Lint
#
#     More details on the shared configurations can be found at [StrictLint.com](https://strictlint.com).
#     Strict Lint is another brand maintained by Megabyte Labs that is home to many of the well-crafted
#     shared configurations that are included in our default NPM configuration fallback settings.
#
#     ## Notes
#
#     * If the system root directory is not writable (even with `sudo`), then the shared modules are installed to the provisioning user's `$HOME` directory
#
#     ## Links
#
#     * [`package.json` configuration file](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/Code/User/package.json)
#     * [StrictLint.com documentation](https://strictlint.com/docs)
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
