#!/usr/bin/env bash
set -euo pipefail
# @file hiSHtory Initialization
# @brief Preserves an existing hiSHtory initialization without exposing its sync secret in process arguments

log() {
  if command -v gum >/dev/null 2>&1; then gum log -sl "$1" "$2"
  else printf 'hishtory: %s\n' "$2" >&2
  fi
}

command -v hishtory >/dev/null 2>&1 || { log info 'hiSHtory is not available in PATH'; exit 20; }

# Upstream currently accepts a sync key as `hishtory init <secret>`. Passing a
# value retrieved from Infisical that way exposes it to process inspection and
# audit tooling. Do not automate enrollment until upstream provides a supported
# stdin, inherited-descriptor, or equivalent non-argv secret interface.
if [ ! -f "$HOME/.hishtory/hishtory.db" ] && [ ! -f "$HOME/.hishtory/.hishtory.db" ]; then
  log warn 'hiSHtory is installed but not initialized; secure automated sync enrollment is unavailable because upstream accepts the key only as an argument'
  exit 20
fi

log info 'Preserving the existing hiSHtory initialization; no sync key was read or changed'
