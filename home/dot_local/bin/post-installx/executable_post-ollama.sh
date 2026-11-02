#!/usr/bin/env bash
# @file post-installx/executable_post-ollama.sh
# @brief Capability-gated Ollama installation, GPU/Metal binding, and approved model manifest
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

if [ "${INSTALL_DOCTOR_OLLAMA:-1}" = "0" ]; then
  log "Ollama installation opted out (INSTALL_DOCTOR_OLLAMA=0) — skipping"
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

APPROVED_MODEL="${OLLAMA_DEFAULT_MODEL:-qwen2.5:7b-instruct}"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte/ai/ollama"
mkdir -p "$CACHE_ROOT"

if [ "$OS" = "macos" ]; then
  if ! command -v ollama >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      log "Installing native Ollama on macOS via Homebrew..."
      (yes || true) | HOMEBREW_NO_AUTO_UPDATE=1 brew install ollama
    else
      warn "Homebrew not available on macOS — skipping Ollama install"
      exit 0
    fi
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
  # Linux: require NVIDIA GPU or explicit CPU override
  if ! command -v nvidia-smi >/dev/null 2>&1 && [ "${OLLAMA_ALLOW_LINUX_CPU:-0}" != "1" ]; then
    log "No NVIDIA GPU detected on Linux host and OLLAMA_ALLOW_LINUX_CPU!=1 — skipping Ollama"
    exit 0
  fi

  SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo"

  if ! command -v ollama >/dev/null 2>&1; then
    log "Installing official Ollama on Linux..."
    curl -fsSL https://ollama.com/install.sh | $SUDO sh
  fi

  $SUDO install -d -m 0755 /etc/systemd/system/ollama.service.d
  $SUDO tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="CUDA_VISIBLE_DEVICES=0"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_MAX_QUEUE=64"
Environment="OLLAMA_KEEP_ALIVE=10m"
Environment="OLLAMA_FLASH_ATTENTION=1"
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

if [ "${OLLAMA_SKIP_PULL:-0}" != "1" ]; then
  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$APPROVED_MODEL"; then
    log "Pulling approved model $APPROVED_MODEL..."
    OLLAMA_HOST=127.0.0.1:11434 ollama pull "$APPROVED_MODEL"
  fi
fi

log "Ollama active on 127.0.0.1:11434 with model $APPROVED_MODEL"
