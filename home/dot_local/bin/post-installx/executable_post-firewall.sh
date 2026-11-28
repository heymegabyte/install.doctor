#!/usr/bin/env bash
# @file Native firewall desired-state boundary
# @brief Refuses unjournaled firewall, package, privilege, and service mutation.
set -euo pipefail

log() { printf 'firewall: %s\n' "$*" >&2; }

if [[ $# == 1 && "$1" == --verify ]]; then
  if [[ "$(uname -s)" != Linux ]] || ! command -v ufw >/dev/null; then
    log 'native UFW verification is inapplicable on this host'
    exit 20
  fi
  if ! live=$(LC_ALL=C ufw status verbose); then
    log 'could not read native UFW state with the current permissions'
    exit 1
  fi
  if ! grep -Fxq 'Status: active' <<< "$live" ||
     ! grep -Fxq 'Default: deny (incoming), allow (outgoing), deny (routed)' <<< "$live"; then
    log 'native UFW is inactive or deviates from the expected defaults'
    exit 1
  fi
  printf '%s\n' 'Native UFW is active with the expected default policy.'
  exit 0
fi
if (( $# != 0 )); then
  log 'usage: post-firewall.sh [--verify]'
  exit 2
fi

if [ "${INSTALL_DOCTOR_FIREWALL:-1}" = 0 ]; then
  log 'native firewall configuration was explicitly omitted from desired state'
  exit 0
fi

# Firewall changes can sever the active management path. The retired hook
# inferred LAN/SSH policy, created an askpass helper from a stored password,
# installed packages, rewrote UFW/Docker rules, and restarted services without
# an engine-owned snapshot or tested recovery timer. Preserve the host until a
# typed operation proves exact policy, active-session continuity, rollback, and
# post-rollback reachability.
log 'native firewall convergence is unsupported until lockout-safe typed policy and rollback operations are available'
exit 20
