#!/usr/bin/env bash
# scripts/lib/detect_os.sh — Single source of truth for OS/role detection.
# Source this file, then call detect_os or detect_role.
# Replaces 25+ ad-hoc OS checks across start.sh, provision.sh, installx, and
# chezmoi scripts.

# shellcheck disable=SC2034  # Functions are sourced, not executed directly

# ---------------------------------------------------------------------------
# detect_os — returns the base operating system
#
# Output: macos | ubuntu | debian | fedora | silverblue | alpine | arch |
#         qubes-dom0 | qubes-appvm | proxmox | wsl | container | unknown
#
# Detection order (most-specific first):
#   1. Qubes (dom0 or AppVM — checked before generic Linux)
#   2. WSL (checked before generic Linux)
#   3. Container (checked before generic Linux)
#   4. macOS (darwin OSTYPE)
#   5. Linux distros via release files
# ---------------------------------------------------------------------------
detect_os() {
  # Qubes dom0 — Xen hypervisor host with Salt control
  if [ -f /usr/bin/qubes-session ] && [ -f /etc/qubes/dom0 ]; then
    echo "qubes-dom0"
    return 0
  fi

  # Qubes AppVM — runs inside a Qubes VM
  if [ -f /usr/bin/qubes-session ] || [ -d /usr/share/qubes ]; then
    echo "qubes-appvm"
    return 0
  fi

  # WSL — Windows Subsystem for Linux
  if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version 2>/dev/null; then
    echo "wsl"
    return 0
  fi

  # Container — Docker/Podman/LXC
  if [ -f /.dockerenv ] || grep -qE 'docker|lxc|containerd' /proc/1/cgroup 2>/dev/null; then
    echo "container"
    return 0
  fi

  # macOS
  if [[ "$OSTYPE" == 'darwin'* ]]; then
    echo "macos"
    return 0
  fi

  # Proxmox VE — Debian-based hypervisor
  if [ -f /etc/pve/pve.cfg ] || [ -x /usr/bin/pvesh ]; then
    echo "proxmox"
    return 0
  fi

  # Linux distro detection via release files
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    local id
    id="$(. /etc/os-release && echo "${ID:-unknown}")"

    case "$id" in
      ubuntu)       echo "ubuntu";   return 0 ;;
      debian)       echo "debian";   return 0 ;;
      fedora)
        # Silverblue / immutable Fedora variants
        if [ -f /run/ostree-booted ]; then
          echo "silverblue"
        else
          echo "fedora"
        fi
        return 0
        ;;
      rhel|centos|rocky|almalinux|ol)  echo "fedora"; return 0 ;;  # RHEL family ≈ fedora for install purposes
      arch|archlinux|manjaro)           echo "arch";    return 0 ;;
      alpine)                           echo "alpine";  return 0 ;;
      opensuse*|sles)                   echo "fedora";  return 0 ;;  # SUSE ≈ fedora (uses rpm)
      *)                                echo "$id";     return 0 ;;
    esac
  fi

  # Fallback detection via legacy release files (pre-systemd or minimal)
  if [ -f /etc/redhat-release ]; then
    echo "fedora"
    return 0
  elif [ -f /etc/debian_version ]; then
    echo "debian"
    return 0
  elif [ -f /etc/arch-release ]; then
    echo "arch"
    return 0
  elif [ -f /etc/alpine-release ]; then
    echo "alpine"
    return 0
  fi

  # Final fallback: check OSTYPE for generic Linux
  if [[ "$OSTYPE" == 'linux'* ]]; then
    echo "linux"
    return 0
  fi

  echo "unknown"
  return 1
}

# ---------------------------------------------------------------------------
# detect_arch — returns the normalized CPU architecture
#
# Output: amd64 | arm64 | armv7 | armv6 | 386 | riscv64 | ppc64le | s390x
#         (passes through the raw `uname -m` token for anything unrecognized;
#          "unknown" + exit 1 only when `uname -m` yields nothing)
#
# Normalizes the many vendor spellings (x86_64/amd64, aarch64/arm64, …) to the
# Go/release-asset vocabulary the catalog + download URLs already use, so the
# 140+ ad-hoc `uname -m` checks across start.sh + post-installx can converge here
# instead of each re-deriving arch. Pairs with detect_os as the "what machine is
# this" source of truth.
# ---------------------------------------------------------------------------
detect_arch() {
  local m
  m="$(uname -m 2>/dev/null)"

  case "$m" in
    x86_64 | amd64)              echo "amd64";   return 0 ;;
    aarch64 | arm64)             echo "arm64";   return 0 ;;
    armv7l | armv7 | armhf)      echo "armv7";   return 0 ;;
    armv6l | armv6)              echo "armv6";   return 0 ;;
    i386 | i486 | i586 | i686)   echo "386";     return 0 ;;
    riscv64)                     echo "riscv64"; return 0 ;;
    ppc64le)                     echo "ppc64le"; return 0 ;;
    s390x)                       echo "s390x";   return 0 ;;
    "")                          echo "unknown"; return 1 ;;
    *)                           echo "$m";      return 0 ;;
  esac
}

# ---------------------------------------------------------------------------
# detect_release — returns the OS version/release identifier
#
# Output: macOS product version (e.g. 26.5) | Linux VERSION_ID (e.g. 24.04, 41)
#         | "rolling" (arch & co. with no VERSION_ID) | "unknown" + exit 1
#
# The machine-readable release the version-gated recipes already reach for via
# scattered `sw_vers -productVersion` / `VERSION_ID` / `/etc/debian_version`
# reads. Completes the B03 "OS, architecture, release, privileges" quartet
# alongside detect_os / detect_arch / detect_privilege. (Codename — what apt
# repos want via `lsb_release -cs` — is a separate concern, intentionally not
# folded in here.)
# ---------------------------------------------------------------------------
detect_release() {
  local os
  os="$(detect_os)"

  # macOS — product version
  if [ "$os" = "macos" ]; then
    if command -v sw_vers > /dev/null 2>&1; then
      sw_vers -productVersion 2>/dev/null && return 0
    fi
    echo "unknown"
    return 1
  fi

  # Linux family (+ WSL/container/proxmox/qubes) — VERSION_ID from os-release
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    local ver
    ver="$(. /etc/os-release && echo "${VERSION_ID:-}")"
    if [ -n "$ver" ]; then
      echo "$ver"
      return 0
    fi
    # Rolling distros (arch, gentoo, void) ship no VERSION_ID
    echo "rolling"
    return 0
  fi

  # Legacy Debian without os-release
  if [ -f /etc/debian_version ]; then
    cat /etc/debian_version 2>/dev/null && return 0
  fi

  echo "unknown"
  return 1
}

# ---------------------------------------------------------------------------
# detect_role — returns the machine's role in the fleet
#
# Output: workstation | server | proxmox | coolify | qubes-dom0 |
#         qubes-appvm | wsl | container | unknown
#
# Can be overridden via INSTALL_DOCTOR_ROLE env var.
# Defaults to 'workstation' on macOS, 'server' on headless Linux.
# ---------------------------------------------------------------------------
detect_role() {
  # Explicit override
  if [ -n "${INSTALL_DOCTOR_ROLE:-}" ]; then
    echo "$INSTALL_DOCTOR_ROLE"
    return 0
  fi

  local os
  os="$(detect_os)"

  case "$os" in
    qubes-dom0)  echo "qubes-dom0";  return 0 ;;
    qubes-appvm) echo "qubes-appvm"; return 0 ;;
    proxmox)     echo "proxmox";     return 0 ;;
    wsl)         echo "wsl";         return 0 ;;
    container)   echo "container";   return 0 ;;
  esac

  # Coolify detection — check for Coolify-specific markers
  if [ -d /data/coolify ] || [ -f /etc/coolify/.installed ]; then
    echo "coolify"
    return 0
  fi

  # macOS defaults to workstation
  if [ "$os" = "macos" ]; then
    echo "workstation"
    return 0
  fi

  # Linux: check for desktop environment for workstation vs server
  if [ -n "${XDG_CURRENT_DESKTOP:-}" ] || [ -n "${DISPLAY:-}" ]; then
    echo "workstation"
  else
    echo "server"
  fi
}

# ---------------------------------------------------------------------------
# detect_package_manager — returns the native package manager for the OS
# ---------------------------------------------------------------------------
detect_package_manager() {
  local os
  os="$(detect_os)"

  case "$os" in
    macos)       echo "brew"  ;;
    ubuntu|debian) echo "apt" ;;
    fedora|silverblue) echo "dnf" ;;
    alpine)      echo "apk"   ;;
    arch)        echo "pacman";;
    *)           echo "unknown" ;;
  esac
}

# ---------------------------------------------------------------------------
# detect_service_manager — returns the init/service system managing the host
#
# Output: launchd | systemd | openrc | runit | sysvinit | unknown
#
# Detects the RUNNING init via PID-1 markers (/run/systemd/system, /run/openrc)
# rather than merely an installed binary — a host can ship `systemctl` yet boot
# OpenRC. Gives the H-series service adapters + server-stack post-installs ONE
# primitive instead of the 160+ scattered `systemctl`/`launchctl` calls that
# each re-derive it. Pairs with detect_package_manager as a "how to operate
# this host" lookup.
# ---------------------------------------------------------------------------
detect_service_manager() {
  # macOS always uses launchd
  if [[ "$OSTYPE" == 'darwin'* ]] || [ "$(detect_os)" = "macos" ]; then
    echo "launchd"
    return 0
  fi

  # systemd — authoritative marker is the /run/systemd/system dir (PID 1 = systemd)
  if [ -d /run/systemd/system ]; then
    echo "systemd"
    return 0
  fi

  # OpenRC (Alpine, Gentoo) — check the running marker before the bare binary
  if [ -d /run/openrc ] || command -v rc-service > /dev/null 2>&1; then
    echo "openrc"
    return 0
  fi

  # runit (Void)
  if [ -d /run/runit ] || { command -v sv > /dev/null 2>&1 && [ -d /etc/runit ]; }; then
    echo "runit"
    return 0
  fi

  # systemd fallback — binary present without the /run marker (e.g. some containers)
  if command -v systemctl > /dev/null 2>&1; then
    echo "systemd"
    return 0
  fi

  # Legacy SysV init
  if [ -d /etc/init.d ]; then
    echo "sysvinit"
    return 0
  fi

  echo "unknown"
  return 1
}

# ---------------------------------------------------------------------------
# is_headless — returns 0 if the machine has no GUI
# ---------------------------------------------------------------------------
is_headless() {
  # Explicit override
  [ "${HEADLESS_INSTALL:-}" = "true" ] && return 0

  # macOS: always has GUI unless explicitly headless
  [ "$(detect_os)" = "macos" ] && return 1

  # Linux: check for display server
  [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && return 0

  return 1
}

# ---------------------------------------------------------------------------
# detect_privilege — returns the host's effective privilege level
#
# Output: root | passwordless-sudo | sudo | user
#   root              — running as uid 0
#   passwordless-sudo — can elevate silently (`sudo -n` works) — HEADLESS-safe
#   sudo              — sudo present but elevation needs a password / may be denied
#   user              — no sudo available (unprivileged)
#
# Consolidates the scattered `id -u` / `EUID` / `sudo -n true` probes across
# provision.sh + post-installx so the bootstrap + headless paths branch on ONE
# honest value instead of re-deriving it. The sudo probe is non-interactive
# (`-n`), so it never prompts and is safe to call during detection. Override
# with INSTALL_DOCTOR_PRIVILEGE (mirrors INSTALL_DOCTOR_ROLE) for tests /
# constrained environments.
# ---------------------------------------------------------------------------
detect_privilege() {
  # Explicit override (tests / constrained environments)
  if [ -n "${INSTALL_DOCTOR_PRIVILEGE:-}" ]; then
    echo "$INSTALL_DOCTOR_PRIVILEGE"
    return 0
  fi

  # Running as root
  if [ "$(id -u 2>/dev/null)" = "0" ]; then
    echo "root"
    return 0
  fi

  # Non-root: probe sudo WITHOUT prompting (-n), so detection never blocks
  if command -v sudo > /dev/null 2>&1; then
    if sudo -n true > /dev/null 2>&1; then
      echo "passwordless-sudo"
    else
      echo "sudo"
    fi
    return 0
  fi

  echo "user"
  return 0
}
