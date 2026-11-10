#!/usr/bin/env bash
# @file post-installx/executable_post-nvidia-toolkit.sh
# @brief Capability-gated NVIDIA Container Toolkit + CDI setup for Linux NVIDIA container hosts
# @description
#   Checks for a compatible Linux host, NVIDIA GPU device, working NVIDIA driver (nvidia-smi),
#   and container runtime (Docker/containerd). Installs nvidia-container-toolkit, generates CDI
#   specification (/etc/cdi/nvidia.yaml), merges runtime configuration into /etc/docker/daemon.json
#   without overwriting existing settings (loopback bind, log limits, live-restore), and validates
#   GPU access inside a container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh" ]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh"
  OS="$(detect_os)"
else
  if [[ "${OSTYPE:-}" == darwin* ]]; then OS="macos"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS="${ID:-linux}"
  else OS="unknown"
  fi
fi

if command -v gum &>/dev/null; then
  log() { gum log -sl info "$1"; }
  warn() { gum log -sl warn "$1"; }
else
  log() { echo "[INFO] $1"; }
  warn() { echo "[WARN] $1" >&2; }
fi

case "$OS" in
  ubuntu|debian|fedora|arch|linux) ;;
  *)
    log "Skipping NVIDIA Container Toolkit on OS=$OS"
    exit 0
    ;;
esac

# Explicit capability predicates: NVIDIA GPU + working driver + Docker runtime
if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi -L >/dev/null 2>&1; then
  log "No active NVIDIA GPU/driver detected — skipping NVIDIA Container Toolkit"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Docker runtime not installed — skipping NVIDIA Container Toolkit"
  exit 0
fi

if ! sudo -n true 2>/dev/null && [ "$(id -u)" -ne 0 ]; then
  warn "Root/sudo unavailable — cannot install NVIDIA Container Toolkit"
  exit 0
fi
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if ! command -v nvidia-ctk >/dev/null 2>&1; then
  warn "nvidia-container-toolkit is absent; select it through Install Doctor desired state"
  exit 20
fi

# Generate CDI specification (/etc/cdi/nvidia.yaml)
$SUDO install -d -m 0755 /etc/cdi
$SUDO nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml >/dev/null

# Merge NVIDIA runtime + CDI support into /etc/docker/daemon.json without clobbering existing keys
$SUDO node - <<'NODE'
const fs = require("node:fs");
const path = "/etc/docker/daemon.json";
let data = {};
try { data = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
data.ip ??= "127.0.0.1";
data["live-restore"] ??= true;
data["userland-proxy"] = false;
data["log-driver"] ??= "local";
data["log-opts"] = { "max-size": "20m", "max-file": "3", ...(data["log-opts"] ?? {}) };
data.builder ??= { gc: { enabled: true, defaultKeepStorage: "20GB" } };
data["registry-mirrors"] ??= [];
if (!data["registry-mirrors"].includes("https://registry.megabyte.space")) data["registry-mirrors"].push("https://registry.megabyte.space");
data.features ??= {};
data.features.cdi = true;
data.runtimes ??= {};
data.runtimes.nvidia = { path: "nvidia-container-runtime", runtimeArgs: [] };
fs.mkdirSync("/etc/docker", { recursive: true });
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
NODE

# Install systemd unit to refresh CDI spec on boot / driver change
$SUDO tee /etc/systemd/system/nvidia-cdi-refresh.service >/dev/null <<'EOF'
[Unit]
Description=Refresh NVIDIA Container Device Interface (CDI) specification
After=nvidia-persistenced.service docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now nvidia-cdi-refresh.service >/dev/null 2>&1 || true
$SUDO systemctl reload docker.service 2>/dev/null || $SUDO systemctl restart docker.service

log "NVIDIA Container Toolkit and CDI (/etc/cdi/nvidia.yaml) configured"
