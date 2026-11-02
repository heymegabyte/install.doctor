#!/usr/bin/env bash
set -euo pipefail
# @file DockerHub Login
# @brief Logs into DockerHub for Docker Desktop
# @description
#     This script logs into DockerHub so that Docker Desktop is pre-authenticated. This
#     functionality requires that the `DOCKERHUB_USER` be passed in as an environment variable (or
#     directly editted in the `~/.config/chezmoi/chezmoi.yaml` file) and that the `DOCKERHUB_TOKEN`
#     be passed in as a secret (either via the encrypted secret method or passed in as an environment
#     variable).

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v docker > /dev/null; then
  ### Acquire DOCKERHUB_USER
  if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml" ]; then
    DOCKERHUB_USER="$(yq '.data.user.docker.username' "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml")"
  else
    gum log -sl info "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml is missing — skipping DockerHub pre-authentication"
    exit 0
  fi

  ### Launch Docker.app
  if [ -d "/Applications/Docker.app" ] || [ -d "$HOME/Applications/Docker.app" ]; then
    gum log -sl info 'Ensuring Docker.app is running' && open --background -a Docker --args --accept-license --unattended
  fi

  ### Pre-authenticate with DockerHub
  if get-secret --exists DOCKERHUB_TOKEN; then
    if [ "$DOCKERHUB_USER" != 'null' ]; then
      gum log -sl info 'Headlessly authenticating with DockerHub registry'
      echo "$(get-secret DOCKERHUB_TOKEN)" | docker login -u "$DOCKERHUB_USER" --password-stdin > /dev/null
      gum log -sl info 'Successfully authenticated with DockerHub registry'
    else
      gum log -sl info 'Skipping logging into DockerHub because DOCKERHUB_USER is undefined'
    fi
  else
    gum log -sl info 'Skipping logging into DockerHub because DOCKERHUB_TOKEN is undefined'
  fi
fi
