#!/usr/bin/env bash
# Shellcheck quality gate (new-arc "quality of the software it delivers", fire #208).
# The highest-stakes shell in the project runs UNATTENDED on every machine: the three curl|bash entrypoints
# served at install.doctor/{start,brew,ssh} (provision.sh / homebrew.sh / cloudflared-ssh.sh), the cnf hook
# sourced into EVERY interactive shell (not-found-hook.sh), and the Monday-02:00 cron updater (update-system).
# A shellcheck ERROR in any of these ships to every provisioned box with no local review in between — so the
# code-style mandate ("ShellCheck + shfmt") matters most HERE. This gate LOCKS them shellcheck-clean:
#   - error-severity (parse errors / definitely-wrong code) on all five unattended runtime scripts;
#   - the stricter warning-severity on the code delivered RAW via curl|bash + sourced into every shell
#     (the entrypoints + the cnf hook — all currently 0 findings, so hold them to the higher bar).
# SKIPs cleanly (0/0, never a vacuous pass) if shellcheck is absent. Pure local checks, no network.
# Scope is deliberately the highest-stakes scripts; extending to the 32 post-installx hooks is a later
# ratchet (audit-arc maturity ladder: detect here first, migrate the hooks once they're error-clean).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

say() { command -v gum > /dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum > /dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum > /dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "shellcheck quality — lock the highest-stakes runtime scripts clean (fire #208)"

if ! command -v shellcheck > /dev/null 2>&1; then
  say "shellcheck-quality: 0 passed, 0 failed (SKIP — shellcheck not installed on this host)"
  exit 0
fi

# error-severity (the most serious: parse errors + definitely-wrong code) on every UNATTENDED runtime script.
ERR_SCRIPTS="home/dot_config/shell/not-found-hook.sh scripts/provision.sh scripts/homebrew.sh scripts/cloudflared-ssh.sh home/dot_local/bin/executable_update-system"
for rel in $ERR_SCRIPTS; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then fail "missing runtime script: $rel"; continue; fi
  out="$(shellcheck -S error -s bash "$f" 2>&1)"
  if [ -z "$out" ]; then
    pass "shellcheck -S error clean: $rel (runs unattended on every machine)"
  else
    fail "shellcheck ERROR in $rel — ships to every provisioned box"
    printf '%s\n' "$out" | grep -E 'SC[0-9]+' | head -3
  fi
done

# warning-severity (stricter) on the code delivered RAW via curl|bash + sourced into every interactive shell:
# no local review stands between these and execution, so hold them to the higher bar (all currently 0).
WARN_SCRIPTS="home/dot_config/shell/not-found-hook.sh scripts/homebrew.sh scripts/cloudflared-ssh.sh"
for rel in $WARN_SCRIPTS; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then fail "missing curl|bash script: $rel"; continue; fi
  out="$(shellcheck -S warning -s bash "$f" 2>&1)"
  if [ -z "$out" ]; then
    pass "shellcheck -S warning clean: $rel (curl|bash-delivered — higher bar)"
  else
    fail "shellcheck warning+ in $rel — curl|bash-delivered, must stay clean"
    printf '%s\n' "$out" | grep -E 'SC[0-9]+' | head -3
  fi
done

say "shellcheck-quality: $P passed, $F failed"
[ "$F" -eq 0 ]
