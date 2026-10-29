#!/usr/bin/env bash
set -euo pipefail
# @file NGINX post-install configuration
# @brief macOS NGINX config-dir symlink fixup
# @description
#     Post-install configuration for NGINX. On macOS it ensures the Homebrew nginx config directory is a
#     symlink to /etc/nginx so configuration lives in one place.
#
#     NOTE: the former "NGINX Amplify join" (download + run the amplify-agent install.sh when
#     NGINX_AMPLIFY_API_KEY was set) was REMOVED in fire #145. nginxinc/nginx-amplify-agent is archived
#     (GitHub archived:true) and the Amplify service (amplify.nginx.com) was sunset by F5 — the block was dead
#     code that fetched + executed an installer from an archived repo's MOVING master branch (an unverified
#     remote-code-execution supply-chain gap, tracked as the #144 installer-supply-chain known-gap). Removing it
#     eliminates the gap at the root. See docs/aid/ + scripts/test-installer-supply-chain.sh.

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v nginx > /dev/null; then
  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS — keep NGINX config in one place: symlink the Homebrew nginx dir to /etc/nginx
    if [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx" ] && [ ! -L "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx" ]; then
      gum log -sl info "Removing ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx directory and its contents in favor of symlink to /etc/nginx"
      rm -rf "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx"
      ln -s /etc/nginx "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx"
    else
      gum log -sl info "Skipping symlinking of /usr/local/etc/nginx to ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/nginx because directory symlink already appears to be there"
    fi
  fi
fi
