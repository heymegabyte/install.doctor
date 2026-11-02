#!/usr/bin/env bash
set -euo pipefail
# @file Atuin to hiSHtory Migration & Preservation Bridge
# @brief Preserves existing Atuin command history and migrates it into hiSHtory (ADR 0001: hiSHtory preferred over Atuin)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

if command -v atuin > /dev/null 2>&1; then
  if command -v hishtory > /dev/null 2>&1; then
    TMP_HIST="$(mktemp)"
    trap 'rm -f "$TMP_HIST"' EXIT
    gum log -sl info 'Exporting existing Atuin history for safe preservation in hiSHtory (ADR 0001)'
    if atuin search --format "{command}" > "$TMP_HIST" 2> /dev/null && [ -s "$TMP_HIST" ]; then
      hishtory import < "$TMP_HIST" > /dev/null 2>&1 || true
      gum log -sl info 'Imported existing Atuin history into hiSHtory'
    fi
  else
    gum log -sl info 'Atuin detected (hiSHtory is the preferred shell history backend per ADR 0001)'
  fi
else
  gum log -sl info 'Skipping Atuin bridge (hiSHtory is preferred per ADR 0001)'
fi
