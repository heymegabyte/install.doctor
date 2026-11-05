#!/usr/bin/env bash
# @file executable_post-zfs-prep.sh
# @description Capability-aware ZFS lifecycle, proportional ARC tuning, Proxmox-style sanoid auto-snapshotting,
# 85% pool capacity guard, copies=2 on /home, and monthly scrub timers across Zen, Omen, Legion, and ZFS hosts.
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
if command -v zpool >/dev/null 2>&1 && zpool list rpool >/dev/null 2>&1; then
  HAS_ZFS_POOL=1
fi

if [[ "$HAS_ZFS_POOL" -ne 1 && "$HOSTNAME_SHORT" != "legion" && "$HOSTNAME_SHORT" != "omen" && "$HOSTNAME_SHORT" != "zen" && "${ENABLE_ZFS_PREP:-0}" != "1" ]]; then
  log_info "No active ZFS rpool detected on $HOSTNAME_SHORT and ENABLE_ZFS_PREP!=1. Skipping."
  exit 0
fi

if [[ $EUID -eq 0 ]]; then
  SUDO=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
else
  log_warn "Root/sudo unavailable — skipping ZFS configuration."
  exit 0
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
#    - < 20 GiB RAM (e.g. Zen 16 GiB): 2 GiB max (2147483648 bytes)
#    - 20..45 GiB RAM (e.g. Omen 32 GiB): 4 GiB max (4294967296 bytes)
#    - > 45 GiB RAM (e.g. Legion 64 GiB): 8 GiB max (8589934592 bytes)
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
# Proportional ZFS ARC cap (${ARC_LABEL} max on ${MEM_TOTAL_GIB} GiB RAM host ${HOSTNAME_SHORT})
options zfs zfs_arc_max=${ARC_MAX_BYTES}
options zfs zfs_arc_min=${ARC_MIN_BYTES}
EOF

$SUDO modprobe zfs 2>/dev/null || true
if [[ -w /sys/module/zfs/parameters/zfs_arc_max ]]; then
  echo "$ARC_MAX_BYTES" | $SUDO tee /sys/module/zfs/parameters/zfs_arc_max >/dev/null || true
fi
$SUDO systemctl enable --now zfs-zed.service 2>/dev/null || true

# 3. Dataset hygiene, copies=2 on /home, Proxmox-style sanoid snapshots, 85% capacity guard, and monthly scrubs
if command -v zpool >/dev/null 2>&1 && zpool list rpool >/dev/null 2>&1; then
  $SUDO zfs set atime=off rpool 2>/dev/null || true

  HOME_DS="$(zfs list -H -o name /home 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$HOME_DS" ]]; then
    log_info "Setting copies=2 on $HOME_DS for single-sector media error resilience..."
    $SUDO zfs set copies=2 "$HOME_DS" 2>/dev/null || true
  fi

  # Create rpool/ai-models (recordsize=1M) when rpool has >= 50 GiB free space
  RPOOL_AVAIL_BYTES="$(zfs get -Hp -o value available rpool 2>/dev/null || echo 0)"
  if [[ "$RPOOL_AVAIL_BYTES" -ge 53687091200 ]] && ! zfs list rpool/ai-models >/dev/null 2>&1; then
    $SUDO zfs create -o recordsize=1M -o compression=zstd -o atime=off -o mountpoint=/var/lib/ai-models rpool/ai-models 2>/dev/null || true
  fi

  ROOT_DS="$(zfs list -H -o name / 2>/dev/null | tr -d ' ' || echo rpool/ROOT/ubuntu)"
  [[ -n "$HOME_DS" ]] || HOME_DS="rpool/USERDATA"
  BPOOL_SECTION=""
  if zfs list bpool/BOOT >/dev/null 2>&1; then
    BPOOL_SECTION=$'[bpool/BOOT]\n  use_template = proxmox_fleet\n  recursive = yes\n'
  elif zfs list bpool >/dev/null 2>&1; then
    BPOOL_SECTION=$'[bpool]\n  use_template = proxmox_fleet\n  recursive = yes\n'
  fi

  $SUDO install -d -m 0755 /etc/sanoid
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

  # Proxmox-style 85% pool capacity guard (prunes oldest autosnap_* snapshots if pool > 85% full)
  $SUDO tee /usr/local/bin/fleet-zfs-autosnap-guard >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
MAX_CAP="${FLEET_ZFS_MAX_CAP:-85}"
for pool in $(zpool list -H -o name 2>/dev/null || true); do
  cap="$(zpool list -H -o capacity "$pool" 2>/dev/null | tr -d '%' || echo 0)"
  if [ "${cap:-0}" -ge "$MAX_CAP" ]; then
    logger -t fleet-zfs-autosnap-guard "Pool $pool at ${cap}% (>= ${MAX_CAP}%); pruning oldest autosnap snapshots"
    zfs list -H -t snapshot -o name -s creation -r "$pool" 2>/dev/null \
      | grep '@autosnap_' \
      | head -n 15 \
      | xargs -r -n 1 zfs destroy || true
  fi
done
EOF
  $SUDO chmod 0755 /usr/local/bin/fleet-zfs-autosnap-guard

  $SUDO install -d -m 0755 /etc/systemd/system/sanoid.service.d
  $SUDO tee /etc/systemd/system/sanoid.service.d/capacity-guard.conf >/dev/null <<'EOF'
[Service]
ExecStartPre=/usr/local/bin/fleet-zfs-autosnap-guard
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now sanoid.timer 2>/dev/null || true
  if command -v sanoid >/dev/null 2>&1; then
    $SUDO sanoid --take-snapshots >/dev/null 2>&1 || true
  fi

  for pool in rpool bpool; do
    if zpool list "$pool" >/dev/null 2>&1; then
      $SUDO systemctl enable --now "zfs-scrub-monthly@${pool}.timer" 2>/dev/null || true
    fi
  done
fi

log_info "ZFS kernel module, ARC bounds (${ARC_LABEL} max), sanoid Proxmox-style snapshots, 85% capacity guard, and monthly scrub timers configured."
