#!/usr/bin/env bash
set -euo pipefail
# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1
# @file Neovim / Vim Runtime State Initialization
# @brief Ensures XDG state and data directories exist for Neovim / Vim and prunes legacy Vim syncolor recursion files

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/nvim"
vim_state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/vim"
vim_undo_dir="${vim_state_dir}/undo"
xdg_vim_dir="${XDG_CONFIG_HOME:-$HOME/.config}/vim"
xdg_rogue_list="${xdg_vim_dir}/colors/lists/default.vim"
xdg_rogue_dir="${xdg_vim_dir}/colors/lists"
home_rogue_list="${HOME}/.vim/colors/lists/default.vim"
home_rogue_dir="${HOME}/.vim/colors/lists"

editor_state_status() {
  [ -d "$data_dir" ] && [ ! -L "$data_dir" ] || return 10
  [ -d "$state_dir" ] && [ ! -L "$state_dir" ] || return 10
  [ -d "$vim_state_dir" ] && [ ! -L "$vim_state_dir" ] || return 10
  [ -d "$vim_undo_dir" ] && [ ! -L "$vim_undo_dir" ] || return 10
  [ ! -e "$xdg_rogue_list" ] && [ ! -L "$xdg_rogue_list" ] || return 10
  [ ! -e "$home_rogue_list" ] && [ ! -L "$home_rogue_list" ] || return 10
}

prune_legacy_vim_color_list() {
  local rogue_file="$1"
  local rogue_dir="$2"
  local colors_dir
  colors_dir="$(dirname "$rogue_dir")"

  if [ -e "$rogue_file" ] || [ -L "$rogue_file" ]; then
    [ ! -L "$colors_dir" ] && [ ! -L "$rogue_dir" ] || return 2
    rm -f -- "$rogue_file"
  fi
  if [ -d "$rogue_dir" ] && [ ! -L "$rogue_dir" ]; then
    rmdir "$rogue_dir" 2>/dev/null || true
  fi
}

ensure_non_symlink_dir_path() {
  local target="$1"
  [ ! -L "$target" ] || return 2
  [ ! -e "$target" ] || [ -d "$target" ] || return 2
}

ensure_editor_state_dirs() {
  ensure_non_symlink_dir_path "$data_dir" || return $?
  ensure_non_symlink_dir_path "$state_dir" || return $?
  ensure_non_symlink_dir_path "$vim_state_dir" || return $?
  ensure_non_symlink_dir_path "$vim_undo_dir" || return $?

  mkdir -p -- "$data_dir" "$state_dir" "$vim_undo_dir"
  chmod 0700 "$vim_state_dir" "$vim_undo_dir"

  prune_legacy_vim_color_list "$xdg_rogue_list" "$xdg_rogue_dir"
  prune_legacy_vim_color_list "$home_rogue_list" "$home_rogue_dir"

  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "Verified Neovim/Vim XDG directories ($data_dir, $state_dir, $vim_undo_dir)"
  fi
}

case "${1:---apply}" in
  --check) editor_state_status ;;
  --apply) ensure_editor_state_dirs ;;
  --verify) if editor_state_status; then exit 0; else status=$?; [ "$status" -eq 10 ] && exit 2; exit "$status"; fi ;;
  *) printf 'usage: %s [--check|--apply|--verify]\n' "$0" >&2; exit 2 ;;
esac
