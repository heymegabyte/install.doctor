#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
canary="$root/scripts/test-launchd-rollback-canary.sh"
test -x "$canary" || { printf 'launchd canary is not executable: %s\n' "$canary" >&2; exit 1; }
bash -n "$canary"
output="$(INSTALL_DOCTOR_LAUNCHD_CANARY=0 bash "$canary")"
case "$output" in SKIP:*) ;; *) printf '%s\n' 'launchd canary did not default to a safe skip' >&2; exit 1 ;; esac
if INSTALL_DOCTOR_LAUNCHD_CANARY=invalid bash "$canary" >/dev/null 2>&1; then
  printf '%s\n' 'launchd canary accepted a malformed opt-in' >&2
  exit 1
fi
grep -Fq 'set -euo pipefail' "$canary"
grep -Fq 'umask 077' "$canary"
grep -Fq 'trap cleanup EXIT INT TERM HUP' "$canary"
grep -Fq '/bin/launchctl bootstrap "$domain" "$plist"' "$canary"
grep -Fq '/bin/launchctl bootout "$domain/$label"' "$canary"
grep -Fq 'launchd-rollback-canary.mjs' "$canary"
if grep -Eq '(^|[[:space:]])(sudo|eval)([[:space:]]|$)|launchctl (load|unload|remove)' "$canary"; then
  printf '%s\n' 'launchd canary contains a forbidden mutation primitive' >&2
  exit 1
fi
printf '%s\n' 'launchd canary contract: PASS'
