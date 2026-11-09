#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

for file in "$PROVISION"; do
  label="${file#"$ROOT"/}"
  if grep -Fq 'read -s -t 30 -p "Password (30s timeout): " SUDO_PASSWORD < /dev/tty' "$file"; then
    pass "$label reads fallback password input from /dev/tty"
  else
    fail "$label can consume piped script bytes while prompting"
  fi

  if grep -Fq 'HANDOFF_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-handoff.XXXXXX")"' "$file" \
    && grep -Fq 'USER_PROVISIONER="$HANDOFF_ROOT/provision.sh"' "$file" \
    && grep -Fq 'idInstallSealedHandoffFile "$CURRENT_PROVISIONER" "$USER_PROVISIONER"' "$file"; then
    pass "$label stages the current immutable provisioner in an unpredictable sealed directory"
  else
    fail "$label does not stage the current provisioner for root-to-user handoff"
  fi

  if grep -Fq 'USER_ENGINE="$HANDOFF_ROOT/install-doctor-engine.mjs"' "$file" \
    && grep -Fq 'idInstallSealedHandoffFile "$VERIFIED_ENGINE" "$USER_ENGINE"' "$file" \
    && grep -Fq 'Root handoff source digest mismatch' "$file" \
    && grep -Fq 'Copied handoff set failed checksum verification' "$file"; then
    pass "$label copies and re-verifies the complete signed handoff set"
  else
    fail "$label does not safely transfer the signed engine across the root boundary"
  fi

  if grep -Fq 'idInstallSealedHandoffFile "${DESKTOP_TOOLS_OPENCODE_ARCHIVE:-}" "$USER_OPENCODE_ARCHIVE"' "$file" \
    && grep -Fq 'idInstallSealedHandoffFile "${DESKTOP_TOOLS_SUPERVISOR_PATH:-}" "$USER_SUPERVISOR"' "$file" \
    && grep -Fq 'idInstallSealedHandoffFile "${DESKTOP_TOOLS_TOOLS_ARCHIVE:-}" "$USER_TOOLS_ARCHIVE"' "$file" \
    && grep -Fq 'idInstallSealedHandoffFile "${DESKTOP_TOOLS_OPENCODE_LOCK_PATH:-}" "$USER_OPENCODE_LOCK"' "$file" \
    && grep -Fq 'chmod 0444 "$USER_OPENCODE_ARCHIVE" "$USER_SUPERVISOR" "$USER_TOOLS_ARCHIVE" "$USER_OPENCODE_LOCK"' "$file" \
    && ! grep -Eq 'chown.*USER_(OPENCODE|SUPERVISOR|TOOLS)' "$file" \
    && grep -Fq 'Desktop Tools runtime handoff failed checksum verification' "$file"; then
    pass "$label seals and re-verifies the complete Desktop Tools runtime closure"
  else
    fail "$label loses the verified Desktop Tools runtime closure at root handoff"
  fi

  if grep -Fq "trap '_idCleanupHandoffAndReport' EXIT" "$file" \
    && grep -Fq "trap '_idCleanupHandoff; idCleanupProvisionerRuntime || true; exit 130' INT" "$file" \
    && grep -Fq "trap '_idCleanupHandoff; idCleanupProvisionerRuntime || true; exit 143' TERM" "$file"; then
    pass "$label composes status reporting with staged-file cleanup on exit and signals"
  else
    fail "$label can leak staged handoff files after interruption"
  fi

  if grep -Fq 'chmod 0711 "$HANDOFF_ROOT"' "$file" \
    && grep -Fq 'chmod 0555 "$USER_PROVISIONER" "$USER_ENGINE"' "$file" \
    && grep -Fq 'chmod 0444 "$USER_MANIFEST" "$USER_SIGNATURE" "$ENV_EXPORT"' "$file" \
    && ! sed -n '/# Seal the complete handoff/,/HANDOFF_STATUS=\$?/p' "$file" | grep -Eq 'chown.*HANDOFF_ROOT'; then
    pass "$label keeps the handoff root-owned and non-writable through execution"
  else
    fail "$label exposes a writable root-to-user handoff race"
  fi

  if ! grep -Eq 'ENV_EXPORT=/tmp/install-doctor-env-|provision-\$\$|install-doctor-engine-\$\$' "$file"; then
    pass "$label has no predictable privileged handoff path"
  else
    fail "$label retains a predictable privileged handoff path"
  fi

  if ! sed -n '/function ensureInstallUser()/,/^}/p' "$file" | grep -Eq 'curl[^\n]*install\.doctor/start'; then
    pass "$label root handoff does not re-download a mutable entrypoint"
  else
    fail "$label root handoff re-downloads the mutable entrypoint"
  fi

  if grep -Fq 'exec 9</dev/tty' "$file" \
    && grep -Fq '_idRunSealedUserHandoff <&9 9<&- & BROKER_CHILD_PID=$!' "$file" \
    && grep -Fq 'exec 9<&-' "$file" \
    && grep -Fq '_idRunSealedUserHandoff </dev/null & BROKER_CHILD_PID=$!' "$file"; then
    pass "$label preserves interactive stdin across root-to-user handoff and isolates headless stdin"
  else
    fail "$label loses or ambiguously inherits stdin across root-to-user handoff"
  fi
done

printf 'bootstrap-local-handoff: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
