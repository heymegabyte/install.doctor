#!/usr/bin/env bash
# @file ZFS lifecycle desired-state boundary
# @brief Detects applicability without mutating pools, datasets, policy, kernel state, or schedules.
set -euo pipefail

log() { printf 'zfs-prep: %s\n' "$*" >&2; }

if [ "$(uname -s 2>/dev/null)" != Linux ]; then
  log 'ZFS lifecycle configuration is inapplicable on this platform'
  exit 0
fi

has_pool=0
if command -v zpool >/dev/null 2>&1 && zpool list -H -o name 2>/dev/null | grep -q .; then
  has_pool=1
fi
if [ "$has_pool" -eq 0 ] && [ "${ENABLE_ZFS_PREP:-0}" != 1 ]; then
  log 'no active ZFS pool or explicit ZFS lifecycle selection was observed'
  exit 0
fi

# Storage mutation requires exact device/dataset identity, capacity and
# encryption evidence, separately owned snapshot/replication namespaces,
# write-ahead compensation, and verified maintenance completion. The retired
# hook instead changed kernel parameters, created datasets and reservations,
# wrote Sanoid policy, enabled services, and scheduled scrubs while suppressing
# failures. Preserve all storage state until typed operations prove those
# prerequisites and can report running scrub/resilver work as pending.
log 'ZFS lifecycle convergence is unsupported until typed storage policy and recovery operations are available'
exit 20
