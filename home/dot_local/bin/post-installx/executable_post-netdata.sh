#!/usr/bin/env bash
# @file Netdata desired-state boundary
# @brief Refuses legacy unjournaled claiming and host mutation.
set -euo pipefail

log() {
  if command -v gum >/dev/null 2>&1; then gum log -sl "$1" "$2"
  else printf 'netdata: %s\n' "$2" >&2
  fi
}

if ! command -v netdata >/dev/null 2>&1; then
  log info 'Netdata is not installed; select it through desired state before configuration'
  exit 20
fi

# Netdata's supported automated claim path is a protected claim.conf (root:netdata
# 0640 on service installs, user-owned 0600 on Homebrew). The retired hook used
# the deprecated claiming helper with secrets in argv and also performed unrelated,
# unjournaled ownership, kernel, alert, and service mutations. Keep the installed
# agent untouched until these effects are represented by separate typed engine
# operations with durable compensation and protected secret-file activation.
log warn 'Netdata is installed but automated claiming and host tuning remain unsupported until typed reversible operations are available'
exit 20
