#!/bin/bash
# @file test-macos.sh
# @brief Run an Install Doctor provisioning test inside a macOS GitHub Actions runner.
# @description
#     This script runs inside a macOS GitHub Actions runner and executes the
#     Install Doctor start script with CI environment variables set for headless operation.
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
# @description Run the Install Doctor start script in headless CI mode.
# ==============================================================================
runInstallDoctor() {
  echo "### Running Install Doctor in CI mode ###"
  export CI=true
  export TEST_INSTALL=true
  export HEADLESS_INSTALL=true
  export NO_RESTART=true

  if [ -n "${INSTALLER_PATH:-}" ]; then
    bash "$INSTALLER_PATH"
  else
    curl -fsSL https://app.install.doctor/start | bash
  fi
}

# ==============================================================================
# Main Execution
# ==============================================================================
main() {
  printSystemInfo
  runInstallDoctor
}

main
