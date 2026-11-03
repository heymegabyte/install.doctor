#!/usr/bin/env bash
# @file executable_post-backrest.sh
# @description Capability-aware Backrest + Restic backup provisioning for Install Doctor (§11).
# Installs restic and Backrest (127.0.0.1:9898 loopback-only), configures Cloudflare R2 encrypted
# repository, and installs scheduled backup/check/prune units.
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

OS_KERNEL="$(uname -s)"
ARCH="$(uname -m)"

if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi

TMP_BR=""
cleanup() {
  if [[ -n "$TMP_BR" ]]; then
    rm -rf -- "$TMP_BR"
  fi
}
trap cleanup EXIT

# 1. Install restic
if ! command -v restic >/dev/null 2>&1; then
  if [[ "$OS_KERNEL" == "Linux" ]] && command -v apt-get >/dev/null 2>&1; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq restic
  elif [[ "$OS_KERNEL" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    HOMEBREW_NO_AUTO_UPDATE=1 brew install restic
  fi
fi

# 2. Install Backrest binary (v1.14.1) on Linux x86_64/arm64
BACKREST_VER="${BACKREST_VERSION:-1.14.1}"
if [[ "$OS_KERNEL" == "Linux" ]] && ! command -v backrest >/dev/null 2>&1; then
  case "$ARCH" in
    x86_64|amd64) BR_ARCH="x86_64" ;;
    aarch64|arm64) BR_ARCH="arm64" ;;
    *) BR_ARCH="" ;;
  esac
  if [[ -n "$BR_ARCH" ]]; then
    log_info "Installing Backrest v${BACKREST_VER} (${BR_ARCH})..."
    TMP_BR="$(mktemp -d)"
    curl -fsSL "https://github.com/garethgeorge/backrest/releases/download/v${BACKREST_VER}/backrest_Linux_${BR_ARCH}.tar.gz" \
      | tar -xz -C "$TMP_BR"
    $SUDO install -m 0755 "$TMP_BR/backrest" /usr/local/bin/backrest
    rm -rf "$TMP_BR"
    TMP_BR=""
  fi
fi

# 3. Configure Backrest loopback systemd service (127.0.0.1:9898) on Linux
if [[ "$OS_KERNEL" == "Linux" ]] && [[ -x /usr/local/bin/backrest ]]; then
  $SUDO install -d -m 0700 /etc/backrest /var/lib/backrest /var/cache/megabyte/backrest
  if [[ ! -f /etc/backrest/config.json ]]; then
    $SUDO tee /etc/backrest/config.json >/dev/null <<'EOF'
{
  "modno": 1,
  "version": 4,
  "instance": "legion",
  "auth": {
    "disabled": true
  },
  "repos": [],
  "plans": []
}
EOF
    $SUDO chmod 0600 /etc/backrest/config.json
  fi

  $SUDO tee /etc/systemd/system/legion-backrest.service >/dev/null <<'EOF'
[Unit]
Description=Backrest Web UI and Restic Orchestrator (Loopback Only)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=-/etc/legion-backup.env
Environment=BACKREST_PORT=127.0.0.1:9898
Environment=BACKREST_CONFIG=/etc/backrest/config.json
Environment=BACKREST_DATA=/var/lib/backrest
Environment=XDG_CACHE_HOME=/var/cache/megabyte/backrest
ExecStart=/usr/local/bin/backrest
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

  # 4. Create Restic exclude file
  $SUDO tee /etc/backrest/excludes.txt >/dev/null <<'EOF'
/home/*/.cache
/home/*/.ollama/models/blobs
/home/*/ai/runners
/var/cache
/var/lib/docker
/var/lib/containerd
/var/lib/legion-runners
/tmp
/var/tmp
*.log
*.swp
EOF

  # 5. Create legion-restic-backup helper & daily timer
  $SUDO tee /usr/local/sbin/legion-restic-backup >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f /etc/legion-backup.env ]]; then
  echo "ERROR: /etc/legion-backup.env missing" >&2
  exit 1
fi
set -a
. /etc/legion-backup.env
set +a
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY_LEGION:-${RESTIC_REPOSITORY}/legion-host}"
export XDG_CACHE_HOME="/var/cache/megabyte/backrest"

restic snapshots >/dev/null 2>&1 || restic init

restic backup \
  --exclude-file=/etc/backrest/excludes.txt \
  --tag legion-host \
  --tag automated \
  /etc/ufw \
  /etc/fail2ban \
  /etc/netdata \
  /etc/smartd.conf \
  /etc/backrest/excludes.txt \
  /home/ubuntu/.cloudflared/legion.yaml \
  /home/ubuntu/ai/repos/legion.megabyte.space

restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --read-data-subset=5%
EOF
  $SUDO chmod 0750 /usr/local/sbin/legion-restic-backup

  $SUDO tee /etc/systemd/system/legion-restic-backup.service >/dev/null <<'EOF'
[Unit]
Description=Legion Restic Snapshot + Prune + Integrity Check to Cloudflare R2
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/legion-restic-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

  $SUDO tee /etc/systemd/system/legion-restic-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Daily Legion Restic Backup to Cloudflare R2

[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now legion-backrest.service legion-restic-backup.timer
fi

log_info "Backrest + Restic provisioning complete."
