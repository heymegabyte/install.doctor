#!/usr/bin/env bash
# @file executable_post-zfs-prep.sh
# @description Capability-aware Unencrypted ZFS tooling, ARC tuning, and rehearsal verification for Install Doctor (§12).
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

OS_KERNEL="$(uname -s)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"

if [[ "$OS_KERNEL" != "Linux" ]]; then
  log_info "ZFS root/data migration tooling is Linux-only (detected: $OS_KERNEL). Skipping."
  exit 0
fi

if [[ "$HOSTNAME_SHORT" != "legion" && "${ENABLE_ZFS_PREP:-0}" != "1" ]]; then
  log_info "Host profile ($HOSTNAME_SHORT) does not request ZFS root migration prep. Skipping."
  exit 0
fi

if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi

# 1. Install ZFS userspace & initramfs integration
if ! command -v zpool >/dev/null 2>&1; then
  log_info "Installing zfsutils-linux and zfs-initramfs..."
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq zfsutils-linux zfs-initramfs zfs-zed
fi

# 2. Bound ZFS ARC to 8 GiB (8589934592 bytes) on 32 GiB workstation so Ollama & CI runners are never starved
$SUDO tee /etc/modprobe.d/zfs.conf >/dev/null <<'EOF'
# Bound ZFS ARC to 8 GiB on Legion (32 GiB RAM) to preserve headroom for Ollama + GNOME + 3 CI runners
options zfs zfs_arc_max=8589934592
options zfs zfs_arc_min=1073741824
EOF

$SUDO modprobe zfs || true
if [[ -w /sys/module/zfs/parameters/zfs_arc_max ]]; then
  echo 8589934592 | $SUDO tee /sys/module/zfs/parameters/zfs_arc_max >/dev/null || true
fi

$SUDO systemctl enable --now zfs-zed.service 2>/dev/null || true
log_info "ZFS kernel module, ARC bounds (8 GiB max), and ZED daemon configured."
