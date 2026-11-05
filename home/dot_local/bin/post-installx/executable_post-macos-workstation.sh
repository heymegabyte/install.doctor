#!/usr/bin/env bash
set -euo pipefail
# @file macOS Apple Silicon Workstation Convergence
# @brief Tunes macOS Sequoia/Tahoe (Darwin 24/25+) kernel limits, Spotlight exclusions, caches, and Zero-Trust daemons

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

log() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "$*"
  else
    printf '[macos-workstation] %s\n' "$*"
  fi
}

# 1. Spotlight (.metadata_never_index) guards on high-churn build/cache directories to stop mds_stores SSD thrashing
for dir in \
  "$HOME/.cache" \
  "$HOME/.bun/install/cache" \
  "$HOME/.npm" \
  "$HOME/.local/share/pnpm" \
  "$HOME/.local/share/uv" \
  "$HOME/.local/share/cargo" \
  "$HOME/Library/Caches"; do
  if [ -d "$dir" ] && [ ! -f "$dir/.metadata_never_index" ]; then
    touch "$dir/.metadata_never_index" 2>/dev/null || true
  fi
done

# 2. Enforce Node 24+ native CA & V8 memory ceiling in ~/.config/environment.d
mkdir -p "$HOME/.config/environment.d"
cat > "$HOME/.config/environment.d/20-macos-ai-workstation.conf" <<'EOF'
NODE_OPTIONS=--use-system-ca --max-old-space-size=8192
BUN_INSTALL_CACHE_DIR=/Users/Apple/.bun/install/cache
UV_LINK_MODE=clone
EOF

# 3. Prune bloated macOS user caches & logs (>7 days old) when free disk space drops below 50 GiB
AVAIL_GB="$(df -g / | awk 'NR==2 {print $4}')"
if [ "${AVAIL_GB:-100}" -lt 50 ]; then
  log "Free disk space on / is ${AVAIL_GB}GiB (<50GiB threshold); pruning stale caches and logs..."
  command -v brew >/dev/null 2>&1 && brew cleanup --prune=7 -s >/dev/null 2>&1 || true
  find "$HOME/Library/Logs" -type f -mtime +7 -delete 2>/dev/null || true
  rm -rf "$HOME/Library/Caches/Homebrew/downloads/"*.incomplete 2>/dev/null || true
fi

log "macOS Apple Silicon workstation convergence complete."
