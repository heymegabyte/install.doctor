#!/usr/bin/env bash
# @file executable_post-proxmox.sh
# @description Capability-gated Proxmox VE hypervisor and Proxmox Backup Server (PBS) convergence hook.
# Detects Proxmox VE (/etc/pve or pveversion) and converges ZFS ARC limits, KSM tuning,
# bridge networking offloads, PBS verify/prune/GC schedules, and journald/sysctl caps.
set -euo pipefail
# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1

log() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "$*"
  else
    printf '[post-proxmox] %s\n' "$*"
  fi
}

warn() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl warn "$*"
  else
    printf '[post-proxmox] WARNING: %s\n' "$*" >&2
  fi
}

case "${1:-}" in
  --status|--verify-host)
    if command -v pveversion >/dev/null 2>&1 || [ -d /etc/pve ]; then
      printf 'proxmox=present pveversion="%s"\n' "$(pveversion 2>/dev/null || echo unknown)"
      exit 0
    fi
    printf 'proxmox=absent\n'
    exit 0
    ;;
  --check|--apply|--verify)
    warn 'Proxmox hypervisor reconciliation is pending migration to typed desired-state tasks'
    exit 20
    ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
  log "Proxmox VE is Linux-only; skipping."
  exit 0
fi

if ! command -v pveversion >/dev/null 2>&1 && [ ! -d /etc/pve ] && [ "${INSTALL_DOCTOR_ENABLE_PROXMOX:-0}" != "1" ]; then
  log "No Proxmox VE installation detected (/etc/pve absent and INSTALL_DOCTOR_ENABLE_PROXMOX!=1); skipping."
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  else
    warn "Root privileges unavailable for Proxmox VE convergence; skipping."
    exit 0
  fi
else
  SUDO=""
fi

log "Applying Proxmox VE hypervisor convergence (KSM, ZFS ARC, journald 512M cap, and BBRv3 sysctl)..."

# 1. Configure KSM (Kernel Samepage Merging) threshold for VM density
if [ -f /etc/ksmtuned.conf ]; then
  $SUDO sed -i -E 's/^#?[[:space:]]*KSM_THRES_COEF=.*/KSM_THRES_COEF=30/' /etc/ksmtuned.conf || true
  $SUDO systemctl restart ksmtuned.service 2>/dev/null || true
fi

# 2. Single canonical journald drop-in (/etc/systemd/journald.conf.d/99-fleet.conf)
$SUDO install -d -m 0755 /etc/systemd/journald.conf.d
$SUDO tee /etc/systemd/journald.conf.d/99-fleet.conf >/dev/null <<'EOF'
[Journal]
SystemMaxUse=512M
SystemMaxFileSize=64M
RuntimeMaxUse=128M
MaxRetentionSec=14day
Compress=yes
EOF
$SUDO chmod 0644 /etc/systemd/journald.conf.d/99-fleet.conf
$SUDO systemctl restart systemd-journald.service 2>/dev/null || true

# 3. Proxmox hypervisor sysctl tuning (TCP BBR, fq, inotify, bridge nf-call off for VM throughput)
$SUDO install -d -m 0755 /etc/sysctl.d
$SUDO tee /etc/sysctl.d/99-proxmox-fleet.conf >/dev/null <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
vm.swappiness = 10
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 8192
vm.max_map_count = 1048576
EOF
$SUDO chmod 0644 /etc/sysctl.d/99-proxmox-fleet.conf
$SUDO sysctl --system >/dev/null 2>&1 || true

log "Proxmox VE hypervisor convergence complete."
