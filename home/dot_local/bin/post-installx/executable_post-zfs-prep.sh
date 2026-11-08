#!/usr/bin/env bash
# @file executable_post-zfs-prep.sh
# @description Capability-aware ZFS lifecycle, proportional ARC tuning, policy-owned Sanoid snapshots,
# capacity alerts, and monthly scrub timers on discovered ZFS hosts.
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

OS_KERNEL="$(uname -s)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"

if [[ "$OS_KERNEL" != "Linux" ]]; then
  log_info "ZFS lifecycle tooling is Linux-only (detected: $OS_KERNEL). Skipping."
  exit 0
fi

HAS_ZFS_POOL=0
if command -v zpool >/dev/null 2>&1 && zpool list -H -o name 2>/dev/null | grep -q .; then
  HAS_ZFS_POOL=1
fi

if [[ "$HAS_ZFS_POOL" -ne 1 && "${ENABLE_ZFS_PREP:-0}" != "1" ]]; then
  log_info "No active ZFS pool detected on $HOSTNAME_SHORT and ENABLE_ZFS_PREP!=1. Skipping."
  exit 0
fi

TMP_ZFS="$(mktemp -d)"
chmod 0700 "$TMP_ZFS"
trap 'rm -rf "$TMP_ZFS" 2>/dev/null || true' EXIT

resolve_sudo_password() {
  local pw="${SUDO_PASSWORD:-}"
  if [[ -z "$pw" ]] && command -v get-secret >/dev/null 2>&1; then
    pw="$(get-secret SUDO_PASSWORD 2>/dev/null || true)"
  fi
  printf '%s' "$pw"
}

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO_PW="$(resolve_sudo_password)"
  if [[ -n "$SUDO_PW" ]]; then
    printf '#!/usr/bin/env sh\nprintf '\''%%s\\n'\'' %q\n' "$SUDO_PW" > "$TMP_ZFS/askpass.sh"
    chmod 0700 "$TMP_ZFS/askpass.sh"
    export SUDO_ASKPASS="$TMP_ZFS/askpass.sh"
    unset SUDO_PW
    if sudo -A -k true 2>/dev/null; then
      SUDO="sudo -A"
    fi
  fi
  if [[ -z "${SUDO:-}" ]]; then
    if sudo -n true 2>/dev/null; then
      SUDO="sudo -n"
    else
      log_warn "Root/sudo (via Infisical SUDO_PASSWORD) unavailable — skipping ZFS configuration."
      exit 0
    fi
  fi
fi

# 1. Install ZFS userspace, initramfs, ZED, and sanoid/syncoid replication helpers
if command -v apt-get >/dev/null 2>&1; then
  if ! command -v zpool >/dev/null 2>&1 || ! command -v sanoid >/dev/null 2>&1; then
    log_info "Installing zfsutils-linux, zfs-initramfs, zfs-zed, sanoid, lzop, pv, and mbuffer..."
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      zfsutils-linux zfs-initramfs zfs-zed sanoid lzop pv mbuffer || true
  fi
fi

# 2. Scale ZFS ARC limit proportionally to total system RAM:
#    - < 20 GiB RAM (16 GiB class): 2 GiB max (2147483648 bytes)
#    - 20..45 GiB RAM (32 GiB class): 4 GiB max (4294967296 bytes)
#    - > 45 GiB RAM (64+ GiB class): 8 GiB max (8589934592 bytes)
MEM_TOTAL_KIB="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || echo 16777216)"
MEM_TOTAL_GIB=$(( MEM_TOTAL_KIB / 1048576 ))
if [[ "$MEM_TOTAL_GIB" -lt 20 ]]; then
  ARC_MAX_BYTES=2147483648
  ARC_MIN_BYTES=536870912
  ARC_LABEL="2 GiB"
elif [[ "$MEM_TOTAL_GIB" -le 45 ]]; then
  ARC_MAX_BYTES=4294967296
  ARC_MIN_BYTES=1073741824
  ARC_LABEL="4 GiB"
else
  ARC_MAX_BYTES=8589934592
  ARC_MIN_BYTES=1073741824
  ARC_LABEL="8 GiB"
fi

$SUDO tee /etc/modprobe.d/zfs.conf >/dev/null <<EOF
# Proportional ZFS ARC cap (${ARC_LABEL} max on ${MEM_TOTAL_GIB} GiB RAM host ${HOSTNAME_SHORT}) + OpenZFS 2.4 Tunables
options zfs zfs_arc_max=${ARC_MAX_BYTES}
options zfs zfs_arc_min=${ARC_MIN_BYTES}
options zfs zfs_bclone_enabled=1
options zfs zfs_bclone_wait_dirty=1
options zfs zfs_txg_timeout=5
options zfs zfs_arc_dnode_limit_percent=20
options zfs zfs_dirty_data_max_percent=10
options zfs l2arc_noprefetch=0
EOF
$SUDO chmod 0644 /etc/modprobe.d/zfs.conf

$SUDO modprobe zfs 2>/dev/null || true
if [[ -w /sys/module/zfs/parameters/zfs_arc_max ]]; then
  echo "$ARC_MAX_BYTES" | $SUDO tee /sys/module/zfs/parameters/zfs_arc_max >/dev/null || true
fi
for zfs_knob in "zfs_bclone_enabled:1" "zfs_bclone_wait_dirty:1" "zfs_txg_timeout:5" "zfs_arc_dnode_limit_percent:20" "zfs_dirty_data_max_percent:10" "l2arc_noprefetch:0"; do
  k="${zfs_knob%%:*}"
  v="${zfs_knob##*:}"
  if [[ -w "/sys/module/zfs/parameters/${k}" ]]; then
    echo "$v" | $SUDO tee "/sys/module/zfs/parameters/${k}" >/dev/null || true
  fi
done
$SUDO systemctl enable --now zfs-zed.service 2>/dev/null || true

# 3. Policy-owned Sanoid snapshots, capacity alerts, and monthly scrubs. Existing
# dataset properties and deliberate Sanoid policies are preserved.
if [[ "$HAS_ZFS_POOL" -eq 1 ]]; then
  # Provision dedicated rpool/ai-models dataset (recordsize=1M, primarycache=metadata, logbias=throughput)
  # and 5% rpool/reservation dataset when rpool has >= 50 GiB available.
  if zpool list rpool >/dev/null 2>&1; then
    RPOOL_AVAIL_BYTES="$(zfs get -Hp -o value available rpool 2>/dev/null || echo 0)"
    RPOOL_SIZE_BYTES="$(zpool get -Hp -o value size rpool 2>/dev/null || echo 0)"
    if [[ "${RPOOL_AVAIL_BYTES:-0}" -ge 53687091200 ]] && ! zfs list rpool/ai-models >/dev/null 2>&1; then
      $SUDO zfs create -o recordsize=1M -o compression=zstd-fast-3 -o atime=off -o primarycache=metadata -o logbias=throughput -o mountpoint=/var/lib/ai-models rpool/ai-models 2>/dev/null || true
    fi
    if [[ "${RPOOL_AVAIL_BYTES:-0}" -ge 53687091200 && "${RPOOL_SIZE_BYTES:-0}" -gt 0 ]] && ! zfs list rpool/reservation >/dev/null 2>&1; then
      RES_GIB=$(( (RPOOL_SIZE_BYTES / 1073741824) / 20 ))
      [[ "$RES_GIB" -lt 4 ]] && RES_GIB=4
      [[ "$RES_GIB" -gt 32 ]] && RES_GIB=32
      $SUDO zfs create -o mountpoint=none -o refreservation="${RES_GIB}G" rpool/reservation 2>/dev/null || true
    fi
  fi

  HOME_DS="$(zfs list -H -o name /home 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$HOME_DS" ]]; then
    log_info "Detected home dataset $HOME_DS; preserving its existing properties."
  fi

  ROOT_DS="$(zfs list -H -o name / 2>/dev/null | tr -d ' ' || true)"
  BPOOL_SECTION=""
  if zfs list bpool/BOOT >/dev/null 2>&1; then
    BPOOL_SECTION=$'[bpool/BOOT]\n  use_template = proxmox_fleet\n  recursive = yes\n'
  elif zfs list bpool >/dev/null 2>&1; then
    BPOOL_SECTION=$'[bpool]\n  use_template = proxmox_fleet\n  recursive = yes\n'
  fi

  $SUDO install -d -m 0755 /etc/sanoid
  if [[ -z "$ROOT_DS" || -z "$HOME_DS" ]]; then
    log_warn "Root or home dataset identity is ambiguous; preserving Sanoid configuration and requiring an explicit host policy."
  elif [[ ! -s /etc/sanoid/sanoid.conf ]]; then
    $SUDO tee /etc/sanoid/sanoid.conf >/dev/null <<EOF
${BPOOL_SECTION}[${ROOT_DS}]
  use_template = proxmox_fleet
  recursive = yes

[${HOME_DS}]
  use_template = proxmox_fleet
  recursive = yes

[template_proxmox_fleet]
  frequently = 0
  hourly = 24
  daily = 14
  weekly = 4
  monthly = 3
  yearly = 0
  autosnap = yes
  autoclean = yes
EOF
  else
    log_info "Preserving existing /etc/sanoid/sanoid.conf; Install Doctor will not replace a deliberate policy."
  fi

  # Capacity guard alerts only. Low space is never authority to delete the last
  # usable recovery point, a common replication anchor, hold, clone dependency,
  # bookmark, or resumable transfer state.
  $SUDO tee /usr/local/bin/fleet-zfs-autosnap-guard >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
MAX_CAP="${FLEET_ZFS_MAX_CAP:-85}"
for pool in $(zpool list -H -o name 2>/dev/null || true); do
  cap="$(zpool list -H -o capacity "$pool" 2>/dev/null | tr -d '%' || echo 0)"
  if [ "${cap:-0}" -ge "$MAX_CAP" ]; then
    logger -p daemon.warning -t fleet-zfs-capacity-guard "Pool $pool at ${cap}% (>= ${MAX_CAP}%); automatic snapshot deletion is disabled"
    status=1
  fi
done
exit "${status:-0}"
EOF
  $SUDO chmod 0755 /usr/local/bin/fleet-zfs-autosnap-guard

  $SUDO install -d -m 0755 /etc/systemd/system/sanoid.service.d
  $SUDO tee /etc/systemd/system/sanoid.service.d/capacity-guard.conf >/dev/null <<'EOF'
[Service]
ExecStartPre=/usr/local/bin/fleet-zfs-autosnap-guard
EOF

  # Restricted SSH wrapper for cross-host Syncoid pull replication. The
  # checked-in parser directly execs an exact allowlist; it never evaluates the
  # caller-controlled SSH_ORIGINAL_COMMAND with a shell.
  SYNCOID_WRAPPER_SOURCE="${XDG_BIN_HOME:-$HOME/.local/bin}/syncoid-ssh-wrapper"
  if [[ -x "$SYNCOID_WRAPPER_SOURCE" ]]; then
    $SUDO install -o root -g root -m 0755 "$SYNCOID_WRAPPER_SOURCE" /usr/local/bin/syncoid-ssh-wrapper
  else
    log_warn "Syncoid wrapper is not installed at $SYNCOID_WRAPPER_SOURCE; replication identity will not be provisioned."
  fi

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now sanoid.timer 2>/dev/null || true
  while IFS= read -r pool; do
    if zpool list "$pool" >/dev/null 2>&1; then
      $SUDO zpool set autotrim=on "$pool" 2>/dev/null || true
      $SUDO systemctl enable --now "zfs-scrub-monthly@${pool}.timer" 2>/dev/null || true
      $SUDO systemctl enable --now "zfs-trim-weekly@${pool}.timer" 2>/dev/null || true
    fi
  done < <(zpool list -H -o name)
fi

log_info "ZFS kernel module, ARC bounds (${ARC_LABEL} max), preserved/policy-owned Sanoid configuration, capacity alerts, and discovered-pool scrub timers configured."
