#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

scan() {
  local candidate
  while IFS= read -r candidate; do
    grep -Eq '(image:[^#]*:latest|container_image[^#]*:latest|ref=(master|main)([^A-Za-z0-9_-]|$))' "$candidate" \
      && printf '%s\n' "$candidate"
  done < <(
    find "$@" -type f \
      \( -name '*.yml' -o -name '*.yaml' -o -name '*.json' -o -name '*.jsonc' \
         -o -name '*.toml' -o -name '*.ini' -o -name '*.conf' -o -name '*.cfg' \) \
      ! -name 'software.yml' ! -name 'package-lock.json' \
      ! -name '*.tmpl' ! -name '*.template' 2>/dev/null
  )
  return 0
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
