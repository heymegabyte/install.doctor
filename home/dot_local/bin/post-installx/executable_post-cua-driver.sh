#!/usr/bin/env bash
# @file post-installx/executable_post-cua-driver.sh
# @brief Opt-in installation and configuration of the official Cua Driver
# @description
#   When explicitly selected, installs the official Cua Driver runtime on a
#   supported interactive desktop.
#   Configures GNOME Wayland support (`winrects@cua`), disables telemetry, and sets up native
#   user autostart. Agent registration is owned by the operator's harness configuration.
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

if (( $# > 1 )) || [[ -n "${1:-}" && "${1:-}" != --check-session ]]; then
  printf 'Usage: post-cua-driver.sh [--check-session]\n' >&2
  exit 64
fi
check_session=${1:-}
skip() {
  log "$1"
  if [[ "$check_session" == --check-session ]]; then exit 1; fi
  exit 0
}

if [ "${INSTALL_DOCTOR_CUA_DRIVER:-0}" != "1" ] || [ "${HEADLESS_INSTALL:-}" = "1" ] || [ "${HEADLESS_INSTALL:-}" = "true" ]; then
  skip 'Cua Driver skipped by provisioning selection or headless mode'
fi

desktop_type=
has_local_user_desktop() {
  (( EUID != 0 )) || return 1
  case "$(uname -s)" in
    Darwin)
      [[ "$(stat -f '%u' /dev/console)" == "$EUID" ]] &&
        /bin/launchctl print "gui/$EUID" >/dev/null 2>&1
      ;;
    Linux)
      local sessions session uid properties
      sessions=$(loginctl list-sessions --no-legend --no-pager 2>/dev/null) || return 1
      while read -r session uid _; do
        [[ -n "$session" && "$uid" == "$EUID" ]] || continue
        properties=$(loginctl show-session "$session" --no-pager \
          -p User -p Type -p Class -p Seat -p Remote -p Active 2>/dev/null) || continue
        if grep -Fxq "User=$EUID" <<<"$properties" &&
           grep -Eq '^Type=(x11|wayland)$' <<<"$properties" &&
           grep -Fxq 'Class=user' <<<"$properties" &&
           grep -Eq '^Seat=[^[:space:]]+$' <<<"$properties" &&
           grep -Fxq 'Remote=no' <<<"$properties" &&
           grep -Fxq 'Active=yes' <<<"$properties"; then
          desktop_type=$(sed -n 's/^Type=//p' <<<"$properties")
          return 0
        fi
      done <<<"$sessions"
      return 1
      ;;
    *) return 1 ;;
  esac
}

if ! has_local_user_desktop; then
  skip 'Cua Driver skipped because this user has no active local graphical session'
fi
if [[ "$check_session" == --check-session ]]; then
  log 'Cua Driver is applicable to the active local graphical session'
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v cua-driver >/dev/null 2>&1; then
  "$HOME/.local/bin/install-cua-driver-runtime"
fi

cua-driver telemetry disable >/dev/null 2>&1 || true
command -v cua >/dev/null 2>&1 && cua telemetry off >/dev/null 2>&1 || true

# Preserve an existing extension and install a bundled helper only for a declared GNOME version.
if [[ "$desktop_type" == wayland ]] && command -v gnome-shell >/dev/null 2>&1; then
  extension="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winrects@cua"
  if [[ ! -e "$extension" && ! -L "$extension" ]]; then
    driver=$(readlink -f -- "$(command -v cua-driver)")
    helper="$(dirname "$driver")/wayland-helper"
    shell_version=$(LC_ALL=C gnome-shell --version)
    if [[ "$shell_version" =~ ^GNOME[[:space:]]Shell[[:space:]]([0-9]+)\. &&
          -f "$helper/install.sh" ]] &&
       jq -e --arg version "${BASH_REMATCH[1]}" '.["shell-version"] | index($version) != null' \
         "$helper/winrects@cua/metadata.json" >/dev/null 2>&1; then
      bash "$helper/install.sh" || warn 'Cua Driver WinRects helper setup failed'
    else
      warn 'Cua Driver WinRects helper skipped because this GNOME version or bundle is unverified'
    fi
  fi
fi

if [ "$OS" = "macos" ]; then
  "$HOME/.local/bin/configure-cua-macos-autostart"
else
  "$HOME/.local/bin/configure-cua-linux-autostart"
  log "Cua Driver configured and autostart enabled on $OS"
fi
