#!/usr/bin/env bash
set -euo pipefail
# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1
# @file Mise Install / Tweaks
# @brief Reconciles the current user's configured mise runtime closure.

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

mise_postcondition() {
  command -v mise >/dev/null 2>&1 || return 20
  # `mise ls --missing` is a read-only view of configured runtimes whose
  # requested versions are absent. Empty output means the install closure is
  # already satisfied.
  [ -z "$(mise ls --missing 2>/dev/null)" ] || return 10
}

case "${1:---apply}" in
  --check|--verify) mise_postcondition; exit $? ;;
  --apply) ;;
  *) printf 'usage: %s [--check|--apply|--verify]\n' "$0" >&2; exit 2 ;;
esac

if command -v mise > /dev/null; then
    gum log -sl info 'Running mise install' && mise install
else
    gum log -sl info 'mise is not available on the PATH'
fi
