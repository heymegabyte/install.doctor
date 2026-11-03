#!/usr/bin/env bash
set -euo pipefail
# @file Tabby Plugins
# @brief This script installs the default Tabby plugins which are defined in `${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins/package.json`
# @description
#     This script pre-installs a handful of useful Tabby plugins which are defined in `${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins/package.json`.
#     These default plugins can be customized by editting the `package.json` file stored in your Install Doctor fork in the Tabby `plugins/package.json`
#     file.
#
#     ## Default Plugins Configuration
#
#     The script will install all the plugins defined in the `package.json` file by navigating to the `~/.config/tabby/plugins` folder
#     and then run `npm install`. The default configuration will include the following plugins:
#
#     ```json
#     {
#       ...
#       // Notable dependencies listed below
#       "dependencies": {
#         "tabby-docker": "^0.2.0",
#         "tabby-save-output": "^3.1.0",
#         "tabby-search-in-browser": "^0.0.1",
#         "tabby-workspace-manager": "^0.0.4"
#       },
#       ...
#     }
#     ```
#
#     ## Default Plugin Descriptions
#
#     The following chart provides a short description of the default plugins that are pre-installed alongside Tabby:
#
#     | NPM Package               | Description                                                         |
#     |---------------------------|---------------------------------------------------------------------|
#     | `tabby-docker`            | Allows you to shell directly into Docker containers                 |
#     | `tabby-save-output`       | This plugin lets you stream console output into a file.             |
#     | `tabby-search-in-browser` | Allows you to open a internet browser and search for selected text. |
#     | `tabby-workspace-manager` | Allows you to create multiple workspace profiles.                   |
#
#     ## Links
#
#     * [Tabby plugins `package.json`](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_config/tabby/plugins/package.json)
#     * [Secrets / Environment variables documentation](https://install.doctor/docs/customization/secrets) which details how to store your Tabby configuration in as an encrypted file

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins/package.json" ]; then
  if [ -d "${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins/node_modules" ]; then
    gum log -sl info 'Skipping Tabby plugin installation because it looks like the plugins were already installed since node_modules is present in ~/.config/tabby/plugins'
  else
    gum log -sl info 'Installing Tabby plugins defined in '"${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins/package.json"''
    cd "${XDG_CONFIG_HOME:-$HOME/.config}/tabby/plugins"
    npm install --quiet --no-progress
    gum log -sl info 'Finished installing Tabby plugins'
  fi
else
  gum log -sl info 'Skipping Tabby plugin installation because is not present'
fi
