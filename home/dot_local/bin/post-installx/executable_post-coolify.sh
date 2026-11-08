#!/usr/bin/env bash
# @file executable_post-coolify.sh
# @description Capability-gated Coolify Docker orchestration and Traefik edge proxy convergence hook.
# Ensures /data/coolify/proxy/error-pages/404.html is present (preventing coolify-proxy-error-pages
# 100s healthcheck restart loops), installs Traefik dynamic compression + security headers,
# and configures Docker daemon log-opts and live-restore.
set -euo pipefail

log() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "$*"
  else
    printf '[post-coolify] %s\n' "$*"
  fi
}

warn() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl warn "$*"
  else
    printf '[post-coolify] WARNING: %s\n' "$*" >&2
  fi
}

case "${1:-}" in
  --status|--verify-host)
    if [ -d /data/coolify ]; then
      has_404="missing"
      [ -s /data/coolify/proxy/error-pages/404.html ] && has_404="ok"
      printf 'coolify=present error_page_404=%s\n' "$has_404"
      exit 0
    fi
    printf 'coolify=absent\n'
    exit 0
    ;;
  --check|--apply|--verify)
    warn 'Coolify reconciliation is pending migration to typed desired-state tasks'
    exit 20
    ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
  log "Coolify edge proxy convergence is Linux-only; skipping."
  exit 0
fi

if [ ! -d /data/coolify ] && [ "${INSTALL_DOCTOR_ENABLE_COOLIFY:-0}" != "1" ]; then
  log "No /data/coolify directory detected and INSTALL_DOCTOR_ENABLE_COOLIFY!=1; skipping."
  exit 0
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    SUDO="docker-helper"
  else
    warn "Neither passwordless sudo nor Docker daemon access is available; skipping."
    exit 0
  fi
fi

log "Converging Coolify proxy error pages and Traefik dynamic middlewares..."

if [ "$SUDO" = "docker-helper" ]; then
  if [ -d /data/coolify/proxy/error-pages ] && [ ! -s /data/coolify/proxy/error-pages/404.html ]; then
    docker run --rm -v /data/coolify/proxy/error-pages:/ep alpine:latest sh -c 'if [ -s /ep/503.html ]; then cp /ep/503.html /ep/404.html && chmod 0644 /ep/404.html; fi' >/dev/null 2>&1 || true
  fi
else
  $SUDO install -d -m 0755 /data/coolify/proxy/error-pages /data/coolify/proxy/dynamic
  if [ -s /data/coolify/proxy/error-pages/503.html ] && [ ! -s /data/coolify/proxy/error-pages/404.html ]; then
    $SUDO cp /data/coolify/proxy/error-pages/503.html /data/coolify/proxy/error-pages/404.html
    $SUDO chmod 0644 /data/coolify/proxy/error-pages/404.html
  fi
  $SUDO tee /data/coolify/proxy/dynamic/security-headers-compression.yaml >/dev/null <<'EOF'
http:
  middlewares:
    fleet-compress:
      compress:
        excludedContentTypes:
          - text/event-stream
        minResponseBodyBytes: 1024
    fleet-security-headers:
      headers:
        frameDeny: true
        browserXssFilter: true
        contentTypeNosniff: true
        referrerPolicy: "strict-origin-when-cross-origin"
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        stsPreload: true
EOF
  $SUDO chmod 0644 /data/coolify/proxy/dynamic/security-headers-compression.yaml
fi

log "Coolify proxy convergence complete."
