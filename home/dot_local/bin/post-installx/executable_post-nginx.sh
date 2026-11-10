#!/usr/bin/env bash
set -euo pipefail
# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1
# @file NGINX post-install configuration
# @brief Non-destructively reconciles the macOS Homebrew NGINX config link

is_macos() { [ "$(uname -s 2>/dev/null)" = Darwin ]; }

nginx_paths() {
  command -v nginx >/dev/null 2>&1 || return 20
  is_macos || return 0
  command -v brew >/dev/null 2>&1 || return 20
  brew_prefix="$(brew --prefix 2>/dev/null)" || return 20
  case "$brew_prefix" in /*) ;; *) return 2 ;; esac
  case "$brew_prefix" in *$'\n'*|*$'\r'*) return 2 ;; esac
  config_parent="$brew_prefix/etc"
  config_path="$config_parent/nginx"
}

nginx_config_status() {
  nginx_paths || return $?
  is_macos || return 0
  if [ -L "$config_path" ]; then
    [ "$(readlink "$config_path")" = /etc/nginx ] || return 20
    return 0
  fi
  [ ! -e "$config_path" ] || return 20
  [ -d /etc/nginx ] && [ ! -L /etc/nginx ] || return 20
  [ -d "$config_parent" ] && [ ! -L "$config_parent" ] || return 20
  return 10
}

apply_nginx_config() {
  local status
  if nginx_config_status; then return 0; else status=$?; fi
  [ "$status" -eq 10 ] || return "$status"
  ln -s /etc/nginx "$config_path"
}

case "${1:---apply}" in
  --check) nginx_config_status ;;
  --apply) apply_nginx_config ;;
  --verify) if nginx_config_status; then exit 0; else status=$?; [ "$status" -eq 10 ] && exit 2; exit "$status"; fi ;;
  *) printf 'usage: %s [--check|--apply|--verify]\n' "$0" >&2; exit 2 ;;
esac
