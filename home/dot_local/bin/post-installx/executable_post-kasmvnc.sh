#!/usr/bin/env bash
# @file executable_post-kasmvnc.sh
# @description Configure loopback-only live GNOME Wayland -> KasmVNC desktop sharing (127.0.0.1:5900 -> 127.0.0.1:8444)
# with responsive browser-fit scaling (resize=scale) and iGPU DRI3 offload.
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  exit 0
fi
if ! command -v Xkasmvnc >/dev/null 2>&1 && ! command -v kasmvncserver >/dev/null 2>&1; then
  exit 0
fi

helper="${HOME}/.local/bin/kasmvnc-fit-browser"
if [ -x "$helper" ]; then
  printf '[INFO] Preparing KasmVNC full-desktop fit webroot\n'
  "$helper" || true
fi

runner="${HOME}/.local/bin/kasmvnc-gnome-loopback-run"
if [ -x "$runner" ] && [ -f "${HOME}/.local/bin/legion-kasmvnc-run" ]; then
  cp -f "$runner" "${HOME}/.local/bin/legion-kasmvnc-run"
  chmod +x "${HOME}/.local/bin/legion-kasmvnc-run"
fi
