#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

scan() {
  rg -l --glob '*.{yml,yaml,json,jsonc,toml,ini,conf,cfg}' \
    --glob '!software.yml' --glob '!package-lock.json' \
    --glob '!*.tmpl' --glob '!*.template' \
    '(image:[^#]*:latest|container_image[^#]*:latest|ref=(master|main)([^A-Za-z0-9_-]|$))' "$@" 2>/dev/null || true
}

findings="$(scan home config .config .github .devcontainer .vscode packages)"
if [ -n "$findings" ]; then
  printf 'configuration contains mutable image or branch authority (paths only):\n%s\n' "$findings" >&2
  exit 1
fi

fixture="$(mktemp "${TMPDIR:-/tmp}/install-doctor-config-provenance.XXXXXXXX.yml")"
trap 'rm -f "$fixture"' EXIT
printf '%s\n' 'image: example.invalid/service:latest' >"$fixture"
if [ -z "$(scan "$fixture")" ]; then
  printf 'configuration provenance detector missed its planted fixture\n' >&2
  exit 1
fi

printf 'config-provenance: 2 passed, 0 failed\n'
