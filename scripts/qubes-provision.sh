#!/usr/bin/env bash
# @file Provision Qubes through the canonical install.doctor lifecycle.
# @brief Preserves the historical Qubes entrypoint without a competing installer.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PROVISIONER="$ROOT/scripts/provision.sh"

if [ ! -f "$PROVISIONER" ] || [ -L "$PROVISIONER" ]; then
  printf 'install.doctor: trusted provisioner is missing; use the signed /start release\n' >&2
  exit 66
fi

# The canonical provisioner owns capability discovery, exact-plan approval,
# dom0/AppVM delegation, privilege consent, journaling, and terminal evidence.
# Do not infer privileged consent or service activation in this compatibility
# adapter; unattended callers must provide the normal approved-plan inputs.
export INSTALL_DOCTOR_ROLE="${INSTALL_DOCTOR_ROLE:-qubes}"
exec bash "$PROVISIONER" "$@"
