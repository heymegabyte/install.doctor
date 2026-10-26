#!/usr/bin/env bash
# Asserts the aid shell-history policy in software.yml (decision: docs/aid/decisions/0001):
#   - hiSHtory (ddworken/hishtory) is ADOPTED  → NOT _deprecated
#   - Atuin is SUPERSEDED for aid              → _deprecated set
#   - neither entry carries a FABRICATED description (master-prompt §10)
# aid-core already enforces the blueprint side (validateBlueprint rejects shellHistory 'atuin').
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SW="$ROOT/software.yml"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

# YAML scalar query: mikefarah yq, else python3+pyyaml, else sentinel. "null"/None → "".
q(){ local out
  if command -v yq >/dev/null 2>&1; then
    out="$(yq "$1" "$SW" 2>/dev/null)"
  elif python3 -c 'import yaml' 2>/dev/null; then
    out="$(python3 - "$SW" "$1" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1])) or {}
cur = d
for k in sys.argv[2].lstrip('.').split('.'):
    cur = cur.get(k) if isinstance(cur, dict) else None
    if cur is None: break
print("" if cur is None else cur)
PY
)"
  else printf '__NOPARSER__'; return; fi
  [ "$out" = "null" ] && out=""; printf '%s' "$out"; }

say "shell-history policy (software.yml)"
hdep="$(q '.softwarePackages.hishtory._deprecated')"
if [ "$hdep" = "__NOPARSER__" ]; then
  skip "no yq / python3+pyyaml — shell-history policy test skipped"
else
  adep="$(q '.softwarePackages.atuin._deprecated')"
  hdesc="$(q '.softwarePackages.hishtory._desc')"
  ashort="$(q '.softwarePackages.atuin._short')"
  adesc="$(q '.softwarePackages.atuin._desc')"
  hbrew="$(q '.softwarePackages.hishtory.brew')"

  [ -z "$hdep" ] && pass "hiSHtory adopted (not _deprecated)" || fail "hiSHtory still _deprecated: $hdep"
  [ -n "$adep" ] && pass "Atuin superseded (_deprecated set)" || fail "Atuin not marked _deprecated"
  [ "$hbrew" = "hishtory" ] && pass "hiSHtory still installable (brew: hishtory)" || fail "hiSHtory brew entry changed: $hbrew"
  case "$hdesc" in *"browsing history"*|*"online activities"*) fail "hiSHtory _desc still fabricated";; *) pass "hiSHtory _desc corrected (not browsing-history slop)";; esac
  case "$ashort$adesc" in *"macOS windows"*|*"AWS infrastructure"*|*"EC2 instances"*) fail "Atuin _short/_desc still fabricated";; *) pass "Atuin _short/_desc corrected (not windows/AWS slop)";; esac
fi

# the decision record must exist
ADR="$ROOT/docs/aid/decisions/0001-shell-history-hishtory-over-atuin.md"
[ -f "$ADR" ] && pass "decision record present (0001)" || fail "decision record missing: docs/aid/decisions/0001-shell-history-hishtory-over-atuin.md"

say "shell-history policy: $P passed, $F failed"
[ "$F" -eq 0 ]
