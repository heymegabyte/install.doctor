#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TEMPLATE="$ROOT/scripts/src/provision.sh.tmpl"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

for file in "$PROVISION" "$TEMPLATE"; do
  label="${file#"$ROOT"/}"
  if grep -Fq 'read -s -t 30 -p "Password (30s timeout): " SUDO_PASSWORD < /dev/tty' "$file"; then
    pass "$label reads fallback password input from /dev/tty"
  else
    fail "$label can consume piped script bytes while prompting"
  fi

  if grep -Fq 'USER_PROVISIONER="$USER_HOME_DIR/.cache/install.doctor/provision-' "$file" \
    && grep -Fq 'install -m 0700 "$CURRENT_PROVISIONER" "$USER_PROVISIONER"' "$file"; then
    pass "$label stages the current immutable provisioner for the target user"
  else
    fail "$label does not stage the current provisioner for root-to-user handoff"
  fi

  if grep -Fq "trap '_idCleanupHandoff' EXIT INT TERM" "$file"; then
    pass "$label cleans staged handoff files after errors and signals"
  else
    fail "$label can leak staged handoff files after interruption"
  fi

  if ! sed -n '/function ensureInstallUser()/,/^}/p' "$file" | grep -Eq 'curl[^\n]*install\.doctor/start'; then
    pass "$label root handoff does not re-download a mutable entrypoint"
  else
    fail "$label root handoff re-downloads the mutable entrypoint"
  fi
done

printf 'bootstrap-local-handoff: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
