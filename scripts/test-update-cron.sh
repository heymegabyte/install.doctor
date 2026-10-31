#!/usr/bin/env bash
# Weekly auto-update gate (the "cron that ensures everything is updated Monday at 2AM" ask, new-arc fire #198).
# Pure file assertions, no network, hermetic. Guards two coupled surfaces:
#   1. the crontab SOURCE (home/dot_config/crontab/config-user) carries a Monday-02:00 entry that runs update-system
#   2. the update-system SCRIPT it invokes is correct: no set -u unbound-var crash, no REMOVED package managers
#      (Nix + MacPorts were dropped fleet-wide per CLAUDE.md §7), and it keeps the host CURRENT (mise + chezmoi).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRON="$ROOT/home/dot_config/crontab/config-user"
UPD="$ROOT/home/dot_local/bin/executable_update-system"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "weekly auto-update (Monday 02:00) + update-system hygiene"

# 1. crontab source present
if [ -f "$CRON" ]; then pass "crontab source present (home/dot_config/crontab/config-user)"; else fail "config-user missing ($CRON)"; fi

# 2. a Monday-02:00 weekly entry that runs update-system (minute=0 hour=2 dom=* mon=* dow=1=Monday).
#    The user asked for an exact "Monday at 2AM", so the schedule is pinned 0 2 * * 1.
if grep -qE '^0 2 \* \* 1[[:space:]].*update-system' "$CRON" 2>/dev/null; then
  pass "config-user has a Monday-02:00 entry invoking update-system (0 2 * * 1 … update-system)"
else
  fail "no Monday-02:00 update-system cron entry (want: 0 2 * * 1 … update-system)"
fi

# 3. update-system source present + bash -n clean
if [ -f "$UPD" ]; then
  pass "update-system source present"
  bash -n "$UPD" 2>/dev/null && pass "update-system bash -n clean" || fail "update-system bash -n failed"
else
  fail "update-system missing ($UPD)"
fi

# 4+5. set -u unbound-variable guard: the script runs `set -euo pipefail`, so a BARE "$DEBUG"/"$DEBUG_MODE"
#      (unset in a bare cron environment) aborts the ENTIRE update with "unbound variable". Must use :- defaults.
if grep -qE '\[ +-n +"\$DEBUG" +\]' "$UPD" 2>/dev/null; then
  fail "bare \"\$DEBUG\" under set -u — would crash update-system when DEBUG is unset (use \${DEBUG:-})"
else
  pass "no bare \"\$DEBUG\" (set -u safe — DEBUG default-expanded)"
fi
if grep -qE '\$\{DEBUG:-' "$UPD" 2>/dev/null && grep -qE '\$\{DEBUG_MODE:-' "$UPD" 2>/dev/null; then
  pass "DEBUG + DEBUG_MODE default-expanded (\${DEBUG:-} / \${DEBUG_MODE:-})"
else
  fail "DEBUG/DEBUG_MODE not default-expanded (set -u crash risk in a bare cron env)"
fi

# 6+7. NO removed package managers — Nix + MacPorts were dropped fleet-wide (CLAUDE.md §7). Retaining their
#      update calls is drift (they can never succeed; they imply the project still supports them).
if grep -qE 'nix-channel|updateNix' "$UPD" 2>/dev/null; then
  fail "update-system still references Nix (removed fleet-wide per CLAUDE.md §7) — drop updateNix"
else
  pass "no Nix update path (Nix removed fleet-wide)"
fi
if grep -qE 'updatePort|port sync' "$UPD" 2>/dev/null; then
  fail "update-system still references MacPorts (removed fleet-wide per CLAUDE.md §7) — drop updatePort"
else
  pass "no MacPorts update path (MacPorts removed fleet-wide)"
fi

# 8+9. keep the host CURRENT: mise owns version-managed runtimes (ADR 0003) + chezmoi pulls the latest
#      install.doctor config ("keep and automatically improve the project over time"). The update MUST cover both.
if grep -qE 'updateMise' "$UPD" 2>/dev/null && grep -qE 'mise upgrade' "$UPD" 2>/dev/null; then
  pass "update-system upgrades mise-managed runtimes (mise upgrade)"
else
  fail "update-system does not upgrade mise runtimes (add updateMise → mise upgrade)"
fi
if grep -qE 'updateChezmoi' "$UPD" 2>/dev/null && grep -qE 'chezmoi update' "$UPD" 2>/dev/null; then
  pass "update-system pulls+applies the latest config (chezmoi update) — host self-improves over time"
else
  fail "update-system does not run chezmoi update (add updateChezmoi → chezmoi update)"
fi

# 9.5. Alpine must actually UPGRADE, not just index-sync (#267). On Alpine, `apk update` only refreshes the
#      package index — `apk upgrade` is what upgrades installed packages (apt separates these too: updateAptGet
#      runs `apt-get update` THEN `apt-get upgrade -y`). update-system ran `apk update` ALONE, so the Monday-02:00
#      cron on a supported Alpine fleet role (CLAUDE.md §2) refreshed the index but NEVER upgraded packages — the
#      prompt's "ensures EVERYTHING is updated" silently broken on Alpine. (dnf/pacman/zypper upgrade in one verb.)
if grep -qE 'apk upgrade' "$UPD" 2>/dev/null; then
  pass "update-system actually UPGRADES Alpine packages (apk upgrade — not just the apk-update index sync)"
else
  fail "update-system runs only 'apk update' (index sync) — add 'apk upgrade' so the Monday cron actually upgrades Alpine packages (the prompt's 'everything updated')"
fi

# 9.6 (#275). The cron must UPDATE what the lazy-installer INSTALLS with. The cnf hook (__cnf_pref) resolves a
#      missing CLI via the OS manager FIRST, then the language managers go/cargo/npm/pipx/pip/gem. The OS managers
#      + mise + flatpak/snap are updated above — but a tool lazy-installed via `npm -g` / `pipx` / `gem` was NEVER
#      kept current, so the prompt's "ensures EVERYTHING is updated" silently missed the language managers (same
#      install-vs-update contract class as #267's apk-in-cron). npm/pipx/gem each have a CLEAN, non-interactive
#      update-ALL safe for the unattended Monday-02:00 cron (npm update -g / pipx upgrade-all / gem update);
#      cargo + go are INTENTIONALLY omitted (no safe unattended update-all — cargo needs the cargo-update crate,
#      `go install` re-fetches per-binary), and pip --user upgrade-all is too fragile to run unattended.
langmiss=""
{ grep -qE 'updateNpm\(\) \{' "$UPD" && grep -qE 'npm update -g' "$UPD"; } || langmiss="$langmiss npm"
{ grep -qE 'updatePipx\(\) \{' "$UPD" && grep -qE 'pipx upgrade-all' "$UPD"; } || langmiss="$langmiss pipx"
{ grep -qE 'updateGem\(\) \{' "$UPD" && grep -qE 'gem update' "$UPD"; } || langmiss="$langmiss gem"
if [ -z "$langmiss" ]; then
  pass "update-system keeps lazy-installed language-manager tools current (npm -g / pipx / gem update — matches the cnf hook's install path)"
else
  fail "update-system does NOT update lazy-install language managers ($langmiss) — a tool installed via the cnf hook's npm/pipx/gem path is never kept current by the Monday cron"
fi

# 10. every updateX invoked in a dispatch branch must be DEFINED (no orphan call after the Nix/Port removal).
missing=""
for fn in $(grep -oE 'update[A-Z][A-Za-z]+' "$UPD" 2>/dev/null | sort -u); do
  grep -qE "^${fn}\(\) \{" "$UPD" 2>/dev/null || missing="$missing $fn"
done
if [ -z "$missing" ]; then
  pass "every invoked update* function is defined (no orphan call left by the Nix/MacPorts removal)"
else
  fail "orphan update* call(s) with no definition:$missing"
fi

# 10.6 (#279). The crontab PATH line is LOAD-BEARING: cron runs with a minimal environment, so the Monday-02:00
#      update job resolves `update-system` (+ every lazy-installed CLI) ONLY via this PATH. It must (a) include
#      ~/.local/bin (where update-system lives — drop it and the cron silently no-ops `command -v update-system`)
#      and (b) have NO DUPLICATE components (the prompt's "ensure there is no duplicate code" — a literal dup in a
#      committed config). Deduping preserves first-occurrence order → identical PATH resolution.
pathline="$(grep -E '^PATH=' "$CRON" 2>/dev/null | head -1)"
if [ -n "$pathline" ]; then
  comps="$(printf '%s' "${pathline#PATH=}" | tr ':' '\n' | grep -v '^$')"
  dups="$(printf '%s\n' "$comps" | sort | uniq -d | tr '\n' ' ' | sed 's/ *$//')"
  [ -z "$dups" ] && pass "crontab PATH has no duplicate components (no-duplicate-code)" || fail "crontab PATH has DUPLICATE components: $dups — dedupe the PATH= line (prompt: ensure no duplicate code)"
  printf '%s\n' "$comps" | grep -qF '.local/bin' && pass "crontab PATH includes ~/.local/bin (cron can resolve update-system + lazy-installed CLIs)" || fail "crontab PATH MISSING ~/.local/bin — the Monday-02:00 cron can't resolve update-system"
else
  fail "crontab has no PATH= line — cron's minimal env won't resolve user-installed tools (update-system)"
fi

# 11. shellcheck clean (defensive; skip if unavailable)
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -S warning "$UPD" >/tmp/update-system-sc.log 2>&1 && pass "update-system shellcheck clean" || { fail "update-system shellcheck findings"; tail -6 /tmp/update-system-sc.log 2>/dev/null; }
else
  skip "shellcheck not installed"
fi

say "update-cron: $P passed, $F failed"
[ "$F" -eq 0 ]
