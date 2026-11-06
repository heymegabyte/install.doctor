#!/usr/bin/env bash
# Compatibility entrypoint for an existing install.doctor checkout.
# Qubes discovery, consent, planning, delegation, and evidence are owned by the
# canonical provisioner; this wrapper must never clone an unrelated repository
# or create services outside that approved plan.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENTRYPOINT="$ROOT/scripts/qubes-provision.sh"

if [ ! -f "$ENTRYPOINT" ] || [ -L "$ENTRYPOINT" ]; then
  printf 'install.doctor: trusted Qubes provisioner is missing; use the signed /start release\n' >&2
  exit 66
fi

exec bash "$ENTRYPOINT" "$@"
