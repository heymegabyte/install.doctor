#!/usr/bin/env bash
# @file Quick Start Provision Script
# @brief Main entry point for Install Doctor that ensures Homebrew and a few dependencies are installed before cloning the repository and running Chezmoi.
# @description
#     This script ensures Homebrew is installed and then installs a few dependencies that Install Doctor relies on.
#     After setting up the minimal amount of changes required, it clones the Install Doctor repository (which you
#     can customize the location of so you can use your own fork). It then proceeds by handing things over to
#     Chezmoi which handles the dotfile application and synchronous scripts. Task is used in conjunction with
#     Chezmoi to boost the performance in some spots by introducing asynchronous features.
#
#     **Note**: the signed `https://app.install.doctor/start` launcher verifies an immutable release containing this file.

# Preserve the owning command's failure through display/logging pipelines such as chezmoi | tee | ts.
set -o pipefail

# Source centralized OS detection (replaces ad-hoc checks throughout)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/detect_os.sh" ]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/lib/detect_os.sh"
else
  # Standalone signed-release fallback. Keep the platform facts needed for
  # admission equivalent to scripts/lib/detect_os.sh: curl|bash receives this
  # file without the repository library beside it.
  detect_os() {
    if [ -f /usr/bin/qubes-session ] && [ -f /etc/qubes/dom0 ]; then echo "qubes-dom0"; return 0; fi
    if [ -f /usr/bin/qubes-session ] || [ -d /usr/share/qubes ]; then echo "qubes-appvm"; return 0; fi
    if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version 2>/dev/null; then echo "wsl"; return 0; fi
    if [ -f /.dockerenv ] || grep -qE 'docker|lxc|containerd' /proc/1/cgroup 2>/dev/null; then echo "container"; return 0; fi
    if [[ "$OSTYPE" == 'darwin'* ]]; then echo "macos"; return 0; fi
    if [ -f /etc/pve/pve.cfg ] || [ -x /usr/bin/pvesh ]; then echo "proxmox"; return 0; fi
    if [ -f /etc/os-release ]; then
      local id; id="$(. /etc/os-release && echo "${ID:-unknown}")"
      case "$id" in
        ubuntu|debian|arch|alpine) echo "$id"; return 0 ;;
        fedora) [ -f /run/ostree-booted ] && echo silverblue || echo fedora; return 0 ;;
        rhel|centos|rocky|almalinux|ol|opensuse*|sles) echo fedora; return 0 ;;
        *) echo "$id"; return 0 ;;
      esac
    fi
    [ -f /etc/debian_version ] && { echo "debian"; return 0; }
    [ -f /etc/redhat-release ] && { echo "fedora"; return 0; }
    [ -f /etc/arch-release ] && { echo "arch"; return 0; }
    [ -f /etc/alpine-release ] && { echo "alpine"; return 0; }
    [[ "$OSTYPE" == 'linux'* ]] && { echo "linux"; return 0; }
    echo "unknown"
    return 1
  }
  detect_arch() {
    case "$(uname -m 2>/dev/null)" in
      x86_64|amd64) echo amd64 ;; aarch64|arm64) echo arm64 ;;
      armv7l|armv7|armhf) echo armv7 ;; armv6l|armv6) echo armv6 ;;
      i386|i486|i586|i686) echo 386 ;; riscv64) echo riscv64 ;;
      ppc64le) echo ppc64le ;; s390x) echo s390x ;; '') echo unknown; return 1 ;;
      *) uname -m ;;
    esac
  }
  detect_release() {
    if [ "$(detect_os)" = macos ]; then command -v sw_vers >/dev/null 2>&1 && sw_vers -productVersion && return 0; echo unknown; return 1; fi
    if [ -f /etc/os-release ]; then
      local version; version="$(. /etc/os-release && echo "${VERSION_ID:-}")"
      [ -n "$version" ] && { echo "$version"; return 0; }
      echo rolling; return 0
    fi
    [ -f /etc/debian_version ] && { cat /etc/debian_version; return 0; }
    echo unknown; return 1
  }
  detect_role() {
    [ -n "${INSTALL_DOCTOR_ROLE:-}" ] && { echo "$INSTALL_DOCTOR_ROLE"; return 0; }
    case "$(detect_os)" in
      qubes-dom0|qubes-appvm|proxmox|wsl|container) detect_os; return 0 ;;
      macos) echo workstation; return 0 ;;
    esac
    [ -d /data/coolify ] || [ -f /etc/coolify/.installed ] && { echo coolify; return 0; }
    [ -n "${XDG_CURRENT_DESKTOP:-}${DISPLAY:-}" ] && echo workstation || echo server
  }
  detect_package_manager() { detect_os; }
  # Mirror lib/detect_os.sh precedence: HEADLESS_INSTALL -> macOS has Aqua GUI -> Wayland/X11 check.
  # (A bare `-z "$DISPLAY"` would wrongly call every GUI macOS headless — Macs never set DISPLAY.)
  is_headless() { case "${HEADLESS_INSTALL:-}" in true|1) return 0 ;; esac; [[ "$OSTYPE" == 'darwin'* ]] && return 1; [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && return 0; return 1; }
fi

# The signed provision artifact is the executable platform-policy authority for
# this release. This pure resolver intentionally mirrors
# scripts/platform-support-matrix.json; the parity test rejects drift.
idResolvePlatformAdmission() {
  local OS="$1" RELEASE="$2" ARCH="$3" ENVIRONMENT="$4" ROLE="$5"
  case "$OS:$RELEASE:$ARCH:$ENVIRONMENT:$ROLE" in
    macos:14:arm64:native:macos) printf '%s\n' 'macos-14-arm64-native|best-effort|GitHub retired the macOS 14 runner and no current clean-host receipt covers the complete install lifecycle.' ;;
    macos:15:arm64:native:macos) printf '%s\n' 'macos-15-arm64-native|best-effort|No current clean-host receipt covers the complete install lifecycle.' ;;
    macos:15:x64:native:macos) printf '%s\n' 'macos-15-x64-native|best-effort|No current clean-host receipt covers the complete install lifecycle.' ;;
    macos:26:arm64:native:macos) printf '%s\n' 'macos-26-arm64-native|best-effort|No current clean-host receipt covers the complete install lifecycle.' ;;
    macos:26:x64:native:macos) printf '%s\n' 'macos-26-x64-native|best-effort|No current clean-host receipt covers the complete install lifecycle.' ;;
    macos:14:x64:native:macos) printf '%s\n' 'macos-14-x64-native|best-effort|GitHub retired the macOS 14 runner and no current clean-host receipt covers the complete install lifecycle.' ;;
    ubuntu:22.04:x64:container:ubuntu) printf '%s\n' 'ubuntu-22-04-x64-container|best-effort|The workflow does not produce a durable full-lifecycle canary receipt.' ;;
    ubuntu:24.04:x64:container:ubuntu) printf '%s\n' 'ubuntu-24-04-x64-container|best-effort|The workflow does not produce a durable full-lifecycle canary receipt.' ;;
    debian:12:x64:container:debian) printf '%s\n' 'debian-12-x64-container|best-effort|The workflow does not produce a durable full-lifecycle canary receipt.' ;;
    debian:12:arm64:container:debian) printf '%s\n' 'debian-12-arm64-container|best-effort|The hermetic signed-install fixture is not a durable full-lifecycle real-host canary receipt.' ;;
    debian:12:x64:native:debian) printf '%s\n' 'debian-12-x64-native|best-effort|No current native-host full-lifecycle canary receipt exists.' ;;
    debian:12:arm64:native:debian) printf '%s\n' 'debian-12-arm64-native|best-effort|No current native-host full-lifecycle canary receipt exists.' ;;
    fedora:44:x64:container:fedora) printf '%s\n' 'fedora-44-x64-container|best-effort|The workflow does not produce a durable full-lifecycle canary receipt.' ;;
    arch:rolling:x64:container:arch) printf '%s\n' 'arch-rolling-x64-container|best-effort|Rolling releases can drift after the workflow definition is authored.' ;;
    alpine:3.19:x64:container:alpine) printf '%s\n' 'alpine-3-19-x64-container|unsupported|The signed bootstrap publishes only glibc Linux runtimes and cannot safely execute them on musl when a compatible system Node is absent.' ;;
    linux:unspecified:x64:container:container) printf '%s\n' 'generic-linux-x64-container|best-effort|Generic containers vary in init, privileges, libc, and package manager.' ;;
    silverblue:40:x64:native:silverblue) printf '%s\n' 'silverblue-40-x64-native|unsupported|No rpm-ostree fixture or current lifecycle canary is committed.' ;;
    qubes-dom0:4.2:x64:qubes:qubes-dom0) printf '%s\n' 'qubes-4-2-x64-dom0|unsupported|No safe dom0 fixture or current canary demonstrates the restricted Salt path.' ;;
    qubes-appvm:4.2:x64:qubes:qubes-appvm) printf '%s\n' 'qubes-4-2-x64-appvm|unsupported|No TemplateVM/AppVM lifecycle canary is committed.' ;;
    proxmox:8:x64:native:proxmox) printf '%s\n' 'proxmox-8-x64-native|unsupported|No current server-role canary proves host-safe provisioning and rollback.' ;;
    ubuntu:unspecified:x64:native:coolify) printf '%s\n' 'coolify-ubuntu-x64-native|unsupported|No canary proves that provisioning preserves an existing Coolify installation.' ;;
    ubuntu:unspecified:x64:wsl:wsl) printf '%s\n' 'wsl2-ubuntu-x64|unsupported|Linux workflow definitions do not prove WSL init, mount, or Windows interop behavior.' ;;
    windows:unspecified:x64:native:windows) printf '%s\n' 'windows-native-x64|unsupported|The PowerShell source is unpublished and has no real-host runtime canary.' ;;
    *) return 1 ;;
  esac
}

idNormalizePlatformArch() {
  case "${1:-$(uname -m 2>/dev/null)}" in x86_64|amd64) echo x64 ;; aarch64|arm64) echo arm64 ;; *) echo "${1:-unknown}" ;; esac
}

idPlatformEnvironment() {
  case "$(detect_os 2>/dev/null || echo unknown)" in
    wsl) echo wsl ;; container) echo container ;; qubes-dom0|qubes-appvm) echo qubes ;; *) echo native ;;
  esac
}

idPlatformMatrixFacts() {
  local DETECTED RELEASE ARCH ENVIRONMENT ROLE BASE_OS
  DETECTED="$(detect_os 2>/dev/null || echo unknown)"
  RELEASE="$(detect_release 2>/dev/null || echo unknown)"
  ARCH="$(idNormalizePlatformArch "$(uname -m)")"; ENVIRONMENT="$(idPlatformEnvironment)"
  BASE_OS="$DETECTED"; ROLE="$DETECTED"
  if [ "$DETECTED" = container ]; then
    BASE_OS="$(. /etc/os-release 2>/dev/null && echo "${ID:-linux}")"
    case "$BASE_OS" in ubuntu|debian|fedora|arch|alpine) ROLE="$BASE_OS" ;; *) BASE_OS=linux; RELEASE=unspecified; ROLE=container ;; esac
    [ "$BASE_OS" != arch ] || RELEASE=rolling
  elif [ "$DETECTED" = wsl ]; then BASE_OS=ubuntu; RELEASE=unspecified; ROLE=wsl
  elif [ "$DETECTED" = macos ]; then RELEASE="${RELEASE%%.*}"; ROLE=macos
  elif [ "$DETECTED" = qubes-dom0 ] || [ "$DETECTED" = qubes-appvm ]; then RELEASE="$(printf '%s' "$RELEASE" | cut -d. -f1,2)"; ROLE="$DETECTED"
  elif [ "$DETECTED" = proxmox ]; then RELEASE="${RELEASE%%.*}"; ROLE=proxmox
  elif [ "$DETECTED" = silverblue ]; then RELEASE="${RELEASE%%.*}"; ROLE=silverblue
  fi
  if [ -d /data/coolify ] || [ -f /etc/coolify/.installed ]; then BASE_OS=ubuntu; RELEASE=unspecified; ENVIRONMENT=native; ROLE=coolify; fi
  printf '%s|%s|%s|%s|%s\n' "$BASE_OS" "$RELEASE" "$ARCH" "$ENVIRONMENT" "$ROLE"
}

idResolvePlatform() {
  local FACTS RESOLUTION CELL STATUS LIMITATION
  FACTS="$(idPlatformMatrixFacts)" || return 2
  IFS='|' read -r INSTALL_DOCTOR_PLATFORM_OS INSTALL_DOCTOR_PLATFORM_RELEASE INSTALL_DOCTOR_PLATFORM_ARCH INSTALL_DOCTOR_PLATFORM_ENVIRONMENT INSTALL_DOCTOR_PLATFORM_ROLE <<EOF
$FACTS
EOF
  RESOLUTION="$(idResolvePlatformAdmission "$INSTALL_DOCTOR_PLATFORM_OS" "$INSTALL_DOCTOR_PLATFORM_RELEASE" "$INSTALL_DOCTOR_PLATFORM_ARCH" "$INSTALL_DOCTOR_PLATFORM_ENVIRONMENT" "$INSTALL_DOCTOR_PLATFORM_ROLE")" || {
    logg error "This exact host tuple is absent from the signed platform policy: $FACTS"; return 2;
  }
  IFS='|' read -r CELL STATUS LIMITATION <<EOF
$RESOLUTION
EOF
  case "$STATUS" in
    verified|best-effort) ;;
    unsupported) logg error "Platform $CELL is unsupported: $LIMITATION"; return 2 ;;
    *) logg error 'Platform support status is invalid'; return 2 ;;
  esac
  INSTALL_DOCTOR_PLATFORM_CELL="$CELL"; INSTALL_DOCTOR_PLATFORM_STATUS="$STATUS"; INSTALL_DOCTOR_PLATFORM_LIMITATION="$LIMITATION"
  export INSTALL_DOCTOR_PLATFORM_OS INSTALL_DOCTOR_PLATFORM_RELEASE INSTALL_DOCTOR_PLATFORM_ARCH INSTALL_DOCTOR_PLATFORM_ENVIRONMENT INSTALL_DOCTOR_PLATFORM_ROLE
  export INSTALL_DOCTOR_PLATFORM_CELL INSTALL_DOCTOR_PLATFORM_STATUS INSTALL_DOCTOR_PLATFORM_LIMITATION INSTALL_DOCTOR_CONSENT_BEST_EFFORT
  logg info "Resolved $CELL as $STATUS under signed platform policy v1"
}

idAuthorizePlatform() {
  case "${INSTALL_DOCTOR_PLATFORM_STATUS:-}:${INSTALL_DOCTOR_CONSENT_BEST_EFFORT:-false}" in
    verified:true|verified:false|best-effort:true) ;;
    best-effort:false) logg error "Platform ${INSTALL_DOCTOR_PLATFORM_CELL:-unknown} is best-effort: ${INSTALL_DOCTOR_PLATFORM_LIMITATION:-No limitation recorded}. Explicit consent is required."; return 2 ;;
    *) logg error 'Platform must be resolved before authorization'; return 2 ;;
  esac
  logg info "Admitted $INSTALL_DOCTOR_PLATFORM_CELL as $INSTALL_DOCTOR_PLATFORM_STATUS under signed platform policy v1"
}

idAdmitPlatform() {
  idResolvePlatform && idAuthorizePlatform
}

# BEGIN INSTALL_DOCTOR_TASK_UI
_idTaskJson() {
  local VALUE="${1-}"
  VALUE="${VALUE//\\/\\\\}"
  VALUE="${VALUE//\"/\\\"}"
  VALUE="${VALUE//$'\b'/\\u0008}"
  VALUE="${VALUE//$'\f'/\\u000c}"
  VALUE="${VALUE//$'\n'/\\n}"
  VALUE="${VALUE//$'\r'/\\r}"
  VALUE="${VALUE//$'\t'/\\t}"
  printf '%s' "$VALUE"
}

_idTaskSafeId() {
  local RAW="${1-}" SAFE SUM
  SAFE="$(printf '%s' "$RAW" | tr -c '[:alnum:]_.-' '-')"
  SUM="$(printf '%s' "$RAW" | cksum | awk '{print $1}')"
  printf '%s-%s' "${SAFE:-task}" "$SUM"
}

_idTaskLock() {
  local LOCK="$INSTALL_DOCTOR_TUI_STATE/.event-lock" COUNT=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    COUNT=$((COUNT + 1))
    [ "$COUNT" -lt 1000 ] || return 1
    sleep 0.01
  done
}

_idTaskUnlock() { rmdir "$INSTALL_DOCTOR_TUI_STATE/.event-lock" 2>/dev/null || true; }

_idTaskEmit() {
  _idTaskLock || return 1
  printf '%s\n' "$1" >> "$INSTALL_DOCTOR_TUI_EVENTS"
  _idTaskUnlock
}

idTaskTerminalWidth() {
  local WIDTH="${COLUMNS:-}"
  if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    WIDTH="$(tput cols 2>/dev/null || printf '%s' "${WIDTH:-120}")"
  fi
  case "$WIDTH" in ''|*[!0-9]*) WIDTH=120 ;; esac
  [ "$WIDTH" -ge 20 ] || WIDTH=20
  [ "$WIDTH" -le 500 ] || WIDTH=500
  printf '%s\n' "$WIDTH"
}

idTaskRenderLine() {
  local WORKER="$1" LIMIT="$2" LABEL="$3" LINE="$4" WIDTH RENDERED
  WIDTH="$(idTaskTerminalWidth)"
  LINE="${LINE//$'\r'/}"
  RENDERED="[worker $WORKER/$LIMIT] $LABEL | $LINE"
  if [ "${#RENDERED}" -gt "$WIDTH" ]; then
    if [ "$WIDTH" -gt 3 ]; then RENDERED="${RENDERED:0:$((WIDTH - 3))}..."
    else RENDERED="${RENDERED:0:$WIDTH}"; fi
  fi
  printf '%s\n' "$RENDERED"
}

idTaskUiInit() {
  local STATE="${INSTALL_DOCTOR_TUI_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/install-doctor/task-ui}"
  umask 077
  if [ -L "$STATE" ]; then return 1; fi
  if [ -e "$STATE" ] && [ ! -d "$STATE" ]; then return 1; fi
  if [ -d "$STATE" ] && [ ! -f "$STATE/.install-doctor-task-ui" ]; then return 1; fi
  if [ ! -d "$STATE" ]; then
    mkdir -p "$STATE" || return 1
    chmod 700 "$STATE" || return 1
    : > "$STATE/.install-doctor-task-ui"
  fi
  INSTALL_DOCTOR_TUI_STATE="$STATE"
  INSTALL_DOCTOR_TUI_EVENTS="$STATE/events.ndjson"
  export INSTALL_DOCTOR_TUI_STATE INSTALL_DOCTOR_TUI_EVENTS
  mkdir -p "$STATE/logs"
  chmod 700 "$STATE" "$STATE/logs"
  : > "$INSTALL_DOCTOR_TUI_EVENTS"
  date +%s > "$STATE/started-at"
}

_idTaskConsume() {
  local WORKER="$1" TASK="$2" LABEL="$3" ATTEMPT="$4" LOG="$5" LINE ESC_TASK ESC_LABEL ESC_LINE
  local RETAINED_CHARS=0 RETAINED_LINES=0 LINE_CHARS TRUNCATED=0
  ESC_TASK="$(_idTaskJson "$TASK")"; ESC_LABEL="$(_idTaskJson "$LABEL")"
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    LINE_CHARS="${#LINE}"
    if [ "$RETAINED_LINES" -lt 10000 ] && [ "$((RETAINED_CHARS + LINE_CHARS))" -le 524288 ]; then
      printf '%s\n' "$LINE" >> "$LOG"
      ESC_LINE="$(_idTaskJson "$LINE")"
      _idTaskLock || return 1
      printf '{"type":"output","task":"%s","label":"%s","worker":%s,"attempt":%s,"line":"%s"}\n' "$ESC_TASK" "$ESC_LABEL" "$WORKER" "$ATTEMPT" "$ESC_LINE" >> "$INSTALL_DOCTOR_TUI_EVENTS"
      idTaskRenderLine "$WORKER" "${INSTALL_DOCTOR_CONCURRENCY:-1}" "$LABEL" "$LINE"
      _idTaskUnlock
      RETAINED_CHARS=$((RETAINED_CHARS + LINE_CHARS)); RETAINED_LINES=$((RETAINED_LINES + 1))
    elif [ "$TRUNCATED" -eq 0 ]; then
      LINE='[further task output omitted: retained log limit reached]'
      printf '%s\n' "$LINE" >> "$LOG"
      _idTaskLock || return 1
      printf '{"type":"output-gap","task":"%s","label":"%s","worker":%s,"attempt":%s,"reason":"retained-output-limit"}\n' "$ESC_TASK" "$ESC_LABEL" "$WORKER" "$ATTEMPT" >> "$INSTALL_DOCTOR_TUI_EVENTS"
      idTaskRenderLine "$WORKER" "${INSTALL_DOCTOR_CONCURRENCY:-1}" "$LABEL" "$LINE"
      _idTaskUnlock
      TRUNCATED=1
    fi
  done
}

idTaskRun() {
  local WORKER="$1" TASK="$2" LABEL="$3" ATTEMPT=1 RETRIES="${INSTALL_DOCTOR_TASK_RETRIES:-0}" RC=0
  local SAFE LOG FIFO FIFO_DIR NONCE READER PREVIEW ESC_TASK ESC_LABEL ESC_PREVIEW ESC_LOG
  shift 3
  ESC_TASK="$(_idTaskJson "$TASK")"; ESC_LABEL="$(_idTaskJson "$LABEL")"
  while :; do
    SAFE="$(_idTaskSafeId "$TASK")"
    FIFO_DIR="$(mktemp -d "$INSTALL_DOCTOR_TUI_STATE/.task.XXXXXX")" || return 1
    NONCE="${FIFO_DIR##*/}"
    LOG="$INSTALL_DOCTOR_TUI_STATE/logs/${SAFE}-${NONCE}.attempt-${ATTEMPT}.log"
    : > "$LOG"
    chmod 0600 "$LOG" || return 1
    ESC_LOG="$(_idTaskJson "$LOG")"
    FIFO="$FIFO_DIR/output"
    if ! mkfifo "$FIFO"; then rmdir "$FIFO_DIR" 2>/dev/null || true; return 1; fi
    _idTaskEmit "{\"type\":\"status\",\"task\":\"$ESC_TASK\",\"label\":\"$ESC_LABEL\",\"status\":\"running\",\"worker\":$WORKER,\"attempt\":$ATTEMPT,\"log\":\"$ESC_LOG\"}"
    _idTaskConsume "$WORKER" "$TASK" "$LABEL" "$ATTEMPT" "$LOG" < "$FIFO" & READER=$!
    if "$@" > "$FIFO" 2>&1; then RC=0; else RC=$?; fi
    wait "$READER" || true
    rm -f "$FIFO"
    rmdir "$FIFO_DIR" 2>/dev/null || true
    if [ "$RC" -eq 0 ]; then
      _idTaskEmit "{\"type\":\"status\",\"task\":\"$ESC_TASK\",\"label\":\"$ESC_LABEL\",\"status\":\"passed\",\"worker\":$WORKER,\"attempt\":$ATTEMPT,\"log\":\"$ESC_LOG\"}"
      return 0
    fi
    if [ "$RC" -eq 130 ] || [ "$RC" -eq 143 ]; then
      _idTaskEmit "{\"type\":\"status\",\"task\":\"$ESC_TASK\",\"label\":\"$ESC_LABEL\",\"status\":\"cancelled\",\"worker\":$WORKER,\"attempt\":$ATTEMPT,\"exitCode\":$RC,\"log\":\"$ESC_LOG\"}"
      return "$RC"
    fi
    if [ "$ATTEMPT" -le "$RETRIES" ]; then
      PREVIEW="$(tail -n 1 "$LOG" 2>/dev/null || true)"; ESC_PREVIEW="$(_idTaskJson "$PREVIEW")"
      _idTaskEmit "{\"type\":\"status\",\"task\":\"$ESC_TASK\",\"label\":\"$ESC_LABEL\",\"status\":\"retrying\",\"worker\":$WORKER,\"attempt\":$ATTEMPT,\"preview\":\"$ESC_PREVIEW\"}"
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi
    _idTaskEmit "{\"type\":\"status\",\"task\":\"$ESC_TASK\",\"label\":\"$ESC_LABEL\",\"status\":\"failed\",\"worker\":$WORKER,\"attempt\":$ATTEMPT,\"exitCode\":$RC,\"log\":\"$ESC_LOG\"}"
    return "$RC"
  done
}

idTaskSummary() {
  local COUNTS START NOW
  COUNTS="$(node - "$INSTALL_DOCTOR_TUI_EVENTS" <<'NODE'
const fs = require('node:fs');
const terminal = new Map();
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line) continue;
  const event = JSON.parse(line);
  if (event.type === 'status' && typeof event.task === 'string' && typeof event.status === 'string') terminal.set(event.task, event.status);
}
const values = [...terminal.values()];
const count = status => values.filter(value => status.includes(value)).length;
process.stdout.write(`passed=${count(['passed'])} failed=${count(['failed'])} pending=${count(['pending'])} cancelled=${count(['cancelled'])} running=${count(['running','retrying'])}`);
NODE
)" || return 1
  START="$(cat "$INSTALL_DOCTOR_TUI_STATE/started-at" 2>/dev/null || date +%s)"; NOW="$(date +%s)"
  printf '%s elapsed=%ss logs=%s\n' "$COUNTS" "$((NOW - START))" "$INSTALL_DOCTOR_TUI_STATE/logs"
}

idTaskResolveTrustedDir() {
  local DIR="$1" RESOLVED MODE PERM
  [ "${INSTALL_DOCTOR_AGENT_TASKS_CONSENT:-0}" = 1 ] || return 1
  [ -d "$DIR" ] && [ ! -L "$DIR" ] || return 1
  RESOLVED="$(cd -P "$DIR" && pwd)" || return 1
  MODE="$(stat -c '%a' "$RESOLVED" 2>/dev/null || stat -f '%Lp' "$RESOLVED" 2>/dev/null)" || return 1
  PERM=$((8#$MODE))
  [ $((PERM & 8#022)) -eq 0 ] || return 1
  printf '%s\n' "$RESOLVED"
}

idTaskPool() {
  local LIMIT="${INSTALL_DOCTOR_CONCURRENCY:-2}" INDEX=0 FAILED=0 POLICY="${INSTALL_DOCTOR_AGENT_FAILURE_POLICY:-fail}"
  local TASK WORKER PID
  local PIDS=()
  idTaskUiInit || return 1
  for TASK in "$@"; do
    [ -f "$TASK" ] && [ -x "$TASK" ] || continue
    WORKER=$((INDEX % LIMIT + 1)); INDEX=$((INDEX + 1))
    idTaskRun "$WORKER" "$(basename "$TASK" .sh)" "$(basename "$TASK" .sh)" "$TASK" & PIDS+=("$!")
    if [ "${#PIDS[@]}" -ge "$LIMIT" ]; then
      for PID in "${PIDS[@]}"; do wait "$PID" || FAILED=1; done
      PIDS=()
    fi
  done
  for PID in "${PIDS[@]}"; do wait "$PID" || FAILED=1; done
  [ "$FAILED" -eq 0 ] || [ "$POLICY" = continue ]
}

idRunConfiguredAgentTasks() {
  local TRUSTED TASK
  local AGENT_TASKS=()
  [ -n "${INSTALL_DOCTOR_AGENT_TASK_DIR:-}" ] || return 0
  TRUSTED="$(idTaskResolveTrustedDir "$INSTALL_DOCTOR_AGENT_TASK_DIR")" || return 1
  for TASK in "$TRUSTED"/*.sh; do
    [ -x "$TASK" ] || continue
    [ -f "$TASK" ] && [ ! -L "$TASK" ] || return 1
    AGENT_TASKS+=("$TASK")
  done
  [ "${#AGENT_TASKS[@]}" -eq 0 ] || idTaskPool "${AGENT_TASKS[@]}"
}

idVerifyConfiguredAgentTaskManifest() {
  local TRUSTED
  [ -n "${INSTALL_DOCTOR_AGENT_TASK_DIR:-}" ] || return 2
  TRUSTED="$(idTaskResolveTrustedDir "$INSTALL_DOCTOR_AGENT_TASK_DIR")" || return 2
  node - "$TRUSTED" "${INSTALL_DOCTOR_AGENT_TASKS_DIGEST:-}" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [directory, expected] = process.argv.slice(2);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const manifest = [];
const names = fs.readdirSync(directory).filter(name => name.endsWith('.sh')).sort();
if (names.length > 64) process.exit(2);
for (const name of names) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sh$/.test(name)) process.exit(2);
  const path = `${directory}/${name}`;
  const metadata = fs.lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 1_048_576
    || metadata.uid !== process.geteuid() || (metadata.mode & 0o022) !== 0) process.exit(2);
  if ((metadata.mode & 0o111) === 0) continue;
  manifest.push({ name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex') });
}
const actual = crypto.createHash('sha256').update(JSON.stringify(canonical(manifest))).digest('hex');
process.exit(actual === expected ? 0 : 2);
NODE
}

idConfiguredAgentTasksReceipt() {
  printf '%s/configured-agent-tasks/%s.receipt\n' "${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor" "${INSTALL_DOCTOR_AGENT_TASKS_DIGEST:-invalid}"
}

idVerifyConfiguredAgentTasksReceipt() {
  local RECEIPT EXPECTED
  idVerifyConfiguredAgentTaskManifest || return $?
  RECEIPT="$(idConfiguredAgentTasksReceipt)" || return 2
  EXPECTED="${INSTALL_DOCTOR_AGENT_TASKS_DIGEST:-}"
  [ -f "$RECEIPT" ] && [ ! -L "$RECEIPT" ] || return 10
  [ "$(cat "$RECEIPT" 2>/dev/null)" = "$EXPECTED" ] || return 2
}

idApplyConfiguredAgentTasks() {
  local RECEIPT ROOT TEMP
  idVerifyConfiguredAgentTaskManifest || return $?
  idRunConfiguredAgentTasks || return $?
  RECEIPT="$(idConfiguredAgentTasksReceipt)" || return 2
  ROOT="$(dirname "$RECEIPT")"
  [ ! -L "$ROOT" ] || return 2
  umask 077
  mkdir -p "$ROOT" || return 1
  chmod 0700 "$ROOT" || return 1
  TEMP="$ROOT/.receipt.$$"
  printf '%s\n' "${INSTALL_DOCTOR_AGENT_TASKS_DIGEST:-}" > "$TEMP" || return 1
  chmod 0600 "$TEMP" || { rm -f "$TEMP"; return 1; }
  mv "$TEMP" "$RECEIPT" || { rm -f "$TEMP"; return 1; }
}
# END INSTALL_DOCTOR_TASK_UI

idProvisionEvidenceInit() {
  local STATE_HOME ROOT RUN_ID HOST_LABEL ENV_LABEL
  STATE_HOME="${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}"
  [ ! -L "$STATE_HOME" ] || return 1
  ROOT="$STATE_HOME/install-doctor/evidence/provision"
  [ ! -L "$STATE_HOME/install-doctor" ] && [ ! -L "$STATE_HOME/install-doctor/evidence" ] && [ ! -L "$ROOT" ] || return 1
  umask 077
  mkdir -p "$ROOT" || return 1
  chmod 0700 "$STATE_HOME/install-doctor" "$STATE_HOME/install-doctor/evidence" "$ROOT" || return 1
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  case "$RUN_ID" in *[!a-zA-Z0-9._-]*) return 1 ;; esac
  HOST_LABEL="$(printf '%s' "${HOST:-$(hostname -s 2>/dev/null || hostname)}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9._-' '-' | cut -c1-64)"
  ENV_LABEL="$(printf '%s' "${WORK_ENVIRONMENT:-native}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9._-' '-' | cut -c1-64)"
  HOST_LABEL="${HOST_LABEL:--}"
  ENV_LABEL="${ENV_LABEL:--}"
  INSTALL_DOCTOR_EVIDENCE_STARTED_AT="$(date +%s)"
  INSTALL_DOCTOR_EVIDENCE_HOST="$HOST_LABEL"
  INSTALL_DOCTOR_EVIDENCE_ENVIRONMENT="$ENV_LABEL"
  INSTALL_DOCTOR_EVENT_LOG="${INSTALL_DOCTOR_EVENT_LOG:-$ROOT/$RUN_ID.ndjson}"
  INSTALL_DOCTOR_TERMINAL_RECEIPT="${INSTALL_DOCTOR_TERMINAL_RECEIPT:-$ROOT/$RUN_ID.receipt.json}"
  [ ! -L "$INSTALL_DOCTOR_EVENT_LOG" ] && [ ! -L "$INSTALL_DOCTOR_TERMINAL_RECEIPT" ] || return 1
  : > "$INSTALL_DOCTOR_EVENT_LOG" || return 1
  chmod 0600 "$INSTALL_DOCTOR_EVENT_LOG" || return 1
  export INSTALL_DOCTOR_EVIDENCE_STARTED_AT INSTALL_DOCTOR_EVIDENCE_HOST INSTALL_DOCTOR_EVIDENCE_ENVIRONMENT
  export INSTALL_DOCTOR_EVENT_LOG INSTALL_DOCTOR_TERMINAL_RECEIPT
}

idEmitProvisionStatus() {
  local PHASE="$1" STATUS="$2" EXIT_CODE="${3:-0}" LOG START NOW DURATION RSS HOST_LABEL ENV_LABEL TERMINAL TEMP
  LOG="${INSTALL_DOCTOR_EVENT_LOG:-${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/install-doctor/provision-events.ndjson}"
  START="${INSTALL_DOCTOR_EVIDENCE_STARTED_AT:-$(date +%s)}"
  NOW="$(date +%s)"
  case "$START:$NOW:$EXIT_CODE" in *[!0-9:]*) return 1 ;; esac
  DURATION=$(((NOW - START) * 1000))
  [ "$DURATION" -ge 0 ] || DURATION=0
  RSS="$(ps -o rss= -p $$ 2>/dev/null | awk '{print $1; exit}')"
  case "$RSS" in ''|*[!0-9]*) RSS=0 ;; esac
  HOST_LABEL="${INSTALL_DOCTOR_EVIDENCE_HOST:-host}"
  ENV_LABEL="${INSTALL_DOCTOR_EVIDENCE_ENVIRONMENT:-native}"
  TERMINAL=false
  case "$STATUS" in success|failed|redirected|cancelled|pending) TERMINAL=true ;; esac
  umask 077
  mkdir -p "$(dirname "$LOG")" || return 1
  [ ! -L "$(dirname "$LOG")" ] && [ ! -L "$LOG" ] || return 1
  if [ -e "$LOG" ] && [ ! -f "$LOG" ]; then return 1; fi
  : >> "$LOG" || return 1
  chmod 0600 "$LOG" || return 1
  printf '{"schemaVersion":1,"type":"provision","phase":"%s","status":"%s","exitCode":%s,"durationMs":%s,"rssKiB":%s,"terminal":%s,"labels":{"host":"%s","environment":"%s","service":"install-doctor"}}\n' \
    "$(_idTaskJson "$PHASE")" "$(_idTaskJson "$STATUS")" "$EXIT_CODE" "$DURATION" "$RSS" "$TERMINAL" \
    "$(_idTaskJson "$HOST_LABEL")" "$(_idTaskJson "$ENV_LABEL")" >> "$LOG" || return 1
  if [ "$TERMINAL" = true ] && [ -n "${INSTALL_DOCTOR_TERMINAL_RECEIPT:-}" ]; then
    [ ! -L "$INSTALL_DOCTOR_TERMINAL_RECEIPT" ] || return 1
    TEMP="$INSTALL_DOCTOR_TERMINAL_RECEIPT.tmp.$$"
    printf '{"schemaVersion":1,"type":"provision-terminal-receipt","status":"%s","exitCode":%s,"durationMs":%s,"rssKiB":%s,"terminal":true,"labels":{"host":"%s","environment":"%s","service":"install-doctor"}}\n' \
      "$(_idTaskJson "$STATUS")" "$EXIT_CODE" "$DURATION" "$RSS" "$(_idTaskJson "$HOST_LABEL")" "$(_idTaskJson "$ENV_LABEL")" > "$TEMP" || return 1
    chmod 0600 "$TEMP" || { rm -f "$TEMP"; return 1; }
    mv "$TEMP" "$INSTALL_DOCTOR_TERMINAL_RECEIPT" || { rm -f "$TEMP"; return 1; }
  fi
  INSTALL_DOCTOR_TERMINAL_STATUS="$STATUS"
  export INSTALL_DOCTOR_TERMINAL_STATUS
}

idOnProvisionExit() {
  local EXIT_CODE="${1:-$?}"
  case "${INSTALL_DOCTOR_TERMINAL_STATUS:-}" in success|failed|redirected|pending|cancelled) return 0 ;; esac
  if [ "$EXIT_CODE" -eq 0 ]; then idEmitProvisionStatus provision redirected 0; else idEmitProvisionStatus provision failed "$EXIT_CODE"; fi
}

idPersistVerifiedReleaseProvenance() {
  local MANIFEST="${INSTALL_DOCTOR_VERIFIED_MANIFEST:-}" SIGNATURE="${INSTALL_DOCTOR_VERIFIED_SIGNATURE:-}"
  local RELEASE_ID="${INSTALL_DOCTOR_RELEASE_ID:-}" MANIFEST_SHA="${INSTALL_DOCTOR_MANIFEST_SHA256:-}"
  local ARTIFACT_SHA="${INSTALL_DOCTOR_ARTIFACT_SHA256:-}" ENGINE_SHA="${INSTALL_DOCTOR_ENGINE_SHA256:-}" ROOT TEMP
  [ -n "$MANIFEST" ] || return 0
  case "$RELEASE_ID" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) return 1 ;; esac
  case "$MANIFEST_SHA:$ARTIFACT_SHA:$ENGINE_SHA" in *[!a-f0-9:]*) return 1 ;; esac
  [ "${#MANIFEST_SHA}" -eq 64 ] && [ "${#ARTIFACT_SHA}" -eq 64 ] && [ "${#ENGINE_SHA}" -eq 64 ] || return 1
  [ -f "$MANIFEST" ] && [ ! -L "$MANIFEST" ] && [ -f "$SIGNATURE" ] && [ ! -L "$SIGNATURE" ] || return 1
  ROOT="${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/install-doctor/releases/$RELEASE_ID"
  [ ! -L "$ROOT" ] || return 1
  umask 077
  mkdir -p "$ROOT" || return 1
  chmod 0700 "$ROOT" || return 1
  TEMP="$ROOT/.provenance.$$"
  mkdir "$TEMP" || return 1
  trap 'rm -rf -- "$TEMP"' RETURN
  cp "$MANIFEST" "$TEMP/manifest" || return 1
  cp "$SIGNATURE" "$TEMP/manifest.sig" || return 1
  printf '%s  manifest\n%s  provision.sh\n%s  install-doctor-engine.mjs\n' "$MANIFEST_SHA" "$ARTIFACT_SHA" "$ENGINE_SHA" > "$TEMP/sha256sums" || return 1
  chmod 0600 "$TEMP/manifest" "$TEMP/manifest.sig" "$TEMP/sha256sums" || return 1
  mv "$TEMP/manifest" "$TEMP/manifest.sig" "$TEMP/sha256sums" "$ROOT/" || return 1
  rmdir "$TEMP"
  trap - RETURN
}
#
#     ## Dependencies
#
#     The chart below shows the dependencies we rely on to get Install Doctor going. The dependencies that are bolded
#     are mandatory. The ones that are not bolded are conditionally installed only if they are required.
#
#     | Dependency         | Description                                                                          |
#     |--------------------|--------------------------------------------------------------------------------------|
#     | **Chezmoi**        | Dotfile configuration manager (on-device provisioning)                               |
#     | **Task**           | Task runner used on-device for task parallelization and dependency management         |
#     | **ZX / Node.js**   | ZX is a Node.js abstraction that allows for better scripts                           |
#     | Gum                | Terminal UI prompt CLI (provides interactive prompts and styled output)               |
#     | Glow               | Markdown renderer used for applying terminal-friendly styles to markdown             |
#
#     There are also a handful of system packages that are installed like `curl` and `git`. Then, during the Chezmoi provisioning
#     process, there are a handful of system packages that are installed to ensure things run smoothly. You can find more details
#     about these extra system packages by browsing through the `home/.chezmoiscripts/${DISTRO_ID}/` folder and other applicable
#     folders (e.g. `universal`).
#
#     Although Install Doctor comes with presets that install a whole gigantic amount of software, it can actually
#     be quite good at provisioning minimal server environments where you want to keep the binaries to a minimum.
#
#     ## Environment Variables
#
#     Specify certain environment variables to customize the behavior of Install Doctor. With the right combination of
#     environment variables, this script can be run completely headlessly (no interactive prompts). This allows
#     automated testing across a wide variety of operating systems.
#
#     | Variable                  | Description                                                                       |
#     |---------------------------|-----------------------------------------------------------------------------------|
#     | `START_REPO` (or `REPO`)  | Git fork URL or GitHub user/repo shorthand to use when provisioning               |
#     | `ANSIBLE_PROVISION_VM`    | **For Qubes**, determines the name of the VM used to provision the system         |
#     | `DEBUG_MODE` (or `DEBUG`) | Set to `true` to enable verbose logging                                           |
#     | `HEADLESS_INSTALL`        | Set to `true` to skip all interactive prompts and use defaults                    |
#     | `SOFTWARE_GROUP`          | Software group to install: "Basic", "Server", "Standard", or "Full" (default)    |
#     | `SUDO_PASSWORD`           | Sudo password for automated passwordless sudo setup                               |
#     | `CI` or `TEST_INSTALL`    | Set either to enable CI mode with predefined defaults                             |
#     | `NO_RESTART`              | Set to `true` to prevent automatic reboots                                        |
#     | `FULL_NAME`               | User's full name for git and other configurations                                 |
#     | `PRIMARY_EMAIL`           | User's primary email address                                                      |
#     | `KEEP_GOING`              | Set to `true` to continue provisioning even if errors occur                       |
#
#     ### Fully Headless Installation
#
#     To run the installer with zero interactive prompts:
#
#     ```bash
#     HEADLESS_INSTALL=true SOFTWARE_GROUP=Full SUDO_PASSWORD=your_password \
#       curl -fsSL https://app.install.doctor/start | bash
#     ```
#
#     For a full list of variables you can use to customize Install Doctor, check out our [Customization](https://install.doctor/docs/customization)
#     and [Secrets](https://install.doctor/docs/customization/secrets) documentation.
#
#     ## Platform admission status
#
#     | Platform       | Status       | Notes                                           |
#     |----------------|--------------|-------------------------------------------------|
#     | macOS/Linux matrix tuples | Best effort | Requires explicit recorded best-effort consent until a fresh full-lifecycle canary exists |
#     | Silverblue/Qubes/Proxmox/Coolify/WSL | Unsupported | Rejected before plan approval until their matrix remediation is complete |
#     | Native Windows/FreeBSD | Unsupported | Not accepted by this Bash endpoint               |
#     | Unknown OS/version/architecture/role tuple | Unsupported | Fails closed before mutation                     |
#
#     ## Links
#
#     [Install Doctor homepage](https://install.doctor)
#     [Install Doctor documentation portal](https://install.doctor/docs) (includes tips, tricks, and guides on how to customize the system to your liking)

# @description This function logs with style using Gum if it is installed, otherwise it uses `echo`. It is also capable of leveraging Glow to render markdown.
#     When Glow is not installed, it uses `cat`. The following sub-commands are available:
#
#     | Sub-Command | Description                                                                                         |
#     |-------------|-----------------------------------------------------------------------------------------------------|
#     | `error`     | Logs a bright red error message                                                                     |
#     | `info`      | Logs a regular informational message                                                                |
#     | `md`        | Tries to render the specified file using `glow` if it is installed and uses `cat` as a fallback     |
#     | `prompt`    | Alternative that logs a message intended to describe an upcoming user input prompt                  |
#     | `star`      | Alternative that logs a message that starts with a star icon                                        |
#     | `start`     | Same as `success`                                                                                   |
#     | `success`   | Logs a success message that starts with green checkmark                                             |
#     | `warn`      | Logs a bright yellow warning message                                                                |
logg() {
  TYPE="$1"
  MSG="$2"
  if [ "$TYPE" == 'error' ]; then
    if command -v gum > /dev/null; then
        gum style --border="thick" "$(gum style --foreground="#ff0000" "✖") $(gum style --bold --background="#ff0000" --foreground="#ffffff"  " ERROR ") $(gum style --bold "$MSG")"
    else
        echo "ERROR: $MSG"
    fi
  elif [ "$TYPE" == 'info' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ffff" "○") $(gum style --faint "$MSG")"
    else
        echo "INFO: $MSG"
    fi
  elif [ "$TYPE" == 'md' ]; then
    if command -v glow > /dev/null; then
        glow "$MSG"
    else
        cat "$MSG"
    fi
  elif [ "$TYPE" == 'prompt' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00008b" "▶") $(gum style --bold "$MSG")"
    else
        echo "PROMPT: $MSG"
    fi
  elif [ "$TYPE" == 'star' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold "$MSG")"
    else
        echo "STAR: $MSG"
    fi
  elif [ "$TYPE" == 'start' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$MSG")"
    else
        echo "START: $MSG"
    fi
  elif [ "$TYPE" == 'success' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "✔") $(gum style --bold "$MSG")"
    else
        echo "SUCCESS: $MSG"
    fi
  elif [ "$TYPE" == 'warn' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold --background="#ffff00" --foreground="#000000"  " WARNING ") $(gum style --bold "$MSG")"
    else
        echo "WARNING: $MSG"
    fi
  else
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$TYPE")"
    else
        echo "$MSG"
    fi
  fi
}

# @description Sets core environment variables for the provisioning process.
#     - Sets `DEBIAN_FRONTEND=noninteractive` to prevent apt-get from prompting during package installation
#     - Sets `HOMEBREW_NO_ENV_HINTS=true` to suppress Homebrew hint messages
#     - Determines the `START_REPO` git URL based on user input:
#       - If `START_REPO` and `REPO` are both unset, defaults to the official Install Doctor repository
#       - If `REPO` is set but `START_REPO` is not, copies `REPO` to `START_REPO`
#       - Supports shorthand formats: `user/repo` expands to `https://github.com/user/repo.git`
#       - Supports bare username format: `user` expands to `https://github.com/user/install.doctor.git`
#       - Full git URLs (containing `://` or `:`) are used as-is
#
#     @envvar START_REPO  The git repository URL to clone for provisioning
#     @envvar REPO  Alternative to START_REPO (START_REPO takes precedence)
setEnvironmentVariables() {
  export DEBIAN_FRONTEND=noninteractive
  export HOMEBREW_NO_ENV_HINTS=true
  ### Force serial Homebrew downloads. The parallel downloader in newer
  ### Homebrew releases races with itself on large bottles (go, python,
  ### ruby, rust, volta, java@beta, macfuse, ...) and fails every retry
  ### with "process has already locked ...<bottle>.incomplete" errors.
  export HOMEBREW_DOWNLOAD_CONCURRENCY=1
  export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
  if [ -z "$START_REPO" ] && [ -z "$REPO" ]; then
    export START_REPO="https://github.com/heymegabyte/install.doctor.git"
  else
    if [ -n "$REPO" ] && [ -z "$START_REPO" ]; then
      export START_REPO="$REPO"
    fi
    if [[ "$START_REPO" == *"/"* ]]; then
      # Either full git address or GitHubUser/RepoName
      if [[ "$START_REPO" == *":"* ]] || [[ "$START_REPO" == *"//"* ]]; then
        export START_REPO="$START_REPO"
      else
        export START_REPO="https://github.com/${START_REPO}.git"
      fi
    else
      export START_REPO="https://github.com/$START_REPO/install.doctor.git"
    fi
  fi
}

# @description Installs only the native tools required before the selected desired state can run.
#     The current signed engine requires Node.js 22+ as an explicit host prerequisite; this
#     closure adds git and rsync when absent. Rsync is still required by the system-files task.
#     Compilers, terminal cosmetics, compatibility tools, and language runtimes belong to the
#     selected catalog closure and remain lazy unless a later task proves it needs them.
ensureBasicDeps() {
  if ! command -v curl > /dev/null || ! command -v git > /dev/null || ! command -v rsync > /dev/null; then
    if command -v apt-get > /dev/null; then
      ### Debian / Ubuntu
      logg info 'Running sudo apt-get update' && sudo apt-get update \
        && logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' \
        && sudo apt-get install -y curl git rsync
    elif command -v dnf > /dev/null; then
      ### Fedora
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && sudo dnf install -y curl git rsync
    elif command -v yum > /dev/null; then
      ### CentOS
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && sudo yum install -y curl git rsync
    elif command -v pacman > /dev/null; then
      ### Archlinux
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && sudo pacman -S --needed --noconfirm curl git rsync
    elif command -v zypper > /dev/null; then
      ### OpenSUSE
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && sudo zypper install -y curl git rsync
    elif command -v apk > /dev/null; then
      ### Alpine
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && sudo apk add curl git rsync
    elif [ "$(detect_os)" = "macos" ]; then
      logg error 'macOS is missing curl, git, or rsync; install Apple Command Line Tools before provisioning'
      return 2
    elif [[ "$OSTYPE" == 'cygwin' ]] || [[ "$OSTYPE" == 'msys' ]] || [[ "$OSTYPE" == 'win32' ]]; then
      ### Windows
      logg info 'Installing the minimal bootstrap tools (curl, git, and rsync)' && choco install -y curl git rsync
    elif [[ "$OSTYPE" == 'freebsd'* ]]; then
      ### FreeBSD
      logg warn "FreeBSD is not yet supported"
    elif command -v pkg > /dev/null; then
      ### Termux
      logg warn "Termux is not yet supported"
    elif command -v xbps-install > /dev/null; then
      ### Void
      logg warn "Void is not yet supported"
    fi
  fi
}

# Acquire the signed, release-scoped Node runtime only when the host has no
# acceptable system Node. The archive is never generally extracted: after the
# signed byte envelope is verified, exactly one regular */bin/node member is
# selected into a private directory and its exact version is revalidated.
unset _ID_PROVISIONER_RUNTIME_STAGE 2>/dev/null || true
ensureProvisionerNodeRuntime() {
  local REQUIRED="${INSTALL_DOCTOR_ENGINE_NODE_MIN:-22}" SOURCE="${INSTALL_DOCTOR_RUNTIME_SOURCE:-}" SYSTEM_NODE="" SYSTEM_MAJOR=""
  local URL SHA SIZE PLATFORM VERSION ARCHIVE STAGE DOWNLOAD MEMBER ACTUAL_SIZE ACTUAL_SHA NODE_PATH NODE_MAJOR RELEASE_ID
  case "$REQUIRED" in ''|*[!0-9]*) logg error 'Invalid engine Node minimum'; return 20 ;; esac
  if [ -z "$SOURCE" ] && [ -z "${INSTALL_DOCTOR_RELEASE_ID:-}" ]; then
    SOURCE='system'
  fi
  case "$SOURCE" in system|signed-archive|sealed-handoff) ;; *) logg error 'Installer Node runtime source is missing or invalid'; return 20 ;; esac
  if [ "$SOURCE" = sealed-handoff ]; then
    NODE_PATH="${INSTALL_DOCTOR_RUNTIME_NODE:-}"; SHA="${INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256:-}"
    [ -n "$NODE_PATH" ] && [ -f "$NODE_PATH" ] && [ ! -L "$NODE_PATH" ] && [ -x "$NODE_PATH" ] \
      || { logg error 'Sealed handoff runtime is unavailable or unsafe'; return 20; }
    case "$SHA" in ''|*[!a-f0-9]*) logg error 'Sealed handoff runtime digest is invalid'; return 20 ;; esac
    [ "${#SHA}" -eq 64 ] && [ "$(idSha256File "$NODE_PATH")" = "$SHA" ] \
      || { logg error 'Sealed handoff runtime digest mismatch'; return 20; }
    NODE_MAJOR="$("$NODE_PATH" --version 2>/dev/null | sed -nE 's/^v([0-9]+)\..*/\1/p')"
    case "$NODE_MAJOR" in ''|*[!0-9]*) logg error 'Sealed handoff runtime version is invalid'; return 20 ;; esac
    { [ "$NODE_MAJOR" -eq 22 ] || [ "$NODE_MAJOR" -eq 24 ]; } && [ "$NODE_MAJOR" -ge "$REQUIRED" ] \
      || { logg error 'Sealed handoff runtime is outside the supported version policy'; return 20; }
    PATH="$(dirname "$NODE_PATH"):$PATH"
    export INSTALL_DOCTOR_RUNTIME_NODE PATH
    return 0
  fi
  if [ "$SOURCE" = 'system' ] && command -v node >/dev/null 2>&1; then
    SYSTEM_NODE="$(command -v node)"
    SYSTEM_MAJOR="$("$SYSTEM_NODE" --version 2>/dev/null | sed -nE 's/^v([0-9]+)\..*/\1/p')"
    case "$SYSTEM_MAJOR" in ''|*[!0-9]*) SYSTEM_MAJOR=0 ;; esac
    if { [ "$SYSTEM_MAJOR" -eq 22 ] || [ "$SYSTEM_MAJOR" -eq 24 ]; } && [ "$SYSTEM_MAJOR" -ge "$REQUIRED" ]; then
      [ -z "${INSTALL_DOCTOR_RUNTIME_ARCHIVE:-}" ] || { logg error 'System runtime selection cannot carry a staged archive'; return 20; }
      [ -z "${INSTALL_DOCTOR_RUNTIME_NODE:-}" ] || [ "$INSTALL_DOCTOR_RUNTIME_NODE" = "$SYSTEM_NODE" ] \
        || { logg error 'System Node runtime changed after stage-zero selection'; return 20; }
      INSTALL_DOCTOR_RUNTIME_NODE="$SYSTEM_NODE"
      export INSTALL_DOCTOR_RUNTIME_NODE
      return 0
    fi
  fi
  if [ "$SOURCE" = 'system' ]; then
    logg error 'Selected system Node runtime is no longer compatible or available'
    return 20
  fi
  if [ -n "${INSTALL_DOCTOR_RUNTIME_NODE:-}" ]; then
    logg error 'Signed-archive selection cannot accept a caller-provided runtime executable'
    return 20
  fi
  URL="${INSTALL_DOCTOR_RUNTIME_URL:-}"; SHA="${INSTALL_DOCTOR_RUNTIME_SHA256:-}"; SIZE="${INSTALL_DOCTOR_RUNTIME_SIZE:-}"
  PLATFORM="${INSTALL_DOCTOR_RUNTIME_PLATFORM:-}"; VERSION="${INSTALL_DOCTOR_RUNTIME_NODE_VERSION:-}"; ARCHIVE="${INSTALL_DOCTOR_RUNTIME_ARCHIVE:-}"
  RELEASE_ID="${INSTALL_DOCTOR_RELEASE_ID:-}"
  [ -n "$RELEASE_ID" ] && [[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { logg error 'Signed release identifier is invalid'; return 20; }
  [ "$URL" = "https://app.install.doctor/releases/$RELEASE_ID/node-$PLATFORM.tar.gz" ] \
    || { logg error 'Signed Node runtime URL is not the canonical release artifact'; return 20; }
  case "$SHA" in ''|*[!a-f0-9]*) logg error 'Signed Node runtime SHA-256 is invalid'; return 20 ;; esac
  [ "${#SHA}" -eq 64 ] || { logg error 'Signed Node runtime SHA-256 is invalid'; return 20; }
  case "$SIZE" in ''|*[!0-9]*) logg error 'Signed Node runtime size is invalid'; return 20 ;; esac
  [ "$SIZE" -gt 0 ] && [ "$SIZE" -le 100663296 ] || { logg error 'Signed Node runtime size is outside policy'; return 20; }
  local HOST_RUNTIME_PLATFORM="${INSTALL_DOCTOR_BOOTSTRAP_PLATFORM:-}"
  export INSTALL_DOCTOR_BOOTSTRAP_PLATFORM
  if [[ "$HOST_RUNTIME_PLATFORM" == linux-* ]] && compgen -G '/lib/ld-musl-*.so.1' >/dev/null 2>&1; then HOST_RUNTIME_PLATFORM="$HOST_RUNTIME_PLATFORM-musl"; fi
  [ "$PLATFORM" = "$HOST_RUNTIME_PLATFORM" ] || { logg error 'Signed Node runtime platform does not match this host libc/platform'; return 20; }
  [ -f "$ARCHIVE" ] && [ ! -L "$ARCHIVE" ] || { logg error 'Signed Node runtime archive is unavailable or unsafe'; return 20; }
  [[ "$VERSION" =~ ^24\.[0-9]+\.[0-9]+$ ]] || { logg error 'Signed Node runtime must identify an exact Node 24 version'; return 20; }
  NODE_MAJOR="${VERSION%%.*}"; [ "$NODE_MAJOR" -ge "$REQUIRED" ] || { logg error 'Signed Node runtime is below the engine minimum'; return 20; }
  command -v tar >/dev/null 2>&1 || { logg error 'tar is required to acquire the signed runtime'; return 20; }
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-runtime.XXXXXX")" || return 20
  chmod 0700 "$STAGE" || { rm -rf -- "$STAGE"; return 20; }
  [ -d "$STAGE" ] && [ ! -L "$STAGE" ] || { rm -rf -- "$STAGE"; return 20; }
  DOWNLOAD="$STAGE/runtime.tar.gz"
  install -m 0600 "$ARCHIVE" "$DOWNLOAD" || { rm -rf -- "$STAGE"; logg error 'Signed Node runtime staging failed'; return 20; }
  [ -f "$DOWNLOAD" ] && [ ! -L "$DOWNLOAD" ] || { rm -rf -- "$STAGE"; return 20; }
  if command -v stat >/dev/null 2>&1 && stat -c %s "$DOWNLOAD" >/dev/null 2>&1; then ACTUAL_SIZE="$(stat -c %s "$DOWNLOAD")"
  else ACTUAL_SIZE="$(stat -f %z "$DOWNLOAD")"; fi
  [ "$ACTUAL_SIZE" = "$SIZE" ] || { rm -rf -- "$STAGE"; logg error 'Signed Node runtime size mismatch'; return 20; }
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL_SHA="$(sha256sum "$DOWNLOAD" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then ACTUAL_SHA="$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')"
  else rm -rf -- "$STAGE"; logg error 'SHA-256 verifier is required for the signed runtime'; return 20; fi
  [ "$ACTUAL_SHA" = "$SHA" ] || { rm -rf -- "$STAGE"; logg error 'Signed Node runtime checksum mismatch'; return 20; }
  MEMBER="$(tar -tzf "$DOWNLOAD" | awk '/^[A-Za-z0-9._+-]+\/bin\/node$/ { print }')"
  [ -n "$MEMBER" ] && [ "$(printf '%s\n' "$MEMBER" | wc -l | tr -d ' ')" -eq 1 ] || { rm -rf -- "$STAGE"; logg error 'Runtime archive must contain exactly one bounded bin/node member'; return 20; }
  case "$MEMBER" in /*|*../*|*\\*) rm -rf -- "$STAGE"; logg error 'Runtime archive member is unsafe'; return 20 ;; esac
  tar -tvzf "$DOWNLOAD" "$MEMBER" | awk 'NR == 1 && substr($1,1,1) == "-" { ok=1 } END { exit !ok }' \
    || { rm -rf -- "$STAGE"; logg error 'Runtime node member is not a regular file'; return 20; }
  mkdir -p "$STAGE/root" || { rm -rf -- "$STAGE"; return 20; }
  tar -xzf "$DOWNLOAD" -C "$STAGE/root" --no-same-owner --no-same-permissions "$MEMBER" \
    || { rm -rf -- "$STAGE"; logg error 'Runtime node extraction failed'; return 20; }
  NODE_PATH="$STAGE/root/$MEMBER"
  [ -f "$NODE_PATH" ] && [ ! -L "$NODE_PATH" ] || { rm -rf -- "$STAGE"; return 20; }
  chmod 0700 "$NODE_PATH" || { rm -rf -- "$STAGE"; return 20; }
  [ "$("$NODE_PATH" --version 2>/dev/null)" = "v$VERSION" ] || { rm -rf -- "$STAGE"; logg error 'Runtime Node exact version mismatch'; return 20; }
  INSTALL_DOCTOR_RUNTIME_STAGE="$STAGE"; INSTALL_DOCTOR_RUNTIME_NODE="$NODE_PATH"; INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$VERSION"
  _ID_PROVISIONER_RUNTIME_STAGE="$STAGE"
  readonly _ID_PROVISIONER_RUNTIME_STAGE
  PATH="$(dirname "$NODE_PATH"):$PATH"
  export INSTALL_DOCTOR_RUNTIME_STAGE INSTALL_DOCTOR_RUNTIME_NODE INSTALL_DOCTOR_RUNTIME_NODE_VERSION PATH
}

idCleanupProvisionerRuntime() {
  local STAGE="${INSTALL_DOCTOR_RUNTIME_STAGE:-}"
  [ -n "$STAGE" ] || return 0
  [ "$STAGE" = "${_ID_PROVISIONER_RUNTIME_STAGE:-}" ] || return 1
  [ -d "$STAGE" ] && [ ! -L "$STAGE" ] || return 1
  case "$STAGE" in "${TMPDIR:-/tmp}"/install-doctor-runtime.*) rm -rf -- "$STAGE" ;; *) return 1 ;; esac
  INSTALL_DOCTOR_RUNTIME_STAGE=""
  export INSTALL_DOCTOR_RUNTIME_STAGE
}

idSha256File() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 20
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 20
  fi
}

idVerifySealedHandoffFile() {
  local FILE="$1" EXPECTED="$2" ACTUAL
  case "$EXPECTED" in ''|*[!a-f0-9]*) return 20 ;; esac
  [ "${#EXPECTED}" -eq 64 ] || return 20
  ACTUAL="$(idSha256File "$FILE")" || return 20
  [ "$ACTUAL" = "$EXPECTED" ]
}

idInstallSealedHandoffFile() {
  local SOURCE="$1" TARGET="$2" MODE="$3" EXPECTED="$4"
  [ -f "$SOURCE" ] && [ ! -L "$SOURCE" ] || return 20
  [ ! -e "$TARGET" ] && [ ! -L "$TARGET" ] || return 20
  install -m "$MODE" "$SOURCE" "$TARGET" || return 20
  idVerifySealedHandoffFile "$TARGET" "$EXPECTED" || { rm -f -- "$TARGET"; return 20; }
}

### Ensure Homebrew is loaded
loadHomebrew() {
  if ! command -v brew > /dev/null; then
    if [ -f /usr/local/bin/brew ]; then
      logg info "Using /usr/local/bin/brew" && eval "$(/usr/local/bin/brew shellenv)"
    elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" ]; then
      logg info "Using ${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" && eval "$("${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" shellenv)"
    elif [ -x "$HOME/.linuxbrew/bin/brew" ]; then
      logg info "Using $HOME/.linuxbrew/bin/brew" && eval "$("$HOME/.linuxbrew/bin/brew" shellenv)"
    elif [ -x "/home/linuxbrew/.linuxbrew/bin/brew" ]; then
      logg info 'Using /home/linuxbrew/.linuxbrew/bin/brew' && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    else
      logg info 'Could not find Homebrew installation'
    fi
  fi
}

### Ensures Homebrew folders have proper owners / permissions
fixHomebrewPermissions() {
  if command -v brew > /dev/null; then
    logg info 'Applying proper permissions on Homebrew folders'
    sudo chmod -R go-w "$(brew --prefix)/share"
    BREW_DIRS="share etc/bash_completion.d"
    for BREW_DIR in $BREW_DIRS; do
      if [ -d "$(brew --prefix)/$BREW_DIR" ]; then
        sudo chown -Rf "$(whoami)" "$(brew --prefix)/$BREW_DIR"
      fi
    done
    logg info 'Running brew update --force --quiet' && brew update --force --quiet
  fi
}

# @description This function removes group write permissions from the Homebrew share folder which
#     is required for the ZSH configuration.
fixHomebrewSharePermissions() {
  if [ -f /usr/local/bin/brew ]; then
    sudo chmod -R g-w /usr/local/share
  elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" ]; then
    sudo chmod -R g-w "${HOMEBREW_PREFIX:-/opt/homebrew}/share"
  elif [ -d "$HOME/.linuxbrew" ]; then
    sudo chmod -R g-w "$HOME/.linuxbrew/share"
  elif [ -d "/home/linuxbrew/.linuxbrew" ]; then
    sudo chmod -R g-w /home/linuxbrew/.linuxbrew/share
  fi
}

### Installs Homebrew
ensurePackageManagerHomebrew() {
  if ! command -v brew > /dev/null; then
    local BREW_EXIT_CODE=""
    local HOMEBREW_INSTALL_COMMIT='959bdd728192d78c47287c177796c3d86d111f09'
    local HOMEBREW_INSTALL_SHA256='5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148'
    local HOMEBREW_INSTALLER HOMEBREW_INSTALL_ACTUAL_SHA256
    HOMEBREW_INSTALLER="$(mktemp)"
    if ! curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 \
      "https://raw.githubusercontent.com/Homebrew/install/$HOMEBREW_INSTALL_COMMIT/install.sh" -o "$HOMEBREW_INSTALLER"; then
      rm -f "$HOMEBREW_INSTALLER"
      logg error 'Unable to download the pinned Homebrew installer'
      return 75
    fi
    [ "$(wc -c < "$HOMEBREW_INSTALLER")" -le 1048576 ] || { rm -f "$HOMEBREW_INSTALLER"; logg error 'Pinned Homebrew installer exceeded its size bound'; return 2; }
    if command -v sha256sum >/dev/null 2>&1; then HOMEBREW_INSTALL_ACTUAL_SHA256="$(sha256sum "$HOMEBREW_INSTALLER" | awk '{print $1}')";
    elif command -v shasum >/dev/null 2>&1; then HOMEBREW_INSTALL_ACTUAL_SHA256="$(shasum -a 256 "$HOMEBREW_INSTALLER" | awk '{print $1}')";
    else rm -f "$HOMEBREW_INSTALLER"; logg error 'SHA-256 support is required to verify Homebrew'; return 2; fi
    [ "$HOMEBREW_INSTALL_ACTUAL_SHA256" = "$HOMEBREW_INSTALL_SHA256" ] || { rm -f "$HOMEBREW_INSTALLER"; logg error 'Pinned Homebrew installer checksum mismatch'; return 2; }
    ### Select install type based off of whether or not sudo privileges are available
    if command -v sudo > /dev/null && sudo -n true; then
      logg info 'Installing Homebrew. Sudo privileges available.'
      NONINTERACTIVE=1 bash "$HOMEBREW_INSTALLER" || BREW_EXIT_CODE="$?"
      if [ -n "$BREW_EXIT_CODE" ]; then
        rm -f "$HOMEBREW_INSTALLER"
        logg error "Pinned Homebrew installer failed (exit $BREW_EXIT_CODE)"
        return "$BREW_EXIT_CODE"
      fi
      if [ -d "/opt/homebrew" ]; then
        if [ -n "$USER" ]; then
          logg info "Setting owner of /opt/homebrew to '$USER'" && sudo chown -R "$USER" /opt/homebrew || logg warn "Failed to chown /opt/homebrew to '$USER'"
        else
          logg warn "USER not set; skipping chown /opt/homebrew"
        fi
      fi
      fixHomebrewSharePermissions
    else
      logg info 'Installing Homebrew. Sudo privileges not available. Password may be required.'
      NONINTERACTIVE=1 bash "$HOMEBREW_INSTALLER" || BREW_EXIT_CODE="$?"
      if [ -n "$BREW_EXIT_CODE" ]; then
        rm -f "$HOMEBREW_INSTALLER"
        logg error "Pinned Homebrew installer failed (exit $BREW_EXIT_CODE)"
        return "$BREW_EXIT_CODE"
      fi
      if [ -d "/opt/homebrew" ]; then
        if [ -n "$USER" ]; then
          logg info "Setting owner of /opt/homebrew to '$USER'" && sudo chown -R "$USER" /opt/homebrew || logg warn "Failed to chown /opt/homebrew to '$USER'"
        else
          logg warn "USER not set; skipping chown /opt/homebrew"
        fi
      fi
      fixHomebrewSharePermissions
    fi
    rm -f "$HOMEBREW_INSTALLER"

  fi
}

# @description This function ensures Homebrew is installed and available in the `PATH`. It handles the installation of Homebrew on both **Linux and macOS**.
#     It will attempt to bypass sudo password entry if it detects that it can do so. The function also has some error handling in regards to various
#     directories falling out of the correct ownership and permission states. Finally, it loads Homebrew into the active profile (allowing other parts of the script
#     to use the `brew` command).
#
#     Optional compilers are selected by desired state and are not part of bootstrap.
ensureHomebrew() {
  loadHomebrew
  ensurePackageManagerHomebrew
  loadHomebrew
  command -v brew >/dev/null 2>&1 || { logg error 'Homebrew installation did not produce an executable brew command'; return 1; }
}

# @description Read-only reboot requirement detection. Reboot is an explicit
#     operator boundary: the canonical engine records pending-reboot and never
#     restarts a host behind the approved task graph.
isRebootRequired() {
  if [ "$(detect_os)" = "macos" ]; then
    command -v defaults >/dev/null 2>&1 || return 1
    defaults read /Library/Updates/index.plist InstallAtLogout 2>/dev/null | grep -Eq '^(1|true|YES)$'
  elif [ -f /var/run/reboot-required ]; then
    return 0
  fi
  return 1
}
# @description Prints information describing why full disk access is required for the script to run on macOS.
printFullDiskAccessNotice() {
  if [ "$(detect_os)" = "macos" ]; then
    logg md "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/docs/terminal/full-disk-access.md"
  fi
}

# @description Ensures the terminal running the provisioning process has full disk access on macOS.
#     Full disk access is required to modify system files, preferences, and permissions during provisioning.
#
#     This function works by attempting to read a file (`com.apple.TimeMachine.plist`) that requires
#     full disk access. If the read fails, it means the terminal lacks the permission.
#
#     **Behavior when full disk access is missing:**
#     - In headless mode (`HEADLESS_INSTALL=true`): Logs a warning and continues (some operations may fail)
#     - In interactive mode: Opens the macOS System Preferences pane and exits so the user can grant access
#
#     After granting access, the user restarts the terminal and explicitly reruns the same verified command.
#
#     @envvar HEADLESS_INSTALL  If set, skips the interactive full disk access prompt
#     @see [Detecting Full Disk Access on macOS](https://www.dzombak.com/blog/2021/11/macOS-Scripting-How-to-tell-if-the-Terminal-app-has-Full-Disk-Access.html)
ensureFullDiskAccess() {
  if [ "$(detect_os)" = "macos" ]; then
    if ! plutil -lint /Library/Preferences/com.apple.TimeMachine.plist > /dev/null ; then
      if [ -n "$HEADLESS_INSTALL" ]; then
        logg warn 'Full disk access is not available. Some macOS operations may fail in headless mode.'
        return 0
      fi
      printFullDiskAccessNotice
      logg star 'Opening Full Disk Access preference pane.. Grant full-disk access for the terminal you would like to run the provisioning process with.' && open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
      logg info 'You may have to force quit the terminal and have it reload.'
      logg info 'After granting access, rerun the original verified install command explicitly.'
      exit 0
    else
      logg info 'Current terminal has full disk access'
    fi
  fi
}

# @description Imports the CloudFlare Teams certificate into the macOS system keychain.
#     This is required for CloudFlare Zero Trust / WARP to function properly with HTTPS inspection.
#
#     **Conditions for execution:**
#     - Only runs on macOS (checks for `/Applications` and `/System` directories)
#     - Skipped entirely when `HEADLESS_INSTALL` is set (requires Touch ID / password prompt)
#     - Certificate must exist at `$HOME/.local/etc/ssl/cloudflare/cloudflare.crt`
#
#     @envvar HEADLESS_INSTALL  If set, skips certificate import (requires user interaction on macOS)
importCloudFlareCert() {
  if [ "$(detect_os)" = "macos" ] && [ -z "$HEADLESS_INSTALL" ]; then
    ### Acquire certificate
    if [ -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" ]; then
      CRT_TMP="$HOME/.local/etc/ssl/cloudflare/cloudflare.crt"
      ### Validate / import certificate
      if ! security verify-cert -c "$CRT_TMP" > /dev/null 2>&1; then
        logg info '**macOS Manual Security Permission** Requesting security authorization for Cloudflare trusted certificate'
        sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CRT_TMP" && logg info 'Successfully imported cloudflare.crt into System.keychain'
      fi
    else
      logg warn "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt is missing"
    fi
  fi
}


# @description Applies default environment variable settings when running in a CI/CD environment.
#     This function is triggered when either the `CI` or `TEST_INSTALL` environment variable is set.
#     It configures the provisioning process for unattended, headless operation with sensible defaults.
#
#     The following defaults are applied:
#     - `NO_RESTART=true` - Prevents automatic reboots during provisioning
#     - `HEADLESS_INSTALL=true` - Disables all interactive prompts
#     - `SOFTWARE_GROUP=Full-Desktop` - Installs the full desktop software suite
#     - Various identity variables are set to default values for testing
#
#     @envvar CI  Set by most CI/CD platforms (GitHub Actions, GitLab CI, etc.)
#     @envvar TEST_INSTALL  Alternative flag for triggering CI mode manually
setCIEnvironmentVariables() {
  if [ -n "$CI" ] || [ -n "$TEST_INSTALL" ]; then
    logg info "Automatically setting environment variables for CI/headless mode"
    export NO_RESTART=true
    export HEADLESS_INSTALL=true
    export SOFTWARE_GROUP="${SOFTWARE_GROUP:-Full-Desktop}"
    export FULL_NAME="${FULL_NAME:-Install Doctor}"
    export PRIMARY_EMAIL="${PRIMARY_EMAIL:-admin@install.doctor}"
    export PUBLIC_SERVICES_DOMAIN="${PUBLIC_SERVICES_DOMAIN:-install.doctor}"
    export RESTRICTED_ENVIRONMENT="${RESTRICTED_ENVIRONMENT:-false}"
    export WORK_ENVIRONMENT="${WORK_ENVIRONMENT:-false}"
    export HOST="${HOST:-$(hostname -s)}"
    logg info "CI environment configured: SOFTWARE_GROUP=$SOFTWARE_GROUP, HEADLESS_INSTALL=$HEADLESS_INSTALL"
  fi
}

# Normalize the public headless flag before any function decides whether it may
# read from a terminal. Keeping one canonical representation prevents values
# such as `false` from being misread as enabled merely because they are
# non-empty, and rejects ambiguous automation input before prompts or mutation.
idNormalizeHeadlessMode() {
  case "${HEADLESS_INSTALL:-}" in
    true|1) HEADLESS_INSTALL=true ;;
    false|0|'') HEADLESS_INSTALL='' ;;
    *) logg error 'HEADLESS_INSTALL must be true, false, 1, or 0'; return 2 ;;
  esac
  export HEADLESS_INSTALL
}

# @description Applies capability-based defaults derived from the host's environment CLASS (A5/B4/H15/A10).
#     The capability ADAPTERS that consume the detectors instead of hostname/OS conditionals: a host that
#     should NOT get desktop components (a container, or a host with no graphical session) defaults to an
#     unattended install — `HEADLESS_INSTALL` (no GUI prompts); a host that cannot safely reboot mid-provision
#     (`should_skip_reboot` — a container with no init to return to, OR a WSL distro that reboots via
#     `wsl --shutdown` from Windows, never in-distro) additionally gets `NO_RESTART`. Each is set only if not
#     already explicit (`:-`), so a user/CI override always wins. Uses `should_provision_desktop` +
#     `should_skip_reboot` + `detect_env_class` from lib/detect_os.sh; no-ops (fallback-safe) if the detector
#     lib was unavailable at source time (the inline fallback does not define them).
#
#     @envvar HEADLESS_INSTALL  Defaulted to true on a no-desktop target (container/headless)
#     @envvar NO_RESTART        Defaulted to true where a mid-provision reboot is impossible/unsafe (container/WSL)
applyEnvClassDefaults() {
  command -v should_provision_desktop > /dev/null 2>&1 || return 0
  should_provision_desktop && return 0 # a desktop target — nothing to adjust
  export HEADLESS_INSTALL="${HEADLESS_INSTALL:-true}"
  if command -v should_skip_reboot > /dev/null 2>&1 && should_skip_reboot; then
    export NO_RESTART="${NO_RESTART:-true}"
    logg info "$(detect_env_class 2> /dev/null) environment — defaulting to HEADLESS_INSTALL + NO_RESTART (desktop-free, cannot safely reboot mid-provision)"
  else
    logg info "No graphical session (is_headless) — defaulting to HEADLESS_INSTALL"
  fi
}

# @description Prompts for inputs needed to automate the entire installation up front, so the
#     user can walk away once they've answered. Currently collects:
#
#     - `SUDO_PASSWORD` - sudo password, masked input via `gum input --password` when available,
#       falling back to bash `read -s` so it works before Homebrew/Gum are installed. Skipped
#       when passwordless sudo is already configured or `SUDO_PASSWORD` is already in the env.
#
#     All prompts auto-skip after 30 seconds so unattended runs are not blocked. Any prompt is
#     bypassed by setting the corresponding env var, `HEADLESS_INSTALL=true`, or running in CI.
#
#     @envvar SUDO_PASSWORD     Sudo password; set to skip the sudo prompt entirely.
#     @envvar HEADLESS_INSTALL  When set, no prompts are shown.
collectInputsUpfront() {
  if [ -n "$HEADLESS_INSTALL" ]; then
    logg info "HEADLESS_INSTALL is set - skipping interactive input collection"
    return 0
  fi
  if [ -n "$CI" ] || [ -n "$TEST_INSTALL" ]; then
    logg info "CI / TEST_INSTALL is set - skipping interactive input collection"
    return 0
  fi

  ### SUDO_PASSWORD prompt
  if [ -z "$SUDO_PASSWORD" ]; then
    if sudo -n true 2>/dev/null; then
      logg info "Passwordless sudo already available - skipping SUDO_PASSWORD prompt"
    else
      logg info "Enter the current user's login / admin password. Auto-skipping in 30 seconds. Set SUDO_PASSWORD env var to bypass this prompt."
      if command -v gum > /dev/null; then
        SUDO_PASSWORD="$(timeout 30 gum input --password --placeholder="Enter password (30s timeout)..")" || SUDO_PASSWORD=""
      else
        SUDO_PASSWORD=""
        read -s -t 30 -p "Password (30s timeout): " SUDO_PASSWORD < /dev/tty || SUDO_PASSWORD=""
        printf '\n'
      fi
      if [ -n "$SUDO_PASSWORD" ]; then
        export SUDO_PASSWORD
        logg success "Sudo password collected - the rest of the install will run unattended"
      else
        logg info "No sudo password provided - interactive prompts may appear later when sudo is required"
      fi
    fi
  fi
}

# Resolve Cloudflare WARP only from installation-owned, fixed absolute paths.
# The caller cannot select an executable through PATH or an environment value.
idResolveWarpCli() {
  local CANDIDATE="${INSTALL_DOCTOR_WARP_CLI_PATH:-}" EXPECTED="${INSTALL_DOCTOR_WARP_CLI_SHA256:-}" ACTUAL
  case "$CANDIDATE" in /usr/local/bin/warp-cli|/opt/homebrew/bin/warp-cli|/usr/bin/warp-cli|/bin/warp-cli) ;; *) return 2 ;; esac
  case "$EXPECTED" in ''|*[!a-f0-9]*) return 2 ;; esac
  [ "${#EXPECTED}" -eq 64 ] || return 2
  [ -f "$CANDIDATE" ] && [ ! -L "$CANDIDATE" ] && [ -x "$CANDIDATE" ] || return 2
  ACTUAL="$(idSha256File "$CANDIDATE")" || return 2
  [ "$ACTUAL" = "$EXPECTED" ] || return 2
  printf '%s\n' "$CANDIDATE"
}

# Return 0 only for the required disconnected postcondition, 10 when apply is
# needed, and 2 for missing tooling, command failure, or an ambiguous state.
idWarpDisconnectedCheck() {
  local WARP_CLI STATUS
  WARP_CLI="$(idResolveWarpCli)" || return 2
  STATUS="$("$WARP_CLI" status 2>/dev/null)" || return 2
  case "$STATUS" in *[Dd]isconnected*) return 0 ;; *[Cc]onnected*) return 10 ;; *) return 2 ;; esac
}

idWarpDisconnectedApply() {
  local WARP_CLI STATUS
  idWarpDisconnectedCheck
  STATUS=$?
  [ "$STATUS" -ne 0 ] || return 0
  [ "$STATUS" -eq 10 ] || return 2
  WARP_CLI="$(idResolveWarpCli)" || return 2
  "$WARP_CLI" disconnect || return 2
  idWarpDisconnectedVerify
}

idWarpDisconnectedVerify() {
  idWarpDisconnectedCheck
  [ "$?" -eq 0 ]
}

# @description Validates and caches the current user's sudo credential for this provisioning process.
#     This function will:
#     1. Reuse an already-valid non-interactive sudo credential
#     2. Resolve SUDO_PASSWORD from the configured secret provider when available
#     3. Use the SUDO_PASSWORD environment variable if set
#     4. Fall back to prompting the user with a 30-second timeout (auto-proceeds on timeout)
#
#     No sudoers entry is created. Cleanup invalidates the credential cache.
#
#     @envvar SUDO_PASSWORD  If set, used to authenticate sudo without interactive prompts
#     @envvar HEADLESS_INSTALL  If set, skips interactive prompts entirely
idSudoOwnershipPath() {
  local ROOT HOST UID_VALUE RELEASE KEY
  ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor/sudo-ownership"
  HOST="$(hostname -s 2>/dev/null || hostname)"; UID_VALUE="$(id -u)"; RELEASE="${INSTALL_DOCTOR_RELEASE_ID:-unknown}"
  KEY="$(printf '%s-%s-%s' "$HOST" "$UID_VALUE" "$RELEASE" | tr -c 'a-zA-Z0-9._-' '_')"
  printf '%s/%s.intent\n' "$ROOT" "$KEY"
}

idSudoProcessStart() {
  local PID_VALUE="$1" VALUE
  case "$PID_VALUE" in ''|*[!0-9]*) return 2 ;; esac
  VALUE="$(ps -o lstart= -p "$PID_VALUE" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$VALUE" ] || return 1
  printf '%s\n' "$VALUE"
}

idPrepareSudoOwnershipRoot() {
  local BASE DOCTOR ROOT PATH_VALUE UID_VALUE OWNER MODE
  BASE="${XDG_STATE_HOME:-$HOME/.local/state}"; DOCTOR="$BASE/install.doctor"; ROOT="$DOCTOR/sudo-ownership"; UID_VALUE="$(id -u)"
  for PATH_VALUE in "$BASE" "$DOCTOR" "$ROOT"; do
    if [ ! -e "$PATH_VALUE" ]; then mkdir "$PATH_VALUE" 2>/dev/null || return 2; fi
    [ -d "$PATH_VALUE" ] && [ ! -L "$PATH_VALUE" ] || return 2
    OWNER="$(stat -c '%u' "$PATH_VALUE" 2>/dev/null || stat -f '%u' "$PATH_VALUE" 2>/dev/null || true)"
    [ "$OWNER" = "$UID_VALUE" ] || return 2
    chmod 0700 "$PATH_VALUE" || return 2
    MODE="$(stat -c '%a' "$PATH_VALUE" 2>/dev/null || stat -f '%Lp' "$PATH_VALUE" 2>/dev/null || true)"
    [ "$MODE" = 700 ] || return 2
  done
  printf '%s\n' "$ROOT"
}

idRetireSudoOwnership() {
  local INTENT ROOT OWNER_PID OWNER_UID OWNER_START CURRENT_START OWNER MODE
  ROOT="$(idPrepareSudoOwnershipRoot)" || return 1; INTENT="$(idSudoOwnershipPath)"; [ "${INTENT%/*}" = "$ROOT" ] || return 1
  [ -f "$INTENT" ] && [ ! -L "$INTENT" ] || return 1
  OWNER="$(stat -c '%u' "$INTENT" 2>/dev/null || stat -f '%u' "$INTENT" 2>/dev/null || true)"; [ "$OWNER" = "$(id -u)" ] || return 1
  MODE="$(stat -c '%a' "$INTENT" 2>/dev/null || stat -f '%Lp' "$INTENT" 2>/dev/null || true)"; [ "$MODE" = 600 ] || return 1
  OWNER_PID="$(sed -n 's/^pid=//p' "$INTENT")"; OWNER_UID="$(sed -n 's/^uid=//p' "$INTENT")"; OWNER_START="$(sed -n 's/^process_start=//p' "$INTENT")"
  CURRENT_START="$(idSudoProcessStart "$$")" || return 1
  [ "$OWNER_PID" = "$$" ] && [ "$OWNER_UID" = "$(id -u)" ] && [ "$OWNER_START" = "$CURRENT_START" ] || return 1
  rm -f -- "$INTENT" 2>/dev/null || return 1
}

idReconcileStaleSudoOwnership() {
  local INTENT ROOT OWNER_PID OWNER_UID OWNER_START LIVE_START MODE OWNER
  ROOT="$(idPrepareSudoOwnershipRoot)" || return 2
  for INTENT in "$ROOT"/*.intent; do
    [ -e "$INTENT" ] || continue
    [ -f "$INTENT" ] && [ ! -L "$INTENT" ] || return 2
    MODE="$(stat -c '%a' "$INTENT" 2>/dev/null || stat -f '%Lp' "$INTENT" 2>/dev/null || true)"; [ "$MODE" = 600 ] || return 2
    OWNER="$(stat -c '%u' "$INTENT" 2>/dev/null || stat -f '%u' "$INTENT" 2>/dev/null || true)"; [ "$OWNER" = "$(id -u)" ] || return 2
    OWNER_PID="$(sed -n 's/^pid=//p' "$INTENT")"; OWNER_UID="$(sed -n 's/^uid=//p' "$INTENT")"; OWNER_START="$(sed -n 's/^process_start=//p' "$INTENT")"
    case "$OWNER_PID:$OWNER_UID" in *[!0-9:]*) return 2 ;; esac
    [ "$OWNER_UID" = "$(id -u)" ] && [ -n "$OWNER_START" ] || return 2
    LIVE_START="$(idSudoProcessStart "$OWNER_PID" 2>/dev/null || true)"
    if [ "$OWNER_PID" != "$$" ] && [ -n "$LIVE_START" ] && [ "$LIVE_START" = "$OWNER_START" ]; then
      logg error "Another live installer owns sudo acquisition intent (pid $OWNER_PID)"
      return 2
    fi
    # `-K` removes every timestamp owned by this uid, including a ticket from
    # the dead run's former tty/session. This may also expire unrelated sudo
    # tickets for the same user; that fail-closed tradeoff is required because
    # sudo's tty_tickets policy cannot otherwise address an unknown stale tty.
    sudo -K 2>/dev/null || true
    if sudo -n true 2>/dev/null; then
      logg error 'Unable to revoke stale installer-owned sudo authority'
      return 2
    fi
    rm -f -- "$INTENT" || return 2
    logg info 'Reconciled stale installer-owned sudo authority before planning'
  done
}

idCreateSudoOwnershipIntent() {
  local INTENT ROOT TEMP PROCESS_START
  INTENT="$(idSudoOwnershipPath)"; ROOT="$(idPrepareSudoOwnershipRoot)" || return 2; TEMP="$INTENT.tmp.$$"; PROCESS_START="$(idSudoProcessStart "$$")" || return 2
  idReconcileStaleSudoOwnership || return $?
  umask 077
  ( set -C; printf 'schema=1\npid=%s\nuid=%s\nprocess_start=%s\nhost=%s\nrelease=%s\nstate=acquiring\n' "$$" "$(id -u)" "$PROCESS_START" "$(hostname -s 2>/dev/null || hostname)" "${INSTALL_DOCTOR_RELEASE_ID:-unknown}" > "$TEMP" ) || return 2
  chmod 0600 "$TEMP" || { rm -f -- "$TEMP"; return 2; }
  mv "$TEMP" "$INTENT" || { rm -f -- "$TEMP"; return 2; }
}

idBindSudoOwnershipProvenance() {
  local INTENT TEMP SESSION
  INTENT="$(idSudoOwnershipPath)"; [ -f "$INTENT" ] && [ ! -L "$INTENT" ] || return 2
  TEMP="$INTENT.bound.$$"; SESSION="$(tty 2>/dev/null || printf 'notty')"; SESSION="$(printf '%s' "$SESSION" | tr -c 'a-zA-Z0-9._/-' '_')"
  umask 077
  sed 's/^state=.*/state=acquired/' "$INTENT" > "$TEMP" || return 2
  printf 'session=%s\nacquired_at=%s\n' "$SESSION" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$TEMP" || { rm -f -- "$TEMP"; return 2; }
  chmod 0600 "$TEMP" && mv "$TEMP" "$INTENT"
}

setupPasswordlessSudo() {
  ### Helper: confirm a candidate password actually works for `sudo`.
  ### Uses `sudo -k` first to invalidate any cached timestamp so that a
  ### previously-cached session does not give a false positive.
  _idSudoPasswordWorks() {
    local CANDIDATE="$1"
    [ -z "$CANDIDATE" ] && return 1
    sudo -k 2>/dev/null || true
    printf '%s\n' "$CANDIDATE" | sudo -S -p '' -k true >/dev/null 2>&1
  }

  ### Record only process-local behavior. The sudo timestamp itself is the
  ### authority; a forgeable shared /tmp marker must never claim privilege.
  ### When sudo is NOT active we
  ### export SUDO_ASKPASS=/usr/bin/false so any stray `sudo` call in a
  ### chezmoi script fails fast instead of blocking on an interactive
  ### password prompt — which is what was happening mid-run before.
  _idMarkPasswordless() {
    unset SUDO_ASKPASS
    unset INSTALL_DOCTOR_NO_SUDO
  }
  _idMarkBlocked() {
    export SUDO_ASKPASS=/usr/bin/false
    export INSTALL_DOCTOR_NO_SUDO=1
  }

  sudo -n true 2>/dev/null && { logg info 'A valid non-interactive sudo credential is already available'; _idMarkPasswordless; return 0; }

  idCreateSudoOwnershipIntent || return $?

  logg info 'Validating sudo once so its credential cache can be used during provisioning'

  ### Try Infisical first (via get-secret or infisical CLI) before Chezmoi or prompting.
  if [ -z "$SUDO_PASSWORD" ] && command -v get-secret > /dev/null 2>&1; then
    SUDO_PASSWORD="$(get-secret SUDO_PASSWORD 2>/dev/null | tr -d '\r' | sed -e 's/[[:space:]]*$//' || true)"
    if [ -n "$SUDO_PASSWORD" ] && ! _idSudoPasswordWorks "$SUDO_PASSWORD"; then
      SUDO_PASSWORD=""
    fi
    export SUDO_PASSWORD
  fi
  if [ -z "$SUDO_PASSWORD" ] && command -v infisical > /dev/null 2>&1 && [ -n "${INFISICAL_TOKEN:-}" ]; then
    logg info "Acquiring SUDO_PASSWORD from Infisical Vault"
    SUDO_PASSWORD="$(infisical secrets get SUDO_PASSWORD --env=prod --path="/hosts/$(hostname -s 2>/dev/null || hostname)" --plain --silent 2>/dev/null || infisical secrets get SUDO_PASSWORD --plain --silent 2>/dev/null || true)"
    if [ -n "$SUDO_PASSWORD" ] && ! _idSudoPasswordWorks "$SUDO_PASSWORD"; then
      logg warn 'The SUDO_PASSWORD retrieved from Infisical did not authenticate; discarding it'
      SUDO_PASSWORD=""
    fi
    export SUDO_PASSWORD
  fi
  if [ -z "$SUDO_PASSWORD" ] && [ -f "$HOME/.config/agent-fleet/infisical.json" ] && command -v python3 > /dev/null 2>&1; then
    SUDO_PASSWORD="$(python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

cfg_path = Path.home() / ".config/agent-fleet/infisical.json"
cfg = json.loads(cfg_path.read_text())
cred_path = Path(cfg.get("credentialsFile", str(Path.home() / ".config/agent-fleet/infisical-us-credentials.json"))).expanduser()
if not cred_path.exists():
    cred_path = Path.home() / ".config/agent-fleet/infisical-us-credentials.json"
creds = json.loads(cred_path.read_text())
base = cfg["url"].rstrip("/")
headers = {"Content-Type": "application/json", "User-Agent": "infisical-fleet-broker/1.0"}
req = Request(f"{base}/api/v1/auth/universal-auth/login", data=json.dumps(creds).encode(), headers=headers)
with urlopen(req, timeout=10) as resp:
    tok = json.load(resp)["accessToken"]
q = urlencode({"workspaceId": cfg["projectId"], "environment": cfg.get("environment", "prod"), "secretPath": cfg.get("secretPath", "/"), "type": "shared"})
req2 = Request(f"{base}/api/v3/secrets/raw/SUDO_PASSWORD?{q}", headers={"Authorization": f"Bearer {tok}", "User-Agent": "infisical-fleet-broker/1.0"})
with urlopen(req2, timeout=10) as resp2:
    print(json.load(resp2)["secret"]["secretValue"], end="")
PY
)"
    if [ -n "$SUDO_PASSWORD" ] && ! _idSudoPasswordWorks "$SUDO_PASSWORD"; then
      SUDO_PASSWORD=""
    fi
    export SUDO_PASSWORD
  fi

  ### Try the Chezmoi-encrypted secret next. `chezmoi decrypt` can append a
  ### trailing newline, so strip it before testing.
  if [ -z "$SUDO_PASSWORD" ] && command -v chezmoi > /dev/null && [ -f "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/home/.chezmoitemplates/secrets-$(hostname -s)/SUDO_PASSWORD" ] && [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/age/chezmoi.txt" ]; then
    logg info "Acquiring SUDO_PASSWORD by using Chezmoi to decrypt ${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/home/.chezmoitemplates/secrets-$(hostname -s)/SUDO_PASSWORD"
    SUDO_PASSWORD="$(chezmoi decrypt < "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/home/.chezmoitemplates/secrets-$(hostname -s)/SUDO_PASSWORD" 2>/dev/null | tr -d '\r' | sed -e 's/[[:space:]]*$//')"
    if ! _idSudoPasswordWorks "$SUDO_PASSWORD"; then
      logg warn 'The SUDO_PASSWORD decrypted from Chezmoi did not authenticate; discarding it'
      SUDO_PASSWORD=""
    fi
    export SUDO_PASSWORD
  fi

  ### If still empty (or the decrypted value was wrong), prompt the user.
  ### Loop up to 3 times so a typo is recoverable without re-running the
  ### whole script. Skip entirely under HEADLESS_INSTALL.
  if [ -z "$SUDO_PASSWORD" ] && [ -z "$HEADLESS_INSTALL" ]; then
    local ATTEMPT=0
    while [ "$ATTEMPT" -lt 3 ] && [ -z "$SUDO_PASSWORD" ]; do
      ATTEMPT=$((ATTEMPT + 1))
      logg info "Enter the current user's login / admin password (attempt $ATTEMPT/3). Auto-skipping in 30 seconds. Set SUDO_PASSWORD env var to bypass this prompt."
      local CANDIDATE=""
      if command -v gum > /dev/null; then
        CANDIDATE="$(timeout 30 gum input --password --placeholder="Enter password (30s timeout)..")" || CANDIDATE=""
      else
        read -s -t 30 -p "Password (30s timeout): " CANDIDATE < /dev/tty || CANDIDATE=""
        printf '\n'
      fi
      if _idSudoPasswordWorks "$CANDIDATE"; then
        SUDO_PASSWORD="$CANDIDATE"
        export SUDO_PASSWORD
        break
      else
        [ -n "$CANDIDATE" ] && logg warn 'That password did not authenticate; try again'
      fi
    done
  fi

  if [ -n "$SUDO_PASSWORD" ] && _idSudoPasswordWorks "$SUDO_PASSWORD"; then
    logg info 'Caching the validated sudo credential without changing sudoers'
    if printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' -v >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      idBindSudoOwnershipProvenance || { sudo -K 2>/dev/null || true; return 2; }
      _idMarkPasswordless
      return 0
    fi
    logg warn 'The sudo credential cache could not be established; treating sudo as blocked'
  fi

  if [ -n "$HEADLESS_INSTALL" ]; then
    logg warn 'HEADLESS_INSTALL is set but no SUDO_PASSWORD is available. Sudo-requiring steps will be skipped.'
  else
    logg warn 'No sudo password was acquired. Sudo-requiring steps will be skipped instead of prompting interactively.'
  fi
  _idMarkBlocked
  sudo -K 2>/dev/null || true
  idRetireSudoOwnership || return 2
  return 0
}

# Qubes dom0 mutation helpers were retired while the platform cell is unsupported.
# Future support must use independently verified typed operations and signed canary evidence.

# @description Helper function used by [[ensureHomebrewDeps]] to ensure a Homebrew package is installed after
#     first checking if it is already available on the system.
installBrewPackage() {
  if ! command -v "$1" > /dev/null; then
    logg info 'Installing '"$1"''
    brew install --quiet "$1"
  fi
}

# @description Installs the Homebrew tools the current desired-state apply directly requires.
#     Node.js 22+ is validated before this point. Gum and zx remain temporary apply-spine
#     dependencies until all Chezmoi scripts use engine events and installx is compiled JS.
ensureHomebrewDeps() {
  installBrewPackage "gum"
  installBrewPackage "chezmoi"
  installBrewPackage "zx"
}

# @description Ensure the `${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi` directory is cloned and up-to-date using the previously
#     set `START_REPO` as the source repository.
cloneChezmoiSourceRepo() {
  local SOURCE_COMMIT="${INSTALL_DOCTOR_SOURCE_COMMIT:-}" RELEASE_ID="${INSTALL_DOCTOR_RELEASE_ID:-}" RELEASE_ROOT SOURCE_ROOT TEMP_ROOT ACTUAL_COMMIT
  case "$SOURCE_COMMIT" in ''|*[!0-9a-f]*) logg error 'A full signed source commit is required'; return 2 ;; esac
  [ "${#SOURCE_COMMIT}" -eq 40 ] || { logg error 'The signed source commit must be a full SHA-1'; return 2; }
  case "$RELEASE_ID" in ''|*[!a-zA-Z0-9._-]*) logg error 'A valid signed release identifier is required'; return 2 ;; esac
  RELEASE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/install.doctor/releases/$RELEASE_ID"
  SOURCE_ROOT="$RELEASE_ROOT/source"
  mkdir -p "$RELEASE_ROOT" || return 1
  chmod 0700 "${XDG_DATA_HOME:-$HOME/.local/share}/install.doctor" "${XDG_DATA_HOME:-$HOME/.local/share}/install.doctor/releases" "$RELEASE_ROOT" 2>/dev/null || return 1
  if [ -e "$SOURCE_ROOT" ]; then
    [ -d "$SOURCE_ROOT/.git" ] && [ ! -L "$SOURCE_ROOT" ] || { logg error 'Existing immutable source path is invalid'; return 2; }
  else
    TEMP_ROOT="$RELEASE_ROOT/.source.$$"
    [ ! -e "$TEMP_ROOT" ] || { logg error 'Temporary immutable source path already exists'; return 2; }
    mkdir -m 0700 "$TEMP_ROOT" || return 1
    git -C "$TEMP_ROOT" init --quiet || { rm -rf -- "$TEMP_ROOT"; return 1; }
    git -C "$TEMP_ROOT" remote add origin "$START_REPO" || { rm -rf -- "$TEMP_ROOT"; return 1; }
    if ! git -C "$TEMP_ROOT" fetch --quiet --depth=1 origin "$SOURCE_COMMIT"; then
      logg error 'Unable to fetch the signed immutable source commit'
      rm -rf -- "$TEMP_ROOT"
      return 1
    fi
    git -C "$TEMP_ROOT" checkout --quiet --detach FETCH_HEAD || { rm -rf -- "$TEMP_ROOT"; return 1; }
    ACTUAL_COMMIT="$(git -C "$TEMP_ROOT" rev-parse HEAD)" || { rm -rf -- "$TEMP_ROOT"; return 1; }
    [ "$ACTUAL_COMMIT" = "$SOURCE_COMMIT" ] || { logg error 'Fetched source does not match the signed commit'; rm -rf -- "$TEMP_ROOT"; return 2; }
    mv "$TEMP_ROOT" "$SOURCE_ROOT" || { rm -rf -- "$TEMP_ROOT"; return 1; }
  fi
  verifyChezmoiSourceRepo
}

verifyChezmoiSourceRepo() {
  local SOURCE_COMMIT="${INSTALL_DOCTOR_SOURCE_COMMIT:-}" RELEASE_ID="${INSTALL_DOCTOR_RELEASE_ID:-}" SOURCE_ROOT ACTUAL_COMMIT ACTUAL_ORIGIN
  case "$SOURCE_COMMIT" in ''|*[!0-9a-f]*) return 2 ;; esac
  [ "${#SOURCE_COMMIT}" -eq 40 ] || return 2
  case "$RELEASE_ID" in ''|*[!a-zA-Z0-9._-]*) return 2 ;; esac
  SOURCE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/install.doctor/releases/$RELEASE_ID/source"
  [ -d "$SOURCE_ROOT/.git" ] && [ ! -L "$SOURCE_ROOT" ] || return 10
  ACTUAL_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)" || return 2
  ACTUAL_ORIGIN="$(git -C "$SOURCE_ROOT" remote get-url origin)" || return 2
  [ "$ACTUAL_COMMIT" = "$SOURCE_COMMIT" ] || { logg error 'Immutable source checkout no longer matches the signed commit'; return 2; }
  [ "$ACTUAL_ORIGIN" = "$START_REPO" ] || { logg error 'Immutable source checkout has an unexpected origin'; return 2; }
  [ -z "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=all)" ] || { logg error 'Immutable source checkout was modified'; return 2; }
  [ -f "$SOURCE_ROOT/.chezmoiroot" ] && [ -d "$SOURCE_ROOT/home" ] || { logg error 'Signed source commit is not an Install Doctor source tree'; return 2; }
  INSTALL_DOCTOR_CHEZMOI_SOURCE="$SOURCE_ROOT/home"
  export INSTALL_DOCTOR_CHEZMOI_SOURCE
  logg info "Using signed source commit $SOURCE_COMMIT from $SOURCE_ROOT; existing checkouts were not modified"
}

# @description Guide the user through the initial setup by showing TUI introduction and accepting input through various prompts.
#     This function performs three main steps:
#
#     1. **Introduction Display**: Shows `chezmoi-intro.md` with `glow` (non-blocking, informational only)
#     2. **Software Group Selection**: Prompts for the software group if `SOFTWARE_GROUP` is not defined.
#        Currently defaults to "Full" (other groups like "Basic", "Server", "Standard" are planned).
#        To skip the prompt entirely, set `SOFTWARE_GROUP` before running the script.
#     3. **Chezmoi Initialization**: Runs `chezmoi init` when the Chezmoi configuration file is missing.
#        In headless mode (`HEADLESS_INSTALL=true`), this uses the `--force` flag to skip interactive prompts.
#
#     @envvar SOFTWARE_GROUP  Pre-set to skip the software group selection prompt (default: "Full")
#     @envvar HEADLESS_INSTALL  If set, forces chezmoi init to run non-interactively
writeInstallPlan() {
  local PLAN_DIR PLAN_FILE PLAN_TMP
  PLAN_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor/plans"
  PLAN_FILE="${INSTALL_DOCTOR_PLAN:-$PLAN_DIR/latest.json}"
  PLAN_TMP="$PLAN_FILE.tmp.$$"
  mkdir -p "$PLAN_DIR"
  umask 077
  command -v node >/dev/null 2>&1 || { logg error 'Node.js is required to create a validated install plan'; return 2; }
  if ! node - "$PLAN_TMP" "$(hostname -s 2>/dev/null || hostname)" "$(detect_os)" <<'NODE'
const fs = require('node:fs');
const [path, hostname, os] = process.argv.slice(2);
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const boolean = name => {
  const value = required(name);
  if (value !== 'true' && value !== 'false') throw new Error(`invalid ${name}`);
  return value === 'true';
};
const concurrency = Number(required('INSTALL_DOCTOR_CONCURRENCY'));
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('invalid concurrency');
const selectedList = (name, maximum, pattern) => {
  const raw = process.env[name] || '';
  if (raw.length > 524_288 || (raw && !pattern.test(raw))) throw new Error(`invalid ${name}`);
  const values = [...new Set(raw.split(',').filter(Boolean))].sort();
  if (values.length > maximum || values.some(value => value.length > 128)) throw new Error(`invalid ${name}`);
  return values;
};
const catalogListPattern = /^[a-z0-9][a-z0-9._:-]*(?:,[a-z0-9][a-z0-9._:-]*)*$/;
const identifierListPattern = /^[a-z0-9][a-z0-9._-]*(?:,[a-z0-9][a-z0-9._-]*)*$/;
const selectedPackages = selectedList('INSTALL_DOCTOR_SELECTED_PACKAGES', 4096, catalogListPattern);
const selectedServices = selectedList('INSTALL_DOCTOR_SELECTED_SERVICES', 1024, catalogListPattern);
const selectedSupportedPaths = selectedList('INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS', 1024, identifierListPattern);
const lazyResolverRequirements = selectedList('INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS', 128, catalogListPattern);
const plan = {
  schemaVersion: 2, host: { hostname, os }, role: required('INSTALL_DOCTOR_ROLE'),
  capability: required('INSTALL_DOCTOR_CAPABILITY'), network: required('INSTALL_DOCTOR_NETWORK'),
  softwareGroup: required('SOFTWARE_GROUP'), installUser: required('INSTALL_DOCTOR_USER'),
  offline: boolean('INSTALL_DOCTOR_OFFLINE'), concurrency, selectedPackages, selectedServices,
  selectedSupportedPaths, lazyResolverRequirements,
  consents: { privileged: boolean('INSTALL_DOCTOR_CONSENT_PRIVILEGED'), network: boolean('INSTALL_DOCTOR_CONSENT_NETWORK'), bestEffort: boolean('INSTALL_DOCTOR_CONSENT_BEST_EFFORT') },
  platformAdmission: {
    policyRevision: 'platform-support-matrix-v1', cellId: required('INSTALL_DOCTOR_PLATFORM_CELL'),
    status: required('INSTALL_DOCTOR_PLATFORM_STATUS'), os: required('INSTALL_DOCTOR_PLATFORM_OS'),
    release: required('INSTALL_DOCTOR_PLATFORM_RELEASE'), arch: required('INSTALL_DOCTOR_PLATFORM_ARCH'),
    environment: required('INSTALL_DOCTOR_PLATFORM_ENVIRONMENT'), role: required('INSTALL_DOCTOR_PLATFORM_ROLE'),
    limitation: required('INSTALL_DOCTOR_PLATFORM_LIMITATION'),
  },
  privilegeContext: { sudoPreexisting: boolean('INSTALL_DOCTOR_SUDO_PREEXISTING') },
  desiredStateAuthority: process.env.DESKTOP_TOOLS_PROFILE_ID ? {
    profileId: required('DESKTOP_TOOLS_PROFILE_ID'), profileRevision: required('DESKTOP_TOOLS_PROFILE_REVISION'),
    profileDigest: required('DESKTOP_TOOLS_PROFILE_DIGEST'), machineId: required('DESKTOP_TOOLS_MACHINE_ID'),
  } : null,
  createdAt: new Date().toISOString(),
};
fs.writeFileSync(path, `${JSON.stringify(plan)}\n`, { mode: 0o600, flag: 'wx' });
NODE
  then
    rm -f -- "$PLAN_TMP"
    logg error 'Unable to create the validated install plan'
    return 2
  fi
  mv "$PLAN_TMP" "$PLAN_FILE"
  export INSTALL_DOCTOR_PLAN="$PLAN_FILE"
  INSTALL_DOCTOR_PLAN_CREATED=1
  export INSTALL_DOCTOR_PLAN_CREATED
  logg info "Install plan saved to $PLAN_FILE"
}

configureInstallPlan() {
  idNormalizeHeadlessMode || return $?
  if [ -n "${INSTALL_DOCTOR_PLAN:-}" ]; then
    if [ "${INSTALL_DOCTOR_PLAN_CREATED:-0}" = 1 ] && [ -f "$INSTALL_DOCTOR_PLAN" ]; then return 0; fi
    logg error 'Caller-supplied install plans are not accepted until their approval digest is verified by the canonical engine'
    return 2
  fi
  INSTALL_DOCTOR_ROLE="${INSTALL_DOCTOR_ROLE:-$(detect_role 2>/dev/null || detect_os)}"
  INSTALL_DOCTOR_CAPABILITY="${INSTALL_DOCTOR_CAPABILITY:-developer}"
  INSTALL_DOCTOR_NETWORK="${INSTALL_DOCTOR_NETWORK:-none}"
  INSTALL_DOCTOR_CONCURRENCY="${INSTALL_DOCTOR_CONCURRENCY:-4}"
  INSTALL_DOCTOR_CONSENT_PRIVILEGED="${INSTALL_DOCTOR_CONSENT_PRIVILEGED:-false}"
  INSTALL_DOCTOR_CONSENT_NETWORK="${INSTALL_DOCTOR_CONSENT_NETWORK:-false}"
  INSTALL_DOCTOR_CONSENT_BEST_EFFORT="${INSTALL_DOCTOR_CONSENT_BEST_EFFORT:-false}"
  if sudo -n true >/dev/null 2>&1; then INSTALL_DOCTOR_SUDO_PREEXISTING=true
  else INSTALL_DOCTOR_SUDO_PREEXISTING=false; fi
  INSTALL_DOCTOR_OFFLINE="${INSTALL_DOCTOR_OFFLINE:-false}"
  INSTALL_DOCTOR_SELECTED_PACKAGES="${INSTALL_DOCTOR_SELECTED_PACKAGES:-}"
  INSTALL_DOCTOR_SELECTED_SERVICES="${INSTALL_DOCTOR_SELECTED_SERVICES:-}"
  INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS="${INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS:-}"
  INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS="${INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS:-}"
  if [ -z "${INSTALL_DOCTOR_USER:-}" ]; then
    if [ "$(id -u)" -eq 0 ]; then INSTALL_DOCTOR_USER="${SUDO_USER:-install-doctor}"
    else INSTALL_DOCTOR_USER="$(id -un)"; fi
  fi
  SOFTWARE_GROUP="${SOFTWARE_GROUP:-Full}"

  if [ -z "${HEADLESS_INSTALL:-}" ] && command -v gum >/dev/null 2>&1 && [ -t 0 ]; then
    gum style --border rounded --border-foreground '#00E5FF' --foreground '#00E5FF' --padding '1 3' 'INSTALL.DOCTOR' 'Fast, explicit fleet provisioning'
    INSTALL_DOCTOR_ROLE="$(gum choose --header 'Machine role' workstation server proxmox coolify qubes container custom --selected "$INSTALL_DOCTOR_ROLE")"
    INSTALL_DOCTOR_CAPABILITY="$(gum choose --header 'Capability bundle' developer ai web media security minimal --selected "$INSTALL_DOCTOR_CAPABILITY")"
    INSTALL_DOCTOR_NETWORK="$(gum choose --header 'Network enrollment' none cloudflare-warp cloudflare-tunnel ssh --selected "$INSTALL_DOCTOR_NETWORK")"
    if gum confirm 'Allow reviewed privileged system changes?'; then INSTALL_DOCTOR_CONSENT_PRIVILEGED=true; fi
    if [ "$INSTALL_DOCTOR_NETWORK" != none ] && gum confirm "Apply $INSTALL_DOCTOR_NETWORK network configuration?"; then
      INSTALL_DOCTOR_CONSENT_NETWORK=true
    else
      INSTALL_DOCTOR_NETWORK=none
    fi
  elif [ -z "${HEADLESS_INSTALL:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '\033[48;2;6;6;16m\033[38;2;0;229;255m ✦ INSTALL.DOCTOR // PLAN ✦ \033[0m\n'
    printf 'Machine role [%s]: ' "$INSTALL_DOCTOR_ROLE" > /dev/tty
    read -r PLAN_ROLE < /dev/tty || true
    [ -z "${PLAN_ROLE:-}" ] || INSTALL_DOCTOR_ROLE="$PLAN_ROLE"
    printf 'Capability (developer/ai/web/media/security/minimal) [%s]: ' "$INSTALL_DOCTOR_CAPABILITY" > /dev/tty
    read -r PLAN_CAPABILITY < /dev/tty || true
    [ -z "${PLAN_CAPABILITY:-}" ] || INSTALL_DOCTOR_CAPABILITY="$PLAN_CAPABILITY"
    printf 'Allow reviewed privileged system changes? [y/N]: ' > /dev/tty
    PLAN_PRIVILEGED=""
    read -r -t 30 PLAN_PRIVILEGED < /dev/tty || true
    case "$PLAN_PRIVILEGED" in y|Y|yes|YES) INSTALL_DOCTOR_CONSENT_PRIVILEGED=true ;; esac
  fi
  if [ "${INSTALL_DOCTOR_PLATFORM_STATUS:-}" = best-effort ] && [ "$INSTALL_DOCTOR_CONSENT_BEST_EFFORT" != true ]; then
    if [ -z "${HEADLESS_INSTALL:-}" ] && command -v gum >/dev/null 2>&1 && [ -t 0 ]; then
      gum confirm "This platform is best-effort: ${INSTALL_DOCTOR_PLATFORM_LIMITATION:-limitations apply}. Continue?" && INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true
    elif [ -z "${HEADLESS_INSTALL:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
      printf 'This platform is best-effort: %s Continue? [y/N]: ' "${INSTALL_DOCTOR_PLATFORM_LIMITATION:-limitations apply}." > /dev/tty
      PLAN_BEST_EFFORT=""
      read -r -t 30 PLAN_BEST_EFFORT < /dev/tty || true
      case "$PLAN_BEST_EFFORT" in y|Y|yes|YES) INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true ;; esac
    fi
  fi
  case "$INSTALL_DOCTOR_ROLE" in workstation|server|proxmox|coolify|qubes|container|custom|macos|ubuntu|debian|fedora|silverblue|alpine|arch|qubes-dom0|qubes-appvm|wsl) ;; *) logg error "Invalid INSTALL_DOCTOR_ROLE: $INSTALL_DOCTOR_ROLE"; return 2 ;; esac
  case "$INSTALL_DOCTOR_CAPABILITY" in developer|ai|web|media|security|minimal) ;; *) logg error "Invalid INSTALL_DOCTOR_CAPABILITY: $INSTALL_DOCTOR_CAPABILITY"; return 2 ;; esac
  case "$INSTALL_DOCTOR_NETWORK" in none|cloudflare-warp|cloudflare-tunnel|ssh) ;; *) logg error "Invalid INSTALL_DOCTOR_NETWORK: $INSTALL_DOCTOR_NETWORK"; return 2 ;; esac
  case "$INSTALL_DOCTOR_CONSENT_PRIVILEGED:$INSTALL_DOCTOR_CONSENT_NETWORK:$INSTALL_DOCTOR_CONSENT_BEST_EFFORT:$INSTALL_DOCTOR_OFFLINE" in
    true:true:true:true|true:true:true:false|true:true:false:true|true:true:false:false|true:false:true:true|true:false:true:false|true:false:false:true|true:false:false:false|false:true:true:true|false:true:true:false|false:true:false:true|false:true:false:false|false:false:true:true|false:false:true:false|false:false:false:true|false:false:false:false) ;;
    *) logg error 'Install consent and offline values must be true or false'; return 2 ;;
  esac
  case "$INSTALL_DOCTOR_CONCURRENCY" in ''|*[!0-9]*) logg error 'INSTALL_DOCTOR_CONCURRENCY must be a positive integer'; return 2 ;; esac
  [ "$INSTALL_DOCTOR_CONCURRENCY" -ge 1 ] || { logg error 'INSTALL_DOCTOR_CONCURRENCY must be at least 1'; return 2; }
  [ "$INSTALL_DOCTOR_CONCURRENCY" -le 16 ] || { logg error 'INSTALL_DOCTOR_CONCURRENCY must not exceed 16'; return 2; }
  case "$INSTALL_DOCTOR_USER" in ''|*[!a-zA-Z0-9._-]*|[0-9.-]*) logg error 'INSTALL_DOCTOR_USER is invalid'; return 2 ;; esac
  case "$INSTALL_DOCTOR_SELECTED_PACKAGES:$INSTALL_DOCTOR_SELECTED_SERVICES:$INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS" in *[!a-z0-9._,:-]*) logg error 'Selected packages, services, and resolver requirements must be comma-separated catalog keys'; return 2 ;; esac
  case "$INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS" in *[!a-z0-9._,-]*) logg error 'INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS must be a comma-separated list of identifiers'; return 2 ;; esac
  if [ "$INSTALL_DOCTOR_CONSENT_PRIVILEGED" != true ]; then
    logg error 'Provisioning requires explicit consent for reviewed privileged changes; set INSTALL_DOCTOR_CONSENT_PRIVILEGED=true in noninteractive mode'
    return 2
  fi
  export INSTALL_DOCTOR_ROLE INSTALL_DOCTOR_CAPABILITY INSTALL_DOCTOR_NETWORK INSTALL_DOCTOR_CONCURRENCY INSTALL_DOCTOR_OFFLINE INSTALL_DOCTOR_USER INSTALL_DOCTOR_SELECTED_SERVICES INSTALL_DOCTOR_SELECTED_PACKAGES SOFTWARE_GROUP
  export INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS
  export INSTALL_DOCTOR_CONSENT_PRIVILEGED INSTALL_DOCTOR_CONSENT_NETWORK INSTALL_DOCTOR_CONSENT_BEST_EFFORT INSTALL_DOCTOR_SUDO_PREEXISTING
  writeInstallPlan
}

initChezmoiAndPrompt() {
  ### Show `chezmoi-intro.md` with `glow` (non-blocking)
  if command -v glow > /dev/null; then
    glow "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/docs/terminal/chezmoi-intro.md"
  fi

  ### Set the software group - defaults to "Full" if not specified
  if [ -z "$SOFTWARE_GROUP" ]; then
    SOFTWARE_GROUP="Full"
    export SOFTWARE_GROUP
  fi
  logg info "Software group set to: $SOFTWARE_GROUP"

  if [ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml" ]; then
    ### Run `chezmoi init` when the Chezmoi configuration is missing
    logg info "Running chezmoi init since ${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml is not present"
    if [ -n "$HEADLESS_INSTALL" ]; then
      idChezmoi init --force
    else
      idChezmoi init
    fi
  fi
}

idChezmoi() {
  [ -n "${INSTALL_DOCTOR_CHEZMOI_SOURCE:-}" ] || { logg error 'Verified Chezmoi source is unavailable'; return 2; }
  loadHomebrew
  command -v chezmoi >/dev/null 2>&1 || { logg error 'Chezmoi is unavailable after loading Homebrew'; return 2; }
  chezmoi --source "$INSTALL_DOCTOR_CHEZMOI_SOURCE" "$@"
}

# @description Runs `chezmoi apply` with appropriate flags and logging.
#     - Logs output to `$HOME/.local/var/log/install.doctor/chezmoi-apply-<timestamp>.log`
#     - Adds the `--force` flag when `HEADLESS_INSTALL` is set (skips all chezmoi prompts)
#     - Adds `-k` (keep going) flag to continue on errors
#     - Adds debug flags (`-vvv --debug --verbose`) when `DEBUG_MODE` or `DEBUG` is set
#     - On macOS, uses `caffeinate` to prevent system sleep during provisioning
#     - Uses `unbuffer` when available for cleaner log output
#     - Reports macOS-specific exit code 140 without rebooting outside the engine
#
#     @envvar HEADLESS_INSTALL  If set, adds --force flag to chezmoi apply
#     @envvar KEEP_GOING  If set, adds -k flag to continue past errors
#     @envvar DEBUG_MODE  If set, enables verbose debug output
#     @envvar DEBUG  Alternative to DEBUG_MODE
runChezmoi() {
  local CHEZMOI_EXIT_CODE=0
  [ -n "${INSTALL_DOCTOR_CHEZMOI_SOURCE:-}" ] || { logg error 'Verified Chezmoi source is unavailable'; return 2; }
  loadHomebrew
  command -v chezmoi >/dev/null 2>&1 || { logg error 'Chezmoi is unavailable after loading Homebrew'; return 2; }
  local -a CHEZMOI_COMMAND=(chezmoi --source "$INSTALL_DOCTOR_CHEZMOI_SOURCE" apply --no-pager)
  ### Set up logging
  mkdir -p "$HOME/.local/var/log/install.doctor"
  LOG_FILE="$HOME/.local/var/log/install.doctor/chezmoi-apply-$(date +%s).log"

  ### Apply command flags
  if [ -n "$HEADLESS_INSTALL" ]; then
    logg info 'Running chezmoi apply forcefully because HEADLESS_INSTALL is set'
    CHEZMOI_COMMAND+=(--force)
  fi
  # TODO: https://github.com/twpayne/chezmoi/discussions/3448
  if [ -n "$KEEP_GOING" ]; then
    logg info 'Instructing chezmoi to keep going in the case of errors because KEEP_GOING is set'
    CHEZMOI_COMMAND+=(-k)
  fi
  if [ -n "$DEBUG_MODE" ] || [ -n "$DEBUG" ]; then
    logg info "Either DEBUG_MODE or DEBUG environment variables were set so Chezmoi will be run in debug mode"
    CHEZMOI_COMMAND+=(-vvv --debug --verbose)
  fi

  logg info 'Applying the selected desired state from the verified immutable source'
  if [ "$(detect_os)" = macos ] && command -v caffeinate >/dev/null 2>&1; then
    caffeinate "${CHEZMOI_COMMAND[@]}" 2>&1 | tee "$LOG_FILE" || CHEZMOI_EXIT_CODE=$?
  else
    "${CHEZMOI_COMMAND[@]}" 2>&1 | tee "$LOG_FILE" || CHEZMOI_EXIT_CODE=$?
  fi

  ### Handle exit codes in log
  if [ -f "$LOG_FILE" ] && grep -q 'chezmoi: exit status 140' "$LOG_FILE"; then
    logg warn "Chezmoi signalled that a reboot is necessary; Install Doctor will never restart the host outside the approved engine boundary"
  fi

  ### Handle actual process exit code
  if [ "$CHEZMOI_EXIT_CODE" -ne 0 ]; then
    logg error "Chezmoi encountered an error and exited with an exit code of $CHEZMOI_EXIT_CODE"
    return "$CHEZMOI_EXIT_CODE"
  else
    logg info 'Finished provisioning the system'
  fi
}

# Admit the generated catalog through one FD before it can influence a plan.
# Signed remote launches must carry the stage-zero path and digest. A local
# developer checkout may derive them only from the exact clean source commit.
idAdmitVerifiedCatalog() {
  local STATE_ROOT="$1" SOURCE_PATH="${INSTALL_DOCTOR_CATALOG_PATH:-}" EXPECTED_SHA="${INSTALL_DOCTOR_CATALOG_SHA256:-}"
  local SOURCE_ROOT COMMIT BLOB ACTUAL_BLOB MODE=remote ADMITTED
  if { [ -n "$SOURCE_PATH" ] && [ -z "$EXPECTED_SHA" ]; } || { [ -z "$SOURCE_PATH" ] && [ -n "$EXPECTED_SHA" ]; }; then
    logg error 'Catalog path and digest must be supplied together'
    return 2
  fi
  if [ -z "$SOURCE_PATH" ]; then
    if [ -n "${INSTALL_DOCTOR_VERIFIED_MANIFEST:-}${INSTALL_DOCTOR_VERIFIED_SIGNATURE:-}${INSTALL_DOCTOR_ARTIFACT_SHA256:-}" ]; then
      logg error 'Signed remote bootstrap requires INSTALL_DOCTOR_CATALOG_PATH and INSTALL_DOCTOR_CATALOG_SHA256'
      return 2
    fi
    MODE=local
    SOURCE_ROOT="$(dirname "${INSTALL_DOCTOR_CHEZMOI_SOURCE:-}")"
    COMMIT="${INSTALL_DOCTOR_SOURCE_COMMIT:-}"
    case "$COMMIT" in ''|*[!0-9a-f]*) logg error 'Local catalog derivation requires a full source commit'; return 2 ;; esac
    [ "${#COMMIT}" -eq 40 ] && [ -d "$SOURCE_ROOT/.git" ] && [ ! -L "$SOURCE_ROOT" ] \
      || { logg error 'Local catalog derivation requires the verified source checkout'; return 2; }
    [ "$(git -C "$SOURCE_ROOT" rev-parse HEAD 2>/dev/null)" = "$COMMIT" ] \
      && [ -z "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=all 2>/dev/null)" ] \
      || { logg error 'Local catalog checkout is not the exact clean source commit'; return 2; }
    SOURCE_PATH="$SOURCE_ROOT/packages/control-plane/src/catalog.json"
    BLOB="$(git -C "$SOURCE_ROOT" rev-parse "$COMMIT:packages/control-plane/src/catalog.json" 2>/dev/null)" \
      || { logg error 'The source commit does not contain the generated catalog'; return 2; }
    ACTUAL_BLOB="$(git -C "$SOURCE_ROOT" hash-object -- "$SOURCE_PATH" 2>/dev/null)" \
      || { logg error 'Unable to bind the local catalog to its source commit'; return 2; }
    [ "$ACTUAL_BLOB" = "$BLOB" ] || { logg error 'Local catalog bytes differ from the source commit'; return 2; }
    EXPECTED_SHA="$(idSha256File "$SOURCE_PATH")" || return 2
  fi
  case "$SOURCE_PATH" in /*) ;; *) logg error 'Verified catalog path must be absolute'; return 2 ;; esac
  case "$EXPECTED_SHA" in *[!a-f0-9]*|'') logg error 'Verified catalog SHA-256 is malformed'; return 2 ;; esac
  [ "${#EXPECTED_SHA}" -eq 64 ] || { logg error 'Verified catalog SHA-256 is malformed'; return 2; }
  mkdir -p "$STATE_ROOT/catalogs" || return 1
  chmod 0700 "$STATE_ROOT/catalogs" || return 1
  ADMITTED="$(node - "$SOURCE_PATH" "$EXPECTED_SHA" "$STATE_ROOT/catalogs" "$MODE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [source, expected, destination, mode] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
if (!path.isAbsolute(source)) fail('catalog path must be absolute');
const before = fs.lstatSync(source, { bigint: true });
if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail('catalog must be a single-linked regular non-symlink file');
if (typeof process.geteuid !== 'function' || before.uid !== BigInt(process.geteuid())) fail('catalog must be owned by the current user');
const permissions = Number(before.mode & 0o777n);
if ((mode === 'remote' && (permissions & 0o077) !== 0) || (mode === 'local' && (permissions & 0o022) !== 0)) fail('catalog permissions are unsafe');
if (before.size < 2n || before.size > 16n * 1024n * 1024n) fail('catalog size is outside the 2 byte to 16 MiB boundary');
const nofollow = fs.constants.O_NOFOLLOW || 0;
const fd = fs.openSync(source, fs.constants.O_RDONLY | nofollow);
let bytes;
try {
  const opened = fs.fstatSync(fd, { bigint: true });
  if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n || opened.size !== before.size
    || opened.uid !== before.uid || opened.mode !== before.mode) fail('catalog changed while being opened');
  bytes = Buffer.alloc(Number(opened.size));
  let offset = 0;
  while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) fail('catalog was truncated while reading'); offset += count; }
  const after = fs.fstatSync(fd, { bigint: true });
  if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1n || after.size !== opened.size
    || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) fail('catalog changed while being read');
} finally { fs.closeSync(fd); }
const actual = crypto.createHash('sha256').update(bytes).digest('hex');
if (actual !== expected) fail('catalog SHA-256 does not match stage-zero authority');
let catalog;
try { catalog = JSON.parse(bytes.toString('utf8')); } catch { fail('catalog is not valid JSON'); }
if (!Array.isArray(catalog) || catalog.length > 16384) fail('catalog must be an array with at most 16384 entries');
const finalPath = path.join(destination, `${actual}.json`);
const validateFinal = () => {
  const info = fs.lstatSync(finalPath, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.uid !== BigInt(process.geteuid()) || (Number(info.mode & 0o777n) & 0o077) !== 0
    || info.size !== BigInt(bytes.length) || !fs.readFileSync(finalPath).equals(bytes)) fail('existing admitted catalog is unsafe or inconsistent');
};
if (fs.existsSync(finalPath)) validateFinal();
else {
  const temporary = path.join(destination, `.${actual}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    const output = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    try { fs.writeFileSync(output, bytes); fs.fsyncSync(output); } finally { fs.closeSync(output); }
    try { fs.linkSync(temporary, finalPath); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    fs.unlinkSync(temporary);
    validateFinal();
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
process.stdout.write(finalPath);
NODE
)" || { logg error 'Verified catalog admission failed'; return 2; }
  INSTALL_DOCTOR_CATALOG_PATH="$ADMITTED"
  INSTALL_DOCTOR_CATALOG_SHA256="$EXPECTED_SHA"
  export INSTALL_DOCTOR_CATALOG_PATH INSTALL_DOCTOR_CATALOG_SHA256
}

# @description Normalize the offline selector before any input, sudo, network,
#     agent, or ordinary desired-state work can occur.
idNormalizeOfflineMode() {
  case "${INSTALL_DOCTOR_OFFLINE:-false}" in
    true|false) ;;
    *) logg error 'INSTALL_DOCTOR_OFFLINE must be exactly true or false'; return 2 ;;
  esac
  export INSTALL_DOCTOR_OFFLINE
}

# @description Execute an independently authorized signed offline bundle. The
#     authority document is the sole approval source; bundle metadata is never
#     allowed to approve itself. Failure is terminal and never falls back to the
#     ordinary provisioning graph.
runOfflineBundleProvisioning() {
  local ENGINE="${INSTALL_DOCTOR_ENGINE_PATH:-}" RUNTIME="${INSTALL_DOCTOR_RUNTIME_NODE:-}"
  local BUNDLE="${INSTALL_DOCTOR_OFFLINE_BUNDLE_DIR:-}" AUTHORITY="${INSTALL_DOCTOR_OFFLINE_AUTHORITY_PATH:-}"
  local MODE="${INSTALL_DOCTOR_OFFLINE_MODE:-execute}" RUN_ID="${INSTALL_DOCTOR_OFFLINE_RUN_ID:-}"
  local RENDERER="${INSTALL_DOCTOR_RENDERER:-}" STATE_BASE INVOCATION_DIR VERIFY_INPUT PLAN_INPUT PLAN_OUTPUT
  local APPLY_INPUT EXECUTE_INPUT MATERIALIZED_ROOT ENGINE_STATE MANIFEST_DIGEST ACTUAL_SHA STATUS
  [ -n "$ENGINE" ] && [ -f "$ENGINE" ] && [ ! -L "$ENGINE" ] || { logg error 'Verified installer engine is unavailable'; return 2; }
  [ -n "$RUNTIME" ] && [ -f "$RUNTIME" ] && [ ! -L "$RUNTIME" ] && [ -x "$RUNTIME" ] \
    || { logg error 'Verified installer Node runtime is unavailable'; return 2; }
  [ -n "$BUNDLE" ] && [ "${BUNDLE#/}" != "$BUNDLE" ] && [ -d "$BUNDLE" ] && [ ! -L "$BUNDLE" ] \
    || { logg error 'Offline bundle directory must be an absolute real directory'; return 2; }
  [ -n "$AUTHORITY" ] && [ "${AUTHORITY#/}" != "$AUTHORITY" ] && [ -f "$AUTHORITY" ] && [ ! -L "$AUTHORITY" ] \
    || { logg error 'Offline authority must be an absolute regular file'; return 2; }
  case "$MODE" in execute|resume) ;; *) logg error 'Offline mode must be execute or resume'; return 2 ;; esac
  case "$RUN_ID" in ''|*[!A-Za-z0-9._-]*) logg error 'Offline run identifier is missing or invalid'; return 2 ;; esac
  if [ -z "$RENDERER" ]; then
    if [ -n "${HEADLESS_INSTALL:-}" ] || [ ! -t 1 ]; then RENDERER=headless; else RENDERER=tui; fi
  fi
  case "$RENDERER" in plain|json|ndjson|headless|ci|tui) ;; *) logg error 'Offline renderer is invalid'; return 2 ;; esac
  ACTUAL_SHA="$(idSha256File "$ENGINE")" || return 2
  [ -n "${INSTALL_DOCTOR_ENGINE_SHA256:-}" ] && [ "$ACTUAL_SHA" = "$INSTALL_DOCTOR_ENGINE_SHA256" ] \
    || { logg error 'Installer engine checksum changed after release verification'; return 2; }

  STATE_BASE="${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor/offline"
  [ ! -L "$STATE_BASE" ] && [ ! -L "$STATE_BASE/invocations" ] && [ ! -L "$STATE_BASE/materialized" ] \
    && [ ! -L "$STATE_BASE/engine" ] || { logg error 'Offline state paths must not be symbolic links'; return 2; }
  umask 077
  mkdir -p "$STATE_BASE/invocations" || return 1
  chmod 0700 "$STATE_BASE" "$STATE_BASE/invocations" || return 1
  INVOCATION_DIR="$(mktemp -d "$STATE_BASE/invocations/bundle.XXXXXX")" || return 1
  chmod 0700 "$INVOCATION_DIR" || { rmdir "$INVOCATION_DIR" 2>/dev/null || true; return 1; }
  VERIFY_INPUT="$INVOCATION_DIR/verify.json"; PLAN_INPUT="$INVOCATION_DIR/plan.json"; PLAN_OUTPUT="$INVOCATION_DIR/plan-output.json"
  APPLY_INPUT="$INVOCATION_DIR/apply.json"; EXECUTE_INPUT="$INVOCATION_DIR/execute.json"

  "$RUNTIME" - "$AUTHORITY" "$BUNDLE" "$VERIFY_INPUT" "$PLAN_INPUT" <<'NODE' || { rm -rf -- "$INVOCATION_DIR"; return 2; }
const fs = require('node:fs');
const [authorityPath,bundleDirectory,verifyPath,planPath]=process.argv.slice(2);
const stat=fs.lstatSync(authorityPath); const uid=process.getuid?.();
if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o022)!==0||(stat.uid!==0&&stat.uid!==uid)) throw new Error('offline authority file is unsafe');
const a=JSON.parse(fs.readFileSync(authorityPath,'utf8'));
const keys=Object.keys(a).sort().join(',');
if(keys!=='approvedManifestDigest,approvedPlanDigest,expected,releaseTrust,trust') throw new Error('offline authority fields are invalid');
const write=(path,value)=>fs.writeFileSync(path,`${JSON.stringify(value)}\n`,{mode:0o600,flag:'wx'});
write(verifyPath,{schemaVersion:2,command:'bundle-verify',bundleDirectory,trust:a.trust,releaseTrust:a.releaseTrust});
write(planPath,{schemaVersion:2,command:'bundle-plan',bundleDirectory,trust:a.trust,releaseTrust:a.releaseTrust,expected:a.expected});
NODE
  env -i HOME="$HOME" PATH="/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" "$RUNTIME" "$ENGINE" --input "$VERIFY_INPUT" >/dev/null \
    || { STATUS=$?; rm -rf -- "$INVOCATION_DIR"; return "$STATUS"; }
  env -i HOME="$HOME" PATH="/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" "$RUNTIME" "$ENGINE" --input "$PLAN_INPUT" > "$PLAN_OUTPUT" \
    || { STATUS=$?; rm -rf -- "$INVOCATION_DIR"; return "$STATUS"; }
  MANIFEST_DIGEST="$("$RUNTIME" - "$AUTHORITY" "$PLAN_OUTPUT" <<'NODE'
const fs=require('node:fs'); const [aPath,pPath]=process.argv.slice(2); const a=JSON.parse(fs.readFileSync(aPath)); const p=JSON.parse(fs.readFileSync(pPath));
if(p.manifestDigest!==a.approvedManifestDigest||p.manifest?.planDigest!==a.approvedPlanDigest) throw new Error('offline approval digest mismatch');
process.stdout.write(p.manifestDigest);
NODE
)" || { rm -rf -- "$INVOCATION_DIR"; logg error 'Offline bundle does not match exact approval'; return 2; }
  MATERIALIZED_ROOT="$STATE_BASE/materialized/$MANIFEST_DIGEST"; ENGINE_STATE="$STATE_BASE/engine"
  if [ "$MODE" = execute ] && [ ! -e "$MATERIALIZED_ROOT" ]; then
    mkdir -p "$STATE_BASE/materialized" || { rm -rf -- "$INVOCATION_DIR"; return 1; }
    "$RUNTIME" - "$AUTHORITY" "$BUNDLE" "$MATERIALIZED_ROOT" "$APPLY_INPUT" <<'NODE' || { rm -rf -- "$INVOCATION_DIR"; return 2; }
const fs=require('node:fs'); const [aPath,bundleDirectory,destinationDirectory,out]=process.argv.slice(2); const a=JSON.parse(fs.readFileSync(aPath));
fs.writeFileSync(out,`${JSON.stringify({schemaVersion:2,command:'bundle-apply',bundleDirectory,destinationDirectory,trust:a.trust,releaseTrust:a.releaseTrust,expected:a.expected,approvedManifestDigest:a.approvedManifestDigest,offline:true,networkPolicy:'deny'})}\n`,{mode:0o600,flag:'wx'});
NODE
    env -i HOME="$HOME" PATH="/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" "$RUNTIME" "$ENGINE" --input "$APPLY_INPUT" >/dev/null \
      || { STATUS=$?; rm -rf -- "$INVOCATION_DIR"; return "$STATUS"; }
  fi
  "$RUNTIME" - "$AUTHORITY" "$BUNDLE" "$MATERIALIZED_ROOT" "$ENGINE_STATE" "$RUN_ID" "$RENDERER" "$MODE" "$EXECUTE_INPUT" <<'NODE' || { rm -rf -- "$INVOCATION_DIR"; return 2; }
const fs=require('node:fs'); const [aPath,bundleDirectory,materializedRoot,stateRoot,runId,renderer,mode,out]=process.argv.slice(2); const a=JSON.parse(fs.readFileSync(aPath));
fs.writeFileSync(out,`${JSON.stringify({schemaVersion:2,command:mode==='resume'?'bundle-resume':'bundle-execute',runId,bundleDirectory,materializedRoot,stateRoot,trust:a.trust,releaseTrust:a.releaseTrust,expected:a.expected,approvedManifestDigest:a.approvedManifestDigest,approvedPlanDigest:a.approvedPlanDigest,renderer,offline:true,networkPolicy:'deny'})}\n`,{mode:0o600,flag:'wx'});
NODE
  env -i HOME="$HOME" PATH="/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" "$RUNTIME" "$ENGINE" --input "$EXECUTE_INPUT"
  STATUS=$?
  rm -rf -- "$INVOCATION_DIR"
  return "$STATUS"
}

# @description Persist the exact signed Desktop Tools runtime closure before
#     stage-zero removes its private download directory. This installs no
#     service and requires no inference credential; it only makes the verified
#     OpenCode, supervisor, tools, and lock artifacts durable for the enrolled
#     user. Legacy releases do not carry this closure and remain unchanged.
idInstallDesktopToolsRuntimeClosure() {
  local RUNTIME="${INSTALL_DOCTOR_RUNTIME_NODE:-}" SUPERVISOR="${DESKTOP_TOOLS_SUPERVISOR_PATH:-}" RESULT EXECUTABLE CHANGED
  if [ -z "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}${DESKTOP_TOOLS_OPENCODE_SHA256:-}${DESKTOP_TOOLS_OPENCODE_VERSION:-}${SUPERVISOR}${DESKTOP_TOOLS_SUPERVISOR_SHA256:-}${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}${DESKTOP_TOOLS_TOOLS_SHA256:-}${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}${DESKTOP_TOOLS_OPENCODE_LOCK_SHA256:-}" ]; then
    return 0
  fi
  [ -n "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}" ] && [ -n "${DESKTOP_TOOLS_OPENCODE_SHA256:-}" ] \
    && [ -n "${DESKTOP_TOOLS_OPENCODE_VERSION:-}" ] && [ -n "$SUPERVISOR" ] \
    && [ -n "${DESKTOP_TOOLS_SUPERVISOR_SHA256:-}" ] && [ -n "${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}" ] \
    && [ -n "${DESKTOP_TOOLS_TOOLS_SHA256:-}" ] && [ -n "${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}" ] \
    && [ -n "${DESKTOP_TOOLS_OPENCODE_LOCK_SHA256:-}" ] \
    || { logg error 'Desktop Tools runtime closure is incomplete'; return 2; }
  [ -x "$RUNTIME" ] && [ -f "$RUNTIME" ] && [ ! -L "$RUNTIME" ] \
    || { logg error 'Verified Node runtime is unavailable for Desktop Tools runtime installation'; return 2; }
  [ -f "$SUPERVISOR" ] && [ ! -L "$SUPERVISOR" ] \
    || { logg error 'Verified Desktop Tools supervisor is unavailable'; return 2; }
  RESULT="$("$RUNTIME" "$SUPERVISOR" install \
    --runtime-archive "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}" \
    --sha256 "${DESKTOP_TOOLS_OPENCODE_SHA256:-}" \
    --version "${DESKTOP_TOOLS_OPENCODE_VERSION:-}" \
    --supervisor "$SUPERVISOR" \
    --supervisor-sha256 "${DESKTOP_TOOLS_SUPERVISOR_SHA256:-}" \
    --tools-archive "${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}" \
    --tools-sha256 "${DESKTOP_TOOLS_TOOLS_SHA256:-}" \
    --lock "${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}" \
    --lock-sha256 "${DESKTOP_TOOLS_OPENCODE_LOCK_SHA256:-}")" || return $?
  EXECUTABLE="$($RUNTIME -e 'const value=JSON.parse(process.argv[1]);if(value.schemaVersion!==1||typeof value.executable!=="string"||!value.executable.startsWith("/")||typeof value.changed!=="boolean"||!/^[a-f0-9]{64}$/.test(value.closureDigest||""))process.exit(2);process.stdout.write(value.executable)' "$RESULT")" \
    || { logg error 'Desktop Tools runtime installer returned invalid evidence'; return 2; }
  CHANGED="$($RUNTIME -e 'process.stdout.write(String(JSON.parse(process.argv[1]).changed))' "$RESULT")" || return 2
  DESKTOP_TOOLS_EXECUTABLE="$EXECUTABLE"
  export DESKTOP_TOOLS_EXECUTABLE
  if [ "$CHANGED" = true ]; then logg success "Installed the verified Desktop Tools runtime at $EXECUTABLE"
  else logg info "Verified the unchanged Desktop Tools runtime at $EXECUTABLE"; fi
}

# @description Execute the desired-state apply through the signed canonical engine.
runCanonicalProvisionEngine() {
  local MODE="${1:-apply}" ENGINE="${INSTALL_DOCTOR_ENGINE_PATH:-}" PROVISIONER INVOCATION INVOCATION_DIR NORMALIZED_PLAN APPROVAL_PLAN EVIDENCE_INVOCATION EVIDENCE_RESULT CLEANUP_EVIDENCE_INVOCATION CLEANUP_EVIDENCE_RESULT RUNS_INVOCATION RUNS_RESULT RESUME_RUN_ID STATE_ROOT NODE_MAJOR EXPECTED_NODE RENDERER GENERATE_STATUS ENGINE_STATUS EVIDENCE_STATUS CLEANUP_EVIDENCE_STATUS PLAN_DIGEST APPROVAL ACTUAL_SHA
  local LOAD_PLAN_INVOCATION LOAD_PLAN_RESULT ARTIFACT_DERIVE_INVOCATION ARTIFACT_DERIVE_RESULT ARTIFACT_CACHE_ROOT USER_BIN_ROOT DOCKER_PLUGIN_ROOT ARTIFACT_COUNT
  local NATIVE_DERIVE_INVOCATION NATIVE_DERIVE_RESULT NATIVE_COUNT
  case "$MODE" in apply|--plan-only) ;; *) logg error "Unknown canonical engine mode: $MODE"; return 2 ;; esac
  [ -n "$ENGINE" ] && [ -f "$ENGINE" ] && [ ! -L "$ENGINE" ] || { logg error 'Verified installer engine is unavailable'; return 2; }
  command -v node >/dev/null 2>&1 || { logg error 'Node.js is required by the verified installer engine'; return 2; }
  NODE_MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  EXPECTED_NODE="${INSTALL_DOCTOR_ENGINE_NODE_MIN:-22}"
  case "$NODE_MAJOR:$EXPECTED_NODE" in *[!0-9:]*) logg error 'Unable to validate the installer engine Node.js requirement'; return 2 ;; esac
  [ "$NODE_MAJOR" -ge "$EXPECTED_NODE" ] || { logg error "Installer engine requires Node.js $EXPECTED_NODE or newer"; return 2; }
  [ -n "${INSTALL_DOCTOR_RELEASE_ID:-}" ] || { logg error 'Verified release identity is required by the canonical engine'; return 2; }
  case "$INSTALL_DOCTOR_RELEASE_ID" in ''|*[!a-zA-Z0-9._-]*) logg error 'Verified release identity is malformed'; return 2 ;; esac
  PROVISIONER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  [ -n "${INSTALL_DOCTOR_ENGINE_SHA256:-}" ] || { logg error 'Verified installer engine checksum is required'; return 2; }
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL_SHA="$(sha256sum "$ENGINE" | awk '{print $1}')";
  elif command -v shasum >/dev/null 2>&1; then ACTUAL_SHA="$(shasum -a 256 "$ENGINE" | awk '{print $1}')";
  else logg error 'A SHA-256 verifier is required by the canonical engine'; return 2; fi
  [ "$ACTUAL_SHA" = "$INSTALL_DOCTOR_ENGINE_SHA256" ] || { logg error 'Installer engine checksum changed after release verification'; return 2; }
  STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor/engine"
  INSTALL_DOCTOR_CHEZMOI_SOURCE="${XDG_DATA_HOME:-$HOME/.local/share}/install.doctor/releases/$INSTALL_DOCTOR_RELEASE_ID/source/home"
  export INSTALL_DOCTOR_CHEZMOI_SOURCE
  [ ! -L "$STATE_ROOT" ] && [ ! -L "$STATE_ROOT/invocations" ] || { logg error 'Installer engine state paths must not be symbolic links'; return 2; }
  mkdir -p "$STATE_ROOT/invocations" || return 1
  chmod 0700 "$STATE_ROOT" "$STATE_ROOT/invocations" || return 1
  idAdmitVerifiedCatalog "$STATE_ROOT" || return $?
  INVOCATION_DIR="$(mktemp -d "$STATE_ROOT/invocations/provision.XXXXXX")" || return 1
  chmod 0700 "$INVOCATION_DIR" || { rmdir "$INVOCATION_DIR" 2>/dev/null || true; return 1; }
  INVOCATION="$INVOCATION_DIR/invocation.json"
  LOAD_PLAN_INVOCATION="$INVOCATION_DIR/load-plan-invocation.json"
  LOAD_PLAN_RESULT="$INVOCATION_DIR/load-plan.json"
  ARTIFACT_DERIVE_INVOCATION="$INVOCATION_DIR/artifact-derive-invocation.json"
  ARTIFACT_DERIVE_RESULT="$INVOCATION_DIR/artifact-derive.json"
  NATIVE_DERIVE_INVOCATION="$INVOCATION_DIR/native-debian-derive-invocation.json"
  NATIVE_DERIVE_RESULT="$INVOCATION_DIR/native-debian-derive.json"
  ARTIFACT_CACHE_ROOT="$STATE_ROOT/artifacts"
  USER_BIN_ROOT="$HOME/.local/bin"
  DOCKER_PLUGIN_ROOT="$HOME/.docker/cli-plugins"
  RENDERER="${INSTALL_DOCTOR_RENDERER:-}"
  if [ -n "${HEADLESS_INSTALL:-}" ]; then
    RENDERER=headless
  elif [ -z "$RENDERER" ]; then
    if [ -t 0 ] && [ -t 1 ] && [ "${TERM:-dumb}" != dumb ]; then RENDERER=tui; else RENDERER=headless; fi
  fi
  case "$RENDERER" in
    plain|json|ndjson|headless|ci|tui) ;;
    *) logg error 'Installer renderer is invalid'; return 2 ;;
  esac
  umask 077
  node - "$LOAD_PLAN_INVOCATION" "${INSTALL_DOCTOR_CATALOG_PATH:?}" <<'NODE'
const fs = require('node:fs');
const [destination, catalogPath] = process.argv.slice(2);
const rawPlan = JSON.parse(fs.readFileSync(process.env.INSTALL_DOCTOR_PLAN, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : process.platform === 'win32' ? 'windows' : process.platform;
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 1, command: 'load-plan', platform, architecture: process.arch,
  roles: [rawPlan.role], selectedPackages: rawPlan.selectedPackages,
  selectedServices: rawPlan.selectedServices, selectedSupportedPaths: rawPlan.selectedSupportedPaths,
  lazyResolverRequirements: rawPlan.lazyResolverRequirements, catalog,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
  GENERATE_STATUS=$?
  if [ "$GENERATE_STATUS" -eq 0 ]; then node "$ENGINE" --input "$LOAD_PLAN_INVOCATION" > "$LOAD_PLAN_RESULT"; GENERATE_STATUS=$?; fi
  [ "$GENERATE_STATUS" -eq 0 ] || { logg error 'Unable to derive the selected catalog load plan'; return "$GENERATE_STATUS"; }
  NATIVE_COUNT="$(node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.items.filter(i => i.name === "tree" && i.selected && i.applicable && i.actions.includes("install") && i.nativePayload).length))' "$LOAD_PLAN_RESULT")" || return 2
  if [ "$NATIVE_COUNT" -gt 0 ] && [ "${INSTALL_DOCTOR_PLATFORM_CELL:-}" = debian-12-x64-native ]; then
    node - "$NATIVE_DERIVE_INVOCATION" "$LOAD_PLAN_RESULT" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const [destination, loadPlanPath] = process.argv.slice(2);
const loadPlan = JSON.parse(fs.readFileSync(loadPlanPath, 'utf8'));
const rawPlan = JSON.parse(fs.readFileSync(process.env.INSTALL_DOCTOR_PLAN, 'utf8'));
const queryPath = '/usr/bin/dpkg-query';
const metadata = fs.lstatSync(queryPath);
if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o111) === 0) {
  throw new Error('native Debian composition requires the protected system dpkg-query');
}
const query = cp.spawnSync(queryPath, ['-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n', 'libc6:amd64'], {
  shell: false, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, timeout: 10_000,
});
if (query.status !== 0 || query.signal !== null || query.stderr !== '') throw new Error('unable to obtain the exact installed libc6 witness');
const fields = query.stdout.trimEnd().split('\t');
if (fields.length !== 4 || fields[0] !== 'libc6:amd64' || fields[2] !== 'amd64' || fields[3] !== 'installed'
  || !/^[0-9A-Za-z.+:~_-]{1,128}$/.test(fields[1])) throw new Error('installed libc6 witness is malformed or unhealthy');
const hostId = String(rawPlan.host.hostname).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 128) || 'host';
const desiredState = {
  schemaVersion: 1, revision: `desired-native-${loadPlan.digest.slice(0, 24)}`, hostId,
  packages: [...new Set(rawPlan.selectedPackages)].sort(), services: [...new Set(rawPlan.selectedServices)].sort(),
  consents: ['package-install'], offline: true,
};
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 1, command: 'native-debian-derive', loadPlan, approvedLoadPlanDigest: loadPlan.digest,
  packageKey: 'tree', target: { distroId: 'debian', versionId: '12', codename: 'bookworm', architecture: 'amd64' },
  installedWitnesses: [{ kind: 'preexisting-witness', manager: 'dpkg', packageName: 'libc6', version: fields[1],
    architecture: 'amd64', status: 'installed', healthy: true, held: false }],
  desiredState, legacyPackages: rawPlan.selectedPackages,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
    GENERATE_STATUS=$?
    if [ "$GENERATE_STATUS" -eq 0 ]; then node "$ENGINE" --input "$NATIVE_DERIVE_INVOCATION" > "$NATIVE_DERIVE_RESULT"; GENERATE_STATUS=$?; fi
    [ "$GENERATE_STATUS" -eq 0 ] || { logg error 'Unable to compose the selected native Debian package'; return "$GENERATE_STATUS"; }
  else
    printf '%s\n' '{"schemaVersion":1,"composition":null}' > "$NATIVE_DERIVE_RESULT"
  fi
  ARTIFACT_COUNT="$(node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.items.filter(i => i.selected && i.applicable && i.actions.includes("install") && i.artifact).length))' "$LOAD_PLAN_RESULT")" || return 2
  if [ "$ARTIFACT_COUNT" -gt 0 ]; then
    node - "$ARTIFACT_DERIVE_INVOCATION" "$LOAD_PLAN_RESULT" "$ARTIFACT_CACHE_ROOT" "$USER_BIN_ROOT" "$DOCKER_PLUGIN_ROOT" <<'NODE'
const fs = require('node:fs');
const [destination, loadPlanPath, cacheRoot, userBinRoot, dockerPluginRoot] = process.argv.slice(2);
const loadPlan = JSON.parse(fs.readFileSync(loadPlanPath, 'utf8'));
const items = loadPlan.items.filter(item => item.selected && item.applicable && item.actions.includes('install') && item.artifact);
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 1, command: 'artifact-derive', loadPlan, items, approvedLoadPlanDigest: loadPlan.digest,
  host: { os: process.platform, arch: process.arch }, cacheRoot,
  destinationRoots: { 'user-bin': userBinRoot, 'docker-cli-plugin': dockerPluginRoot },
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
    GENERATE_STATUS=$?
    if [ "$GENERATE_STATUS" -eq 0 ]; then node "$ENGINE" --input "$ARTIFACT_DERIVE_INVOCATION" > "$ARTIFACT_DERIVE_RESULT"; GENERATE_STATUS=$?; fi
    [ "$GENERATE_STATUS" -eq 0 ] || { logg error 'Unable to derive immutable artifact operations'; return "$GENERATE_STATUS"; }
  else
    printf '%s\n' '{"schemaVersion":1,"artifacts":[]}' > "$ARTIFACT_DERIVE_RESULT"
  fi
  export INSTALL_DOCTOR_LOAD_PLAN_PATH="$LOAD_PLAN_RESULT" INSTALL_DOCTOR_ARTIFACT_DERIVATION_PATH="$ARTIFACT_DERIVE_RESULT" INSTALL_DOCTOR_NATIVE_DERIVATION_PATH="$NATIVE_DERIVE_RESULT"
  node - "$INVOCATION" "$PROVISIONER" "$STATE_ROOT" "$RENDERER" <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const [invocationPath, provisioner, stateRoot, renderer] = process.argv.slice(2);
const loadSignedPlanningInputs = () => {
  const archivePath = process.env.DESKTOP_TOOLS_TOOLS_ARCHIVE;
  const expectedDigest = process.env.DESKTOP_TOOLS_TOOLS_SHA256;
  if (!archivePath && !expectedDigest) return null;
  if (!archivePath || !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('signed planning-input archive authority is incomplete');
  const metadata = fs.lstatSync(archivePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 33_554_432) {
    throw new Error('signed planning-input archive must be one bounded regular file');
  }
  const archive = fs.readFileSync(archivePath);
  if (crypto.createHash('sha256').update(archive).digest('hex') !== expectedDigest) throw new Error('signed planning-input archive digest mismatch');
  let expanded;
  try { expanded = zlib.gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }); }
  catch { throw new Error('signed planning-input archive cannot be safely expanded'); }
  const entries = new Map();
  for (let offset = 0; offset + 512 <= expanded.length;) {
    const header = expanded.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (offset + 512 > expanded.length || !expanded.subarray(offset, offset + 512).every(byte => byte === 0)
        || !expanded.subarray(offset + 512).every(byte => byte === 0)) throw new Error('signed planning-input archive has invalid trailing structure');
      const installx = entries.get('provisioning/home/dot_local/bin/executable_installx');
      if (!installx || installx.length < 1 || installx.length > 65_536) throw new Error('signed planning-input archive lacks bounded installx authority');
      for (const [name, bytes] of entries) if (name.startsWith('provisioning/') && name !== 'provisioning/home/dot_local/bin/executable_installx'
        && (!/^provisioning\/home\/dot_local\/bin\/post-installx\/executable_post-[a-z0-9][a-z0-9._+-]{0,127}\.sh$/.test(name)
          || bytes.length < 1 || bytes.length > 1_048_576)) throw new Error('signed planning-input archive contains invalid provisioning authority');
      return entries;
    }
    const name = header.subarray(0, 100).toString('utf8').split('\0', 1)[0];
    const sizeText = header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim();
    const checksumText = header.subarray(148, 156).toString('ascii').replaceAll('\0', '').trim();
    const checksumHeader = Buffer.from(header); checksumHeader.fill(0x20, 148, 156);
    if (!name || !/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksumText)
      || Number.parseInt(checksumText, 8) !== checksumHeader.reduce((sum, byte) => sum + byte, 0)
      || (header[156] !== 0 && header[156] !== 0x30) || name.startsWith('/') || name.split('/').includes('..') || entries.has(name)) {
      throw new Error('signed planning-input archive is malformed');
    }
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > expanded.length) throw new Error('signed planning-input archive entry is malformed');
    entries.set(name, expanded.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error('signed planning-input archive lacks its terminator');
};
const signedPlanningInputs = loadSignedPlanningInputs();
const planPath = process.env.INSTALL_DOCTOR_PLAN;
if (!planPath) throw new Error('INSTALL_DOCTOR_PLAN is required');
const planMetadata = fs.lstatSync(planPath);
if (!planMetadata.isFile() || planMetadata.isSymbolicLink() || planMetadata.size < 2 || planMetadata.size > 1_048_576) throw new Error('install plan must be a bounded regular non-symlink file');
if (process.platform !== 'win32' && (planMetadata.uid !== process.geteuid() || (planMetadata.mode & 0o022) !== 0)) throw new Error('install plan ownership or mode is unsafe');
const rawPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} shape is invalid`);
};
exactKeys(rawPlan, ['schemaVersion', 'host', 'role', 'capability', 'network', 'softwareGroup', 'installUser', 'offline', 'concurrency',
  'selectedPackages', 'selectedServices', 'selectedSupportedPaths', 'lazyResolverRequirements', 'consents', 'platformAdmission', 'privilegeContext',
  'desiredStateAuthority', 'createdAt'], 'install plan');
if (rawPlan.schemaVersion !== 2) throw new Error('install plan schema version is unsupported');
exactKeys(rawPlan.host, ['hostname', 'os'], 'install plan host');
exactKeys(rawPlan.consents, ['privileged', 'network', 'bestEffort'], 'install plan consents');
exactKeys(rawPlan.platformAdmission, ['policyRevision', 'cellId', 'status', 'os', 'release', 'arch', 'environment', 'role', 'limitation'], 'platform admission');
exactKeys(rawPlan.privilegeContext, ['sudoPreexisting'], 'privilege context');
const expectedAdmission = {
  policyRevision: 'platform-support-matrix-v1', cellId: process.env.INSTALL_DOCTOR_PLATFORM_CELL,
  status: process.env.INSTALL_DOCTOR_PLATFORM_STATUS, os: process.env.INSTALL_DOCTOR_PLATFORM_OS,
  release: process.env.INSTALL_DOCTOR_PLATFORM_RELEASE, arch: process.env.INSTALL_DOCTOR_PLATFORM_ARCH,
  environment: process.env.INSTALL_DOCTOR_PLATFORM_ENVIRONMENT, role: process.env.INSTALL_DOCTOR_PLATFORM_ROLE,
  limitation: process.env.INSTALL_DOCTOR_PLATFORM_LIMITATION,
};
if (JSON.stringify(rawPlan.platformAdmission) !== JSON.stringify(expectedAdmission)) throw new Error('platform admission changed after signed-policy evaluation');
const boundedString = (value, pattern, maximum, label) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !pattern.test(value)) throw new Error(`${label} is invalid`);
};
if (rawPlan.desiredStateAuthority !== null) {
  exactKeys(rawPlan.desiredStateAuthority, ['profileId', 'profileRevision', 'profileDigest', 'machineId'], 'desired-state authority');
  boundedString(rawPlan.desiredStateAuthority.profileId, /^[a-z0-9][a-z0-9._-]*$/, 128, 'desired-state profile id');
  boundedString(rawPlan.desiredStateAuthority.profileRevision, /^[a-z0-9][a-z0-9._-]*$/, 128, 'desired-state profile revision');
  boundedString(rawPlan.desiredStateAuthority.profileDigest, /^[a-f0-9]{64}$/, 64, 'desired-state profile digest');
  boundedString(rawPlan.desiredStateAuthority.machineId, /^[a-z0-9][a-z0-9._-]*$/, 128, 'desired-state machine id');
}
const expectedDesiredStateAuthority = process.env.DESKTOP_TOOLS_PROFILE_ID ? {
  profileId: process.env.DESKTOP_TOOLS_PROFILE_ID, profileRevision: process.env.DESKTOP_TOOLS_PROFILE_REVISION,
  profileDigest: process.env.DESKTOP_TOOLS_PROFILE_DIGEST, machineId: process.env.DESKTOP_TOOLS_MACHINE_ID,
} : null;
if (JSON.stringify(rawPlan.desiredStateAuthority) !== JSON.stringify(expectedDesiredStateAuthority)) {
  throw new Error('desired-state authority changed after authenticated profile resolution');
}
boundedString(rawPlan.host.hostname, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 255, 'install plan hostname');
boundedString(rawPlan.host.os, /^[a-z0-9][a-z0-9._-]*$/, 64, 'install plan os');
if (!['workstation', 'server', 'proxmox', 'coolify', 'qubes', 'container', 'custom', 'macos', 'ubuntu', 'debian', 'fedora', 'silverblue', 'alpine', 'arch', 'qubes-dom0', 'qubes-appvm', 'wsl'].includes(rawPlan.role)) throw new Error('install plan role is invalid');
if (!['developer', 'ai', 'web', 'media', 'security', 'minimal'].includes(rawPlan.capability)) throw new Error('install plan capability is invalid');
if (!['none', 'cloudflare-warp', 'cloudflare-tunnel', 'ssh'].includes(rawPlan.network)) throw new Error('install plan network is invalid');
boundedString(rawPlan.softwareGroup, /^[A-Za-z0-9][A-Za-z0-9._ -]*$/, 128, 'install plan softwareGroup');
boundedString(rawPlan.installUser, /^(?![0-9.-])[A-Za-z0-9._-]+$/, 128, 'install plan installUser');
if (typeof rawPlan.offline !== 'boolean' || !Number.isSafeInteger(rawPlan.concurrency) || rawPlan.concurrency < 1 || rawPlan.concurrency > 16
  || typeof rawPlan.consents.privileged !== 'boolean' || typeof rawPlan.consents.network !== 'boolean' || typeof rawPlan.consents.bestEffort !== 'boolean'
  || typeof rawPlan.privilegeContext.sudoPreexisting !== 'boolean') throw new Error('install plan scalar fields are invalid');
for (const [key, value] of Object.entries(rawPlan.platformAdmission)) boundedString(value, /^[A-Za-z0-9][A-Za-z0-9 ,.'_:/()-]*$/, key === 'limitation' ? 512 : 128, `platform admission ${key}`);
if (rawPlan.platformAdmission.policyRevision !== 'platform-support-matrix-v1') throw new Error('platform admission policy revision is unsupported');
if (!['verified', 'best-effort'].includes(rawPlan.platformAdmission.status)) throw new Error('platform admission status cannot authorize execution');
if (rawPlan.platformAdmission.status === 'best-effort' && !rawPlan.consents.bestEffort) throw new Error('best-effort platform admission lacks explicit consent');
if (typeof rawPlan.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rawPlan.createdAt)
  || new Date(rawPlan.createdAt).toISOString() !== rawPlan.createdAt) throw new Error('install plan createdAt is invalid');
const canonicalList = (value, maximum, pattern, label) => {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string' || item.length > 128 || !pattern.test(item))
    || JSON.stringify(value) !== JSON.stringify([...new Set(value)].sort())) throw new Error(`install plan ${label} is invalid`);
  return value;
};
const selectedPackages = canonicalList(rawPlan.selectedPackages, 4096, /^[a-z0-9][a-z0-9._:-]*$/, 'selectedPackages');
const selectedServices = canonicalList(rawPlan.selectedServices, 1024, /^[a-z0-9][a-z0-9._:-]*$/, 'selectedServices');
const selectedSupportedPaths = canonicalList(rawPlan.selectedSupportedPaths, 1024, /^[a-z0-9][a-z0-9._-]*$/, 'selectedSupportedPaths');
const lazyResolverRequirements = canonicalList(rawPlan.lazyResolverRequirements, 128, /^[a-z0-9][a-z0-9._:-]*$/, 'lazyResolverRequirements');
const loadPlan = JSON.parse(fs.readFileSync(process.env.INSTALL_DOCTOR_LOAD_PLAN_PATH, 'utf8'));
if (!loadPlan || !Array.isArray(loadPlan.items)) throw new Error('load plan is malformed');
const nativeDerivation = JSON.parse(fs.readFileSync(process.env.INSTALL_DOCTOR_NATIVE_DERIVATION_PATH, 'utf8'));
const nativeComposition = nativeDerivation.composition ?? null;
if (nativeComposition !== null && (!nativeComposition.task || !nativeComposition.operations
  || nativeComposition.rootPackageKey !== 'tree' || !Array.isArray(nativeComposition.remainingLegacyPackages))) {
  throw new Error('native Debian derivation is malformed');
}
const selectedPackageClosure = [...new Set(loadPlan.items
  .filter(item => item && item.selected === true && item.applicable === true)
  .map(item => {
    boundedString(item.name, /^[a-z0-9][a-z0-9._:-]*$/, 128, 'load plan package name');
    return item.name;
  }))].sort();
const legacySelectedPackages = nativeComposition === null ? selectedPackages : nativeComposition.remainingLegacyPackages;
canonicalList(legacySelectedPackages, 4096, /^[a-z0-9][a-z0-9._:-]*$/, 'native remainingLegacyPackages');
if (nativeComposition !== null && (!selectedPackages.includes('tree') || legacySelectedPackages.includes('tree'))) {
  throw new Error('native Debian derivation did not subtract only the admitted tree package');
}
const artifactDerivation = JSON.parse(fs.readFileSync(process.env.INSTALL_DOCTOR_ARTIFACT_DERIVATION_PATH, 'utf8'));
if (!Array.isArray(artifactDerivation.artifacts)) throw new Error('artifact derivation is malformed');
const directoryRequirements = new Map();
for (const artifact of artifactDerivation.artifacts) {
  if (!Array.isArray(artifact.directoryRequirements)) throw new Error('artifact directory requirements are malformed');
  for (const requirement of artifact.directoryRequirements) {
    const key = `${requirement.targetPath}\0${requirement.targetMode}`;
    const existing = directoryRequirements.get(key);
    if (existing && (existing.targetPath !== requirement.targetPath || existing.targetMode !== requirement.targetMode)) {
      throw new Error('conflicting artifact directory requirements');
    }
    directoryRequirements.set(key, { targetPath: requirement.targetPath, targetMode: requirement.targetMode });
  }
}
const directoryEntries = [...directoryRequirements.entries()].sort(([left], [right]) => left.localeCompare(right));
const directoryTaskIdByKey = new Map(directoryEntries.map(([key, requirement]) => [key, `directory.${digest(requirement).slice(0, 24)}`]));
const semanticPlan = { ...rawPlan };
delete semanticPlan.createdAt;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const desiredDigest = digest(semanticPlan);
const sanitize = value => String(value || 'host').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 128) || 'host';
if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error(`unsupported platform: ${process.platform}`);
if (process.arch !== 'arm64' && process.arch !== 'x64') throw new Error(`unsupported architecture: ${process.arch}`);
const platform = process.platform;
const arch = process.arch;
const environment = rawPlan.platformAdmission.environment;
const role = sanitize(rawPlan.role || platform);
const capability = sanitize(rawPlan.capability || 'minimal');
const consents = [];
if (rawPlan.consents.privileged) consents.push('privileged');
if (rawPlan.consents.network) consents.push('network');
if (rawPlan.consents.bestEffort) consents.push('best-effort-platform');
const agentTaskDirectory = process.env.INSTALL_DOCTOR_AGENT_TASK_DIR || '';
const agentTasksConsent = process.env.INSTALL_DOCTOR_AGENT_TASKS_CONSENT === '1';
if (agentTaskDirectory && agentTasksConsent) consents.push('agent-tasks');
const agentTaskManifest = [];
if (agentTaskDirectory) {
  const directory = fs.lstatSync(agentTaskDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o022) !== 0) throw new Error('configured agent task directory is unsafe');
  if (process.platform !== 'win32' && directory.uid !== process.geteuid()) throw new Error('configured agent task directory must be owned by the current user');
  const names = fs.readdirSync(agentTaskDirectory).filter(name => name.endsWith('.sh')).sort();
  if (names.length > 64) throw new Error('configured agent task count exceeds the bounded policy');
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sh$/.test(name)) throw new Error(`configured agent task name is invalid: ${name}`);
    const taskPath = `${agentTaskDirectory}/${name}`;
    const metadata = fs.lstatSync(taskPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 1_048_576) throw new Error(`configured agent task is not one bounded regular file: ${name}`);
    if (process.platform !== 'win32' && (metadata.uid !== process.geteuid() || (metadata.mode & 0o022) !== 0)) throw new Error(`configured agent task has unsafe ownership or mode: ${name}`);
    if ((metadata.mode & 0o111) === 0) continue;
    agentTaskManifest.push({ name, sha256: crypto.createHash('sha256').update(fs.readFileSync(taskPath)).digest('hex') });
  }
}
const agentTaskManifestDigest = digest(agentTaskManifest);
let warpCliPath = '';
let warpCliDigest = 'absent';
if (rawPlan.network === 'cloudflare-warp' && rawPlan.consents.network === true) {
  for (const candidate of ['/usr/local/bin/warp-cli', '/opt/homebrew/bin/warp-cli', '/usr/bin/warp-cli', '/bin/warp-cli']) {
    try {
      const metadata = fs.lstatSync(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0 || (metadata.mode & 0o022) !== 0) continue;
      if (metadata.uid !== 0 && metadata.uid !== process.geteuid()) continue;
      warpCliPath = candidate;
      warpCliDigest = crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
      break;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
}
let sudoPath = '';
let sudoDigest = '';
let sudoDigestKind = '';
for (const candidate of ['/usr/bin/sudo', '/bin/sudo']) {
  try {
    const metadata = fs.lstatSync(candidate);
    const parent = fs.lstatSync(require('node:path').dirname(candidate));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o111) === 0
      || (metadata.mode & 0o4000) === 0 || (metadata.mode & 0o022) !== 0 || metadata.uid !== 0
      || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) continue;
    sudoPath = candidate;
    try { sudoDigest = crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'); sudoDigestKind = 'content-sha256'; }
    catch (error) {
      if (!error || error.code !== 'EACCES') throw error;
      sudoDigest = crypto.createHash('sha256').update(JSON.stringify({ dev: metadata.dev, ino: metadata.ino, size: metadata.size,
        mode: metadata.mode, uid: metadata.uid, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs })).digest('hex');
      sudoDigestKind = 'stat-identity-sha256';
    }
    break;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}
if (!sudoPath) throw new Error('no safe fixed sudo executable is available for credential cleanup');
const operationEnvironment = {
  SOFTWARE_GROUP: rawPlan.softwareGroup,
  INSTALL_DOCTOR_ROLE: rawPlan.role,
  INSTALL_DOCTOR_CAPABILITY: rawPlan.capability,
  INSTALL_DOCTOR_NETWORK: rawPlan.network,
  INSTALL_DOCTOR_CONCURRENCY: String(rawPlan.concurrency),
  INSTALL_DOCTOR_CONSENT_PRIVILEGED: String(rawPlan.consents.privileged),
  INSTALL_DOCTOR_CONSENT_NETWORK: String(rawPlan.consents.network),
  INSTALL_DOCTOR_CONSENT_BEST_EFFORT: String(rawPlan.consents.bestEffort),
  INSTALL_DOCTOR_SUDO_PREEXISTING: String(rawPlan.privilegeContext.sudoPreexisting),
  INSTALL_DOCTOR_OFFLINE: String(rawPlan.offline),
  INSTALL_DOCTOR_USER: rawPlan.installUser,
  INSTALL_DOCTOR_AGENT_TASK_DIR: agentTaskDirectory,
  INSTALL_DOCTOR_AGENT_TASKS_CONSENT: agentTasksConsent ? '1' : '0',
  INSTALL_DOCTOR_AGENT_TASKS_DIGEST: agentTaskManifestDigest,
  INSTALL_DOCTOR_AGENT_FAILURE_POLICY: process.env.INSTALL_DOCTOR_AGENT_FAILURE_POLICY === 'continue' ? 'continue' : 'fail',
  INSTALL_DOCTOR_EFFECT_RECEIPT_DIR: `${stateRoot}/effects`,
  INSTALL_DOCTOR_ENGINE_OWNS_PACKAGES: '1',
  INSTALL_DOCTOR_ENGINE_OWNS_SERVICES: '1',
  INSTALL_DOCTOR_ENGINE_OWNS_SOFTWARE_GROUPS: '1',
  INSTALL_DOCTOR_ENGINE_OWNS_CATALOG_POST_HOOKS: '1',
  INSTALL_DOCTOR_ENGINE_OWNS_CUSTOM_POST_HOOKS: '1',
  INSTALL_DOCTOR_BOOTSTRAP_INSTALLX: `${stateRoot}/tools/installx`,
  INSTALL_DOCTOR_SELECTED_PACKAGES: legacySelectedPackages.join(','),
  INSTALL_DOCTOR_SELECTED_SERVICES: selectedServices.join(','),
  INSTALL_DOCTOR_WARP_CLI_PATH: warpCliPath,
  INSTALL_DOCTOR_WARP_CLI_SHA256: warpCliDigest,
};
const stageZeroInstallUserTask = {
  schemaVersion: 1, id: 'stage-zero.install-user-transition',
  inputDigest: digest({ installUser: rawPlan.installUser, policy: 'root-handoff-v1' }),
  dependencies: [], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'stage-zero-install-user-check', apply: 'stage-zero-install-user-apply', verify: 'stage-zero-install-user-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'admin', network: 'none',
  consent: 'privileged', lockDomains: ['privilege', 'user-account'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const stageZeroSudoTask = {
  schemaVersion: 1, id: 'stage-zero.sudo-credential',
  inputDigest: digest({ installUser: rawPlan.installUser, sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting, policy: 'externally-acquired-ephemeral-cache-v2' }),
  dependencies: [stageZeroInstallUserTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'stage-zero-sudo-check', apply: 'stage-zero-sudo-apply', verify: 'stage-zero-sudo-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'admin', network: 'none',
  consent: 'privileged', lockDomains: ['privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const warpDisconnectTask = rawPlan.network === 'cloudflare-warp' && rawPlan.consents.network === true ? {
  schemaVersion: 1, id: 'network.warp-disconnect',
  inputDigest: digest({ network: rawPlan.network, consent: rawPlan.consents.network, warpCliPath, warpCliDigest, policy: 'disconnect-no-automatic-reconnect-v1' }),
  dependencies: [stageZeroSudoTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'warp-disconnect-check', apply: 'warp-disconnect-apply', verify: 'warp-disconnect-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'user', network: 'none',
  consent: 'network', lockDomains: ['network:cloudflare-warp'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
} : null;
const nativeDependenciesTask = {
  schemaVersion: 1, id: 'bootstrap.native-dependencies',
  inputDigest: digest({ platform, arch, commands: ['curl', 'git', 'rsync'] }),
  dependencies: [warpDisconnectTask?.id ?? stageZeroSudoTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'native-dependencies-check', apply: 'native-dependencies-apply', verify: 'native-dependencies-verify' },
  timeoutMs: 1_800_000, retry: { class: 'transient', maxAttempts: 2, backoffMs: 1_000 },
  resources: { cpu: 1, memoryMiB: 512, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['package-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const sourceTask = {
  schemaVersion: 1, id: 'bootstrap.source',
  inputDigest: digest({ release: process.env.INSTALL_DOCTOR_RELEASE_ID, sourceCommit: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, origin: process.env.START_REPO }),
  dependencies: [nativeDependenciesTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'source-check', apply: 'source-apply', verify: 'source-verify' },
  timeoutMs: 900_000, retry: { class: 'transient', maxAttempts: 3, backoffMs: 1_000 },
  resources: { cpu: 1, memoryMiB: 256, network: true }, privilege: 'user', network: 'required',
  consent: 'none', lockDomains: ['source-cache'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const homebrewTask = {
  schemaVersion: 1, id: 'bootstrap.homebrew',
  inputDigest: digest({ platform, installerCommit: '959bdd728192d78c47287c177796c3d86d111f09' }),
  dependencies: [nativeDependenciesTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'homebrew-check', apply: 'homebrew-apply', verify: 'homebrew-verify' },
  timeoutMs: 1_800_000, retry: { class: 'transient', maxAttempts: 2, backoffMs: 2_000 },
  resources: { cpu: 1, memoryMiB: 1024, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['package-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const homebrewToolsTask = {
  schemaVersion: 1, id: 'bootstrap.homebrew-tools',
  inputDigest: digest({ tools: ['chezmoi', 'gum', 'zx'] }),
  dependencies: [homebrewTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'homebrew-tools-check', apply: 'homebrew-tools-apply', verify: 'homebrew-tools-verify' },
  timeoutMs: 1_800_000, retry: { class: 'transient', maxAttempts: 2, backoffMs: 1_000 },
  resources: { cpu: 1, memoryMiB: 1024, network: true }, privilege: 'user', network: 'required',
  consent: 'privileged', lockDomains: ['package-manager'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const chezmoiInitTask = {
  schemaVersion: 1, id: 'bootstrap.chezmoi-init',
  inputDigest: digest({ semanticPlan, source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT }),
  dependencies: [sourceTask.id, homebrewToolsTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'chezmoi-init-check', apply: 'chezmoi-init-apply', verify: 'chezmoi-init-verify' },
  timeoutMs: 900_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 512, network: false }, privilege: 'user', network: 'none',
  consent: 'privileged', lockDomains: ['chezmoi'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const installxSourcePath = `${process.env.INSTALL_DOCTOR_CHEZMOI_SOURCE}/dot_local/bin/executable_installx`;
const installxTargetPath = `${stateRoot}/tools/installx`;
const installxBinPath = `${stateRoot}/tools`;
let installxCandidate;
if (signedPlanningInputs) installxCandidate = signedPlanningInputs.get('provisioning/home/dot_local/bin/executable_installx');
else {
  const installxSourceMetadata = fs.lstatSync(installxSourcePath);
  if (!installxSourceMetadata.isFile() || installxSourceMetadata.isSymbolicLink() || installxSourceMetadata.size < 1 || installxSourceMetadata.size > 65_536) {
    throw new Error('installx source must be one bounded regular file');
  }
  installxCandidate = fs.readFileSync(installxSourcePath);
}
const installxCandidateBase64 = installxCandidate.toString('base64');
const installxBinDirectoryTask = {
  schemaVersion: 1, id: 'bootstrap.installx-bin-directory',
  inputDigest: digest({ targetPath: installxBinPath, mode: 0o700, policy: 'managed-directory-v1' }),
  dependencies: [chezmoiInitTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'installx-bin-check', apply: 'installx-bin-apply', verify: 'installx-bin-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 32, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: ['installer-configuration', 'installx-tool'], cleanup: 'none', compensation: 'configuration',
  failurePolicy: 'abort-run',
};
const installxToolTask = {
  schemaVersion: 1, id: 'bootstrap.installx-tool',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, targetPath: installxTargetPath,
    candidateDigest: crypto.createHash('sha256').update(installxCandidate).digest('hex'), policy: 'isolated-managed-file-v1' }),
  dependencies: [installxBinDirectoryTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'installx-tool-check', apply: 'installx-tool-apply', verify: 'installx-tool-verify' },
  timeoutMs: 120_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 256, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: ['installer-configuration', 'installx-tool'], cleanup: 'none', compensation: 'configuration',
  failurePolicy: 'abort-run',
};
const desiredPackagesTask = {
  schemaVersion: 1, id: 'desired.packages',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, softwareGroup: rawPlan.softwareGroup, selectedPackages: legacySelectedPackages, selectedServices, policy: 'approved-plus-eager-lazy-v2' }),
  dependencies: [installxToolTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'desired-packages-check', apply: 'desired-packages-apply', verify: 'desired-packages-verify' },
  timeoutMs: 14_400_000, retry: { class: 'transient', maxAttempts: 2, backoffMs: 2_000 },
  resources: { cpu: Math.min(rawPlan.concurrency, 16), memoryMiB: 2048, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['package-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const directoryTasks = directoryEntries.map(([key, requirement]) => {
  const id = directoryTaskIdByKey.get(key);
  if (!id) throw new Error('artifact directory task identity is unavailable');
  return {
    schemaVersion: 1, id, inputDigest: digest(requirement), dependencies: [desiredPackagesTask.id],
    predicate: 'host-supported', requiredCapabilities: [],
    operations: { check: `${id}-check`, apply: `${id}-apply`, verify: `${id}-verify` },
    timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 32, network: false }, privilege: 'user', network: 'none',
    consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none', compensation: 'configuration',
    failurePolicy: 'abort-run',
  };
});
const directoryOperations = Object.fromEntries(directoryEntries.flatMap(([key, requirement]) => {
  const id = directoryTaskIdByKey.get(key);
  if (!id) throw new Error('artifact directory operation identity is unavailable');
  return ['check', 'apply', 'verify'].map(action => [`${id}-${action}`, {
    kind: 'managed-directory', action, targetPath: requirement.targetPath, candidateMode: requirement.targetMode,
  }]);
}));
const artifactTasks = artifactDerivation.artifacts.map((artifact, index) => {
  const prefix = `artifact-${index}-${sanitize(artifact.itemName)}`;
  const directoryTaskIds = artifact.directoryRequirements.map(requirement => {
    const id = directoryTaskIdByKey.get(`${requirement.targetPath}\0${requirement.targetMode}`);
    if (!id) throw new Error('artifact dependency directory is unavailable');
    return id;
  });
  return {
    schemaVersion: 1, id: `artifact.${sanitize(artifact.itemName)}`,
    inputDigest: digest({ loadPlanDigest: loadPlan.digest, descriptorDigest: artifact.descriptorDigest, operations: artifact.operations }),
    dependencies: [desiredPackagesTask.id, ...directoryTaskIds], predicate: 'host-supported', requiredCapabilities: [],
    operations: { check: `${prefix}-check`, apply: `${prefix}-apply`, verify: `${prefix}-verify` },
    timeoutMs: 120_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 128, network: true }, privilege: 'user', network: 'required',
    consent: 'network', lockDomains: [`artifact:${sanitize(artifact.itemName)}`], cleanup: 'none', compensation: 'configuration',
    failurePolicy: 'abort-run',
  };
});
const artifactOperations = Object.fromEntries(artifactDerivation.artifacts.flatMap((artifact, index) => {
  const prefix = `artifact-${index}-${sanitize(artifact.itemName)}`;
  return [['check', artifact.operations.check], ['apply', artifact.operations.apply], ['verify', artifact.operations.verify]]
    .map(([phase, operation]) => [`${prefix}-${phase}`, operation]);
}));
const macosFullDiskAccessTask = {
  schemaVersion: 1, id: 'bootstrap.macos-full-disk-access',
  inputDigest: digest({ platform, policy: 'interactive-request-v1', headless: Boolean(process.env.HEADLESS_INSTALL) }),
  dependencies: [nativeDependenciesTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'macos-full-disk-access-check', apply: 'macos-full-disk-access-apply', verify: 'macos-full-disk-access-verify' },
  timeoutMs: 120_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 128, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: ['macos-privacy'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const certificatePath = `${process.env.HOME}/.local/etc/ssl/cloudflare/cloudflare.crt`;
let certificateDigest = 'absent';
try {
  const metadata = fs.lstatSync(certificatePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Cloudflare certificate path must be a regular non-symlink file');
  certificateDigest = crypto.createHash('sha256').update(fs.readFileSync(certificatePath)).digest('hex');
} catch (error) {
  if (error && error.code !== 'ENOENT') throw error;
}
const macosCertificateTask = {
  schemaVersion: 1, id: 'bootstrap.macos-cloudflare-certificate',
  inputDigest: digest({ platform, certificatePath, certificateDigest, headless: Boolean(process.env.HEADLESS_INSTALL) }),
  dependencies: [nativeDependenciesTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'macos-certificate-check', apply: 'macos-certificate-apply', verify: 'macos-certificate-verify' },
  timeoutMs: 120_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 128, network: false }, privilege: 'admin', network: 'none',
  consent: 'privileged', lockDomains: ['macos-keychain', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const qubesDom0Task = rawPlan.role === 'qubes-dom0' ? {
  schemaVersion: 1, id: 'bootstrap.qubes-dom0-delegation',
  inputDigest: digest({ role: rawPlan.role, release: process.env.INSTALL_DOCTOR_RELEASE_ID, policy: 'delegated-provision-v1' }),
  dependencies: [nativeDependenciesTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'qubes-dom0-check', apply: 'qubes-dom0-apply', verify: 'qubes-dom0-verify' },
  timeoutMs: 7_200_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 2, memoryMiB: 2048, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['package-manager', 'privilege', 'qubes-dom0'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
} : null;
const agentTasksTask = agentTaskDirectory ? {
  schemaVersion: 1, id: 'bootstrap.configured-agent-tasks',
  inputDigest: digest({ directory: agentTaskDirectory, manifest: agentTaskManifest, failurePolicy: operationEnvironment.INSTALL_DOCTOR_AGENT_FAILURE_POLICY }),
  dependencies: [chezmoiInitTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'configured-agent-tasks-check', apply: 'configured-agent-tasks-apply', verify: 'configured-agent-tasks-verify' },
  timeoutMs: 3_600_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: Math.min(rawPlan.concurrency, 16), memoryMiB: 2048, network: true }, privilege: 'admin', network: 'required',
  consent: 'agent-tasks', lockDomains: ['agent-tasks', 'package-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
} : null;
const finalDependencies = [desiredPackagesTask.id, macosFullDiskAccessTask.id, macosCertificateTask.id];
if (qubesDom0Task) finalDependencies.push(qubesDom0Task.id);
if (agentTasksTask) finalDependencies.push(agentTasksTask.id);
const task = {
  schemaVersion: 1, id: 'provision.chezmoi', inputDigest: digest({ semanticPlan, release: process.env.INSTALL_DOCTOR_RELEASE_ID }),
  dependencies: finalDependencies, predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'chezmoi-check', apply: 'chezmoi-apply', verify: 'chezmoi-verify' },
  timeoutMs: 14_400_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 2, memoryMiB: 1024, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['chezmoi', 'package-manager'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const configurationRoot = process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`;
if (!configurationRoot || !configurationRoot.startsWith('/')) throw new Error('installer configuration root must be absolute');
const bootstrapPolicyPath = `${configurationRoot}/install.doctor-policy.json`;
const bootstrapPolicy = `${JSON.stringify(canonical({
  schemaVersion: 1,
  releaseId: process.env.INSTALL_DOCTOR_RELEASE_ID,
  sourceCommit: process.env.INSTALL_DOCTOR_SOURCE_COMMIT,
  desiredStateRevision: `desired-${desiredDigest.slice(0, 24)}`,
  role: rawPlan.role,
  capability: rawPlan.capability,
  softwareGroup: rawPlan.softwareGroup,
  offline: rawPlan.offline,
  selectedServices,
  selectedPackages,
  selectedPackageClosure,
}))}\n`;
const bootstrapPolicyCandidate = Buffer.from(bootstrapPolicy, 'utf8').toString('base64');
const bootstrapPolicyTask = {
  schemaVersion: 1, id: 'installer.bootstrap-policy',
  inputDigest: digest({ targetPath: bootstrapPolicyPath, candidate: bootstrapPolicy, policy: 'managed-file-v1' }),
  dependencies: [task.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'bootstrap-policy-check', apply: 'bootstrap-policy-apply', verify: 'bootstrap-policy-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none', compensation: 'configuration',
  failurePolicy: 'abort-run',
};
const softwareGroupsTask = {
  schemaVersion: 1, id: 'desired.software-groups',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, packages: selectedPackages, services: selectedServices, policy: 'selected-groups-current-state-v2' }),
  dependencies: [bootstrapPolicyTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'software-groups-check', apply: 'software-groups-apply', verify: 'software-groups-verify' },
  timeoutMs: 900_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 256, network: false }, privilege: 'admin', network: 'none',
  consent: 'privileged', lockDomains: ['software-groups', 'filesystem-ownership', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const catalogPostValidationTask = {
  schemaVersion: 1, id: 'desired.catalog-post-validation',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, policy: 'reject-executable-catalog-post-v2' }),
  dependencies: [softwareGroupsTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'catalog-post-validation-check', apply: 'catalog-post-validation-apply', verify: 'catalog-post-validation-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 128, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const customHookRoot = `${process.env.INSTALL_DOCTOR_CHEZMOI_SOURCE}/dot_local/bin/post-installx`;
const selectedHookClosure = loadPlan.items.filter(item => item.selected).map(item => item.name).sort();
const customHookManifest = selectedHookClosure.flatMap(packageName => {
  const sourcePath = `${customHookRoot}/executable_post-${packageName}.sh`;
  if (signedPlanningInputs) {
    const bytes = signedPlanningInputs.get(`provisioning/home/dot_local/bin/post-installx/executable_post-${packageName}.sh`);
    return bytes ? [{ package: packageName, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] : [];
  }
  try {
    const metadata = fs.lstatSync(sourcePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`custom hook is not a regular file: ${packageName}`);
    return [{ package: packageName, sha256: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex') }];
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
});
const customHookManifestEnvironment = customHookManifest.map(entry => `${entry.package}=${entry.sha256}`).join('\n');
const customHookKeysEnvironment = customHookManifest.map(entry => entry.package).join(',');
const customPostHooksTask = {
  schemaVersion: 1, id: 'desired.custom-post-hooks',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, softwareGroup: rawPlan.softwareGroup, hooks: customHookManifest, policy: 'typed-custom-post-v2' }),
  dependencies: [catalogPostValidationTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'custom-post-hooks-check', apply: 'custom-post-hooks-apply', verify: 'custom-post-hooks-verify' },
  timeoutMs: 7_200_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 1024, network: true }, privilege: 'admin', network: 'required',
  consent: 'privileged', lockDomains: ['custom-post-hooks', 'package-manager', 'service-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const desiredServicesTask = {
  schemaVersion: 1, id: 'desired.services',
  inputDigest: digest({ source: process.env.INSTALL_DOCTOR_SOURCE_COMMIT, services: selectedServices }),
  dependencies: [customPostHooksTask.id], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'desired-services-check', apply: 'desired-services-apply', verify: 'desired-services-verify' },
  timeoutMs: 300_000, retry: { class: 'transient', maxAttempts: 2, backoffMs: 1_000 },
  resources: { cpu: 1, memoryMiB: 256, network: false }, privilege: 'admin', network: 'none',
  consent: 'privileged', lockDomains: ['service-manager', 'privilege'], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const rebootAssessmentTask = {
  schemaVersion: 1, id: 'system.reboot-assessment',
  inputDigest: digest({ platform, policy: 'explicit-operator-reboot-v1' }),
  dependencies: [desiredServicesTask.id, ...artifactTasks.map(task => task.id)], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'reboot-assessment-check', apply: 'reboot-assessment-apply', verify: 'reboot-assessment-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: [], cleanup: 'none', compensation: 'none',
  failurePolicy: 'abort-run',
};
const sudoCleanupTask = {
  schemaVersion: 1, id: 'system.sudo-credential-cleanup',
  inputDigest: digest({ installUser: rawPlan.installUser, sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting,
    sudoPath, sudoDigest, sudoDigestKind, policy: 'native-plan-bound-sudo-cleanup-v3' }),
  dependencies: [], predicate: 'host-supported', requiredCapabilities: [],
  operations: { check: 'sudo-cleanup-check', apply: 'sudo-cleanup-apply', verify: 'sudo-cleanup-verify' },
  timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
  resources: { cpu: 1, memoryMiB: 32, network: false }, privilege: 'user', network: 'none',
  consent: 'none', lockDomains: ['privilege'], cleanup: 'none', compensation: 'none',
  lifecycle: 'run-finalizer',
  failurePolicy: 'abort-run',
};
const invocation = {
  schemaVersion: 1, command: 'plan', runId: `install-${crypto.randomBytes(12).toString('hex')}`,
  releaseId: process.env.INSTALL_DOCTOR_RELEASE_ID,
  facts: {
    schemaVersion: 1, hostId: sanitize(os.hostname()), collectedAt: new Date().toISOString(), os: platform,
    osVersion: os.release(), arch, environment, roles: [role], packageManagers: [], capabilities: [capability],
  },
  desiredState: {
    schemaVersion: 1, revision: `desired-${desiredDigest.slice(0, 24)}`, hostId: sanitize(os.hostname()),
    packages: selectedPackageClosure, services: selectedServices, consents,
    offline: rawPlan.offline,
  },
    plan: {
      tasks: [stageZeroInstallUserTask, stageZeroSudoTask, ...(warpDisconnectTask ? [warpDisconnectTask] : []), ...(nativeComposition ? [nativeComposition.task] : []), nativeDependenciesTask, sourceTask, homebrewTask, homebrewToolsTask, chezmoiInitTask, installxBinDirectoryTask, installxToolTask, desiredPackagesTask, ...directoryTasks, ...artifactTasks, macosFullDiskAccessTask, macosCertificateTask, ...(qubesDom0Task ? [qubesDom0Task] : []), ...(agentTasksTask ? [agentTasksTask] : []), task, bootstrapPolicyTask, softwareGroupsTask, catalogPostValidationTask, customPostHooksTask, desiredServicesTask, rebootAssessmentTask, sudoCleanupTask],
      selectedTaskIds: [...(nativeComposition ? [nativeComposition.task.id] : []), rebootAssessmentTask.id, sudoCleanupTask.id],
      executionPolicy: {
        maxConcurrency: rawPlan.concurrency,
        resourceLimits: { cpu: 64, memoryMiB: 8192, networkConcurrency: rawPlan.concurrency },
      },
    },
  operations: {
    ...(nativeComposition ? nativeComposition.operations.operations : {}),
    ...directoryOperations,
    ...artifactOperations,
    'stage-zero-install-user-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-install-user-check'], env: operationEnvironment },
    'stage-zero-install-user-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-install-user-apply'], env: operationEnvironment },
    'stage-zero-install-user-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-install-user-verify'], env: operationEnvironment },
    'stage-zero-sudo-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-sudo-check'], env: operationEnvironment },
    'stage-zero-sudo-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-sudo-apply'], env: operationEnvironment },
    'stage-zero-sudo-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'stage-zero-sudo-verify'], env: operationEnvironment },
    'sudo-cleanup-check': { kind: 'sudo-credential-cleanup', action: 'check', sudoPath, digestKind: sudoDigestKind, sudoSha256: sudoDigest,
      sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting },
    'sudo-cleanup-apply': { kind: 'sudo-credential-cleanup', action: 'apply', sudoPath, digestKind: sudoDigestKind, sudoSha256: sudoDigest,
      sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting },
    'sudo-cleanup-verify': { kind: 'sudo-credential-cleanup', action: 'verify', sudoPath, digestKind: sudoDigestKind, sudoSha256: sudoDigest,
      sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting },
    ...(warpDisconnectTask ? {
      'warp-disconnect-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'warp-disconnect-check'], env: operationEnvironment },
      'warp-disconnect-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'warp-disconnect-apply'], env: operationEnvironment },
      'warp-disconnect-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'warp-disconnect-verify'], env: operationEnvironment },
    } : {}),
    'native-dependencies-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'native-dependencies-check'], env: operationEnvironment },
    'native-dependencies-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'native-dependencies-apply'], env: operationEnvironment },
    'native-dependencies-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'native-dependencies-verify'], env: operationEnvironment },
    'source-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'source-check'], env: operationEnvironment },
    'source-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'source-apply'], env: operationEnvironment },
    'source-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'source-verify'], env: operationEnvironment },
    'homebrew-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-check'], env: operationEnvironment },
    'homebrew-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-apply'], env: operationEnvironment },
    'homebrew-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-verify'], env: operationEnvironment },
    'homebrew-tools-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-tools-check'], env: operationEnvironment },
    'homebrew-tools-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-tools-apply'], env: operationEnvironment },
    'homebrew-tools-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'homebrew-tools-verify'], env: operationEnvironment },
    'chezmoi-init-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-init-check'], env: operationEnvironment },
    'chezmoi-init-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-init-apply'], env: operationEnvironment },
    'chezmoi-init-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-init-verify'], env: operationEnvironment },
    'installx-bin-check': { kind: 'managed-directory', action: 'check', targetPath: installxBinPath, candidateMode: 0o700 },
    'installx-bin-apply': { kind: 'managed-directory', action: 'apply', targetPath: installxBinPath, candidateMode: 0o700 },
    'installx-bin-verify': { kind: 'managed-directory', action: 'verify', targetPath: installxBinPath, candidateMode: 0o700 },
    'installx-tool-check': { kind: 'managed-file', action: 'check', targetPath: installxTargetPath, candidateBase64: installxCandidateBase64, candidateMode: 0o700 },
    'installx-tool-apply': { kind: 'managed-file', action: 'apply', targetPath: installxTargetPath, candidateBase64: installxCandidateBase64, candidateMode: 0o700 },
    'installx-tool-verify': { kind: 'managed-file', action: 'verify', targetPath: installxTargetPath, candidateBase64: installxCandidateBase64, candidateMode: 0o700 },
    'desired-packages-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-packages-check'], env: operationEnvironment },
    'desired-packages-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-packages-apply'], env: operationEnvironment },
    'desired-packages-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-packages-verify'], env: operationEnvironment },
    'macos-full-disk-access-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-full-disk-access-check'], env: operationEnvironment },
    'macos-full-disk-access-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-full-disk-access-apply'], env: operationEnvironment },
    'macos-full-disk-access-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-full-disk-access-verify'], env: operationEnvironment },
    'macos-certificate-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-certificate-check'], env: operationEnvironment },
    'macos-certificate-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-certificate-apply'], env: operationEnvironment },
    'macos-certificate-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'macos-certificate-verify'], env: operationEnvironment },
    'qubes-dom0-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'qubes-dom0-check'], env: operationEnvironment },
    'qubes-dom0-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'qubes-dom0-apply'], env: operationEnvironment },
    'qubes-dom0-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'qubes-dom0-verify'], env: operationEnvironment },
    'configured-agent-tasks-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'configured-agent-tasks-check'], env: operationEnvironment },
    'configured-agent-tasks-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'configured-agent-tasks-apply'], env: operationEnvironment },
    'configured-agent-tasks-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'configured-agent-tasks-verify'], env: operationEnvironment },
    'chezmoi-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-check'], env: operationEnvironment },
    'chezmoi-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-apply'], env: operationEnvironment },
    'chezmoi-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'chezmoi-verify'], env: operationEnvironment },
    'bootstrap-policy-check': { kind: 'managed-file', action: 'check', targetPath: bootstrapPolicyPath, candidateBase64: bootstrapPolicyCandidate, candidateMode: 0o600 },
    'bootstrap-policy-apply': { kind: 'managed-file', action: 'apply', targetPath: bootstrapPolicyPath, candidateBase64: bootstrapPolicyCandidate, candidateMode: 0o600 },
    'bootstrap-policy-verify': { kind: 'managed-file', action: 'verify', targetPath: bootstrapPolicyPath, candidateBase64: bootstrapPolicyCandidate, candidateMode: 0o600 },
    'software-groups-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'software-groups-check'], env: operationEnvironment },
    'software-groups-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'software-groups-apply'], env: operationEnvironment },
    'software-groups-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'software-groups-verify'], env: operationEnvironment },
    'catalog-post-validation-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'catalog-post-validation-check'], env: operationEnvironment },
    'catalog-post-validation-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'catalog-post-validation-apply'], env: operationEnvironment },
    'catalog-post-validation-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'catalog-post-validation-verify'], env: operationEnvironment },
    'custom-post-hooks-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'custom-post-hooks-check'], env: { ...operationEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST: customHookManifestEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_KEYS: customHookKeysEnvironment } },
    'custom-post-hooks-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'custom-post-hooks-apply'], env: { ...operationEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST: customHookManifestEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_KEYS: customHookKeysEnvironment } },
    'custom-post-hooks-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'custom-post-hooks-verify'], env: { ...operationEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST: customHookManifestEnvironment, INSTALL_DOCTOR_CUSTOM_HOOK_KEYS: customHookKeysEnvironment } },
    'desired-services-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-services-check'], env: operationEnvironment },
    'desired-services-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-services-apply'], env: operationEnvironment },
    'desired-services-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'desired-services-verify'], env: operationEnvironment },
    'reboot-assessment-check': { argv: ['/bin/bash', provisioner, '--engine-operation', 'reboot-assessment-check'], env: operationEnvironment },
    'reboot-assessment-apply': { argv: ['/bin/bash', provisioner, '--engine-operation', 'reboot-assessment-apply'], env: operationEnvironment },
    'reboot-assessment-verify': { argv: ['/bin/bash', provisioner, '--engine-operation', 'reboot-assessment-verify'], env: operationEnvironment },
  },
};
const provisionerDigest = crypto.createHash('sha256').update(fs.readFileSync(provisioner)).digest('hex');
for (const operation of Object.values(invocation.operations)) {
  if (Array.isArray(operation.argv)) operation.verifiedExecutable = { argvIndex: 1, sha256: provisionerDigest };
}
fs.writeFileSync(invocationPath, `${JSON.stringify(invocation)}\n`, { mode: 0o600, flag: 'wx' });
NODE
  GENERATE_STATUS=$?
  [ "$GENERATE_STATUS" -eq 0 ] || { rm -f "$INVOCATION"; rmdir "$INVOCATION_DIR" 2>/dev/null || true; logg error 'Unable to create the canonical engine invocation'; return "$GENERATE_STATUS"; }
  NORMALIZED_PLAN="$INVOCATION_DIR/normalized-plan.json"
  node "$ENGINE" --input "$INVOCATION" > "$NORMALIZED_PLAN"
  GENERATE_STATUS=$?
  if [ "$GENERATE_STATUS" -ne 0 ]; then
    rm -f "$INVOCATION" "$NORMALIZED_PLAN"
    rmdir "$INVOCATION_DIR" 2>/dev/null || true
    logg error 'Unable to normalize the canonical install plan'
    return "$GENERATE_STATUS"
  fi
  PLAN_DIGEST="$(node -e "const p=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')); if(!/^[a-f0-9]{64}$/.test(p.digest)) process.exit(2); process.stdout.write(p.digest)" "$NORMALIZED_PLAN")" || return 2
  mkdir -p "$STATE_ROOT/approvals" || return 1
  chmod 0700 "$STATE_ROOT/approvals" || return 1
  APPROVAL_PLAN="$STATE_ROOT/approvals/$PLAN_DIGEST.json"
  if [ -e "$APPROVAL_PLAN" ]; then
    node - "$NORMALIZED_PLAN" "$APPROVAL_PLAN" <<'NODE' || { logg error 'Normalized plan digest collided with different persisted semantics'; return 2; }
const fs = require('node:fs');
const semantic = file => { const value = JSON.parse(fs.readFileSync(file, 'utf8')); delete value.createdAt; return JSON.stringify(value); };
if (semantic(process.argv[2]) !== semantic(process.argv[3])) process.exit(1);
NODE
  else
    install -m 0600 "$NORMALIZED_PLAN" "$APPROVAL_PLAN" || return 1
  fi
  APPROVAL="${INSTALL_DOCTOR_APPROVED_PLAN_DIGEST:-}"
  if [ -z "${HEADLESS_INSTALL:-}" ] && [ -t 0 ]; then
    printf '\nNormalized install plan (%s):\n' "$PLAN_DIGEST" >&2
    sed -n '1,240p' "$NORMALIZED_PLAN" >&2
    if command -v gum >/dev/null 2>&1; then
      gum confirm "Approve exact plan $PLAN_DIGEST?" <&0 >&2 && APPROVAL="$PLAN_DIGEST"
    else
      printf 'Approve this exact plan? [y/N]: ' >&2
      read -r APPROVE_CURRENT_PLAN <&0 || true
      case "${APPROVE_CURRENT_PLAN:-}" in y|Y|yes|YES) APPROVAL="$PLAN_DIGEST" ;; esac
    fi
  fi
  if [ "$APPROVAL" != "$PLAN_DIGEST" ]; then
    logg error "Plan approval required; review $APPROVAL_PLAN and rerun with INSTALL_DOCTOR_APPROVED_PLAN_DIGEST=$PLAN_DIGEST"
    rm -f "$INVOCATION" "$NORMALIZED_PLAN" "$LOAD_PLAN_INVOCATION" "$LOAD_PLAN_RESULT" \
      "$ARTIFACT_DERIVE_INVOCATION" "$ARTIFACT_DERIVE_RESULT" "$NATIVE_DERIVE_INVOCATION" "$NATIVE_DERIVE_RESULT"
    rmdir "$INVOCATION_DIR" 2>/dev/null || true
    return 3
  fi
  INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$PLAN_DIGEST"
  export INSTALL_DOCTOR_APPROVED_PLAN_DIGEST
  if [ "$MODE" = apply ] && [ "$NATIVE_COUNT" -gt 0 ] \
    && [ -n "${DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST:-}" ] \
    && [ -n "${DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE:-}" ]; then
    local BROKER_REQUEST="$DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST"
    local BROKER_RESPONSE="$DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE"
    local BROKER_WAIT=0
    node - "$INVOCATION" "$NORMALIZED_PLAN" "$LOAD_PLAN_RESULT" "$BROKER_REQUEST" <<'NODE'
const fs = require('node:fs');
const [invocationPath, planPath, loadPlanPath, requestPath] = process.argv.slice(2);
const invocation = JSON.parse(fs.readFileSync(invocationPath, 'utf8'));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const loadPlan = JSON.parse(fs.readFileSync(loadPlanPath, 'utf8'));
const matches = loadPlan.items.filter(item => item.name === 'tree' && item.selected === true
  && item.applicable === true && item.nativePayload);
if (matches.length !== 1) {
  throw new Error('native broker preparation lacks one exact selected descriptor');
}
const request = {
  schemaVersion: 1,
  runId: invocation.runId,
  approvedPlanDigest: plan.digest,
  plan,
  operations: invocation.operations,
  desiredState: invocation.desiredState,
  hostFacts: invocation.facts,
  descriptor: matches[0].nativePayload,
};
const temporary = `${requestPath}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(request)}\n`, { mode: 0o600, flag: 'wx' });
fs.renameSync(temporary, requestPath);
NODE
    GENERATE_STATUS=$?
    [ "$GENERATE_STATUS" -eq 0 ] || { logg error 'Unable to publish the approved native broker preparation'; return "$GENERATE_STATUS"; }
    while [ ! -f "$BROKER_RESPONSE" ] && [ "$BROKER_WAIT" -lt 180 ]; do
      sleep 1
      BROKER_WAIT=$((BROKER_WAIT + 1))
    done
    [ -f "$BROKER_RESPONSE" ] || { logg error 'Timed out waiting for the root native broker'; return 4; }
    node - "$INVOCATION" "$BROKER_RESPONSE" "$PLAN_DIGEST" <<'NODE'
const fs = require('node:fs');
const [invocationPath, responsePath, planDigest] = process.argv.slice(2);
const invocation = JSON.parse(fs.readFileSync(invocationPath, 'utf8'));
const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
if (response?.schemaVersion !== 1 || response?.status !== 'authorized'
  || !response.privilegedBroker || response.privilegedBroker.client?.runId !== invocation.runId
  || response.privilegedBroker.client?.planDigest !== planDigest
  || response.privilegedBroker.client?.hostId !== invocation.facts.hostId
  || response.privilegedBroker.client?.releaseId !== invocation.releaseId
  || response.privilegedBroker.payload?.sha256 !== response.privilegedBroker.descriptor?.artifact?.sha256
  || response.privilegedBroker.payload?.sizeBytes !== response.privilegedBroker.descriptor?.artifact?.sizeBytes
  || response.privilegedBroker.payload?.mode !== '0600') {
  throw new Error('root broker response differs from the exact approved invocation');
}
const temporary = `${invocationPath}.broker`;
fs.writeFileSync(temporary, `${JSON.stringify({ ...invocation, privilegedBroker: response.privilegedBroker })}\n`, { mode: 0o600, flag: 'wx' });
fs.renameSync(temporary, invocationPath);
NODE
    GENERATE_STATUS=$?
    [ "$GENERATE_STATUS" -eq 0 ] || { logg error 'Unable to bind the authorized broker to the approved invocation'; return "$GENERATE_STATUS"; }
  fi
  if [ "$MODE" = --plan-only ]; then
    logg info "Approved normalized plan $PLAN_DIGEST before host mutation"
    rm -f "$INVOCATION" "$NORMALIZED_PLAN" "$LOAD_PLAN_INVOCATION" "$LOAD_PLAN_RESULT" \
      "$ARTIFACT_DERIVE_INVOCATION" "$ARTIFACT_DERIVE_RESULT" "$NATIVE_DERIVE_INVOCATION" "$NATIVE_DERIVE_RESULT"
    rmdir "$INVOCATION_DIR" 2>/dev/null || true
    return 0
  fi
  if [ "${INSTALL_DOCTOR_SUDO_PREPARED:-false}" != true ]; then
    setupPasswordlessSudo || return $?
    INSTALL_DOCTOR_SUDO_PREPARED=true
    export INSTALL_DOCTOR_SUDO_PREPARED INSTALL_DOCTOR_PROVISION_BOOTSTRAPPED=1
  fi
  RUNS_INVOCATION="$INVOCATION_DIR/runs-list.json"
  RUNS_RESULT="$INVOCATION_DIR/runs-list-result.json"
  node - "$RUNS_INVOCATION" "$STATE_ROOT" <<'NODE'
const fs = require('node:fs');
const [path, stateRoot] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, command: 'runs-list', stateRoot })}\n`, { mode: 0o600, flag: 'wx' });
NODE
  GENERATE_STATUS=$?
  if [ "$GENERATE_STATUS" -eq 0 ]; then
    node "$ENGINE" --input "$RUNS_INVOCATION" > "$RUNS_RESULT"
    GENERATE_STATUS=$?
  fi
  if [ "$GENERATE_STATUS" -ne 0 ]; then
    rm -f "$INVOCATION" "$NORMALIZED_PLAN" "$RUNS_INVOCATION" "$RUNS_RESULT"
    rmdir "$INVOCATION_DIR" 2>/dev/null || true
    logg error 'Unable to inspect protected resumable runs'
    return "$GENERATE_STATUS"
  fi
  RESUME_RUN_ID="$(node - "$RUNS_RESULT" "$PLAN_DIGEST" <<'NODE'
const fs = require('node:fs');
const [path, planDigest] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, 'utf8'));
const matches = value.runs.filter(run => run.planDigest === planDigest && run.resumeCandidate === true);
if (matches.length > 1) {
  process.stderr.write(`multiple resumable runs match plan ${planDigest}; inspect them with the engine runs-list command\n`);
  process.exit(2);
}
if (matches.length === 1) process.stdout.write(matches[0].runId);
NODE
)"
  GENERATE_STATUS=$?
  if [ "$GENERATE_STATUS" -ne 0 ]; then
    rm -f "$INVOCATION" "$NORMALIZED_PLAN" "$RUNS_INVOCATION" "$RUNS_RESULT"
    rmdir "$INVOCATION_DIR" 2>/dev/null || true
    return "$GENERATE_STATUS"
  fi
  node - "$INVOCATION" "$PLAN_DIGEST" "$RENDERER" "$STATE_ROOT" "$RESUME_RUN_ID" <<'NODE'
const fs = require('node:fs');
const [invocationPath, approvedPlanDigest, renderer, stateRoot, resumeRunId] = process.argv.slice(2);
const planned = JSON.parse(fs.readFileSync(invocationPath, 'utf8'));
const running = resumeRunId
  ? { ...planned, command: 'resume', runId: resumeRunId, planDigest: approvedPlanDigest, renderer, stateRoot }
  : { ...planned, command: 'run', approvedPlanDigest, renderer, stateRoot };
const temporary = `${invocationPath}.approved`;
fs.writeFileSync(temporary, `${JSON.stringify(running)}\n`, { mode: 0o600, flag: 'wx' });
fs.renameSync(temporary, invocationPath);
NODE
  GENERATE_STATUS=$?
  rm -f "$RUNS_INVOCATION" "$RUNS_RESULT"
  [ "$GENERATE_STATUS" -eq 0 ] || { rm -f "$INVOCATION" "$NORMALIZED_PLAN"; rmdir "$INVOCATION_DIR" 2>/dev/null || true; return "$GENERATE_STATUS"; }
  if [ -n "$RESUME_RUN_ID" ]; then
    logg info "Resuming protected run $RESUME_RUN_ID for exact plan $PLAN_DIGEST"
  fi
  node "$ENGINE" --input "$INVOCATION"
  ENGINE_STATUS=$?
  INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED=false
  export INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED
  EVIDENCE_INVOCATION="$INVOCATION_DIR/evidence.json"
  EVIDENCE_RESULT="$INVOCATION_DIR/evidence-result.json"
  node - "$INVOCATION" "$EVIDENCE_INVOCATION" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [invocationPath, evidencePath] = process.argv.slice(2);
const invocation = JSON.parse(fs.readFileSync(invocationPath, 'utf8'));
const runsRoot = path.join(invocation.stateRoot, 'runs');
const matches = fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot).filter(planDigest => {
  if (!/^[a-f0-9]{64}$/.test(planDigest)) return false;
  const candidate = path.join(runsRoot, planDigest, invocation.runId);
  try { return fs.lstatSync(candidate).isDirectory() && !fs.lstatSync(candidate).isSymbolicLink(); } catch { return false; }
}) : [];
if (matches.length !== 1) process.exit(1);
fs.writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1, command: 'evidence-verify', runId: invocation.runId,
  planDigest: matches[0], stateRoot: invocation.stateRoot,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
  if [ "$?" -eq 0 ]; then
    node "$ENGINE" --input "$EVIDENCE_INVOCATION" > "$EVIDENCE_RESULT"
    EVIDENCE_STATUS=$?
  else
    EVIDENCE_STATUS=1
  fi
  CLEANUP_EVIDENCE_INVOCATION="$INVOCATION_DIR/cleanup-evidence.json"
  CLEANUP_EVIDENCE_RESULT="$INVOCATION_DIR/cleanup-evidence-result.json"
  node - "$INVOCATION" "$PLAN_DIGEST" "$CLEANUP_EVIDENCE_INVOCATION" <<'NODE'
const fs = require('node:fs');
const [invocationPath, planDigest, evidencePath] = process.argv.slice(2);
const invocation = JSON.parse(fs.readFileSync(invocationPath, 'utf8'));
fs.writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1, command: 'task-evidence', runId: invocation.runId, planDigest,
  taskId: 'system.sudo-credential-cleanup', stateRoot: invocation.stateRoot,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
  if [ "$?" -eq 0 ]; then
    node "$ENGINE" --input "$CLEANUP_EVIDENCE_INVOCATION" > "$CLEANUP_EVIDENCE_RESULT"
    CLEANUP_EVIDENCE_STATUS=$?
  else
    CLEANUP_EVIDENCE_STATUS=1
  fi
  [ "$CLEANUP_EVIDENCE_STATUS" -eq 0 ] && INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED=true
  if [ "$ENGINE_STATUS" -eq 0 ] && [ "$EVIDENCE_STATUS" -ne 0 ]; then
    logg error 'Engine exited successfully without independently verifiable committed evidence'
    ENGINE_STATUS=2
  elif [ "$ENGINE_STATUS" -eq 0 ]; then
    logg info 'Verified authoritative engine completion evidence'
  fi
  rm -f "$INVOCATION" "$NORMALIZED_PLAN" "$LOAD_PLAN_INVOCATION" "$LOAD_PLAN_RESULT" \
    "$ARTIFACT_DERIVE_INVOCATION" "$ARTIFACT_DERIVE_RESULT" "$NATIVE_DERIVE_INVOCATION" "$NATIVE_DERIVE_RESULT"
  rm -f "$EVIDENCE_INVOCATION" "$EVIDENCE_RESULT"
  rm -f "$CLEANUP_EVIDENCE_INVOCATION" "$CLEANUP_EVIDENCE_RESULT"
  rmdir "$INVOCATION_DIR" 2>/dev/null || true
  return "$ENGINE_STATUS"
}

idEffectReceiptPath() {
  case "${INSTALL_DOCTOR_EFFECT_ID:-}" in custom-post-hooks) ;; *) return 2 ;; esac
  case "${INSTALL_DOCTOR_EFFECT_DIGEST:-}" in ''|*[!a-f0-9]*) return 2 ;; esac
  [ "${#INSTALL_DOCTOR_EFFECT_DIGEST}" -eq 64 ] || return 2
  [ -n "${INSTALL_DOCTOR_EFFECT_RECEIPT_DIR:-}" ] || return 2
  printf '%s/%s.verified\n' "$INSTALL_DOCTOR_EFFECT_RECEIPT_DIR" "$INSTALL_DOCTOR_EFFECT_ID"
}

idValidateCatalogPostMetadata() {
  command -v process-software-post-scripts >/dev/null 2>&1 || return 2
  process-software-post-scripts
}

idCheckEffectReceipt() {
  local RECEIPT
  RECEIPT="$(idEffectReceiptPath)" || return 2
  [ -f "$RECEIPT" ] && [ ! -L "$RECEIPT" ] || return 10
  [ "$(cat "$RECEIPT" 2>/dev/null)" = "$INSTALL_DOCTOR_EFFECT_DIGEST" ] || return 10
}

idRecordEffectReceipt() {
  local RECEIPT RECEIPT_DIR RECEIPT_TMP
  RECEIPT="$(idEffectReceiptPath)" || return 2
  RECEIPT_DIR="$(dirname "$RECEIPT")"
  [ ! -L "$RECEIPT_DIR" ] || return 2
  mkdir -p "$RECEIPT_DIR" || return 1
  chmod 0700 "$RECEIPT_DIR" || return 1
  RECEIPT_TMP="$(mktemp "$RECEIPT_DIR/.${INSTALL_DOCTOR_EFFECT_ID}.XXXXXX")" || return 1
  printf '%s\n' "$INSTALL_DOCTOR_EFFECT_DIGEST" > "$RECEIPT_TMP" || { rm -f "$RECEIPT_TMP"; return 1; }
  chmod 0600 "$RECEIPT_TMP" || { rm -f "$RECEIPT_TMP"; return 1; }
  mv -f "$RECEIPT_TMP" "$RECEIPT"
}

# Execute only the package roots carried by the normalized desired-state plan.
# `installx --all` is deliberately forbidden here: catalog defaults are
# discoverability policy, not authority to mutate a target. Installx expands
# dependencies for these exact roots and retains lazy acquisition semantics.
idRunSelectedDesiredPackages() {
  local PHASE="${1:-}" RAW="${INSTALL_DOCTOR_SELECTED_PACKAGES:-}" PACKAGE
  local -a PACKAGES=() INSTALLX_COMMAND
  case "$PHASE" in check|apply) ;; *) return 2 ;; esac
  case "$RAW" in *[!a-z0-9._,:-]*) return 2 ;; esac
  [ -n "$RAW" ] || return 0
  IFS=',' read -r -a PACKAGES <<< "$RAW"
  [ "${#PACKAGES[@]}" -le 4096 ] || return 2
  for PACKAGE in "${PACKAGES[@]}"; do
    case "$PACKAGE" in ''|*[!a-z0-9._:-]*) return 2 ;; esac
    [ "${#PACKAGE}" -le 128 ] || return 2
  done
  INSTALLX_COMMAND=("$INSTALL_DOCTOR_BOOTSTRAP_INSTALLX")
  [ "$PHASE" != check ] || INSTALLX_COMMAND+=(--check)
  INSTALLX_COMMAND+=(--lazy "${PACKAGES[@]}")
  (cd "$(dirname "$INSTALL_DOCTOR_CHEZMOI_SOURCE")" && "${INSTALLX_COMMAND[@]}")
}

idRunSelectedPostInstallxHooks() {
  local PHASE="${1:-}" POST_INSTALLX_DIR PACKAGE HOOK STATUS EXPECTED ACTUAL MATCHES ENTRY_PACKAGE ENTRY_SHA
  local NEEDS_APPLY=0 PENDING=0 FAILURES=0 FAILED_HOOKS=''
  case "$PHASE" in check|apply|verify) ;; *) return 2 ;; esac
  POST_INSTALLX_DIR="$HOME/.local/bin/post-installx"
  case "${INSTALL_DOCTOR_CUSTOM_HOOK_KEYS:-}" in *[!a-z0-9._,:-]*) return 2 ;; esac
  if [ -z "${INSTALL_DOCTOR_CUSTOM_HOOK_KEYS:-}" ]; then
    [ -z "${INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST:-}" ] || return 2
    return 0
  fi
  [ -d "$POST_INSTALLX_DIR" ] && [ ! -L "$POST_INSTALLX_DIR" ] || return 2
  [ -n "${INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST:-}" ] || return 2
  while IFS= read -r MATCHES; do
    ENTRY_PACKAGE="${MATCHES%%=*}"; ENTRY_SHA="${MATCHES#*=}"
    [ "$ENTRY_PACKAGE" != "$MATCHES" ] || return 2
    case "$ENTRY_PACKAGE" in ''|*[!a-z0-9._:-]*) return 2 ;; esac
    case "$ENTRY_SHA" in *[!a-f0-9]*) return 2 ;; esac
    [ "${#ENTRY_PACKAGE}" -le 128 ] && [ "${#ENTRY_SHA}" -eq 64 ] || return 2
  done <<EOF
$INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST
EOF
  while IFS= read -r PACKAGE; do
    [ -n "$PACKAGE" ] || continue
    HOOK="$POST_INSTALLX_DIR/post-$PACKAGE.sh"
    [ -f "$HOOK" ] && [ ! -L "$HOOK" ] || continue
    MATCHES="$(printf '%s\n' "$INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST" | awk -F= -v package="$PACKAGE" '$1 == package { count++; value=$2 } END { if (count == 1) print value }')"
    [ "${#MATCHES}" -eq 64 ] || return 2
    EXPECTED="$MATCHES"
    ACTUAL="$(idSha256File "$HOOK")" || return 2
    [ "$ACTUAL" = "$EXPECTED" ] || { logg error "custom hook digest mismatch: $(basename "$HOOK")"; return 2; }
    if [ "$PHASE" = apply ]; then
      if bash "$HOOK" --check </dev/null; then STATUS=0; else STATUS=$?; fi
      case "$STATUS" in
        0) continue ;;
        10)
          if bash "$HOOK" --apply </dev/null; then STATUS=0; else STATUS=$?; fi
          if [ "$STATUS" -eq 0 ]; then
            if bash "$HOOK" --verify </dev/null; then STATUS=0; else STATUS=$?; fi
            [ "$STATUS" -eq 0 ] || FAILURES=$((FAILURES + 1))
          elif [ "$STATUS" -eq 20 ]; then PENDING=1
          else FAILURES=$((FAILURES + 1)); fi
          ;;
        20) PENDING=1 ;;
        *) FAILURES=$((FAILURES + 1)) ;;
      esac
    else
      if bash "$HOOK" "--$PHASE" </dev/null; then STATUS=0; else STATUS=$?; fi
      case "$STATUS" in 0) ;; 10) NEEDS_APPLY=1 ;; 20) PENDING=1 ;; *) FAILURES=$((FAILURES + 1)) ;; esac
    fi
    [ "$FAILURES" -eq 0 ] || FAILED_HOOKS="$FAILED_HOOKS $(basename "$HOOK")"
  done < <(printf '%s\n' "${INSTALL_DOCTOR_CUSTOM_HOOK_KEYS//,/$'\n'}")
  [ "$FAILURES" -eq 0 ] || { logg error "$FAILURES selected post-installx hook(s) failed:$FAILED_HOOKS"; return 1; }
  [ "$PENDING" -eq 0 ] || return 20
  [ "$NEEDS_APPLY" -eq 0 ] || return 10
}

idRunEngineOperation() {
  local OPERATION_STATUS
  case "${1:-}" in
    stage-zero-install-user-check|stage-zero-install-user-verify)
      [ "$(id -u)" -ne 0 ] || return 10
      [ "$(id -un)" = "${INSTALL_DOCTOR_USER:-}" ] || return 2
      return 0
      ;;
    stage-zero-install-user-apply) return 2 ;;
    stage-zero-sudo-check|stage-zero-sudo-verify)
      sudo -n true >/dev/null 2>&1 && return 0
      return 10
      ;;
    stage-zero-sudo-apply) return 2 ;;
    warp-disconnect-check) idWarpDisconnectedCheck ;;
    warp-disconnect-apply) idWarpDisconnectedApply ;;
    warp-disconnect-verify) idWarpDisconnectedVerify ;;
    native-dependencies-check|native-dependencies-verify)
      command -v curl >/dev/null 2>&1 && command -v git >/dev/null 2>&1 && command -v rsync >/dev/null 2>&1 && return 0
      return 10
      ;;
    native-dependencies-apply)
      ensureBasicDeps
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -ne 1 ] || return 75
      return "$OPERATION_STATUS"
      ;;
    source-check) verifyChezmoiSourceRepo >/dev/null 2>&1 ;;
    source-apply)
      cloneChezmoiSourceRepo
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -ne 1 ] || return 75
      return "$OPERATION_STATUS"
      ;;
    source-verify) verifyChezmoiSourceRepo ;;
    homebrew-check|homebrew-verify)
      loadHomebrew
      command -v brew >/dev/null 2>&1 && return 0
      [ "${1:-}" = homebrew-check ] && return 10
      return 2
      ;;
    homebrew-apply)
      ensureHomebrew
      ;;
    homebrew-tools-check|homebrew-tools-verify)
      loadHomebrew
      command -v chezmoi >/dev/null 2>&1 && command -v gum >/dev/null 2>&1 && command -v zx >/dev/null 2>&1 && return 0
      [ "${1:-}" = homebrew-tools-check ] && return 10
      return 2
      ;;
    homebrew-tools-apply)
      loadHomebrew
      ensureHomebrewDeps
      ;;
    chezmoi-init-check)
      [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml" ] || return 10
      idChezmoi data >/dev/null 2>&1
      ;;
    chezmoi-init-apply) initChezmoiAndPrompt ;;
    chezmoi-init-verify)
      [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml" ] || return 2
      idChezmoi data >/dev/null 2>&1
      ;;
    desired-packages-check)
      idRunSelectedDesiredPackages check
      ;;
    desired-packages-apply)
      idRunSelectedDesiredPackages apply
      ;;
    desired-packages-verify)
      idRunSelectedDesiredPackages check
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -eq 0 ] && return 0
      return 2
      ;;
    macos-full-disk-access-check)
      [ "$(detect_os)" = macos ] || return 20
      [ -z "${HEADLESS_INSTALL:-}" ] || return 20
      plutil -lint /Library/Preferences/com.apple.TimeMachine.plist >/dev/null 2>&1 && return 0
      return 10
      ;;
    macos-full-disk-access-apply) ensureFullDiskAccess ;;
    macos-full-disk-access-verify)
      [ "$(detect_os)" = macos ] || return 20
      [ -z "${HEADLESS_INSTALL:-}" ] || return 20
      plutil -lint /Library/Preferences/com.apple.TimeMachine.plist >/dev/null 2>&1 && return 0
      return 30
      ;;
    macos-certificate-check)
      [ "$(detect_os)" = macos ] || return 20
      [ -z "${HEADLESS_INSTALL:-}" ] || return 20
      [ -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" ] || return 20
      security verify-cert -c "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" >/dev/null 2>&1 && return 0
      return 10
      ;;
    macos-certificate-apply) importCloudFlareCert ;;
    macos-certificate-verify)
      [ "$(detect_os)" = macos ] || return 20
      [ -z "${HEADLESS_INSTALL:-}" ] || return 20
      [ -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" ] || return 20
      security verify-cert -c "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" >/dev/null 2>&1
      ;;
    qubes-dom0-check)
      return 78
      ;;
    qubes-dom0-apply) return 78 ;;
    qubes-dom0-verify)
      return 78
      ;;
    configured-agent-tasks-check) idVerifyConfiguredAgentTasksReceipt ;;
    configured-agent-tasks-apply) idApplyConfiguredAgentTasks ;;
    configured-agent-tasks-verify)
      idVerifyConfiguredAgentTasksReceipt
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -eq 0 ] && return 0
      return 2
      ;;
    chezmoi-check)
      idChezmoi verify --no-pager >/dev/null 2>&1 && return 0
      return 10
      ;;
    chezmoi-apply) runChezmoi ;;
    chezmoi-verify) idChezmoi verify --no-pager ;;
    software-groups-check)
      command -v process-software-groups >/dev/null 2>&1 || return 2
      process-software-groups --check
      OPERATION_STATUS=$?
      case "$OPERATION_STATUS" in 0|10) return "$OPERATION_STATUS" ;; *) return 2 ;; esac
      ;;
    custom-post-hooks-check) idRunSelectedPostInstallxHooks check ;;
    software-groups-apply)
      command -v process-software-groups >/dev/null 2>&1 || return 2
      process-software-groups
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -eq 0 ] && return 0
      return 2
      ;;
    software-groups-verify)
      command -v process-software-groups >/dev/null 2>&1 || return 2
      process-software-groups --check
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -eq 0 ] && return 0
      return 2
      ;;
    custom-post-hooks-verify) idRunSelectedPostInstallxHooks verify ;;
    catalog-post-validation-check|catalog-post-validation-verify) idValidateCatalogPostMetadata ;;
    catalog-post-validation-apply) return 2 ;;
    custom-post-hooks-apply) idRunSelectedPostInstallxHooks apply ;;
    desired-services-check)
      [ -n "${INSTALL_DOCTOR_SELECTED_SERVICES:-}" ] || return 0
      command -v process-software-services >/dev/null 2>&1 || return 2
      process-software-services --check
      ;;
    desired-services-apply)
      [ -n "${INSTALL_DOCTOR_SELECTED_SERVICES:-}" ] || return 0
      command -v process-software-services >/dev/null 2>&1 || return 2
      process-software-services
      ;;
    desired-services-verify)
      [ -n "${INSTALL_DOCTOR_SELECTED_SERVICES:-}" ] || return 0
      command -v process-software-services >/dev/null 2>&1 || return 2
      process-software-services --check
      OPERATION_STATUS=$?
      [ "$OPERATION_STATUS" -eq 0 ] && return 0
      return 2
      ;;
    reboot-assessment-check)
      if isRebootRequired; then
        logg warn 'A reboot is required before convergence can be verified'
        return 11
      fi
      return 0
      ;;
    reboot-assessment-verify)
      if isRebootRequired; then
        logg warn 'A reboot is required before convergence can be verified'
        return 31
      fi
      return 0
      ;;
    reboot-assessment-apply) return 2 ;;
    *) logg error 'Unknown canonical engine operation'; return 2 ;;
  esac
}

idRunRequiredProvisionStep() {
  local LABEL="$1" STATUS
  shift
  logg info "$LABEL"
  "$@"
  STATUS=$?
  if [ "$STATUS" -ne 0 ]; then
    logg error "$LABEL failed (exit $STATUS)"
    idEmitProvisionStatus provision failed "$STATUS"
    return "$STATUS"
  fi
}

idProvisionExit() {
  local STATUS="$1"
  if [ "${INSTALL_DOCTOR_SUDO_PREPARED:-false}" = true ]; then
    removePasswordlessSudo || true
    INSTALL_DOCTOR_SUDO_PREPARED=false
  fi
  idCleanupProvisionerRuntime || true
  idOnProvisionExit "$STATUS"
}

# @description Invalidate the temporary sudo credential cache and remove legacy bootstrap state.
removePasswordlessSudo() {
  # Safety fallback for interruption before the journaled terminal cleanup
  # node can run. Never mutate admin membership or sudoers here.
  [ "${INSTALL_DOCTOR_SUDO_PREEXISTING:-false}" = true ] || sudo -K 2>/dev/null || true
}

# @description Render the `docs/terminal/post-install.md` file to the terminal at the end of the provisioning process
postProvision() {
  logg info 'Provisioning complete!'
  if command -v glow > /dev/null && [ -f "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/docs/terminal/post-install.md" ]; then
    glow "${XDG_DATA_HOME:-$HOME/.local/share}/chezmoi/docs/terminal/post-install.md"
  fi
}

# Validate a previously enrolled target account without changing identity,
# password, group, home, or administrator state. Cross-UID account creation
# cannot yet share the target user's protected journal, so it fails closed.
idValidateInstallUserAccount() {
  local INSTALL_USER="$1" EXPECTED_HOME ACCOUNT_HOME ACCOUNT_SHELL ACCOUNT_UID HOME_UID HOME_MODE HOME_PERMISSIONS ACCOUNT_GROUPS ENTRY GETENT
  case "$INSTALL_USER" in ''|*[!a-zA-Z0-9._-]*|[0-9.-]*) return 2 ;; esac
  id "$INSTALL_USER" >/dev/null 2>&1 || return 2
  ACCOUNT_UID="$(id -u "$INSTALL_USER" 2>/dev/null)" || return 2
  case "$ACCOUNT_UID" in ''|*[!0-9]*|0) return 2 ;; esac
  if [ "$(detect_os)" = macos ]; then
    EXPECTED_HOME="/Users/$INSTALL_USER"
    [ -x /usr/bin/dscl ] || return 2
    ACCOUNT_HOME="$(/usr/bin/dscl . -read "/Users/$INSTALL_USER" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p')"
    ACCOUNT_SHELL="$(/usr/bin/dscl . -read "/Users/$INSTALL_USER" UserShell 2>/dev/null | sed -n 's/^UserShell: //p')"
  else
    EXPECTED_HOME="/home/$INSTALL_USER"
    if [ -x /usr/bin/getent ]; then GETENT=/usr/bin/getent
    elif [ -x /bin/getent ]; then GETENT=/bin/getent
    else return 2; fi
    ENTRY="$("$GETENT" passwd "$INSTALL_USER" 2>/dev/null)" || return 2
    [ "$(printf '%s\n' "$ENTRY" | wc -l | tr -d ' ')" -eq 1 ] || return 2
    IFS=: read -r _ _ _ _ _ ACCOUNT_HOME ACCOUNT_SHELL <<EOF
$ENTRY
EOF
  fi
  [ "$ACCOUNT_HOME" = "$EXPECTED_HOME" ] || return 2
  case "$ACCOUNT_SHELL" in /bin/bash|/bin/zsh|/usr/bin/bash|/usr/bin/zsh) ;; *) return 2 ;; esac
  [ -x "$ACCOUNT_SHELL" ] || return 2
  [ -d "$EXPECTED_HOME" ] && [ ! -L "$EXPECTED_HOME" ] || return 2
  HOME_UID="$(stat -c '%u' "$EXPECTED_HOME" 2>/dev/null || stat -f '%u' "$EXPECTED_HOME" 2>/dev/null)" || return 2
  HOME_MODE="$(stat -c '%a' "$EXPECTED_HOME" 2>/dev/null || stat -f '%Lp' "$EXPECTED_HOME" 2>/dev/null)" || return 2
  case "$HOME_UID:$HOME_MODE" in *[!0-9:]*) return 2 ;; esac
  [ "$HOME_UID" = "$ACCOUNT_UID" ] || return 2
  HOME_PERMISSIONS=$((8#$HOME_MODE))
  [ $((HOME_PERMISSIONS & 8#022)) -eq 0 ] || return 2
  ACCOUNT_GROUPS="$(id -Gn "$INSTALL_USER" 2>/dev/null)" || return 2
  case " $ACCOUNT_GROUPS " in *' admin '*|*' sudo '*|*' wheel '*) ;; *) return 2 ;; esac
  printf '%s\n' "$EXPECTED_HOME"
}

idRequireRootInstallUserEnrollment() {
  [ "$(id -u)" -eq 0 ] || return 0
  INSTALL_DOCTOR_USER="${INSTALL_DOCTOR_USER:-${SUDO_USER:-}}"
  if [ -z "$INSTALL_DOCTOR_USER" ] || ! idValidateInstallUserAccount "$INSTALL_DOCTOR_USER" >/dev/null; then
    logg error 'Root provisioning requires an exact pre-existing non-root target account with its standard owned home, interactive shell, and admin/sudo/wheel membership.'
    logg error 'Install Doctor does not automatically create or elevate accounts; create or enroll the target account explicitly, then rerun with INSTALL_DOCTOR_USER set.'
    return 2
  fi
  export INSTALL_DOCTOR_USER
}

# Stage only the selected Debian native-package authority into a root-owned
# volatile release directory. The durable transaction fence lives separately
# under /var/lib; release bytes are re-established from the signed release.
idSealBrokerApprovalDelegation() {
  [ "${DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED:-false}" = true ] || return 0
  [ "$(id -u)" -eq 0 ] || { logg error 'Broker approval delegation must be sealed by the root parent'; return 2; }
  [ "${INSTALL_DOCTOR_RUNTIME_SOURCE:-}" = signed-archive ] \
    || { logg error 'Broker approval delegation requires the signed release Node runtime'; return 2; }
  local SOURCE="${DESKTOP_TOOLS_BROKER_APPROVAL_DELEGATION_PATH:-}"
  local EXPECTED_SHA="${DESKTOP_TOOLS_BROKER_APPROVAL_DELEGATION_SHA256:-}"
  local MINIMUM_EPOCH="${DESKTOP_TOOLS_BROKER_APPROVAL_MINIMUM_REVOCATION_EPOCH:-}"
  local OUTPUT KEY VALUE
  case "$EXPECTED_SHA" in ''|*[!a-f0-9]*) logg error 'Broker approval delegation digest is malformed'; return 2 ;; esac
  [ "${#EXPECTED_SHA}" -eq 64 ] || { logg error 'Broker approval delegation digest is malformed'; return 2; }
  case "$MINIMUM_EPOCH" in ''|*[!0-9]*) logg error 'Broker approval minimum revocation epoch is malformed'; return 2 ;; esac
  [ -n "$SOURCE" ] && [ -f "$SOURCE" ] && [ ! -L "$SOURCE" ] \
    || { logg error 'Verified broker approval delegation is unavailable'; return 2; }
  OUTPUT="$("${INSTALL_DOCTOR_RUNTIME_NODE}" - "$SOURCE" "$EXPECTED_SHA" "$MINIMUM_EPOCH" \
    "${INSTALL_DOCTOR_RELEASE_ID:-}" "${INSTALL_DOCTOR_VERIFIED_MANIFEST:-}" "${INSTALL_DOCTOR_MANIFEST_SHA256:-}" <<'NODE'
const fs=require('node:fs');const crypto=require('node:crypto');const path=require('node:path');
if(process.geteuid?.()!==0)throw new Error('root is required');
const [source,expectedSha,minimumEpochText,releaseId,manifestPath,manifestSha]=process.argv.slice(2);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)])):value;
const readExact=(file,maximum,expected)=>{const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>BigInt(maximum))throw new Error('delegation authority source is unsafe');const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const opened=fs.fstatSync(fd,{bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw new Error('delegation authority changed while opening');const bytes=fs.readFileSync(fd);if(BigInt(bytes.length)!==opened.size||hash(bytes)!==expected)throw new Error('delegation authority digest mismatch');return bytes;}finally{fs.closeSync(fd);}};
if(!/^[a-f0-9]{64}$/.test(expectedSha)||!/^[a-f0-9]{64}$/.test(manifestSha)||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(releaseId)||!/^\d+$/.test(minimumEpochText))throw new Error('delegation release binding is malformed');
const minimumEpoch=Number(minimumEpochText);if(!Number.isSafeInteger(minimumEpoch)||minimumEpoch<0)throw new Error('minimum revocation epoch is invalid');
const manifestBytes=readExact(manifestPath,1_048_576,manifestSha);const manifestText=manifestBytes.toString('utf8');if(!manifestText.endsWith('\n')||manifestText.includes('\r')||manifestText.includes('\n\n'))throw new Error('release manifest encoding is invalid');
const manifest=new Map();for(const line of manifestText.slice(0,-1).split('\n')){const separator=line.indexOf('=');if(separator<1)throw new Error('release manifest line is malformed');const key=line.slice(0,separator),value=line.slice(separator+1);if(manifest.has(key))throw new Error('release manifest contains duplicate authority');manifest.set(key,value);}
if(manifest.get('schema_version')!=='9'||manifest.get('product_id')!=='desktop-tools'||manifest.get('release_id')!==releaseId||manifest.get('broker_approval_delegation_sha256')!==expectedSha||manifest.get('broker_approval_minimum_revocation_epoch')!==minimumEpochText)throw new Error('delegation differs from the signed release manifest');
const expectedUrl=`https://desktop.tools/releases/${releaseId}/broker-approval-signer-delegation.json`;if(manifest.get('broker_approval_delegation_url')!==expectedUrl)throw new Error('delegation URL is outside the exact release');
const delegationBytes=readExact(source,65_536,expectedSha);if(manifest.get('broker_approval_delegation_size')!==String(delegationBytes.length))throw new Error('delegation size differs from the signed release manifest');
let delegation;try{delegation=JSON.parse(delegationBytes.toString('utf8'));}catch{throw new Error('delegation is not valid JSON');}
const keys=['algorithm','channel','delegationDigest','keyId','kind','maximumApprovalLifetimeSeconds','notAfter','notBefore','product','publicKeySpki','releaseId','revocationEpoch','schemaVersion','signatureDomain'];if(!delegation||Array.isArray(delegation)||JSON.stringify(Object.keys(delegation).sort())!==JSON.stringify(keys)||!delegationBytes.equals(Buffer.from(`${JSON.stringify(canonical(delegation))}\n`)))throw new Error('delegation is not exact canonical JSON');
const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);if(delegation.schemaVersion!==1||delegation.kind!=='desktop-tools-broker-approval-signer-delegation'||delegation.algorithm!=='Ed25519'||delegation.signatureDomain!=='desktop-tools-broker-approval-v1'||delegation.product!=='desktop-tools'||delegation.releaseId!==releaseId||delegation.channel!=='stable'||!id(delegation.keyId)||!Number.isSafeInteger(delegation.maximumApprovalLifetimeSeconds)||delegation.maximumApprovalLifetimeSeconds<1||delegation.maximumApprovalLifetimeSeconds>1800||!Number.isSafeInteger(delegation.revocationEpoch)||delegation.revocationEpoch<minimumEpoch)throw new Error('delegation identity or policy is invalid');
const created=Number(manifest.get('created_at'))*1000,expires=Number(manifest.get('expires_at'))*1000,before=Date.parse(delegation.notBefore),after=Date.parse(delegation.notAfter);if(!Number.isSafeInteger(created)||!Number.isSafeInteger(expires)||!Number.isFinite(before)||!Number.isFinite(after)||new Date(before).toISOString()!==delegation.notBefore||new Date(after).toISOString()!==delegation.notAfter||before>created||after<expires||before>=after)throw new Error('delegation does not contain the signed release validity window');
let publicKey;try{if(typeof delegation.publicKeySpki!=='string'||!/^[A-Za-z0-9_-]{32,512}$/.test(delegation.publicKeySpki))throw new Error();const der=Buffer.from(delegation.publicKeySpki,'base64url');if(der.toString('base64url')!==delegation.publicKeySpki)throw new Error();publicKey=crypto.createPublicKey({key:der,type:'spki',format:'der'});if(publicKey.asymmetricKeyType!=='ed25519'||!publicKey.export({type:'spki',format:'der'}).equals(der))throw new Error();}catch{throw new Error('delegation public key is not exact Ed25519 SPKI');}
const {delegationDigest,...projection}=delegation;const semanticDigest=hash(Buffer.from(`desktop-tools:broker-approval-signer-delegation:v1\0${JSON.stringify(canonical(projection))}`));if(delegationDigest!==semanticDigest)throw new Error('delegation semantic digest is invalid');
for(const [directory,mode] of [['/run/desktop-tools',0o711],['/run/desktop-tools/authority',0o711],[`/run/desktop-tools/authority/${releaseId}`,0o711]]){try{fs.mkdirSync(directory,{mode});}catch(error){if(error.code!=='EEXIST')throw error;}const metadata=fs.lstatSync(directory);if(!metadata.isDirectory()||metadata.isSymbolicLink()||metadata.uid!==0||(metadata.mode&0o777)!==mode)throw new Error('delegation authority directory is unsafe');}
const root=`/run/desktop-tools/authority/${releaseId}`;const install=(name,bytes,mode)=>{const target=path.join(root,name);try{const metadata=fs.lstatSync(target);if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.uid!==0||(metadata.mode&0o777)!==mode||hash(fs.readFileSync(target))!==hash(bytes))throw new Error('existing sealed delegation authority differs');return target;}catch(error){if(error.code!=='ENOENT')throw error;}const temporary=`${target}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,target);return target;};
const delegationPath=install('broker-approval-signer-delegation.json',delegationBytes,0o400);const evidence={schemaVersion:1,kind:'desktop-tools-broker-approval-authority',releaseId,manifestSha256:manifestSha,delegationSha256:expectedSha,delegationDigest,keyId:delegation.keyId,revocationEpoch:delegation.revocationEpoch,minimumRevocationEpoch:minimumEpoch};const evidenceBytes=Buffer.from(`${JSON.stringify(canonical(evidence))}\n`);const evidencePath=install('broker-approval-authority.json',evidenceBytes,0o400);
process.stdout.write(`DELEGATION_PATH=${delegationPath}\nDELEGATION_SHA256=${expectedSha}\nDELEGATION_DIGEST=${delegationDigest}\nDELEGATION_EVIDENCE_PATH=${evidencePath}\nDELEGATION_EVIDENCE_SHA256=${hash(evidenceBytes)}\n`);
NODE
)" || { logg error 'Unable to seal the signed broker approval delegation'; return 2; }
  while IFS='=' read -r KEY VALUE; do
    case "$KEY" in
      DELEGATION_PATH|DELEGATION_SHA256|DELEGATION_DIGEST|DELEGATION_EVIDENCE_PATH|DELEGATION_EVIDENCE_SHA256)
        printf -v "DESKTOP_TOOLS_BROKER_$KEY" '%s' "$VALUE"; export "DESKTOP_TOOLS_BROKER_$KEY" ;;
      *) logg error 'Broker approval delegation sealing returned an unknown field'; return 2 ;;
    esac
  done <<< "$OUTPUT"
  [ -n "${DESKTOP_TOOLS_BROKER_DELEGATION_PATH:-}" ] && [ -n "${DESKTOP_TOOLS_BROKER_DELEGATION_DIGEST:-}" ] \
    && [ -n "${DESKTOP_TOOLS_BROKER_DELEGATION_EVIDENCE_PATH:-}" ] \
    || { logg error 'Broker approval delegation sealing returned incomplete authority'; return 2; }
}

idStageNativeBrokerAuthority() {
  [ "${DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED:-false}" = true ] || return 0
  [ "$(id -u)" -eq 0 ] || { logg error 'Native broker authority must be staged by the root parent'; return 2; }
  [ "${INSTALL_DOCTOR_PLATFORM_CELL:-}" = debian-12-x64-native ] \
    || { logg error 'Native broker authority is supported only on Debian 12 x64 native hosts'; return 2; }
  [ "${INSTALL_DOCTOR_RUNTIME_SOURCE:-}" = signed-archive ] \
    || { logg error 'Native broker authority requires the signed release Node runtime'; return 2; }
  idSealBrokerApprovalDelegation || return $?
  local OUTPUT KEY VALUE NATIVE_STAGE DOWNLOAD_STATUS=0 DOWNLOAD_PID
  NATIVE_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/desktop-tools-native.XXXXXX")" || return 1
  chmod 0700 "$NATIVE_STAGE" || { rm -rf -- "$NATIVE_STAGE"; return 1; }
  local -a NATIVE_DOWNLOADS=(
    "${DESKTOP_TOOLS_DEBIAN_KEYRING_URL:-}|${DESKTOP_TOOLS_DEBIAN_KEYRING_SHA256:-}|${DESKTOP_TOOLS_DEBIAN_KEYRING_SIZE:-}|$NATIVE_STAGE/keyring"
    "${DESKTOP_TOOLS_DEBIAN_INRELEASE_URL:-}|${DESKTOP_TOOLS_DEBIAN_INRELEASE_SHA256:-}|${DESKTOP_TOOLS_DEBIAN_INRELEASE_SIZE:-}|$NATIVE_STAGE/inrelease"
    "${DESKTOP_TOOLS_DEBIAN_PACKAGES_URL:-}|${DESKTOP_TOOLS_DEBIAN_PACKAGES_SHA256:-}|${DESKTOP_TOOLS_DEBIAN_PACKAGES_SIZE:-}|$NATIVE_STAGE/packages"
    "${DESKTOP_TOOLS_DEBIAN_TREE_URL:-}|${DESKTOP_TOOLS_DEBIAN_TREE_SHA256:-}|${DESKTOP_TOOLS_DEBIAN_TREE_SIZE:-}|$NATIVE_STAGE/tree"
  )
  local -a NATIVE_PIDS=()
  local SPEC URL SHA SIZE DESTINATION ACTUAL_SIZE ACTUAL_SHA
  for SPEC in "${NATIVE_DOWNLOADS[@]}"; do
    IFS='|' read -r URL SHA SIZE DESTINATION <<< "$SPEC"
    case "$URL" in "https://desktop.tools/releases/${INSTALL_DOCTOR_RELEASE_ID}/"*) ;; *) rm -rf -- "$NATIVE_STAGE"; logg error 'Native artifact URL is outside the exact release'; return 2 ;; esac
    case "$SHA" in ''|*[!a-f0-9]*) rm -rf -- "$NATIVE_STAGE"; logg error 'Native artifact digest is malformed'; return 2 ;; esac
    case "$SIZE" in ''|*[!0-9]*) rm -rf -- "$NATIVE_STAGE"; logg error 'Native artifact size is malformed'; return 2 ;; esac
    [ "${#SHA}" -eq 64 ] && [ "$SIZE" -gt 0 ] && [ "$SIZE" -le 268435456 ] \
      || { rm -rf -- "$NATIVE_STAGE"; logg error 'Native artifact authority is outside policy'; return 2; }
    curl -q --fail --show-error --silent --proto '=https' --proto-redir '=https' --tlsv1.2 --max-redirs 0 \
      --retry 2 --retry-all-errors --retry-delay 1 --connect-timeout 10 --max-time 300 --max-filesize "$SIZE" \
      --output "$DESTINATION" "$URL" & NATIVE_PIDS+=("$!")
  done
  for DOWNLOAD_PID in "${NATIVE_PIDS[@]}"; do wait "$DOWNLOAD_PID" || DOWNLOAD_STATUS=1; done
  [ "$DOWNLOAD_STATUS" -eq 0 ] || { rm -rf -- "$NATIVE_STAGE"; logg error 'Selected native artifact download failed'; return 2; }
  for SPEC in "${NATIVE_DOWNLOADS[@]}"; do
    IFS='|' read -r URL SHA SIZE DESTINATION <<< "$SPEC"
    ACTUAL_SIZE="$(wc -c < "$DESTINATION" | tr -d '[:space:]')"; ACTUAL_SHA="$(idSha256File "$DESTINATION")" || { rm -rf -- "$NATIVE_STAGE"; return 2; }
    [ "$ACTUAL_SIZE" = "$SIZE" ] && [ "$ACTUAL_SHA" = "$SHA" ] || { rm -rf -- "$NATIVE_STAGE"; logg error 'Selected native artifact verification failed'; return 2; }
  done
  OUTPUT="$("${INSTALL_DOCTOR_RUNTIME_NODE}" - \
    "${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}" "${DESKTOP_TOOLS_TOOLS_SHA256:-}" \
    "${INSTALL_DOCTOR_RUNTIME_NODE:-}" "${INSTALL_DOCTOR_RELEASE_ID:-}" \
    "${INSTALL_DOCTOR_VERIFIED_MANIFEST:-}" "${INSTALL_DOCTOR_VERIFIED_SIGNATURE:-}" "${INSTALL_DOCTOR_CATALOG_PATH:-}" \
    "$NATIVE_STAGE/keyring" "$NATIVE_STAGE/inrelease" "$NATIVE_STAGE/packages" "$NATIVE_STAGE/tree" <<'NODE'
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const zlib = require('node:zlib');
if (process.geteuid?.() !== 0 || process.platform !== 'linux' || process.arch !== 'x64') throw new Error('root Linux x64 is required');
const [archive, archiveDigest, runtime, releaseId, manifest, signature, catalog, keyring, inrelease, packages, tree] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(releaseId) || !/^[a-f0-9]{64}$/.test(archiveDigest)) throw new Error('release authority is malformed');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readExact = (source, maximum, expected = null) => { const before=fs.lstatSync(source,{bigint:true}); if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>BigInt(maximum)) throw new Error('authority source is unsafe'); const fd=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)); try { const opened=fs.fstatSync(fd,{bigint:true}); if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size) throw new Error('authority source changed'); const bytes=fs.readFileSync(fd); if(BigInt(bytes.length)!==opened.size||(expected&&hash(bytes)!==expected)) throw new Error('authority source digest mismatch'); return bytes; } finally { fs.closeSync(fd); } };
const archiveBytes=readExact(archive,33_554_432,archiveDigest); const expanded=zlib.gunzipSync(archiveBytes,{maxOutputLength:64*1024*1024});
const entries=new Map(); let ended=false; for(let offset=0;offset+512<=expanded.length;){const h=expanded.subarray(offset,offset+512);offset+=512;if(h.every(b=>b===0)){if(offset+512>expanded.length||!expanded.subarray(offset,offset+512).every(b=>b===0)||!expanded.subarray(offset+512).every(b=>b===0))throw new Error('tools archive terminator is invalid');ended=true;break;}const name=h.subarray(0,100).toString('utf8').split('\0',1)[0];const sizeText=h.subarray(124,136).toString('ascii').replaceAll('\0','').trim();const sumText=h.subarray(148,156).toString('ascii').replaceAll('\0','').trim();const check=Buffer.from(h);check.fill(0x20,148,156);if(!name||!/^[0-7]+$/.test(sizeText)||!/^[0-7]+$/.test(sumText)||parseInt(sumText,8)!==check.reduce((a,b)=>a+b,0)||(h[156]!==0&&h[156]!==0x30)||name.startsWith('/')||name.split('/').includes('..')||entries.has(name))throw new Error('tools archive is malformed');const size=parseInt(sizeText,8);if(!Number.isSafeInteger(size)||size<0||offset+size>expanded.length)throw new Error('tools archive entry is malformed');entries.set(name,expanded.subarray(offset,offset+size));offset+=Math.ceil(size/512)*512;} if(!ended)throw new Error('tools archive lacks its terminator');
const required=['bin/linux-x64/desktop-tools-privileged-broker','lib/desktop-tools-privileged-controller.mjs','lib/desktop-tools-privileged-worker.mjs']; const closure=[...required,'bin/desktop-tools-mcp-server.mjs','contracts/runtime-policy.json','contracts/supervisor-api.schema.json','contracts/typed-tools.json','runtime/encrypted-recording.mjs'].sort(); if(JSON.stringify([...entries.keys()].sort())!==JSON.stringify(closure))throw new Error('tools archive closure is not exact'); for(const name of required)if(!entries.get(name)?.length)throw new Error(`tools archive lacks ${name}`);
for(const segment of ['/run','/run/desktop-tools','/run/desktop-tools/authority',`/run/desktop-tools/authority/${releaseId}`]){const wanted=segment==='/run'?null:0o711;try{fs.mkdirSync(segment,{mode:wanted??0o755});}catch(e){if(e.code!=='EEXIST')throw e;}const m=fs.lstatSync(segment);if(!m.isDirectory()||m.isSymbolicLink()||m.uid!==0||(wanted===null?(m.mode&0o022)!==0:(m.mode&0o777)!==wanted))throw new Error('authority directory is unsafe');}
const root=`/run/desktop-tools/authority/${releaseId}`; const install=(name,bytes,mode)=>{const target=`${root}/${name}`;try{const m=fs.lstatSync(target);if(!m.isFile()||m.isSymbolicLink()||m.nlink!==1||m.uid!==0||(m.mode&0o777)!==mode||hash(fs.readFileSync(target))!==hash(bytes))throw new Error('existing authority differs');return target;}catch(e){if(e.code!=='ENOENT')throw e;}const temp=`${target}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,target);return target;};
const installed={helper:install('desktop-tools-privileged-broker',entries.get(required[0]),0o555),controller:install('desktop-tools-privileged-controller.mjs',entries.get(required[1]),0o400),worker:install('desktop-tools-privileged-worker.mjs',entries.get(required[2]),0o400),runtime:install('node',readExact(runtime,268_435_456),0o500),manifest:install('manifest',readExact(manifest,1_048_576),0o400),signature:install('manifest.sig',readExact(signature,65_536),0o400),catalog:install('catalog.json',readExact(catalog,16_777_216),0o400),keyring:install('debian-keyring.gpg',readExact(keyring,16_777_216),0o400),inrelease:install('debian-inrelease',readExact(inrelease,16_777_216),0o400),packages:install('debian-Packages.xz',readExact(packages,268_435_456),0o400),tree:install('tree.deb',readExact(tree,268_435_456),0o400)};
for(const [key,value] of Object.entries(installed)){process.stdout.write(`${key.toUpperCase()}_PATH=${value}\n${key.toUpperCase()}_SHA256=${hash(fs.readFileSync(value))}\n`);}
NODE
)" || { rm -rf -- "$NATIVE_STAGE"; logg error 'Unable to stage the signed native broker authority'; return 2; }
  rm -rf -- "$NATIVE_STAGE"
  while IFS='=' read -r KEY VALUE; do
    case "$KEY" in
      HELPER_PATH|HELPER_SHA256|CONTROLLER_PATH|CONTROLLER_SHA256|WORKER_PATH|WORKER_SHA256|RUNTIME_PATH|RUNTIME_SHA256|MANIFEST_PATH|MANIFEST_SHA256|SIGNATURE_PATH|SIGNATURE_SHA256|CATALOG_PATH|CATALOG_SHA256|KEYRING_PATH|KEYRING_SHA256|INRELEASE_PATH|INRELEASE_SHA256|PACKAGES_PATH|PACKAGES_SHA256|TREE_PATH|TREE_SHA256)
        printf -v "DESKTOP_TOOLS_BROKER_$KEY" '%s' "$VALUE"; export "DESKTOP_TOOLS_BROKER_$KEY" ;;
      *) logg error 'Native broker staging returned an unknown field'; return 2 ;;
    esac
  done <<< "$OUTPUT"
  [ -n "${DESKTOP_TOOLS_BROKER_HELPER_PATH:-}" ] && [ -n "${DESKTOP_TOOLS_BROKER_CONTROLLER_PATH:-}" ] \
    && [ -n "${DESKTOP_TOOLS_BROKER_WORKER_PATH:-}" ] && [ -n "${DESKTOP_TOOLS_BROKER_RUNTIME_PATH:-}" ] \
    || { logg error 'Native broker staging returned an incomplete closure'; return 2; }
}

# @description Continue a root launch under an already enrolled compatible
#     non-root account. Account creation and elevation are intentionally not
#     performed outside the canonical journal.
function ensureInstallUser() {
  local INSTALL_USER="${INSTALL_DOCTOR_USER:-}"
  [ -n "$INSTALL_USER" ] || { logg error 'Approved install-user identity is missing'; return 2; }
  local USER_HOME_DIR
  # Check if the script is running as root
  if [ "$(id -u)" -eq 0 ]; then
    USER_HOME_DIR="$(idValidateInstallUserAccount "$INSTALL_USER")" || {
      logg error 'The enrolled target account changed after admission; refusing root-to-user handoff.'
      return 2
    }
    logg info "Continuing with pre-enrolled target account '$INSTALL_USER'."

    # Seal the complete handoff in a root-owned unpredictable directory. No
    # path is exposed to the target user until every copy and digest verifies.
    local CURRENT_PROVISIONER VERIFIED_ENGINE VERIFIED_MANIFEST VERIFIED_SIGNATURE VERIFIED_CATALOG HANDOFF_BASE HANDOFF_ROOT USER_PROVISIONER USER_ENGINE USER_MANIFEST USER_SIGNATURE USER_CATALOG ENV_EXPORT USER_RUNTIME
    local USER_OPENCODE_ARCHIVE USER_SUPERVISOR USER_TOOLS_ARCHIVE USER_OPENCODE_LOCK
    local PROVISIONER_SHA MANIFEST_SHA SIGNATURE_SHA ENGINE_SHA CATALOG_SHA RUNTIME_SHA ENV_SHA HANDOFF_STATUS
    local BROKER_COORD_ROOT BROKER_USER_ROOT BROKER_ROOT_ROOT BROKER_REQUEST BROKER_RESPONSE BROKER_DERIVE_INPUT BROKER_DERIVED BROKER_APPROVAL_INPUT BROKER_APPROVAL_OUTPUT BROKER_CONTROLLER_INPUT BROKER_READY BROKER_ERROR BROKER_PAYLOAD
    local BROKER_CHILD_PID='' BROKER_CONTROLLER_PID='' BROKER_SOCKET_DIR='' BROKER_WAIT=0 INSTALL_UID INSTALL_GID
    CURRENT_PROVISIONER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
    VERIFIED_ENGINE="${INSTALL_DOCTOR_ENGINE_PATH:-}"
    VERIFIED_MANIFEST="${INSTALL_DOCTOR_VERIFIED_MANIFEST:-}"
    VERIFIED_SIGNATURE="${INSTALL_DOCTOR_VERIFIED_SIGNATURE:-}"
    VERIFIED_CATALOG="${INSTALL_DOCTOR_CATALOG_PATH:-}"
    HANDOFF_BASE="${TMPDIR:-/tmp}"
    if [ "$(detect_os)" != macos ] && [ -d /run ] && [ ! -L /run ]; then
      local RUN_OWNER RUN_MODE RUN_PERMISSIONS
      RUN_OWNER="$(stat -c '%u' /run 2>/dev/null || true)"
      RUN_MODE="$(stat -c '%a' /run 2>/dev/null || true)"
      case "$RUN_OWNER:$RUN_MODE" in *[!0-9:]*) ;; *)
        RUN_PERMISSIONS=$((8#$RUN_MODE))
        if [ "$RUN_OWNER" = 0 ] && [ $((RUN_PERMISSIONS & 8#022)) -eq 0 ]; then HANDOFF_BASE=/run; fi
      esac
    fi
    HANDOFF_ROOT="$(mktemp -d "$HANDOFF_BASE/install-doctor-handoff.XXXXXX")" || return 1
    chmod 0700 "$HANDOFF_ROOT" || { rm -rf -- "$HANDOFF_ROOT"; return 1; }
    USER_PROVISIONER="$HANDOFF_ROOT/provision.sh"; USER_ENGINE="$HANDOFF_ROOT/install-doctor-engine.mjs"
    USER_MANIFEST="$HANDOFF_ROOT/manifest"; USER_SIGNATURE="$HANDOFF_ROOT/manifest.sig"; USER_CATALOG="$HANDOFF_ROOT/catalog.json"; ENV_EXPORT="$HANDOFF_ROOT/environment.sh"
    USER_RUNTIME="$HANDOFF_ROOT/node"
    USER_OPENCODE_ARCHIVE="$HANDOFF_ROOT/opencode-runtime"; USER_SUPERVISOR="$HANDOFF_ROOT/desktop-tools-supervisor.mjs"
    USER_TOOLS_ARCHIVE="$HANDOFF_ROOT/desktop-tools-tools.tar.gz"; USER_OPENCODE_LOCK="$HANDOFF_ROOT/opencode.lock.json"
    INSTALL_UID="$(id -u "$INSTALL_USER")"; INSTALL_GID="$(id -g "$INSTALL_USER")"
    _idCleanupHandoff() {
      [ -z "${BROKER_CONTROLLER_PID:-}" ] || { kill -TERM "$BROKER_CONTROLLER_PID" 2>/dev/null || true; wait "$BROKER_CONTROLLER_PID" 2>/dev/null || true; }
      [ -z "${BROKER_CHILD_PID:-}" ] || { kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; }
      case "${BROKER_SOCKET_DIR:-}" in /run/desktop-tools/broker/*) rmdir "$BROKER_SOCKET_DIR" 2>/dev/null || true ;; esac
      case "${HANDOFF_ROOT:-}" in "$HANDOFF_BASE"/install-doctor-handoff.*) rm -rf -- "$HANDOFF_ROOT" ;; esac
    }
    _idCleanupHandoffAndReport() { local STATUS=$?; _idCleanupHandoff; idCleanupProvisionerRuntime || true; idOnProvisionExit "$STATUS"; }
    trap '_idCleanupHandoffAndReport' EXIT
    trap '_idCleanupHandoff; idCleanupProvisionerRuntime || true; exit 130' INT
    trap '_idCleanupHandoff; idCleanupProvisionerRuntime || true; exit 143' TERM
    [ -f "$CURRENT_PROVISIONER" ] && [ ! -L "$CURRENT_PROVISIONER" ] || return 1
    [ -f "$VERIFIED_ENGINE" ] && [ ! -L "$VERIFIED_ENGINE" ] || { logg error 'Verified installer engine is unavailable for user handoff'; return 1; }
    [ -f "$VERIFIED_MANIFEST" ] && [ ! -L "$VERIFIED_MANIFEST" ] || { logg error 'Verified release manifest is unavailable for user handoff'; return 1; }
    [ -f "$VERIFIED_SIGNATURE" ] && [ ! -L "$VERIFIED_SIGNATURE" ] || { logg error 'Verified release signature is unavailable for user handoff'; return 1; }
    [ -f "$VERIFIED_CATALOG" ] && [ ! -L "$VERIFIED_CATALOG" ] || { logg error 'Verified catalog is unavailable for user handoff'; return 1; }
    PROVISIONER_SHA="$(idSha256File "$CURRENT_PROVISIONER")"; MANIFEST_SHA="$(idSha256File "$VERIFIED_MANIFEST")"
    SIGNATURE_SHA="$(idSha256File "$VERIFIED_SIGNATURE")"; ENGINE_SHA="$(idSha256File "$VERIFIED_ENGINE")"; CATALOG_SHA="$(idSha256File "$VERIFIED_CATALOG")"
    [ "$PROVISIONER_SHA" = "${INSTALL_DOCTOR_ARTIFACT_SHA256:-}" ] && [ "$MANIFEST_SHA" = "${INSTALL_DOCTOR_MANIFEST_SHA256:-}" ] \
      && [ "$ENGINE_SHA" = "${INSTALL_DOCTOR_ENGINE_SHA256:-}" ] && [ "$CATALOG_SHA" = "${INSTALL_DOCTOR_CATALOG_SHA256:-}" ] \
      || { logg error 'Root handoff source digest mismatch'; return 1; }
    idInstallSealedHandoffFile "$CURRENT_PROVISIONER" "$USER_PROVISIONER" 0700 "$PROVISIONER_SHA" \
      && idInstallSealedHandoffFile "$VERIFIED_ENGINE" "$USER_ENGINE" 0700 "$ENGINE_SHA" \
      && idInstallSealedHandoffFile "$VERIFIED_MANIFEST" "$USER_MANIFEST" 0600 "$MANIFEST_SHA" \
      && idInstallSealedHandoffFile "$VERIFIED_SIGNATURE" "$USER_SIGNATURE" 0600 "$SIGNATURE_SHA" \
      && idInstallSealedHandoffFile "$VERIFIED_CATALOG" "$USER_CATALOG" 0600 "$CATALOG_SHA" \
      || { logg error 'Copied handoff set failed checksum verification'; return 1; }
    if [ -n "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}${DESKTOP_TOOLS_SUPERVISOR_PATH:-}${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}" ]; then
      idInstallSealedHandoffFile "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}" "$USER_OPENCODE_ARCHIVE" 0600 "${DESKTOP_TOOLS_OPENCODE_SHA256:-}" \
        && idInstallSealedHandoffFile "${DESKTOP_TOOLS_SUPERVISOR_PATH:-}" "$USER_SUPERVISOR" 0600 "${DESKTOP_TOOLS_SUPERVISOR_SHA256:-}" \
        && idInstallSealedHandoffFile "${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}" "$USER_TOOLS_ARCHIVE" 0600 "${DESKTOP_TOOLS_TOOLS_SHA256:-}" \
        && idInstallSealedHandoffFile "${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}" "$USER_OPENCODE_LOCK" 0600 "${DESKTOP_TOOLS_OPENCODE_LOCK_SHA256:-}" \
        || { logg error 'Desktop Tools runtime handoff failed checksum verification'; return 1; }
      # Release artifacts are public, nonsecret authority. Keep them root-owned
      # and immutable to the target while granting read-only traversal through
      # the unpredictable handoff directory.
      chmod 0444 "$USER_OPENCODE_ARCHIVE" "$USER_SUPERVISOR" "$USER_TOOLS_ARCHIVE" "$USER_OPENCODE_LOCK" || return 1
      DESKTOP_TOOLS_OPENCODE_ARCHIVE="$USER_OPENCODE_ARCHIVE"; DESKTOP_TOOLS_SUPERVISOR_PATH="$USER_SUPERVISOR"
      DESKTOP_TOOLS_TOOLS_ARCHIVE="$USER_TOOLS_ARCHIVE"; DESKTOP_TOOLS_OPENCODE_LOCK_PATH="$USER_OPENCODE_LOCK"
      export DESKTOP_TOOLS_OPENCODE_ARCHIVE DESKTOP_TOOLS_SUPERVISOR_PATH DESKTOP_TOOLS_TOOLS_ARCHIVE DESKTOP_TOOLS_OPENCODE_LOCK_PATH
    fi
    if [ -n "${INSTALL_DOCTOR_RUNTIME_STAGE:-}" ]; then
      [ -f "${INSTALL_DOCTOR_RUNTIME_NODE:-}" ] && [ ! -L "${INSTALL_DOCTOR_RUNTIME_NODE:-}" ] || return 1
      RUNTIME_SHA="$(idSha256File "$INSTALL_DOCTOR_RUNTIME_NODE")"
      idInstallSealedHandoffFile "$INSTALL_DOCTOR_RUNTIME_NODE" "$USER_RUNTIME" 0700 "$RUNTIME_SHA" || return 1
      INSTALL_DOCTOR_RUNTIME_NODE="$USER_RUNTIME"
    else
      USER_RUNTIME="${INSTALL_DOCTOR_RUNTIME_NODE:-}"
      if [ -L "$USER_RUNTIME" ]; then
        if command -v realpath >/dev/null 2>&1; then USER_RUNTIME="$(realpath "$USER_RUNTIME")"
        elif readlink -f "$USER_RUNTIME" >/dev/null 2>&1; then USER_RUNTIME="$(readlink -f "$USER_RUNTIME")"
        else logg error 'Cannot safely resolve the system Node runtime for handoff'; return 1
        fi
      fi
      [ -f "$USER_RUNTIME" ] && [ ! -L "$USER_RUNTIME" ] && [ -x "$USER_RUNTIME" ] \
        || { logg error 'System Node runtime is unsafe for handoff'; return 1; }
      RUNTIME_SHA="$(idSha256File "$USER_RUNTIME")"
      idInstallSealedHandoffFile "$USER_RUNTIME" "$HANDOFF_ROOT/node" 0700 "$RUNTIME_SHA" || return 1
      USER_RUNTIME="$HANDOFF_ROOT/node"
      INSTALL_DOCTOR_RUNTIME_NODE="$USER_RUNTIME"
    fi
    INSTALL_DOCTOR_RUNTIME_SOURCE=sealed-handoff
    INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256="$RUNTIME_SHA"
    export INSTALL_DOCTOR_RUNTIME_SOURCE INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256
    INSTALL_DOCTOR_ENGINE_PATH="$USER_ENGINE"
    INSTALL_DOCTOR_VERIFIED_MANIFEST="$USER_MANIFEST"
    INSTALL_DOCTOR_VERIFIED_SIGNATURE="$USER_SIGNATURE"
    INSTALL_DOCTOR_CATALOG_PATH="$USER_CATALOG"
    export INSTALL_DOCTOR_ENGINE_PATH INSTALL_DOCTOR_VERIFIED_MANIFEST INSTALL_DOCTOR_VERIFIED_SIGNATURE INSTALL_DOCTOR_CATALOG_PATH INSTALL_DOCTOR_CATALOG_SHA256
    # The user-owned plan decides whether a privileged broker is needed. Root
    # creates only private coordination paths before handoff and acquires no
    # native artifacts unless the approved user plan publishes a request.
    BROKER_COORD_ROOT="$HANDOFF_ROOT/broker-coordination"
    BROKER_USER_ROOT="$BROKER_COORD_ROOT/user"; BROKER_ROOT_ROOT="$BROKER_COORD_ROOT/root"
    mkdir -m 0711 "$BROKER_COORD_ROOT" "$BROKER_ROOT_ROOT" || return 1
    mkdir -m 0700 "$BROKER_USER_ROOT" || return 1
    chown "$INSTALL_UID:$INSTALL_GID" "$BROKER_USER_ROOT" || return 1
    BROKER_REQUEST="$BROKER_USER_ROOT/request.json"; BROKER_RESPONSE="$BROKER_ROOT_ROOT/response.json"
    BROKER_DERIVE_INPUT="$BROKER_ROOT_ROOT/derive.json"; BROKER_DERIVED="$BROKER_ROOT_ROOT/derived.json"
    BROKER_APPROVAL_INPUT="$BROKER_ROOT_ROOT/approval-request.json"; BROKER_APPROVAL_OUTPUT="$BROKER_ROOT_ROOT/approval.json"
    BROKER_CONTROLLER_INPUT="$BROKER_ROOT_ROOT/controller.json"; BROKER_READY="$BROKER_ROOT_ROOT/ready.ndjson"
    BROKER_ERROR="$BROKER_ROOT_ROOT/controller.err"; BROKER_PAYLOAD="$BROKER_ROOT_ROOT/tree.deb"
    DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST="$BROKER_REQUEST"
    DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE="$BROKER_RESPONSE"
    export DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE
    logg info "Writing the bounded provisioning environment for the target user"
    umask 077
    : > "$ENV_EXPORT"
    local HANDOFF_VARIABLE HANDOFF_VALUE
    # This is intentionally a fixed allowlist. In particular, arbitrary
    # provider tokens, proxy variables, shell hooks, and caller credentials
    # must not cross the root-to-user trust boundary.
    for HANDOFF_VARIABLE in \
      ANSIBLE_PROVISION_VM CI COLORTERM DEBUG DEBUG_MODE FULL_NAME HEADLESS_INSTALL \
      HOST INSTALL_DOCTOR_ARTIFACT_SHA256 INSTALL_DOCTOR_ENGINE_NODE_MIN \
      INSTALL_DOCTOR_BOOTSTRAP_PLATFORM \
      INSTALL_DOCTOR_CATALOG_PATH INSTALL_DOCTOR_CATALOG_SHA256 \
      INSTALL_DOCTOR_ENGINE_PATH INSTALL_DOCTOR_ENGINE_SHA256 INSTALL_DOCTOR_MANIFEST_SHA256 \
      INSTALL_DOCTOR_ROLE INSTALL_DOCTOR_CAPABILITY INSTALL_DOCTOR_NETWORK INSTALL_DOCTOR_CONCURRENCY \
      INSTALL_DOCTOR_USER INSTALL_DOCTOR_SELECTED_SERVICES INSTALL_DOCTOR_SELECTED_PACKAGES \
      INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS \
      INSTALL_DOCTOR_CONSENT_PRIVILEGED INSTALL_DOCTOR_CONSENT_NETWORK INSTALL_DOCTOR_CONSENT_BEST_EFFORT INSTALL_DOCTOR_OFFLINE \
      INSTALL_DOCTOR_OFFLINE_BUNDLE_DIR INSTALL_DOCTOR_OFFLINE_AUTHORITY_PATH \
      INSTALL_DOCTOR_OFFLINE_MODE INSTALL_DOCTOR_OFFLINE_RUN_ID INSTALL_DOCTOR_RENDERER \
      INSTALL_DOCTOR_PLATFORM_CELL INSTALL_DOCTOR_PLATFORM_STATUS INSTALL_DOCTOR_PLATFORM_OS \
      INSTALL_DOCTOR_PLATFORM_RELEASE INSTALL_DOCTOR_PLATFORM_ARCH INSTALL_DOCTOR_PLATFORM_ENVIRONMENT \
      INSTALL_DOCTOR_PLATFORM_ROLE INSTALL_DOCTOR_PLATFORM_LIMITATION \
      INSTALL_DOCTOR_SUDO_PREEXISTING \
      INSTALL_DOCTOR_AGENT_TASK_DIR INSTALL_DOCTOR_AGENT_TASKS_CONSENT \
      INSTALL_DOCTOR_AGENT_FAILURE_POLICY INSTALL_DOCTOR_TASK_RETRIES \
      INSTALL_DOCTOR_APPROVED_PLAN_DIGEST \
      INSTALL_DOCTOR_CHEZMOI_SOURCE \
      INSTALL_DOCTOR_RELEASE_ID INSTALL_DOCTOR_SOURCE_COMMIT \
      INSTALL_DOCTOR_RELEASE_SIGNER_ID INSTALL_DOCTOR_RELEASE_SIGNER_PUBLIC_KEY \
      INSTALL_DOCTOR_RUNTIME_NODE INSTALL_DOCTOR_RUNTIME_NODE_VERSION INSTALL_DOCTOR_RUNTIME_SOURCE INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256 \
      INSTALL_DOCTOR_VERIFIED_MANIFEST INSTALL_DOCTOR_VERIFIED_SIGNATURE \
      DESKTOP_TOOLS_PROFILE_ID DESKTOP_TOOLS_PROFILE_SLUG DESKTOP_TOOLS_PROFILE_REVISION DESKTOP_TOOLS_PROFILE_DIGEST DESKTOP_TOOLS_MACHINE_ID \
      DESKTOP_TOOLS_OPENCODE_VERSION DESKTOP_TOOLS_OPENCODE_ARCHIVE DESKTOP_TOOLS_OPENCODE_SHA256 \
      DESKTOP_TOOLS_SUPERVISOR_PATH DESKTOP_TOOLS_SUPERVISOR_SHA256 \
      DESKTOP_TOOLS_TOOLS_ARCHIVE DESKTOP_TOOLS_TOOLS_SHA256 \
      DESKTOP_TOOLS_OPENCODE_LOCK_PATH DESKTOP_TOOLS_OPENCODE_LOCK_SHA256 \
      DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED \
      DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE \
      DESKTOP_TOOLS_BROKER_HELPER_PATH DESKTOP_TOOLS_BROKER_HELPER_SHA256 \
      DESKTOP_TOOLS_BROKER_CONTROLLER_PATH DESKTOP_TOOLS_BROKER_CONTROLLER_SHA256 \
      DESKTOP_TOOLS_BROKER_WORKER_PATH DESKTOP_TOOLS_BROKER_WORKER_SHA256 \
      DESKTOP_TOOLS_BROKER_RUNTIME_PATH DESKTOP_TOOLS_BROKER_RUNTIME_SHA256 \
      DESKTOP_TOOLS_BROKER_MANIFEST_PATH DESKTOP_TOOLS_BROKER_MANIFEST_SHA256 \
      DESKTOP_TOOLS_BROKER_SIGNATURE_PATH DESKTOP_TOOLS_BROKER_SIGNATURE_SHA256 \
      DESKTOP_TOOLS_BROKER_CATALOG_PATH DESKTOP_TOOLS_BROKER_CATALOG_SHA256 \
      DESKTOP_TOOLS_BROKER_KEYRING_PATH DESKTOP_TOOLS_BROKER_KEYRING_SHA256 \
      DESKTOP_TOOLS_BROKER_INRELEASE_PATH DESKTOP_TOOLS_BROKER_INRELEASE_SHA256 \
      DESKTOP_TOOLS_BROKER_PACKAGES_PATH DESKTOP_TOOLS_BROKER_PACKAGES_SHA256 \
      DESKTOP_TOOLS_BROKER_TREE_PATH DESKTOP_TOOLS_BROKER_TREE_SHA256 \
      KEEP_GOING LANG LC_ALL NO_RESTART PRIMARY_EMAIL PUBLIC_SERVICES_DOMAIN \
      REPO RESTRICTED_ENVIRONMENT SOFTWARE_GROUP START_REPO TERM TEST_INSTALL \
      WORK_ENVIRONMENT; do
      HANDOFF_VALUE="${!HANDOFF_VARIABLE-}"
      [ -n "$HANDOFF_VALUE" ] || continue
      printf 'export %s=%q\n' "$HANDOFF_VARIABLE" "$HANDOFF_VALUE" >> "$ENV_EXPORT"
    done
    chmod 0444 "$ENV_EXPORT"
    ENV_SHA="$(idSha256File "$ENV_EXPORT")"
    # Keep the handoff root-owned and non-writable until execution completes.
    # The target can traverse the unpredictable directory and read/execute only
    # the sealed files; another process under that UID cannot replace them.
    chmod 0711 "$HANDOFF_ROOT"
    chmod 0555 "$USER_PROVISIONER" "$USER_ENGINE"
    chmod 0555 "$USER_RUNTIME"
    chmod 0444 "$USER_MANIFEST" "$USER_SIGNATURE" "$ENV_EXPORT"
    chown "$INSTALL_USER" "$USER_CATALOG" && chmod 0600 "$USER_CATALOG" \
      || { logg error 'Unable to make the sealed catalog readable only by the target user'; return 1; }
    logg info "Continuing with the locally staged provisioner as $INSTALL_USER"
    _idRunSealedUserHandoff() {
      su - "$INSTALL_USER" -c "hash_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum \"\$1\" | awk '{print \$1}'; else shasum -a 256 \"\$1\" | awk '{print \$1}'; fi; }; [ \"\$(hash_file '$ENV_EXPORT')\" = '$ENV_SHA' ] && [ \"\$(hash_file '$USER_PROVISIONER')\" = '$PROVISIONER_SHA' ] && [ \"\$(hash_file '$USER_ENGINE')\" = '$ENGINE_SHA' ] && [ \"\$(hash_file '$USER_MANIFEST')\" = '$MANIFEST_SHA' ] && [ \"\$(hash_file '$USER_SIGNATURE')\" = '$SIGNATURE_SHA' ] && [ \"\$(hash_file '$USER_CATALOG')\" = '$CATALOG_SHA' ] && [ \"\$(hash_file '$USER_RUNTIME')\" = '$RUNTIME_SHA' ] || exit 20; source '$ENV_EXPORT'; if [ -n \"\${DESKTOP_TOOLS_PROFILE_ID:-}\" ]; then [ \"\$(hash_file \"\$DESKTOP_TOOLS_OPENCODE_ARCHIVE\")\" = \"\$DESKTOP_TOOLS_OPENCODE_SHA256\" ] && [ \"\$(hash_file \"\$DESKTOP_TOOLS_SUPERVISOR_PATH\")\" = \"\$DESKTOP_TOOLS_SUPERVISOR_SHA256\" ] && [ \"\$(hash_file \"\$DESKTOP_TOOLS_TOOLS_ARCHIVE\")\" = \"\$DESKTOP_TOOLS_TOOLS_SHA256\" ] && [ \"\$(hash_file \"\$DESKTOP_TOOLS_OPENCODE_LOCK_PATH\")\" = \"\$DESKTOP_TOOLS_OPENCODE_LOCK_SHA256\" ] || exit 20; fi; export HOME='$USER_HOME_DIR' USER='$INSTALL_USER' PATH='$(dirname "$USER_RUNTIME")':\"\$PATH\" && cd '$USER_HOME_DIR' && bash '$USER_PROVISIONER'"
    }
    # Bash redirects stdin from /dev/null for asynchronous commands when job
    # control is unavailable. Preserve the controlling terminal explicitly so
    # the enrolled-user installer retains its interactive TUI after the
    # privileged handoff; headless runs remain deliberately non-interactive.
    if [ -z "${HEADLESS_INSTALL:-}" ] && [ -t 1 ] && [ -r /dev/tty ]; then
      exec 9</dev/tty || { logg error 'Unable to preserve the terminal for enrolled-user provisioning'; return 1; }
      _idRunSealedUserHandoff <&9 9<&- & BROKER_CHILD_PID=$!
      exec 9<&-
    else
      _idRunSealedUserHandoff </dev/null & BROKER_CHILD_PID=$!
    fi
    while [ ! -f "$BROKER_REQUEST" ] && kill -0 "$BROKER_CHILD_PID" 2>/dev/null && [ "$BROKER_WAIT" -lt 180 ]; do
      sleep 1; BROKER_WAIT=$((BROKER_WAIT + 1))
    done
    if [ ! -f "$BROKER_REQUEST" ]; then
      wait "$BROKER_CHILD_PID" 2>/dev/null; HANDOFF_STATUS=$?; BROKER_CHILD_PID=''
      [ "$HANDOFF_STATUS" -eq 0 ] || logg error 'Enrolled-user provisioning failed before publishing broker work'
    else
        DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED=true
        export DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED
        idStageNativeBrokerAuthority || { kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; return 2; }
        node - "$BROKER_REQUEST" "$BROKER_DERIVE_INPUT" "$INSTALL_UID" "$INSTALL_GID" <<'NODE'
const fs = require('node:fs'); const crypto = require('node:crypto');
const [requestPath, outputPath, uidText, gidText] = process.argv.slice(2); const uid=Number(uidText), gid=Number(gidText);
const before=fs.lstatSync(requestPath,{bigint:true}); if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.uid!==BigInt(uid)||(before.mode&0o777n)!==0o600n||before.size<2n||before.size>2_097_152n)throw new Error('broker preparation file is unsafe');
const fd=fs.openSync(requestPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)); let request; try{const opened=fs.fstatSync(fd,{bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw new Error('broker preparation changed');request=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
const d=request.descriptor, env=process.env; const required=name=>{const value=env[name];if(!value)throw new Error(`missing ${name}`);return value;};
const artifact=(artifactId,url,path,sha256,sizeBytes)=>({artifactId,url,sourcePath:path,sha256,sizeBytes:Number(sizeBytes),mode:'0600'});
const issuedAt=new Date();const expiresAt=new Date(issuedAt.getTime()+20*60*1000);const runId=request.runId;
const value={...request,schemaVersion:1,approvalMode:request.desiredState?.offline===true?'trusted-local':'signed-device',enrolledUid:uid,socketGid:gid,
  releaseProof:{manifestPath:required('DESKTOP_TOOLS_BROKER_MANIFEST_PATH'),signaturePath:required('DESKTOP_TOOLS_BROKER_SIGNATURE_PATH'),catalogPath:required('DESKTOP_TOOLS_BROKER_CATALOG_PATH'),manifestSha256:required('DESKTOP_TOOLS_BROKER_MANIFEST_SHA256'),trust:{keyId:required('INSTALL_DOCTOR_RELEASE_SIGNER_ID'),publicKey:required('INSTALL_DOCTOR_RELEASE_SIGNER_PUBLIC_KEY')}},
  artifacts:[
    artifact(d.metadataProof.inRelease.keyring.artifactId,required('DESKTOP_TOOLS_DEBIAN_KEYRING_URL'),required('DESKTOP_TOOLS_BROKER_KEYRING_PATH'),required('DESKTOP_TOOLS_BROKER_KEYRING_SHA256'),required('DESKTOP_TOOLS_DEBIAN_KEYRING_SIZE')),
    artifact(d.metadataProof.inRelease.artifactId,required('DESKTOP_TOOLS_DEBIAN_INRELEASE_URL'),required('DESKTOP_TOOLS_BROKER_INRELEASE_PATH'),required('DESKTOP_TOOLS_BROKER_INRELEASE_SHA256'),required('DESKTOP_TOOLS_DEBIAN_INRELEASE_SIZE')),
    artifact(d.metadataProof.packagesIndex.artifactId,required('DESKTOP_TOOLS_DEBIAN_PACKAGES_URL'),required('DESKTOP_TOOLS_BROKER_PACKAGES_PATH'),required('DESKTOP_TOOLS_BROKER_PACKAGES_SHA256'),required('DESKTOP_TOOLS_DEBIAN_PACKAGES_SIZE')),
    artifact(d.artifact.id,required('DESKTOP_TOOLS_DEBIAN_TREE_URL'),required('DESKTOP_TOOLS_BROKER_TREE_PATH'),required('DESKTOP_TOOLS_BROKER_TREE_SHA256'),required('DESKTOP_TOOLS_DEBIAN_TREE_SIZE'))],
  transactionRoot:`/var/lib/desktop-tools/transactions/${runId}`,helperPath:required('DESKTOP_TOOLS_BROKER_HELPER_PATH'),helperDigest:required('DESKTOP_TOOLS_BROKER_HELPER_SHA256'),runtimePath:required('DESKTOP_TOOLS_BROKER_RUNTIME_PATH'),runtimeDigest:required('DESKTOP_TOOLS_BROKER_RUNTIME_SHA256'),workerPath:required('DESKTOP_TOOLS_BROKER_WORKER_PATH'),workerDigest:required('DESKTOP_TOOLS_BROKER_WORKER_SHA256'),socketPath:`/run/desktop-tools/broker/${runId}/broker.sock`,issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString(),operationTimeoutMs:120000,command:'privileged-broker-authority-derive'};
fs.writeFileSync(outputPath,`${JSON.stringify(value)}\n`,{mode:0o400,flag:'wx'});
NODE
        if [ "$?" -ne 0 ] || ! "$DESKTOP_TOOLS_BROKER_RUNTIME_PATH" "$VERIFIED_ENGINE" --input "$BROKER_DERIVE_INPUT" > "$BROKER_DERIVED"; then
          kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; return 2
        fi
        chmod 0400 "$BROKER_DERIVED"
        if [ "$(node -e 'const value=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(value.controllerInput.approvalMode)' "$BROKER_DERIVED")" = signed-device ]; then
          node - "$BROKER_DERIVED" "$BROKER_APPROVAL_INPUT" "$USER_HOME_DIR/.config/desktop-tools/device-credential.json" \
            "${DESKTOP_TOOLS_PROFILE_ID:-}" "${DESKTOP_TOOLS_PROFILE_DIGEST:-}" <<'NODE'
const fs=require('node:fs');const crypto=require('node:crypto');
const [derivedPath,outputPath,tokenPath,profileId,profileRevisionDigest]=process.argv.slice(2);
if(!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(profileId)||!/^[a-f0-9]{64}$/.test(profileRevisionDigest)||!tokenPath.startsWith('/'))throw new Error('signed profile or enrollment token path is unavailable');
const derived=JSON.parse(fs.readFileSync(derivedPath,'utf8'));const suffix=()=>crypto.randomBytes(16).toString('hex');
const value={schemaVersion:1,command:'broker-approval-claim',origin:'https://desktop.tools',tokenPath,grant:derived.grant,
  bootstrapBinding:{profileId,profileRevisionDigest,runIntentId:`intent-${suffix()}`,authorizationId:`authorization-${suffix()}`}};
fs.writeFileSync(outputPath,`${JSON.stringify(value)}\n`,{mode:0o400,flag:'wx'});
NODE
          if [ "$?" -ne 0 ] || ! su -s /bin/sh "$INSTALL_USER" -c \
            "exec env -i HOME='$USER_HOME_DIR' PATH='$(dirname "$DESKTOP_TOOLS_BROKER_RUNTIME_PATH"):/usr/bin:/bin' '$DESKTOP_TOOLS_BROKER_RUNTIME_PATH' '$VERIFIED_ENGINE' --input /dev/stdin" \
            < "$BROKER_APPROVAL_INPUT" > "$BROKER_APPROVAL_OUTPUT"; then
            kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true
            logg error 'Bound device approval was not obtained; signed-device mode has no local fallback'
            return 2
          fi
          chmod 0400 "$BROKER_APPROVAL_OUTPUT"
        fi
        BROKER_SOCKET_DIR="$(node -e 'const d=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));const p=require("node:path").dirname(d.controllerInput.socketPath);if(!/^\/run\/desktop-tools\/broker\/[a-z0-9][a-z0-9._-]{0,127}$/.test(p))process.exit(2);process.stdout.write(p)' "$BROKER_DERIVED")" \
          || { kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; return 2; }
        node - "$BROKER_DERIVED" "$BROKER_CONTROLLER_INPUT" "$BROKER_PAYLOAD" "$INSTALL_UID" "$INSTALL_GID" \
          "${BROKER_APPROVAL_OUTPUT:-}" "${DESKTOP_TOOLS_BROKER_DELEGATION_EVIDENCE_PATH:-}" \
          "${DESKTOP_TOOLS_BROKER_DELEGATION_EVIDENCE_SHA256:-}" <<'NODE'
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const [derivedPath,controllerPath,payloadPath,uidText,gidText,approvalPath,delegationEvidencePath,delegationEvidenceDigest]=process.argv.slice(2);const uid=Number(uidText),gid=Number(gidText);const derived=JSON.parse(fs.readFileSync(derivedPath,'utf8'));const socketParent=path.dirname(derived.controllerInput.socketPath);const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const [directory,mode,ownerGid] of [['/run/desktop-tools',0o711,0],['/run/desktop-tools/broker',0o711,0],[socketParent,0o710,gid]]){try{fs.mkdirSync(directory,{mode});}catch(e){if(e.code!=='EEXIST')throw e;}const m=fs.lstatSync(directory);if(!m.isDirectory()||m.isSymbolicLink()||m.uid!==0||m.gid!==ownerGid||(m.mode&0o777)!==mode)throw new Error('broker socket directory is unsafe');}
let controllerInput=derived.controllerInput;if(controllerInput.approvalMode==='signed-device'){const before=fs.lstatSync(approvalPath,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.uid!==0n||(before.mode&0o777n)!==0o400n||before.size<2n||before.size>65536n)throw new Error('broker approval output is unsafe');const deviceApproval=JSON.parse(fs.readFileSync(approvalPath,'utf8'));if(!delegationEvidencePath.startsWith('/run/desktop-tools/authority/')||!/^[a-f0-9]{64}$/.test(delegationEvidenceDigest))throw new Error('sealed broker delegation evidence reference is invalid');const evidenceBefore=fs.lstatSync(delegationEvidencePath,{bigint:true});if(!evidenceBefore.isFile()||evidenceBefore.isSymbolicLink()||evidenceBefore.nlink!==1n||evidenceBefore.uid!==0n||(evidenceBefore.mode&0o777n)!==0o400n||evidenceBefore.size<2n||evidenceBefore.size>65536n)throw new Error('sealed broker delegation evidence is unsafe');const evidenceFd=fs.openSync(delegationEvidencePath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let evidence;try{const opened=fs.fstatSync(evidenceFd,{bigint:true});if(opened.dev!==evidenceBefore.dev||opened.ino!==evidenceBefore.ino||opened.size!==evidenceBefore.size)throw new Error('sealed broker delegation evidence changed');const bytes=fs.readFileSync(evidenceFd);if(hash(bytes)!==delegationEvidenceDigest)throw new Error('sealed broker delegation evidence digest mismatch');evidence=JSON.parse(bytes.toString('utf8'));}finally{fs.closeSync(evidenceFd);}const delegationPath=path.join(path.dirname(delegationEvidencePath),'broker-approval-signer-delegation.json');const minimumEpoch=evidence?.minimumRevocationEpoch;if(evidence?.schemaVersion!==1||evidence?.kind!=='desktop-tools-broker-approval-authority'||evidence?.releaseId!==derived.controllerInput.releaseId||!delegationPath.startsWith('/run/desktop-tools/authority/')||!/^[a-f0-9]{64}$/.test(evidence?.delegationSha256)||!Number.isSafeInteger(minimumEpoch)||minimumEpoch<0)throw new Error('sealed broker delegation authority is incomplete');controllerInput={...controllerInput,deviceApproval,brokerApprovalDelegationPath:delegationPath,brokerApprovalDelegationDigest:evidence.delegationSha256,brokerApprovalMinimumRevocationEpoch:minimumEpoch};}
fs.writeFileSync(controllerPath,`${JSON.stringify(controllerInput)}\n`,{mode:0o400,flag:'wx'});
const source=derived.authority.artifacts.find(item=>item.artifactId===derived.authority.descriptor.artifact.id);const bytes=fs.readFileSync(source.sourcePath);if(bytes.length!==source.sizeBytes||crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error('broker payload source differs from authority');const fd=fs.openSync(payloadPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.fchownSync(fd,uid,gid);}finally{fs.closeSync(fd);}
NODE
        if [ "$?" -ne 0 ]; then kill -TERM "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; return 2; fi
        : > "$BROKER_READY"; : > "$BROKER_ERROR"; chmod 0400 "$BROKER_READY" "$BROKER_ERROR"
        "$DESKTOP_TOOLS_BROKER_RUNTIME_PATH" "$DESKTOP_TOOLS_BROKER_CONTROLLER_PATH" < "$BROKER_CONTROLLER_INPUT" > "$BROKER_READY" 2> "$BROKER_ERROR" & BROKER_CONTROLLER_PID=$!
        BROKER_WAIT=0
        while [ ! -s "$BROKER_READY" ] && kill -0 "$BROKER_CONTROLLER_PID" 2>/dev/null && [ "$BROKER_WAIT" -lt 125 ]; do sleep 1; BROKER_WAIT=$((BROKER_WAIT + 1)); done
        if [ ! -s "$BROKER_READY" ]; then kill -TERM "$BROKER_CHILD_PID" "$BROKER_CONTROLLER_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CONTROLLER_PID" 2>/dev/null || true; return 2; fi
        node - "$BROKER_DERIVED" "$BROKER_READY" "$BROKER_RESPONSE" "$BROKER_PAYLOAD" "$INSTALL_UID" "$INSTALL_GID" <<'NODE'
const fs=require('node:fs');const [derivedPath,readyPath,responsePath,payloadPath,uidText,gidText]=process.argv.slice(2);const uid=Number(uidText),gid=Number(gidText);const derived=JSON.parse(fs.readFileSync(derivedPath,'utf8'));const lines=fs.readFileSync(readyPath,'utf8').trim().split('\n');if(lines.length!==1)throw new Error('broker readiness is not singular');const ready=JSON.parse(lines[0]);if(ready.status!=='authorized'||ready.socketPath!==derived.controllerInput.socketPath||ready.grantDigest!==derived.grantDigest||ready.authorityDigest!==derived.authorityDigest)throw new Error('broker readiness differs from derived authority');const response={schemaVersion:1,status:'authorized',privilegedBroker:{client:derived.clientConfig,descriptor:derived.authority.descriptor,payload:{sourcePath:payloadPath,sha256:derived.authority.descriptor.artifact.sha256,sizeBytes:derived.authority.descriptor.artifact.sizeBytes,mode:'0600'}}};const fd=fs.openSync(responsePath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);try{fs.writeFileSync(fd,`${JSON.stringify(response)}\n`);fs.fsyncSync(fd);fs.fchownSync(fd,uid,gid);}finally{fs.closeSync(fd);}
NODE
        if [ "$?" -ne 0 ]; then kill -TERM "$BROKER_CHILD_PID" "$BROKER_CONTROLLER_PID" 2>/dev/null || true; wait "$BROKER_CHILD_PID" 2>/dev/null || true; wait "$BROKER_CONTROLLER_PID" 2>/dev/null || true; return 2; fi
        wait "$BROKER_CHILD_PID"; HANDOFF_STATUS=$?; BROKER_CHILD_PID=''
        kill -TERM "$BROKER_CONTROLLER_PID" 2>/dev/null || true
        wait "$BROKER_CONTROLLER_PID" || { [ "$HANDOFF_STATUS" -ne 0 ] || HANDOFF_STATUS=2; }
        BROKER_CONTROLLER_PID=''
        rmdir "$BROKER_SOCKET_DIR" 2>/dev/null || { [ "$HANDOFF_STATUS" -ne 0 ] || HANDOFF_STATUS=2; }
        BROKER_SOCKET_DIR=''
    fi
    _idCleanupHandoff
    exit "$HANDOFF_STATUS"
  else
    logg info "You are not running as root. Proceeding with the current user."
  fi
}

# @description Enrolls a profile-bound target before the selected desired state is planned.
#     The target owns its key, pending polling state, and structured credential. The shell
#     receives only nonsecret status output and keeps stdin detached for curl-pipe/headless use.
idEnsureDesktopToolsDeviceAuthorization() {
  local PROFILE_ID="${DESKTOP_TOOLS_PROFILE_ID:-}" PROFILE_SLUG="${DESKTOP_TOOLS_PROFILE_SLUG:-}"
  local PROFILE_DIGEST="${DESKTOP_TOOLS_PROFILE_DIGEST:-}" ENGINE="${INSTALL_DOCTOR_ENGINE_PATH:-}"
  local RUNTIME="${INSTALL_DOCTOR_RUNTIME_NODE:-}" ORIGIN STATE_ROOT CONFIG_ROOT STATE_PATH CREDENTIAL_PATH
  local INVOCATION STATUS_OUTPUT STATUS MACHINE_LABEL EXPIRES_AT
  [ -n "$PROFILE_ID" ] || return 0
  [ "$(id -u)" -ne 0 ] || { logg error 'Desktop Tools device enrollment must run as the enrolled non-root user'; return 2; }
  [[ "$PROFILE_ID" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]] \
    && [[ "$PROFILE_SLUG" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] \
    && [[ "$PROFILE_DIGEST" =~ ^[a-f0-9]{64}$ ]] \
    || { logg error 'Signed Desktop Tools profile identity is incomplete or invalid'; return 2; }
  [ -f "$ENGINE" ] && [ ! -L "$ENGINE" ] && [ -x "$ENGINE" ] \
    && [ -f "$RUNTIME" ] && [ -x "$RUNTIME" ] \
    || { logg error 'Verified enrollment runtime is unavailable'; return 2; }
  ORIGIN="https://${PROFILE_SLUG}.desktop.tools"
  STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/desktop-tools/device-authorization"
  CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/desktop-tools"
  mkdir -p "$STATE_ROOT" "$CONFIG_ROOT" || return 2
  chmod 0700 "$STATE_ROOT" "$CONFIG_ROOT" || return 2
  STATE_PATH="$STATE_ROOT/pending.json"
  CREDENTIAL_PATH="$CONFIG_ROOT/device-credential.json"
  INVOCATION="$STATE_ROOT/invocation-$$.json"
  STATUS_OUTPUT="$STATE_ROOT/status-$$.json"
  trap 'rm -f -- "${INVOCATION:-}" "${STATUS_OUTPUT:-}"; unset -f idWriteDeviceAuthorizationInvocation; trap - RETURN' RETURN

  idWriteDeviceAuthorizationInvocation() {
    local COMMAND="$1"
    "$RUNTIME" - "$INVOCATION" "$COMMAND" "$ORIGIN" "$STATE_PATH" "$CREDENTIAL_PATH" \
      "$PROFILE_ID" "$MACHINE_LABEL" "$EXPIRES_AT" <<'NODE'
const fs=require('node:fs');
const [path,command,origin,statePath,credentialPath,profileId,machineLabel,expiresAt]=process.argv.slice(2);
const value={schemaVersion:1,command,statePath,credentialPath};
if(command==='device-authorization-start')Object.assign(value,{origin,profileId,machineLabel,
  scopes:['profile:read','run:authorize','status:write'],expiresAt});
if(command==='device-authorization-wait')value.origin=origin;
fs.writeFileSync(path,`${JSON.stringify(value)}\n`,{mode:0o600,flag:'w'});
NODE
  }
  MACHINE_LABEL="$(hostname 2>/dev/null || printf 'desktop-tools-target')"
  MACHINE_LABEL="${MACHINE_LABEL:0:128}"
  [ -n "$MACHINE_LABEL" ] || MACHINE_LABEL='desktop-tools-target'
  EXPIRES_AT="$($RUNTIME -e 'process.stdout.write(new Date(Date.now()+10*60*1000).toISOString())')" || return 2

  idWriteDeviceAuthorizationInvocation device-authorization-status || return 2
  "$RUNTIME" "$ENGINE" --input "$INVOCATION" </dev/null > "$STATUS_OUTPUT" || return $?
  STATUS="$($RUNTIME -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));if(!["absent","pending","approved","expired"].includes(v.status))process.exit(2);process.stdout.write(v.status)' "$STATUS_OUTPUT")" \
    || { logg error 'Device enrollment status was malformed'; return 2; }
  if [ "$STATUS" = approved ]; then
    "$RUNTIME" - "$STATUS_OUTPUT" "$PROFILE_ID" <<'NODE' || { logg error 'Stored device credential belongs to another profile'; return 2; }
const fs=require('node:fs');const [path,profileId]=process.argv.slice(2);const value=JSON.parse(fs.readFileSync(path,'utf8'));
if(value.profileId!==profileId||typeof value.credentialId!=='string'||Date.parse(value.expiresAt)<=Date.now())process.exit(2);
NODE
    logg info 'Using the existing protected Desktop Tools device enrollment.'
    return 0
  fi
  [ "$STATUS" != expired ] || { logg error 'The protected Desktop Tools device credential expired; revoke it and enroll this target again.'; return 2; }
  if [ "$STATUS" = absent ]; then
    idWriteDeviceAuthorizationInvocation device-authorization-start || return 2
    "$RUNTIME" "$ENGINE" --input "$INVOCATION" </dev/null > "$STATUS_OUTPUT" || return $?
  fi
  "$RUNTIME" - "$STATUS_OUTPUT" <<'NODE' || { logg error 'Device enrollment prompt was malformed'; return 2; }
const value=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(value.status!=='pending'||typeof value.verificationCode!=='string'||typeof value.approvalUri!=='string'||typeof value.expiresAt!=='string')process.exit(2);
process.stdout.write(`\nApprove this Desktop Tools target from another device:\n  ${value.approvalUri}\n  Matching code: ${value.verificationCode}\n  Expires: ${value.expiresAt}\nPress Ctrl-C to cancel safely.\n\n`);
NODE
  idWriteDeviceAuthorizationInvocation device-authorization-wait || return 2
  "$RUNTIME" "$ENGINE" --input "$INVOCATION" </dev/null > "$STATUS_OUTPUT" || return $?
  "$RUNTIME" - "$STATUS_OUTPUT" <<'NODE' || { logg error 'Desktop Tools device enrollment did not complete'; return 2; }
const value=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(value.status!=='approved'||typeof value.credentialId!=='string'||Date.parse(value.expiresAt)<=Date.now())process.exit(2);
NODE
  logg success 'Desktop Tools device enrollment is approved and durably stored.'
}

# @description Fetches the exact authenticated profile desired state and replaces caller/default
#     package selection with the one machine declared by that profile. The engine owns credential
#     reads, response bounds, profile/digest checks, and atomic ENVIRONMENT.md materialization.
idSyncDesktopToolsDesiredState() {
  local PROFILE_ID="${DESKTOP_TOOLS_PROFILE_ID:-}" PROFILE_SLUG="${DESKTOP_TOOLS_PROFILE_SLUG:-}"
  local PROFILE_DIGEST="${DESKTOP_TOOLS_PROFILE_DIGEST:-}" ENGINE="${INSTALL_DOCTOR_ENGINE_PATH:-}"
  local RUNTIME="${INSTALL_DOCTOR_RUNTIME_NODE:-}" CONFIG_ROOT STATE_ROOT CREDENTIAL_PATH ENVIRONMENT_PATH
  local INVOCATION RESULT MACHINE_ID
  [ -n "$PROFILE_ID" ] || return 0
  CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/desktop-tools"
  STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/desktop-tools/desired-state"
  CREDENTIAL_PATH="$CONFIG_ROOT/device-credential.json"
  ENVIRONMENT_PATH="$CONFIG_ROOT/ENVIRONMENT.md"
  mkdir -p "$CONFIG_ROOT" "$STATE_ROOT" || return 2
  chmod 0700 "$CONFIG_ROOT" "$STATE_ROOT" || return 2
  MACHINE_ID="${DESKTOP_TOOLS_MACHINE_ID:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)}"
  MACHINE_ID="$(printf '%s' "$MACHINE_ID" | tr '[:upper:]' '[:lower:]')"
  [[ "$MACHINE_ID" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]] \
    || { logg error 'Desktop Tools machine identity must exactly match a declared ENVIRONMENT.md machine id'; return 2; }
  INVOCATION="$STATE_ROOT/invocation-$$.json"
  RESULT="$STATE_ROOT/result-$$.json"
  trap 'rm -f -- "${INVOCATION:-}" "${RESULT:-}"; trap - RETURN' RETURN
  "$RUNTIME" - "$INVOCATION" "https://${PROFILE_SLUG}.desktop.tools" "$CREDENTIAL_PATH" "$ENVIRONMENT_PATH" \
    "$PROFILE_ID" "$PROFILE_DIGEST" "$MACHINE_ID" <<'NODE' || return 2
const fs=require('node:fs');const [path,origin,credentialPath,environmentPath,expectedProfileId,expectedProfileDigest,machineId]=process.argv.slice(2);
fs.writeFileSync(path,`${JSON.stringify({schemaVersion:1,command:'profile-desired-state-sync',origin,credentialPath,
  environmentPath,expectedProfileId,expectedProfileDigest,machineId})}\n`,{mode:0o600,flag:'wx'});
NODE
  "$RUNTIME" "$ENGINE" --input "$INVOCATION" </dev/null > "$RESULT" || return $?
  "$RUNTIME" - "$RESULT" <<'NODE' || { logg error 'Authenticated Desktop Tools desired state was malformed'; return 2; }
const value=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
const id=/^[a-z0-9][a-z0-9._:-]{0,127}$/;
if(value.schemaVersion!==1||!id.test(value.machineRole)||!Array.isArray(value.selectedPackages)||!Array.isArray(value.selectedServices)
  ||value.selectedPackages.some(item=>!id.test(item))||value.selectedServices.some(item=>!id.test(item)))process.exit(2);
NODE
  INSTALL_DOCTOR_SELECTED_PACKAGES="$($RUNTIME -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.selectedPackages.join(","))' "$RESULT")" || return 2
  INSTALL_DOCTOR_SELECTED_SERVICES="$($RUNTIME -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.selectedServices.join(","))' "$RESULT")" || return 2
  INSTALL_DOCTOR_ROLE="$($RUNTIME -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.machineRole)' "$RESULT")" || return 2
  DESKTOP_TOOLS_PROFILE_REVISION="$($RUNTIME -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.revision)' "$RESULT")" || return 2
  DESKTOP_TOOLS_MACHINE_ID="$MACHINE_ID"
  INSTALL_DOCTOR_ENVIRONMENT_PATH="$ENVIRONMENT_PATH"
  export INSTALL_DOCTOR_SELECTED_PACKAGES INSTALL_DOCTOR_SELECTED_SERVICES INSTALL_DOCTOR_ROLE INSTALL_DOCTOR_ENVIRONMENT_PATH \
    DESKTOP_TOOLS_PROFILE_REVISION DESKTOP_TOOLS_MACHINE_ID
  logg success 'Authenticated Desktop Tools desired state is bound to this machine.'
}

# @description Main orchestration function that defines the execution order of all provisioning steps.
provisionLogic() {
  local CHEZMOI_STATUS=0
  INSTALL_DOCTOR_TERMINAL_STATUS=""
  export INSTALL_DOCTOR_TERMINAL_STATUS
  INSTALL_DOCTOR_SUDO_PREPARED=false
  export INSTALL_DOCTOR_SUDO_PREPARED
  # This read-only gate deliberately precedes both the exit recorder and the
  # evidence initializer so an unenrolled root target causes zero filesystem
  # or account mutation.
  idRequireRootInstallUserEnrollment || return $?
  trap 'idProvisionExit "$?"' EXIT
  idRunRequiredProvisionStep "Initializing protected local run evidence" idProvisionEvidenceInit || return $?
  idEmitProvisionStatus provision started 0 || return $?
  idRunRequiredProvisionStep "Setting environment variables" setEnvironmentVariables || return $?
  idRunRequiredProvisionStep "Handling CI variables" setCIEnvironmentVariables || return $?
  idRunRequiredProvisionStep "Normalizing terminal interaction policy" idNormalizeHeadlessMode || return $?
  idRunRequiredProvisionStep "Applying env-class defaults" applyEnvClassDefaults || return $?
  idRunRequiredProvisionStep "Resolving the exact host against signed platform policy" idResolvePlatform || return $?
  idRunRequiredProvisionStep "Validating offline execution selection" idNormalizeOfflineMode || return $?
  if [ "$INSTALL_DOCTOR_OFFLINE" = true ]; then
    idRunRequiredProvisionStep "Ensuring the signed installer Node runtime" ensureProvisionerNodeRuntime || return $?
    if [ "$(id -u)" -eq 0 ]; then
      idRunRequiredProvisionStep "Handing off planning and execution to the enrolled user" ensureInstallUser || return $?
      return 0
    fi
    idRunRequiredProvisionStep "Executing the independently approved offline bundle" runOfflineBundleProvisioning || return $?
    idEmitProvisionStatus provision success 0
    return 0
  fi
  idRunRequiredProvisionStep "Collecting required inputs up front" collectInputsUpfront || return $?
  idRunRequiredProvisionStep "Ensuring the signed installer Node runtime" ensureProvisionerNodeRuntime || return $?
  if [ "$(id -u)" -eq 0 ]; then
    idRunRequiredProvisionStep "Handing off planning and execution to the enrolled user" ensureInstallUser || return $?
    return 0
  fi
  idRunRequiredProvisionStep "Installing the verified Desktop Tools runtime closure" idInstallDesktopToolsRuntimeClosure || return $?
  idRunRequiredProvisionStep "Authorizing this Desktop Tools target" idEnsureDesktopToolsDeviceAuthorization || return $?
  idRunRequiredProvisionStep "Loading this machine's authenticated Desktop Tools desired state" idSyncDesktopToolsDesiredState || return $?
  idRunRequiredProvisionStep "Reconciling stale sudo acquisition ownership" idReconcileStaleSudoOwnership || return $?
  idRunRequiredProvisionStep "Resolving the install plan before mutation" configureInstallPlan || return $?
  idRunRequiredProvisionStep "Authorizing the exact host and recorded consent" idAuthorizePlatform || return $?
  if [ "${DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED:-false}" = true ]; then
    [ -n "${DESKTOP_TOOLS_BROKER_COORDINATION_USER_REQUEST:-}" ] \
      && [ -n "${DESKTOP_TOOLS_BROKER_COORDINATION_ROOT_RESPONSE:-}" ] \
      || { logg error 'Native package execution requires the enrolled root broker coordinator'; return 2; }
  fi
  idRunRequiredProvisionStep "Persisting verified release provenance" idPersistVerifiedReleaseProvenance || return $?
  logg info "Approving and executing one canonical provisioning plan"
  runCanonicalProvisionEngine apply || CHEZMOI_STATUS=$?
  if [ "${INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED:-false}" != true ] \
    && [ "${INSTALL_DOCTOR_SUDO_PREPARED:-false}" = true ]; then
    # Fall back only when protected engine evidence does not prove the
    # run-finalizer reached a verified/inapplicable cleanup postcondition.
    removePasswordlessSudo || true
  fi
  if [ "${INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED:-false}" = true ] || ! sudo -n true 2>/dev/null; then
    idRetireSudoOwnership || true
  fi
  INSTALL_DOCTOR_SUDO_PREPARED=false
  if [ "$CHEZMOI_STATUS" -ne 0 ]; then
    logg error "Provisioning failed during chezmoi apply (exit $CHEZMOI_STATUS)"
    case "$CHEZMOI_STATUS" in
      6) idEmitProvisionStatus provision pending "$CHEZMOI_STATUS" ;;
      130) idEmitProvisionStatus provision cancelled "$CHEZMOI_STATUS" ;;
      *) idEmitProvisionStatus provision failed "$CHEZMOI_STATUS" ;;
    esac
    return "$CHEZMOI_STATUS"
  fi
  idRunRequiredProvisionStep "Handling post-provision logic" postProvision || return $?
  idEmitProvisionStatus provision success 0
}
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi
if [ "${1:-}" = '--engine-operation' ]; then
  shift
  idRunEngineOperation "${1:-}"
  exit $?
fi
provisionLogic
