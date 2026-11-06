#!/usr/bin/env bash
set -euo pipefail
# @file ~/.local/bin/post-installx/post-zsh-bootstrap.sh
# @brief Pre-warm zinit plugin cache, zcompile .zshrc, configure Terminal.app font
# @description
#   1. Pre-warm zinit plugins by sourcing ~/.zshrc once headless so the
#      first interactive terminal launch is silent and instant. (Replaces
#      the old antigen pre-warm path; antigen has been retired in favor of
#      zinit turbo mode.)
#   2. zcompile ~/.zshrc into ~/.zshrc.zwc so the zsh parser skips the
#      ~30-50ms tokenize/parse cost on every shell launch.
#   3. Force Terminal.app's default profile to use the MesloLGS Nerd Font
#      Mono at 13pt — powerlevel10k's powerline glyphs render as tofu in
#      the stock SF Mono.

set -u

### Detect OS once. Used to gate sections that only make sense on one
### platform (Terminal.app font config = macOS-only; fc-cache = Linux).
_IS_MAC=0; _IS_LINUX=0
if [ -d /Applications ] && [ -d /System ]; then
  _IS_MAC=1
elif [ -f /etc/os-release ] || [ -d /etc ]; then
  _IS_LINUX=1
fi

### gum is the standard logger across install.doctor scripts. Fall back to
### plain echo if it isn't on PATH yet (e.g. when this runs very early in
### a chroot/CI shell).
if ! command -v gum > /dev/null; then
  gum() {
    if [ "${1:-}" = "log" ]; then shift; while [ "$#" -gt 0 ] && [ "${1#-}" != "$1" ]; do shift; done; printf '%s %s\n' "${1:-INFO}" "${2:-}"; else "$@"; fi
  }
fi

###########################################################################
# Cross-platform Nerd Font installer
#
# Installs the 4 MesloLGS NF faces (Regular/Bold/Italic/Bold-Italic) on
# whichever OS we're running. powerlevel10k's prompt uses powerline
# glyphs + Nerd Font icons that render as tofu in any normal monospace
# font — install.doctor's brand requires the prompt look right on every
# fleet machine, not just macOS.
#
#   macOS — brew install --cask font-meslo-lg-nerd-font (handled at
#           install time via run_before_04-requirements.sh.tmpl); this
#           hook just verifies the install
#   Linux — verify the font selected by desired state. Artifact acquisition
#           belongs to the signed installer plan, not a configuration hook.
###########################################################################
installNerdFont() {
  local FONT_DIR
  if [ "$_IS_MAC" = "1" ]; then
    FONT_DIR="$HOME/Library/Fonts"
  else
    FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
  fi
  mkdir -p "$FONT_DIR"

  ### Already installed? (any of the brew-cask, p10k-media, or generic
  ### Nerd Fonts releases drop a `MesloLGS NF Regular.ttf` or close
  ### variant under one of two well-known directories.)
  if ls "$FONT_DIR"/MesloLGS*NF*.ttf "$FONT_DIR"/MesloLGSNerd*.ttf /Library/Fonts/MesloLGS*.ttf 2>/dev/null | head -1 | grep -q .; then
    gum log -sl info "MesloLGS NF already installed under $FONT_DIR"
    return 0
  fi

  gum log -sl warn 'MesloLGS NF is absent; select a checksummed font artifact in desired state'
  return 20
}

###########################################################################
# 1. Compile the local-only shell configuration
###########################################################################
preWarmZinit() {
  if ! command -v zsh > /dev/null; then
    gum log -sl warn 'zsh not found on PATH; skipping zsh compilation'
    return 0
  fi

  ### zcompile ~/.zshrc → ~/.zshrc.zwc. zsh checks for the .zwc on every
  ### shell launch and skips re-parsing the .zshrc when present + newer
  ### than its source. Saves ~30-50ms per shell launch.
  if [ -f "$HOME/.zshrc" ]; then
    gum log -sl info 'Compiling ~/.zshrc → ~/.zshrc.zwc'
    zsh -fc "zcompile -R -- '$HOME/.zshrc.zwc' '$HOME/.zshrc'" 2>/dev/null || gum log -sl warn 'zcompile failed (non-fatal)'
  fi
}

###########################################################################
# 2. Import existing shell history into atuin (idempotent — atuin
#    dedupes on import). Only runs if atuin is installed and the local DB
#    doesn't already have rows.
###########################################################################
importAtuinHistory() {
  command -v atuin > /dev/null || { gum log -sl info 'atuin not installed; skipping history import'; return 0; }
  local DB="${XDG_DATA_HOME:-$HOME/.local/share}/atuin/history.db"
  if [ -f "$DB" ] && [ "$(stat -f %z "$DB" 2>/dev/null || echo 0)" -gt 16384 ]; then
    gum log -sl info 'atuin history DB already populated; skipping import'
    return 0
  fi
  ### atuin auto-detects the shell + history file. Falls back to explicit
  ### HISTFILE if auto-detection fails (zsh history at a non-default path).
  gum log -sl info 'Importing existing shell history into atuin'
  HISTFILE="${HISTFILE:-${XDG_STATE_HOME:-$HOME/.local/state}/zsh/history}" atuin import auto 2>&1 | tail -3 | sed 's/^/  /'
}

###########################################################################
# 2. Force Terminal.app default profile to use MesloLGS NF
###########################################################################
configureTerminalFont() {
  ### Detect which MesloLGS face is actually installed and use its real
  ### family name. font-meslo-lg-nerd-font ships `MesloLGSNerdFontMono-
  ### Regular.ttf` (family `MesloLGS Nerd Font Mono`); the p10k-official
  ### download ships `MesloLGS NF Regular.ttf` (family `MesloLGS NF`).
  ### Both render the same powerline glyphs — we just need to use the
  ### family name macOS actually knows about.
  local FONT_FAMILY=""
  if [ -f "$HOME/Library/Fonts/MesloLGSNerdFontMono-Regular.ttf" ] || [ -f /Library/Fonts/MesloLGSNerdFontMono-Regular.ttf ]; then
    FONT_FAMILY="MesloLGS Nerd Font Mono"
  elif [ -f "$HOME/Library/Fonts/MesloLGSNerdFont-Regular.ttf" ] || [ -f /Library/Fonts/MesloLGSNerdFont-Regular.ttf ]; then
    FONT_FAMILY="MesloLGS Nerd Font"
  elif [ -f "$HOME/Library/Fonts/MesloLGS NF Regular.ttf" ] || [ -f "/Library/Fonts/MesloLGS NF Regular.ttf" ]; then
    FONT_FAMILY="MesloLGS NF"
  else
    gum log -sl warn 'No MesloLGS face found in ~/Library/Fonts or /Library/Fonts; skipping Terminal.app font config (cask font-meslo-lg-nerd-font may not have installed)'
    return 0
  fi
  gum log -sl info "Detected installed Meslo family: $FONT_FAMILY"

  ### Apple's font cache may not have picked up the new TTF yet —
  ### `atsutil databases -remove` forces a rebuild and is safe to run
  ### even when nothing changed. Without this, the AppleScript call
  ### below can return "font not registered" on a fresh machine.
  atsutil databases -remove > /dev/null 2>&1 || true

  ### AppleScript is the cleanest way to set the font on every existing
  ### Terminal.app profile + lock in the default. We pass the detected
  ### family name in via the env so the AppleScript stays static.
  gum log -sl info "Configuring every Terminal.app settings set to use $FONT_FAMILY 13pt"
  TERMINAL_FONT_FAMILY="$FONT_FAMILY" /usr/bin/osascript <<'APPLESCRIPT' > /dev/null 2>&1 || gum log -sl warn 'AppleScript Terminal.app font config returned non-zero; check Terminal > Preferences manually'
on getEnv(varName)
  return do shell script "printf %s \"$" & varName & "\""
end getEnv

set famName to my getEnv("TERMINAL_FONT_FAMILY")

tell application "Terminal"
  set allProfiles to name of every settings set
  repeat with p in allProfiles
    try
      set font name of settings set (p as string) to famName
      set font size of settings set (p as string) to 13
    end try
  end repeat
  try
    set font name of default settings to famName
    set font size of default settings to 13
  end try
  try
    set font name of startup settings to famName
    set font size of startup settings to 13
  end try
end tell
APPLESCRIPT

  gum log -sl info "Terminal.app font set to $FONT_FAMILY 13pt. Open a new window to see the change."
}

###########################################################################
# Main — runs on every supported OS (macOS, Ubuntu, Fedora, Qubes,
# Proxmox, Coolify, Alpine, Arch, WSL). Each function is OS-aware and
# self-skips when not applicable.
###########################################################################

### Nerd Font — runs on every OS. macOS uses the brew cask; Linux
### downloads the 4 .ttf files from romkatv/powerlevel10k-media and runs
### fc-cache. Without these the powerlevel10k prompt renders as tofu.
installNerdFont || gum log -sl warn 'Nerd Font install returned non-zero; prompt glyphs may render as tofu'

### zinit pre-warm + zsh compilation — runs on every OS that has zsh
### installed.
preWarmZinit
importAtuinHistory

### Terminal.app font configuration — macOS-only. On Linux the host
### terminal (Ghostty / Alacritty / gnome-terminal / Konsole / xterm) has
### its own font config path and we don't try to drive every one.
if [ "$_IS_MAC" = "1" ]; then
  configureTerminalFont || gum log -sl warn 'Terminal.app font configuration failed; set Terminal > Preferences > Profiles > Text > Font manually to MesloLGS NF.'
fi
