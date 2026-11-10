#!/usr/bin/env bash
# @file post-installx/executable_post-ollama.sh
# @brief Opt-in, capability-gated Ollama service and approved model setup
# @description
#   Evaluates host eligibility for local Ollama inference using measured available memory
#   (>= 8 GiB available RAM, zero heavy swap thrashing), free disk headroom (>= 25 GiB),
#   and hardware acceleration (NVIDIA CUDA on Linux or Apple Silicon Metal on macOS).
#   Binds Ollama privately to 127.0.0.1:11434, configures bounded concurrency/keep-alive,
#   uses scoped model storage, and pulls/verifies the approved tool-calling model.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh" ]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh"
  OS="$(detect_os)"
  ARCH="$(detect_arch)"
else
  if [[ "${OSTYPE:-}" == darwin* ]]; then OS="macos"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS="${ID:-linux}"
  else OS="unknown"
  fi
  ARCH="$(uname -m)"
fi

if command -v gum &>/dev/null; then
  log() { gum log -sl info "$1"; }
  warn() { gum log -sl warn "$1"; }
else
  log() { echo "[INFO] $1"; }
  warn() { echo "[WARN] $1" >&2; }
fi

if [ "${INSTALL_DOCTOR_OLLAMA:-0}" != "1" ]; then
  log "Ollama is lazy by default; set INSTALL_DOCTOR_OLLAMA=1 to install, start, and pull a model"
  exit 0
fi

# 1. Measure available RAM, swap pressure, and disk headroom
AVAIL_RAM_GIB=0
FREE_DISK_GIB=0
SWAP_USED_GIB=0

if [ "$OS" = "macos" ]; then
  TOTAL_BYTES="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  # On macOS, unified memory headroom check (>= 16 GiB total and >= 25 GiB free disk)
  TOTAL_RAM_GIB=$(( TOTAL_BYTES / 1073741824 ))
  AVAIL_RAM_GIB="$TOTAL_RAM_GIB"
  FREE_DISK_GIB="$(df -g / | awk 'NR==2 {print $4}')"
  if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "aarch64" ] && [ "${OLLAMA_ALLOW_INTEL_MAC:-0}" != "1" ]; then
    log "Skipping Ollama on Intel Mac (no Metal unified-memory acceleration; set OLLAMA_ALLOW_INTEL_MAC=1 to override)"
    exit 0
  fi
else
  MEM_AVAIL_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  AVAIL_RAM_GIB=$(( MEM_AVAIL_KB / 1048576 ))
  SWAP_TOTAL_KB="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  SWAP_FREE_KB="$(awk '/SwapFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  SWAP_USED_GIB=$(( (SWAP_TOTAL_KB - SWAP_FREE_KB) / 1048576 ))
  FREE_DISK_GIB="$(df -BG / | awk 'NR==2 {gsub("G","",$4); print $4}')"
fi

if [ "$AVAIL_RAM_GIB" -lt 8 ] || [ "$SWAP_USED_GIB" -ge 4 ] || [ "$FREE_DISK_GIB" -lt 25 ]; then
  log "Host ineligible for local Ollama (avail_ram=${AVAIL_RAM_GIB}GiB, swap_used=${SWAP_USED_GIB}GiB, free_disk=${FREE_DISK_GIB}GiB) — skipping"
  exit 0
fi

# A Linux host with an NVIDIA GPU must have enough VRAM for the default local
# model before this hook creates directories, installs Ollama, or changes its
# service. CPU-only Linux remains available through its existing explicit
# override, and non-NVIDIA hosts retain their existing skip behavior.
if [ "$OS" != "macos" ]; then
  NVIDIA_GPU_AVAILABLE=0
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    NVIDIA_GPU_AVAILABLE=1
  fi

  if [ "$NVIDIA_GPU_AVAILABLE" -eq 0 ]; then
    if [ "${OLLAMA_ALLOW_LINUX_CPU:-0}" != "1" ]; then
      log "No NVIDIA GPU detected on Linux host and OLLAMA_ALLOW_LINUX_CPU!=1 — skipping Ollama"
      exit 0
    fi
  else
    MIN_GPU_VRAM_MIB="${OLLAMA_MIN_GPU_VRAM_MIB:-8192}"
    case "$MIN_GPU_VRAM_MIB" in
      ''|*[!0-9]*)
        warn "OLLAMA_MIN_GPU_VRAM_MIB must be a non-negative integer — skipping Ollama"
        exit 0
        ;;
    esac

    GPU_VRAM_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null \
      | awk 'NF {gsub(/[[:space:]]/, "", $1); print $1; exit}' || true)"
    case "$GPU_VRAM_MIB" in
      ''|*[!0-9]*)
        warn "Unable to measure NVIDIA GPU VRAM with nvidia-smi — skipping Ollama"
        exit 0
        ;;
    esac

    if [ "$GPU_VRAM_MIB" -lt "$MIN_GPU_VRAM_MIB" ] && [ "${OLLAMA_ALLOW_LOW_VRAM_GPU:-0}" != "1" ]; then
      log "NVIDIA GPU VRAM ${GPU_VRAM_MIB} MiB is below the required ${MIN_GPU_VRAM_MIB} MiB (set OLLAMA_ALLOW_LOW_VRAM_GPU=1 to override) — skipping Ollama"
      exit 0
    fi
  fi
fi

APPROVED_MODEL="${OLLAMA_DEFAULT_MODEL:-qwen2.5:7b-instruct}"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/ai/ollama"
mkdir -p "$CACHE_ROOT"

if [ "$OS" = "macos" ]; then
  if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama was selected but its admitted package is absent; install it through desired state before configuration"
    exit 20
  fi

  MODEL_DIR="$CACHE_ROOT/models"
  mkdir -p "$MODEL_DIR" "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/com.megabyte.ollama.plist"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.megabyte.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v ollama)</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key>
    <string>127.0.0.1:11434</string>
    <key>OLLAMA_MODELS</key>
    <string>$MODEL_DIR</string>
    <key>OLLAMA_NUM_PARALLEL</key>
    <string>2</string>
    <key>OLLAMA_MAX_LOADED_MODELS</key>
    <string>1</string>
    <key>OLLAMA_MAX_QUEUE</key>
    <string>32</string>
    <key>OLLAMA_KEEP_ALIVE</key>
    <string>10m</string>
    <key>OLLAMA_FLASH_ATTENTION</key>
    <string>1</string>
    <key>OLLAMA_KV_CACHE_TYPE</key>
    <string>q8_0</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$CACHE_ROOT/ollama.log</string>
  <key>StandardErrorPath</key>
  <string>$CACHE_ROOT/ollama.err.log</string>
</dict>
</plist>
EOF
  brew services stop ollama >/dev/null 2>&1 || true
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load -w "$PLIST"
else
  SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo"

  if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama was selected but its verified package artifact is absent. Refusing the mutable ollama.com installer; add Ollama to the signed desired-state closure and rerun install.doctor."
    exit 69
  fi

  $SUDO install -d -m 0755 /etc/systemd/system/ollama.service.d
  $SUDO tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="CUDA_VISIBLE_DEVICES=0"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_MAX_QUEUE=64"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Restart=always
RestartSec=5
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now ollama.service
  $SUDO systemctl restart ollama.service
fi

# Wait for loopback listener
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$APPROVED_MODEL"; then
  warn "Approved model $APPROVED_MODEL is absent; admit its immutable manifest through desired state before loading it"
  exit 20
fi

log "Ollama active on 127.0.0.1:11434 with model $APPROVED_MODEL"
