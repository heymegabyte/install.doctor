#!/usr/bin/env bash
# @file post-installx/executable_post-wazuh.sh
# @brief Verifies and starts an already selected Wazuh agent.
# @description Package/repository enrollment is owned by the signed desired-state
# closure. This hook never downloads packages or repository trust roots.
set -euo pipefail

if command -v gum >/dev/null 2>&1; then
  log() { gum log -sl info "$*"; }
  warn() { gum log -sl warn "$*"; }
else
  log() { printf '[post-wazuh] %s\n' "$*"; }
  warn() { printf '[post-wazuh] WARNING: %s\n' "$*" >&2; }
fi

WAZUH_CONTROL=''
for candidate in /Library/Ossec/bin/wazuh-control /var/ossec/bin/wazuh-control; do
  if [ -x "$candidate" ]; then
    WAZUH_CONTROL="$candidate"
    break
  fi
done
if [ -z "$WAZUH_CONTROL" ] && command -v wazuh-control >/dev/null 2>&1; then
  WAZUH_CONTROL="$(command -v wazuh-control)"
fi

if [ -z "$WAZUH_CONTROL" ]; then
  warn 'Wazuh agent is absent; select a platform-pinned agent through Install Doctor desired state'
  exit 20
fi

# Enrollment secrets are intentionally not passed on argv or persisted in a
# temporary installer environment. Existing enrollment is preserved; typed
# secret-FD enrollment owns any future first-registration workflow.
if [ -f /Library/Ossec/etc/ossec.conf ] || [ -f /var/ossec/etc/ossec.conf ]; then
  log 'Starting the existing Wazuh agent configuration'
  if [ "$(id -u)" -eq 0 ]; then
    "$WAZUH_CONTROL" start
  else
    sudo -n "$WAZUH_CONTROL" start
  fi
else
  warn 'Wazuh is installed but has no admitted configuration; registration remains pending'
  exit 20
fi
