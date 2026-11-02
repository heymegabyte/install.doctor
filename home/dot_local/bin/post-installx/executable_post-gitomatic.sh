#!/usr/bin/env bash
set -euo pipefail
# @file git-o-matic Configuration
# @brief Starts service on Linux systems to monitor Git repositories
# @description
#     git-o-matic is a tool to monitor git repositories and automatically pull/push changes. Multiple repositories can be
#     monitored by running multiple instances of `gitomatic`. This script supports SSH Key based authentication only.
#
#     If the `gitomatic` program is installed, this script creates and starts a Systemd service to monitor the repositories.
#     The repositories are cloned if they are not available at the path.
#
#     ## Notes
#     * The author name and email address for commits are the same as `.user.name` and `.user.email` (configured in the `home/.chezmoi.yaml.tmpl` file)
#     * `gitomatic` automatically pushes and pulls changes. The script does not change this behavior
#     * `gitomatic` checks for changes every minute. This setting is not changed by this script
#     * The User's default SSH Key is used for authentication
#
#     ## Links
#
#     * [gitomatic GitHub repository](https://github.com/muesli/gitomatic/)
#     * [Systemd Unit file](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/gitomatic/gitomatic.service.tmpl)
#     * [Helper script](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_gitomatic_service.tmpl

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v gitomatic > /dev/null; then
  ### Copy gitomatic-service to /usr/local/bin
  gum log -sl info "Copying $HOME/.local/bin/gitomatic-service to /usr/local/bin/gitomatic-service"
  sudo cp -f "$HOME/.local/bin/gitomatic-service" /usr/local/bin/gitomatic-service
  
  ### Copy gitomatic to global directory
  if [ ! -f /usr/local/bin/gitomatic ]; then
    gum log -sl info 'Copying gitomatic executable to /usr/local/bin/gitomatic'
    sudo cp -f "$(which gitomatic)" /usr/local/bin/gitomatic
  fi

  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS
    gum log -sl info 'Enabling the com.github.muesli.gitomatic LaunchDaemon'
    load-service com.github.muesli.gitomatic
  else
    ### Linux
    gum log -sl info 'Copying gitomatic systemd unit file to /etc/systemd/system/'
    sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/gitomatic/gitomatic.service" /etc/systemd/system/gitomatic.service
    gum log -sl info 'Reloading systemd daemon'
    sudo systemctl daemon-reload
    gum log -sl info 'Enabling and starting gitomatic service'
    sudo systemctl enable --now gitomatic
  fi
else
  gum log -sl info 'gitomatic is not installed or it is not available in PATH'
fi
