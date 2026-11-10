#!/usr/bin/env bash
set -euo pipefail
# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1
# @file Neovim / Vim Runtime State Initialization
# @brief Ensures XDG state and data directories exist for Neovim / Vim without legacy coc.nvim extensions

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/nvim"

editor_state_status() {
  [ -d "$data_dir" ] && [ ! -L "$data_dir" ] || return 10
  [ -d "$state_dir" ] && [ ! -L "$state_dir" ] || return 10
}

ensure_editor_state_dirs() {
  [ ! -e "$data_dir" ] || [ -d "$data_dir" ] && [ ! -L "$data_dir" ] || return 2
  [ ! -e "$state_dir" ] || [ -d "$state_dir" ] && [ ! -L "$state_dir" ] || return 2
  mkdir -p -- "$data_dir" "$state_dir"
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "Verified Neovim/Vim XDG directories ($data_dir, $state_dir)"
  fi
}

case "${1:---apply}" in
  --check) editor_state_status ;;
  --apply) ensure_editor_state_dirs ;;
  --verify) if editor_state_status; then exit 0; else status=$?; [ "$status" -eq 10 ] && exit 2; exit "$status"; fi ;;
  *) printf 'usage: %s [--check|--apply|--verify]\n' "$0" >&2; exit 2 ;;
esac
