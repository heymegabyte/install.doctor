#!/usr/bin/env bash
# @file executable_post-github-runners.sh
# @description Capability-aware GitHub Actions self-hosted multi-runner provisioning for Install Doctor (§10).
# Implements isolated per-runner Linux system accounts, systemd slice resource budgets,
# pre/post-job cleanup hooks, and scoped XDG caches (${XDG_CACHE_HOME}/megabyte).
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

OS_KERNEL="$(uname -s)"
if [[ "$OS_KERNEL" != "Linux" ]]; then
  log_info "GitHub Actions multi-runner systemd fleet is only supported on Linux (detected: $OS_KERNEL). Skipping."
  exit 0
fi

HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"
RUNNER_COUNT="${GITHUB_RUNNER_COUNT:-0}"
if [[ "$HOSTNAME_SHORT" == "legion" && "$RUNNER_COUNT" == "0" ]]; then
  RUNNER_COUNT=3
fi

if [[ "$RUNNER_COUNT" -le 0 ]]; then
  log_info "Host profile ($HOSTNAME_SHORT) does not request GitHub Actions runners (GITHUB_RUNNER_COUNT=0). Skipping."
  exit 0
fi

RUNNER_ORG_URL="${GITHUB_RUNNER_ORG_URL:-https://github.com/heymegabyte}"
RUNNER_GROUP="${GITHUB_RUNNER_GROUP:-persistent-agent-fleet}"
RUNNER_NAME_PREFIX="${GITHUB_RUNNER_NAME_PREFIX:-Legion Runner}"
RUNNER_LABELS="${GITHUB_RUNNER_LABELS:-self-hosted,Linux,X64,legion,trusted,gpu,nvidia}"
RUNNER_BASE_DIR="${GITHUB_RUNNER_BASE_DIR:-/var/lib/legion-runners}"
RUNNER_TEMPLATE_DIR="${GITHUB_RUNNER_TEMPLATE_DIR:-/home/ubuntu/ai/runners/legion-01}"
RUNNER_REG_TOKEN="${GITHUB_RUNNER_REG_TOKEN:-}"

if [[ $EUID -ne 0 ]]; then
  SUDO="sudo -n"
else
  SUDO=""
fi

# 1. Create systemd slice for all runners so they cannot starve interactive desktop or Ollama
$SUDO tee /etc/systemd/system/legion-runners.slice >/dev/null <<'EOF'
[Unit]
Description=Legion GitHub Actions Runners Resource Slice
Before=slices.target

[Slice]
CPUWeight=60
IOWeight=60
CPUQuota=1800%
MemoryHigh=24G
MemoryMax=30G
TasksMax=8192
EOF

# 2. Create pre/post-job cleanup hook script
$SUDO install -d -m 0755 /usr/local/libexec
$SUDO tee /usr/local/libexec/legion-runner-hook.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Runs before and after each GitHub Actions job to prune stale temp artifacts and dangling containers
rm -rf "${RUNNER_TEMP:-/tmp/runner-tmp}"/* 2>/dev/null || true
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/packages" \
         "${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/build" \
         "${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/ai" \
         "${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/agents"
EOF
$SUDO chmod 0755 /usr/local/libexec/legion-runner-hook.sh

# 3. Ensure runner binary template exists
$SUDO install -d -m 0755 "$RUNNER_BASE_DIR"
if [[ ! -f "$RUNNER_TEMPLATE_DIR/config.sh" ]]; then
  RUNNER_TEMPLATE_DIR="$RUNNER_BASE_DIR/template"
  if [[ ! -f "$RUNNER_TEMPLATE_DIR/config.sh" ]]; then
    log_info "Downloading GitHub Actions runner binary..."
    $SUDO install -d -m 0755 "$RUNNER_TEMPLATE_DIR"
    RUNNER_VER="2.322.0"
    curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VER}/actions-runner-linux-x64-${RUNNER_VER}.tar.gz" \
      | $SUDO tar -xz -C "$RUNNER_TEMPLATE_DIR"
  fi
fi

# 4. Provision each isolated runner account, directory, and service
for i in $(seq 1 "$RUNNER_COUNT"); do
  RUNNER_USER="legion-runner-${i}"
  RUNNER_DIR="${RUNNER_BASE_DIR}/runner-${i}"
  RUNNER_NAME="${RUNNER_NAME_PREFIX} ${i}"
  CACHE_ROOT="/var/cache/megabyte/runner-${i}"

  if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
    $SUDO useradd --system --create-home --home-dir "$RUNNER_DIR" --shell /bin/bash "$RUNNER_USER"
  fi
  if getent group docker >/dev/null 2>&1; then
    $SUDO usermod -aG docker "$RUNNER_USER"
  fi

  $SUDO install -d -m 0750 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
  $SUDO install -d -m 0750 -o "$RUNNER_USER" -g "$RUNNER_USER" "$CACHE_ROOT/megabyte/packages" "$CACHE_ROOT/megabyte/build" "$CACHE_ROOT/megabyte/ai" "$CACHE_ROOT/megabyte/agents"

  if [[ ! -f "$RUNNER_DIR/config.sh" ]]; then
    log_info "Populating runner binaries for $RUNNER_NAME ($RUNNER_DIR)..."
    $SUDO cp -a "$RUNNER_TEMPLATE_DIR/bin" "$RUNNER_TEMPLATE_DIR/externals" "$RUNNER_TEMPLATE_DIR/config.sh" "$RUNNER_TEMPLATE_DIR/env.sh" "$RUNNER_TEMPLATE_DIR/run.sh" "$RUNNER_TEMPLATE_DIR/run-helper.sh.template" "$RUNNER_TEMPLATE_DIR/safe_sleep.sh" "$RUNNER_DIR/"
    $SUDO chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
  fi

  if [[ ! -f "$RUNNER_DIR/.runner" && -n "$RUNNER_REG_TOKEN" ]]; then
    log_info "Registering '$RUNNER_NAME' in group '$RUNNER_GROUP'..."
    sudo -n -u "$RUNNER_USER" bash -c "cd '$RUNNER_DIR' && ./config.sh --unattended \
      --url '$RUNNER_ORG_URL' \
      --token '$RUNNER_REG_TOKEN' \
      --name '$RUNNER_NAME' \
      --runnergroup '$RUNNER_GROUP' \
      --labels '$RUNNER_LABELS' \
      --work '_work' \
      --replace"
  fi

  $SUDO tee "/etc/systemd/system/legion-runner-${i}.service" >/dev/null <<EOF
[Unit]
Description=GitHub Actions Runner (${RUNNER_NAME})
After=network-online.target docker.service
Wants=network-online.target docker.service
ConditionPathExists=${RUNNER_DIR}/.runner

[Service]
Type=simple
User=${RUNNER_USER}
Group=${RUNNER_USER}
SupplementaryGroups=docker
WorkingDirectory=${RUNNER_DIR}
ExecStartPre=/usr/local/libexec/legion-runner-hook.sh
ExecStart=${RUNNER_DIR}/run.sh
ExecStopPost=/usr/local/libexec/legion-runner-hook.sh
Environment=HOME=${RUNNER_DIR}
Environment=XDG_CACHE_HOME=${CACHE_ROOT}
Environment=PIP_CACHE_DIR=${CACHE_ROOT}/megabyte/packages/pip
Environment=UV_CACHE_DIR=${CACHE_ROOT}/megabyte/packages/uv
Environment=npm_config_cache=${CACHE_ROOT}/megabyte/packages/npm
Environment=CARGO_HOME=${CACHE_ROOT}/megabyte/packages/cargo
Environment=GOMODCACHE=${CACHE_ROOT}/megabyte/packages/gomod
Environment=GOCACHE=${CACHE_ROOT}/megabyte/build/go-build
Environment=HF_HOME=${CACHE_ROOT}/megabyte/ai/huggingface
Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/libexec/legion-runner-hook.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/libexec/legion-runner-hook.sh
Environment=AI_MACHINE_ID=${HOSTNAME_SHORT}-runner-${i}
Restart=always
RestartSec=10
KillSignal=SIGINT
TimeoutStopSec=120
Slice=legion-runners.slice
Nice=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
done

# Retire legacy single legion-runner.service if present
if systemctl list-unit-files legion-runner.service >/dev/null 2>&1; then
  $SUDO systemctl disable --now legion-runner.service 2>/dev/null || true
  $SUDO rm -f /etc/systemd/system/legion-runner.service
fi

$SUDO systemctl daemon-reload
for i in $(seq 1 "$RUNNER_COUNT"); do
  if $SUDO test -f "${RUNNER_BASE_DIR}/runner-${i}/.runner"; then
    $SUDO systemctl enable --now "legion-runner-${i}.service"
  fi
done

log_info "GitHub Actions runner provisioning complete ($RUNNER_COUNT runners configured)."
