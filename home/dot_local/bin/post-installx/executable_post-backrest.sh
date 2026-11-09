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
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"

if [[ "${INSTALL_DOCTOR_BACKREST:-0}" != "1" ]]; then
  log_info "Backrest provisioning not requested (set INSTALL_DOCTOR_BACKREST=1 to enable)"
  exit 0
fi

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
BACKREST_VER="1.14.1"
if [[ "$OS_KERNEL" == "Linux" ]] && ! command -v backrest >/dev/null 2>&1; then
  case "$ARCH" in
    x86_64|amd64) BR_ARCH="x86_64"; BR_SIZE=12224740; BR_SHA256='acc7835a9c55b3d254f0fa285cacbe87ac912cb7e069d0211924838020e6921c' ;;
    aarch64|arm64) BR_ARCH="arm64"; BR_SIZE=11130174; BR_SHA256='b53718cd6e042e7d99538cb652968ab966a5c53fabd556785648ceb13320a320' ;;
    *) BR_ARCH="" ;;
  esac
  if [[ -n "$BR_ARCH" ]]; then
    log_info "Installing Backrest v${BACKREST_VER} (${BR_ARCH})..."
    TMP_BR="$(mktemp -d)"
    archive="$TMP_BR/backrest.tar.gz"
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --location --max-time 120 \
      "https://github.com/garethgeorge/backrest/releases/download/v${BACKREST_VER}/backrest_Linux_${BR_ARCH}.tar.gz" -o "$archive"
    [[ "$(wc -c < "$archive")" -eq "$BR_SIZE" ]]
    if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{print $1}')";
    else actual="$(shasum -a 256 "$archive" | awk '{print $1}')"; fi
    [[ "$actual" == "$BR_SHA256" ]]
    tar -xzf "$archive" -C "$TMP_BR" backrest
    $SUDO install -m 0755 "$TMP_BR/backrest" /usr/local/bin/backrest
    rm -rf "$TMP_BR"
    TMP_BR=""
  fi
fi

# 3. Configure Backrest loopback systemd service (127.0.0.1:9898) on Linux
if [[ "$OS_KERNEL" == "Linux" ]] && [[ -x /usr/local/bin/backrest ]]; then
  if $SUDO systemctl list-unit-files "${HOST_SHORT}-backrest.service" 2>/dev/null | grep -Fq "${HOST_SHORT}-backrest.service"; then
    log_warn "Existing ${HOST_SHORT}-backrest.service is preserved; migrate it explicitly before enabling the managed Backrest service"
    exit 0
  fi
  $SUDO install -d -m 0700 /etc/backrest /var/lib/backrest /var/cache/megabyte/backrest
  for env_file in "/etc/${HOST_SHORT}-backup.env" /etc/backrest/backup.env; do
    if $SUDO test -f "$env_file"; then
      $SUDO sed -i 's/^export //' "$env_file"
      $SUDO chmod 0600 "$env_file"
    fi
  done
  if [[ ! -f /etc/backrest/config.json ]]; then
    $SUDO tee /etc/backrest/config.json >/dev/null <<EOF
{
  "modno": 1,
  "version": 4,
  "instance": "${HOST_SHORT}",
  "auth": {
    "disabled": true
  },
  "repos": [],
  "plans": []
}
EOF
    $SUDO chmod 0600 /etc/backrest/config.json
  fi

  $SUDO tee /etc/systemd/system/backrest.service >/dev/null <<EOF
[Unit]
Description=Backrest Web UI and Restic Orchestrator (Loopback Only - ${HOST_SHORT})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=-/etc/${HOST_SHORT}-backup.env
EnvironmentFile=-/etc/backrest/backup.env
Environment=BACKREST_PORT=127.0.0.1:9898
Environment=BACKREST_CONFIG=/etc/backrest/config.json
Environment=BACKREST_DATA=/var/lib/backrest
Environment=XDG_CACHE_HOME=/var/cache/megabyte/backrest
ExecStart=/usr/local/bin/backrest
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/etc/backrest /var/lib/backrest /var/cache/megabyte/backrest

[Install]
WantedBy=multi-user.target
EOF

  # 4. Create Restic exclude file
  $SUDO tee /etc/backrest/excludes.txt >/dev/null <<'EOF'
/home/*/.cache
/home/*/.ollama/models/blobs
/home/*/.local/share/Trash
/home/*/.local/share/containers
/home/*/ai/runners
/var/cache
/var/lib/docker
/var/lib/containerd
/var/lib/github-runners
/tmp
/var/tmp
node_modules
.venv
__pycache__
*.log
*.swp
EOF

  # 5. Create host-aware restic backup helper & daily timer
  $SUDO tee /usr/local/sbin/restic-host-backup >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail
HOST_SHORT="${HOST_SHORT}"
if [[ -f "/etc/\${HOST_SHORT}-backup.env" ]]; then
  set -a
  . "/etc/\${HOST_SHORT}-backup.env"
  set +a
elif [[ -f /etc/backrest/backup.env ]]; then
  set -a
  . /etc/backrest/backup.env
  set +a
else
  echo "ERROR: /etc/\${HOST_SHORT}-backup.env missing" >&2
  exit 1
fi
export RESTIC_REPOSITORY="\${RESTIC_REPOSITORY_HOST:-\${RESTIC_REPOSITORY}/\${HOST_SHORT}-host}"
export XDG_CACHE_HOME="/var/cache/megabyte/backrest"

restic snapshots >/dev/null 2>&1 || restic init

BACKUP_PATHS=(
  /etc/ufw
  /etc/fail2ban
  /etc/netdata
  /etc/sanoid
  /etc/backrest/excludes.txt
)
for p in "/etc/smartd.conf" "/home/ubuntu/.cloudflared/\${HOST_SHORT}.yaml" "/home/ubuntu/ai/repos/\${HOST_SHORT}.megabyte.space" "/home/ubuntu/\${HOST_SHORT}.megabyte.space"; do
  [[ -e "\$p" ]] && BACKUP_PATHS+=("\$p")
done

restic backup \\
  --exclude-file=/etc/backrest/excludes.txt \\
  --tag "\${HOST_SHORT}-host" \\
  --tag automated \\
  "\${BACKUP_PATHS[@]}"

restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --read-data-subset=5%
EOF
  $SUDO chmod 0750 /usr/local/sbin/restic-host-backup

  $SUDO tee /etc/systemd/system/restic-host-backup.service >/dev/null <<'EOF'
[Unit]
Description=Workstation Restic Snapshot + Prune + Integrity Check to Cloudflare R2
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/restic-host-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

  $SUDO tee /etc/systemd/system/restic-host-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Daily Workstation Restic Backup to Cloudflare R2

[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now backrest.service restic-host-backup.timer
fi

log_info "Backrest + Restic provisioning complete."
