#!/usr/bin/env bash
# scripts/test-detect-os.sh — Test harness for detect_os.sh library.
# Runs on ANY OS; validates the functions work correctly on the host.
# CI runs this per-OS via the container matrix, so every OS type
# gets tested on its native host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
if [ ! -f "$LIB_DIR/detect_os.sh" ]; then
  echo "FAIL: $LIB_DIR/detect_os.sh not found"
  exit 1
fi

# shellcheck disable=SC1090
source "$LIB_DIR/detect_os.sh"

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

assert_ok() {
  local desc="$1" result="$2"
  if [ "$result" -eq 0 ]; then
    echo "  PASS: $desc (exit 0)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc — exit code $result"
    FAIL=$((FAIL + 1))
  fi
}

assert_defined() {
  local desc="$1" value="$2"
  if [ -n "$value" ] && [ "$value" != "unknown" ]; then
    echo "  PASS: $desc ($value)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc — undefined or unknown"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# Test 1: detect_os returns a known value on this host
# ---------------------------------------------------------------------------
echo "=== Test: detect_os ==="
OS="$(detect_os)"
KNOWN_OS="macos ubuntu debian fedora silverblue alpine arch qubes-dom0 qubes-appvm proxmox wsl container linux"
if echo "$KNOWN_OS" | /usr/bin/grep -qw "$OS"; then
  echo "  PASS: detect_os returned '$OS' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_os returned '$OS' (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Check exit code
detect_os > /dev/null
assert_ok "detect_os exit code" $?

# ---------------------------------------------------------------------------
# Test 1b: detect_arch returns a known, normalized value on this host (B03)
# ---------------------------------------------------------------------------
echo "=== Test: detect_arch ==="
ARCH="$(detect_arch)"
KNOWN_ARCH="amd64 arm64 armv7 armv6 386 riscv64 ppc64le s390x"
if echo "$KNOWN_ARCH" | /usr/bin/grep -qw "$ARCH"; then
  echo "  PASS: detect_arch returned '$ARCH' (valid normalized value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_arch returned '$ARCH' (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Exit code
detect_arch > /dev/null
assert_ok "detect_arch exit code" $?

# Normalization cross-check against the raw `uname -m` (host-agnostic — CI runs amd64 too)
RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
  x86_64 | amd64) EXP_ARCH="amd64" ;;
  aarch64 | arm64) EXP_ARCH="arm64" ;;
  armv7l | armv7 | armhf) EXP_ARCH="armv7" ;;
  armv6l | armv6) EXP_ARCH="armv6" ;;
  i386 | i486 | i586 | i686) EXP_ARCH="386" ;;
  riscv64) EXP_ARCH="riscv64" ;;
  ppc64le) EXP_ARCH="ppc64le" ;;
  s390x) EXP_ARCH="s390x" ;;
  *) EXP_ARCH="$RAW_ARCH" ;;
esac
assert_eq "detect_arch normalizes '$RAW_ARCH'" "$EXP_ARCH" "$ARCH"

# Idempotency
assert_eq "detect_arch idempotent" "$(detect_arch)" "$(detect_arch)"

# ---------------------------------------------------------------------------
# Test 1c: detect_release returns the OS version/release (B03 release)
# ---------------------------------------------------------------------------
echo "=== Test: detect_release ==="
RELEASE="$(detect_release)"
assert_defined "detect_release returned a release" "$RELEASE"

# Exit code
detect_release > /dev/null
assert_ok "detect_release exit code" $?

# macOS: must match sw_vers -productVersion (deterministic)
if [ "$OS" = "macos" ] && command -v sw_vers > /dev/null 2>&1; then
  assert_eq "detect_release matches sw_vers" "$(sw_vers -productVersion 2>/dev/null)" "$RELEASE"
fi

# Idempotency
assert_eq "detect_release idempotent" "$(detect_release)" "$(detect_release)"

# ---------------------------------------------------------------------------
# Test 2: detect_role returns a known value
# ---------------------------------------------------------------------------
echo "=== Test: detect_role ==="
ROLE="$(detect_role)"
KNOWN_ROLES="workstation server proxmox coolify qubes-dom0 qubes-appvm wsl container"
if echo "$KNOWN_ROLES" | /usr/bin/grep -qw "$ROLE"; then
  echo "  PASS: detect_role returned '$ROLE' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_role returned '$ROLE' (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Override test
INSTALL_DOCTOR_ROLE="test-role" detect_role > /dev/null
assert_eq "detect_role with INSTALL_DOCTOR_ROLE override" "test-role" "$(INSTALL_DOCTOR_ROLE="test-role" detect_role)"

# ---------------------------------------------------------------------------
# Test 3: detect_package_manager returns a known value
# ---------------------------------------------------------------------------
echo "=== Test: detect_package_manager ==="
PM="$(detect_package_manager)"
KNOWN_PM="brew apt dnf apk pacman"
if echo "$KNOWN_PM" | /usr/bin/grep -qw "$PM"; then
  echo "  PASS: detect_package_manager returned '$PM' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_package_manager returned '$PM' for OS=$OS (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Check cross-OS mapping
case "$OS" in
  macos) assert_eq "package manager for macOS" "brew" "$PM" ;;
  ubuntu|debian) assert_eq "package manager for $OS" "apt" "$PM" ;;
  fedora|silverblue) assert_eq "package manager for $OS" "dnf" "$PM" ;;
  alpine) assert_eq "package manager for alpine" "apk" "$PM" ;;
  arch) assert_eq "package manager for arch" "pacman" "$PM" ;;
esac

# ---------------------------------------------------------------------------
# Test 3b: detect_service_manager returns a known init system (B05)
# ---------------------------------------------------------------------------
echo "=== Test: detect_service_manager ==="
SM="$(detect_service_manager)"
KNOWN_SM="launchd systemd openrc runit sysvinit"
if echo "$KNOWN_SM" | /usr/bin/grep -qw "$SM"; then
  echo "  PASS: detect_service_manager returned '$SM' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_service_manager returned '$SM' for OS=$OS (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Exit code
detect_service_manager > /dev/null
assert_ok "detect_service_manager exit code" $?

# macOS always uses launchd
if [ "$OS" = "macos" ]; then
  assert_eq "service manager for macOS" "launchd" "$SM"
fi

# Idempotency
assert_eq "detect_service_manager idempotent" "$(detect_service_manager)" "$(detect_service_manager)"

# ---------------------------------------------------------------------------
# Test 4: is_headless
# ---------------------------------------------------------------------------
echo "=== Test: is_headless ==="
# HEADLESS_INSTALL=true must return 0
if HEADLESS_INSTALL=true is_headless; then
  echo "  PASS: is_headless with HEADLESS_INSTALL=true (exit 0)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: is_headless with HEADLESS_INSTALL=true returned non-zero"
  FAIL=$((FAIL + 1))
fi

# Without HEADLESS_INSTALL, macOS should return 1 (has GUI)
if [ "$OS" = "macos" ]; then
  if is_headless; then
    echo "  FAIL: is_headless on macOS without HEADLESS_INSTALL returned 0 (should be 1)"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: is_headless on macOS without HEADLESS_INSTALL (exit non-zero, has GUI)"
    PASS=$((PASS + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Test 4a: detect_graphical_session returns the session TYPE (B05 graphical-
# session / G09 Wayland-vs-X11). headless | x11 | wayland | aqua. is_headless
# is now a thin consumer (headless <=> no GUI). Precedence mirrors the old
# is_headless: HEADLESS_INSTALL -> macOS(aqua) -> Wayland -> X11 -> headless.
# ---------------------------------------------------------------------------
echo "=== Test: detect_graphical_session ==="
GFX="$(detect_graphical_session)"
KNOWN_GFX="headless x11 wayland aqua"
if echo "$KNOWN_GFX" | /usr/bin/grep -qw "$GFX"; then
  echo "  PASS: detect_graphical_session returned '$GFX' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_graphical_session returned '$GFX' (not in known list)"
  FAIL=$((FAIL + 1))
fi
# Exit code
detect_graphical_session > /dev/null
assert_ok "detect_graphical_session exit code" $?
# Full override (mirrors detect_privilege — deterministic, no host probing)
assert_eq "detect_graphical_session INSTALL_DOCTOR_GRAPHICAL_SESSION override" "test-gfx" "$(INSTALL_DOCTOR_GRAPHICAL_SESSION="test-gfx" detect_graphical_session)"
# HEADLESS_INSTALL=true wins over everything (parity with the 89 HEADLESS_INSTALL sites + is_headless)
assert_eq "detect_graphical_session HEADLESS_INSTALL=true -> headless" "headless" "$(HEADLESS_INSTALL=true detect_graphical_session)"
# macOS host -> aqua (dev box + macOS CI); Linux branches via the stubbed-OS cases below
if [ "$OS" = "macos" ]; then
  assert_eq "detect_graphical_session on macOS (no HEADLESS) -> aqua" "aqua" "$(HEADLESS_INSTALL='' detect_graphical_session)"
fi
# Linux display-server branches — stub detect_os so the wayland/x11/headless logic is testable on ANY host
assert_eq "detect_graphical_session: linux + WAYLAND_DISPLAY -> wayland" "wayland" "$(detect_os() { echo linux; }; WAYLAND_DISPLAY=wayland-0 DISPLAY='' HEADLESS_INSTALL='' detect_graphical_session)"
assert_eq "detect_graphical_session: linux + DISPLAY (no wayland) -> x11" "x11" "$(detect_os() { echo linux; }; WAYLAND_DISPLAY='' DISPLAY=:0 HEADLESS_INSTALL='' detect_graphical_session)"
assert_eq "detect_graphical_session: linux + WAYLAND+DISPLAY (XWayland) -> wayland" "wayland" "$(detect_os() { echo linux; }; WAYLAND_DISPLAY=wayland-0 DISPLAY=:0 HEADLESS_INSTALL='' detect_graphical_session)"
assert_eq "detect_graphical_session: linux + no display -> headless" "headless" "$(detect_os() { echo linux; }; WAYLAND_DISPLAY='' DISPLAY='' HEADLESS_INSTALL='' detect_graphical_session)"
# Idempotent
assert_eq "detect_graphical_session idempotent" "$(detect_graphical_session)" "$(detect_graphical_session)"
# is_headless CONSISTENCY — is_headless true IFF detect_graphical_session==headless (the refactor invariant)
if HEADLESS_INSTALL=true is_headless && [ "$(HEADLESS_INSTALL=true detect_graphical_session)" = "headless" ]; then
  echo "  PASS: is_headless <=> detect_graphical_session==headless (HEADLESS_INSTALL case)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: is_headless/detect_graphical_session disagree on HEADLESS_INSTALL"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Test 4b: detect_privilege returns a known elevation level (B03 privileges)
# ---------------------------------------------------------------------------
echo "=== Test: detect_privilege ==="
PRIV="$(detect_privilege)"
KNOWN_PRIV="root passwordless-sudo sudo user"
if echo "$KNOWN_PRIV" | /usr/bin/grep -qw "$PRIV"; then
  echo "  PASS: detect_privilege returned '$PRIV' (valid value)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: detect_privilege returned '$PRIV' (not in known list)"
  FAIL=$((FAIL + 1))
fi

# Exit code
detect_privilege > /dev/null
assert_ok "detect_privilege exit code" $?

# Override test (mirrors detect_role — deterministic, no sudo probe)
assert_eq "detect_privilege with INSTALL_DOCTOR_PRIVILEGE override" "test-priv" "$(INSTALL_DOCTOR_PRIVILEGE="test-priv" detect_privilege)"

# Idempotency
assert_eq "detect_privilege idempotent" "$(detect_privilege)" "$(detect_privilege)"

# ---------------------------------------------------------------------------
# Test 4c: detect_env_class returns the VIRTUALIZATION/environment class (B04
# "distinguish bare metal, VM, WSL, container"), orthogonal to the OS role +
# graphical session. container | wsl | vm | bare-metal. Precedence: container
# FIRST (a container nested in a VM is still a container for provisioning).
# ---------------------------------------------------------------------------
echo "=== Test: detect_env_class ==="
ENVC="$(detect_env_class)"
KNOWN_ENVC="container wsl vm bare-metal"
if echo "$KNOWN_ENVC" | grep -qw "$ENVC"; then
  echo "  PASS: detect_env_class returned '$ENVC' (valid value)"; PASS=$((PASS + 1))
else
  echo "  FAIL: detect_env_class returned '$ENVC' (not in known list)"; FAIL=$((FAIL + 1))
fi
detect_env_class > /dev/null
assert_ok "detect_env_class exit code" $?
# Full override (mirrors detect_privilege / detect_graphical_session — deterministic, no host probing)
assert_eq "detect_env_class INSTALL_DOCTOR_ENV_CLASS override" "test-env" "$(INSTALL_DOCTOR_ENV_CLASS="test-env" detect_env_class)"
# REAL detection path (env-var-mockable): the `container` env var (set by systemd-nspawn/podman) -> container,
# on ANY host, with NO override. Proves the detection logic runs, not just the override echo.
assert_eq "detect_env_class: container env var -> container" "container" "$(INSTALL_DOCTOR_ENV_CLASS='' container=podman detect_env_class)"
# Precedence: the container signal wins over a would-be vm/bare-metal host classification.
assert_eq "detect_env_class: container checked before vm/bare-metal" "container" "$(INSTALL_DOCTOR_ENV_CLASS='' container=lxc detect_env_class)"
# Idempotency
assert_eq "detect_env_class idempotent" "$(detect_env_class)" "$(detect_env_class)"

# ---------------------------------------------------------------------------
# Test 5: All functions are defined
# ---------------------------------------------------------------------------
echo "=== Test: function definitions ==="
for fn in detect_os detect_arch detect_release detect_role detect_package_manager detect_service_manager detect_privilege detect_graphical_session is_headless detect_env_class; do
  if declare -f "$fn" > /dev/null 2>&1; then
    echo "  PASS: $fn is defined"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $fn is not defined"
    FAIL=$((FAIL + 1))
  fi
done

# ---------------------------------------------------------------------------
# Test 6: Idempotency — multiple calls return same result
# ---------------------------------------------------------------------------
echo "=== Test: idempotency ==="
FIRST="$(detect_os)"
SECOND="$(detect_os)"
assert_eq "detect_os idempotent" "$FIRST" "$SECOND"

# ---------------------------------------------------------------------------
# Test 7: start.sh embedded detect_os matches the library
# ---------------------------------------------------------------------------
echo "=== Test: start.sh embedded detect_os consistency ==="
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$REPO_ROOT/start.sh" ]; then
  # Source the embedded function from start.sh (it defines detect_os inline)
  EMBEDDED_OS="$(bash -c "
    $(sed -n '/^detect_os() {/,/^}/p' "$REPO_ROOT/start.sh")
    detect_os
  " 2>/dev/null || echo "error")"
  if [ "$EMBEDDED_OS" = "error" ]; then
    echo "  WARN: Could not extract embedded detect_os from start.sh"
  elif [ "$EMBEDDED_OS" = "$OS" ]; then
    echo "  PASS: start.sh embedded detect_os matches library ($EMBEDDED_OS == $OS)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: start.sh embedded detect_os ($EMBEDDED_OS) differs from library ($OS)"
    FAIL=$((FAIL + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Test 8: start.sh embedded detectArchSuffix picks the host's go-task arch (B03 consumer)
#   Guards the real bug: the Task bootstrap must not hardcode amd64 on ARM hosts.
# ---------------------------------------------------------------------------
echo "=== Test: start.sh embedded detectArchSuffix ==="
if [ -f "$REPO_ROOT/start.sh" ]; then
  EMBEDDED_ARCH="$(bash -c "
    $(sed -n '/^detectArchSuffix() {/,/^}/p' "$REPO_ROOT/start.sh")
    detectArchSuffix
  " 2>/dev/null || echo "error")"
  case "$(uname -m)" in
    x86_64 | amd64) EXP_TASK_ARCH="amd64" ;;
    aarch64 | arm64) EXP_TASK_ARCH="arm64" ;;
    i386 | i486 | i586 | i686) EXP_TASK_ARCH="386" ;;
    armv7l | armv7 | armv6l | armv6 | armhf | arm) EXP_TASK_ARCH="arm" ;;
    *) EXP_TASK_ARCH="amd64" ;;
  esac
  assert_eq "start.sh detectArchSuffix resolves host arch" "$EXP_TASK_ARCH" "$EMBEDDED_ARCH"
  # Regression guard for the hardcoded-amd64 bug: ARM hosts must resolve arm64, never amd64
  if [ "$(uname -m)" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then
    assert_eq "start.sh Task arch is arm64 on ARM (not hardcoded amd64)" "arm64" "$EMBEDDED_ARCH"
  fi
fi

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
echo ""
echo "=============================="
echo "Results: $PASS passed, $FAIL failed"
echo "=============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
