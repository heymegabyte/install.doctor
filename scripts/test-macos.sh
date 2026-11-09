#!/bin/bash
# @file test-macos.sh
# @brief Run the repository-provided Desktop Tools fixture on a macOS CI host.
# @description
#     This script runs inside a macOS CI host and executes an explicitly supplied,
#     repository-controlled installer fixture in headless mode. It never fetches
#     a mutable network entrypoint.
#
#     It automatically sets CI=true and HEADLESS_INSTALL=true to ensure all prompts
#     auto-proceed with defaults.
#
# @usage
#   ./test-macos.sh
#
# @envvar CI  Automatically set to true
# @envvar HEADLESS_INSTALL  Automatically set to true
# @envvar TEST_INSTALL  Automatically set to true
#
# @exitcode 0 If successful.
# @exitcode 1 If an error occurs.

set -e

# Redirect output to log file
LOG_FILE="macos-script.log"
exec > >(tee -i "$LOG_FILE") 2>&1

# ==============================================================================
# @description Print macOS system information for debugging.
# ==============================================================================
printSystemInfo() {
  echo "### macOS System Information ###"
  sw_vers
  uname -a
  sysctl -n machdep.cpu.brand_string
  echo "Disk space:"
  df -h /
  echo ""
}

# ==============================================================================
# @description Run an explicit local Desktop Tools fixture in headless CI mode.
# ==============================================================================
runDesktopToolsFixture() {
  echo "### Running the Desktop Tools local fixture in CI mode ###"
  export CI=true
  export TEST_INSTALL=true
  export HEADLESS_INSTALL=true
  export NO_RESTART=true

  if [ -z "${INSTALLER_PATH:-}" ]; then
    echo 'INSTALLER_PATH must name an explicit trusted local fixture; this test never downloads a mutable retired endpoint.' >&2
    return 64
  fi
  [ -f "$INSTALLER_PATH" ] || { echo "INSTALLER_PATH is not a file: $INSTALLER_PATH" >&2; return 66; }
  bash "$INSTALLER_PATH"
}

# ==============================================================================
# Main Execution
# ==============================================================================
main() {
  printSystemInfo
  runDesktopToolsFixture
}

main
