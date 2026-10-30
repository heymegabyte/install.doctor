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
# Error-sev covers all 32 hooks (aggregate, below). The stricter warning-sev bar is being migrated onto
# the hooks ONE PER FIRE (audit-arc ladder: detect -> migrate -> lock); each cleaned hook joins WARN_HOOKS.
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
WARN_SCRIPTS="home/dot_config/shell/not-found-hook.sh scripts/provision.sh scripts/homebrew.sh scripts/cloudflared-ssh.sh"
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

# error-severity on EVERY post-installx hook — they run at provision time (installx fires them after their
# tool installs); a shellcheck ERROR (parse error / broken redirect) silently misconfigures that tool on
# every machine. Aggregate (ONE assertion, lists offenders) — the 32-hook migration per the audit-arc
# maturity ladder (detect → migrate → lock). Warning-sev on the hooks is a later ratchet.
hookdirty=""
for f in "$ROOT"/home/dot_local/bin/post-installx/*.sh; do
  [ -f "$f" ] || continue
  out="$(shellcheck -S error -s bash "$f" 2>&1)"
  [ -n "$out" ] && hookdirty="$hookdirty $(basename "$f")"
done
if [ -z "$hookdirty" ]; then
  pass "all post-installx hooks pass shellcheck -S error (provision-time scripts — a parse error misconfigures the tool)"
else
  fail "post-installx hook(s) with shellcheck ERRORS:$hookdirty"
fi

# Hooks MIGRATED to the stricter warning bar, locked one-at-a-time (audit-arc ladder). The cloudflare/WARP
# hooks the prompt names came first, then migrated one hook/fire: post-zsh-bootstrap #222 (SC2155 + 3x SC2010),
# post-privoxy #223 (SC2046 chown-group quoting), post-rclone #224 (SC2046 -- dropped the redundant
# `echo $(...)` wrapper around the line-number lookup; $(...) already strips the trailing newline).
# A cleaned hook is locked here so a future edit can't regress it. Remaining warn-dirty candidates:
# post-netdata/postfix/wazuh (+ post-warp's SC2024 sudo-redirect is HOST-GATED -- `sudo tee`
# would change Homebrew cert-dir ownership, so it stays error-locked above until verified on a real box).
WARN_HOOKS="executable_post-cloudflared.sh executable_post-rkhunter.sh executable_post-zsh-bootstrap.sh executable_post-privoxy.sh executable_post-rclone.sh"
for h in $WARN_HOOKS; do
  f="$ROOT/home/dot_local/bin/post-installx/$h"
  if [ ! -f "$f" ]; then fail "missing warn-locked hook: $h"; continue; fi
  out="$(shellcheck -S warning -s bash "$f" 2>&1)"
  if [ -z "$out" ]; then
    pass "shellcheck -S warning clean: post-installx/$h (warn-locked hook)"
  else
    fail "shellcheck warning+ in post-installx/$h (warn-locked — must stay clean)"
    printf '%s\n' "$out" | grep -E 'SC[0-9]+' | head -3
  fi
done

# No user-VISIBLE "TODO" in the deployed entrypoints' + the basic-deps partial's logg/echo strings (#220).
# A `logg warn "TODO - …"` ships a dev marker to the end user (a no-user-visible-TODO Hard-Gate violation);
# source COMMENTS (`# TODO:`) are fine (todos-are-roadmap) — this flags TODO only INSIDE a logg/echo string.
TODO_FILES="scripts/provision.sh scripts/homebrew.sh scripts/cloudflared-ssh.sh scripts/partials/basic-deps"
vis=""
for rel in $TODO_FILES; do
  [ -f "$ROOT/$rel" ] || continue
  grep -qE 'logg [a-z]+ "TODO|echo "TODO' "$ROOT/$rel" && vis="$vis $(basename "$rel")"
done
if [ -z "$vis" ]; then
  pass "no user-visible TODO in deployed-entrypoint logg/echo strings (source # TODO comments allowed)"
else
  fail "user-visible TODO in a logg/echo string ships to every machine (reword — it is not a dev marker):$vis"
fi

say "shellcheck-quality: $P passed, $F failed"
[ "$F" -eq 0 ]
