#!/usr/bin/env bash
set -euo pipefail
# @file Neovim / Vim Runtime State Initialization
# @brief Ensures XDG state and data directories exist for Neovim / Vim without legacy coc.nvim extensions

ensureEditorStateDirs() {
  local data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
  local state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/nvim"
  mkdir -p "$data_dir" "$state_dir"
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "Verified Neovim/Vim XDG directories ($data_dir, $state_dir)"
  fi
}

ensureEditorStateDirs
