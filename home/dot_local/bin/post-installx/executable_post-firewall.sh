#!/usr/bin/env bash
# @file Native firewall desired-state boundary
# @brief Refuses unjournaled firewall, package, privilege, and service mutation.
set -euo pipefail

log() { printf 'firewall: %s\n' "$*" >&2; }

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
