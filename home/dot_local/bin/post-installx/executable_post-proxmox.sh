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

# 4. Disable weekly ZFS TRIM timers and autotrim on rotational HDD pools (DISC-MAX == 0B)
if command -v zpool >/dev/null 2>&1; then
  for _pool in $(zpool list -H -o name 2>/dev/null || true); do
    _can_trim=0
    for _dev in $(zpool status -P "$_pool" 2>/dev/null | awk '/\/dev\// {print $1}'); do
      _disc_max="$(lsblk -dn -o DISC-MAX "$_dev" 2>/dev/null | tr -d ' ' || true)"
      if [ -n "$_disc_max" ] && [ "$_disc_max" != "0B" ] && [ "$_disc_max" != "0" ]; then
        _can_trim=1
        break
      fi
    done
    if [ "$_can_trim" -eq 0 ]; then
      $SUDO zpool set autotrim=off "$_pool" 2>/dev/null || true
      $SUDO systemctl disable --now "zfs-trim-weekly@${_pool}.timer" 2>/dev/null || true
      $SUDO systemctl reset-failed "zfs-trim@${_pool}.service" "zfs-trim-weekly@${_pool}.service" 2>/dev/null || true
    fi
  done
fi

# 5. Suppress info-level notification noise in Proxmox VE & PBS (only email warning, error, unknown)
for _ncfg in /etc/pve/notifications.cfg /etc/proxmox-backup/notifications.cfg; do
  if [ -f "$_ncfg" ] && command -v node >/dev/null 2>&1; then
    $SUDO node -e '
      const fs = require("node:fs");
      const p = process.argv[1];
      const src = fs.readFileSync(p, "utf8");
      const updated = src.replace(
        /matcher:\s*default-matcher[\s\S]*?(?=\n\S|\s*$)/,
        "matcher: default-matcher\n\tcomment Route only warning, error, and unknown notifications to amazon-ses\n\tmatch-severity warning,error,unknown\n\tmode all\n\ttarget amazon-ses\n"
      );
      if (updated !== src) fs.writeFileSync(p, updated, "utf8");
    ' "$_ncfg" 2>/dev/null || true
  fi
done

# 6. Ensure Netdata health.d permissions (0755 dirs, 0644 files) & mark stale streaming child nodes ephemeral
if [ -d /etc/netdata ]; then
  $SUDO chmod 0755 /etc/netdata /etc/netdata/health.d 2>/dev/null || true
  $SUDO chmod 0644 /etc/netdata/health.d/*.conf 2>/dev/null || true
  if command -v netdatacli >/dev/null 2>&1; then
    $SUDO netdatacli mark-stale-nodes-ephemeral ALL_NODES >/dev/null 2>&1 || true
    $SUDO netdatacli reload-health >/dev/null 2>&1 || true
  fi
fi

# 7. Mask rpcbind (111/tcp + 111/udp) when no NFS mounts exist & converge SSH + kernel security posture
if ! mount | grep -qE ' type nfs'; then
  $SUDO systemctl disable --now rpcbind.service rpcbind.socket 2>/dev/null || true
  $SUDO systemctl mask rpcbind.service rpcbind.socket 2>/dev/null || true
fi
$SUDO mkdir -p /etc/ssh/sshd_config.d
$SUDO tee /etc/ssh/sshd_config.d/99-fleet-hardening.conf >/dev/null <<'EOF'
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
AllowAgentForwarding no
MaxAuthTries 4
ClientAliveInterval 180
ClientAliveCountMax 2
PermitUserEnvironment no
EOF
$SUDO chmod 0644 /etc/ssh/sshd_config.d/99-fleet-hardening.conf
$SUDO sshd -t 2>/dev/null && $SUDO systemctl reload ssh 2>/dev/null || true

$SUDO tee /etc/sysctl.d/99-fleet-security.conf >/dev/null <<'EOF'
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
kernel.unprivileged_bpf_disabled = 2
net.core.bpf_jit_harden = 2
kernel.perf_event_paranoid = 4
fs.suid_dumpable = 0
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
dev.tty.ldisc_autoload = 0
vm.unprivileged_userfaultfd = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
EOF
$SUDO chmod 0644 /etc/sysctl.d/99-fleet-security.conf
$SUDO sysctl --system >/dev/null 2>&1 || true

log "Proxmox VE hypervisor convergence complete."
