#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pattern='(?i)(ansible_(become_)?pass(word)?|LOCKBOX_MASTER_KEY|SECRET_KEY_BASE|APPSMITH_(ENCRYPTION_PASSWORD|ENCRYPTION_SALT|SUPERVISOR_PASSWORD)|ADMIN_PASSWORD|STORAGE_CLOUD_(KEY|SECRET))[[:space:]]*:[[:space:]]*[^[:space:]#]+'
command_pattern='(?i)(rootPassword|password)[=:][^[:space:]#]+'

scan() {
  rg -n --no-heading --pcre2 --glob '*.{yml,yaml,json,jsonc,toml,ini,conf,cfg}' \
    --glob '!package-lock.json' --glob '!*.tmpl' --glob '!*.template' \
    -e "$pattern" -e "$command_pattern" "$@" 2>/dev/null \
    | grep -Ev '\{\{|\$\{|\$[A-Z_]|requiredEnv|get-secret|secretRef' \
    | cut -d: -f1 | sort -u || true
}

findings="$(scan home config .config .github .devcontainer .vscode)"
if [ -n "$findings" ]; then
  printf 'configuration contains literal secret/default credential fields (paths only):\n%s\n' "$findings" >&2
  exit 1
fi

fixture="$(mktemp "${TMPDIR:-/tmp}/install-doctor-config-secret.XXXXXXXX.yml")"
trap 'rm -f "$fixture"' EXIT
printf '%s\n' 'ansible_password: planted-literal' >"$fixture"
if [ -z "$(scan "$fixture")" ]; then
  printf 'configuration secret-default detector missed its planted fixture\n' >&2
  exit 1
fi

printf 'config-secret-defaults: 2 passed, 0 failed\n'
