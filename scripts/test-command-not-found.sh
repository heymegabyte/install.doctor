#!/usr/bin/env bash
# Test the command-not-found AI lazy-installer (provisioning/command-not-found/).
# Hermetic + SAFE: exercises __cnf_resolve in CNF_DRY mode against a synthetic
# index (no real install, no machine mutation) and validates the index builder.
# Mirrors handler.sh's gum-or-printf output idiom so it runs in CI without gum.
# Part of the "aid" first-workflow slice — see docs/aid/CURRENT-STATE.md.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HANDLER="$ROOT/provisioning/command-not-found/handler.sh"
BUILDER="$ROOT/provisioning/command-not-found/build-index.sh"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
PASS=0; FAIL=0

say "command-not-found test suite"

# 0. static syntax
bash -n "$HANDLER" && pass "handler.sh parses" || fail "handler.sh syntax error"
bash -n "$BUILDER" && pass "build-index.sh parses" || fail "build-index.sh syntax error"

# shellcheck source=/dev/null
. "$HANDLER"

# 1. dry-run resolve against a synthetic index (proves lookup + manager selection; NO install)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
idx="$tmp/index.tsv"
# pick a package manager that actually exists on this runner; capture its TSV column.
# columns: 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem
mgr=""; col=0
for cand in "brew:3" "go:10" "cargo:11" "npm:12" "pip:14" "gem:15"; do
  name="${cand%%:*}"; c="${cand##*:}"
  if command -v "$name" >/dev/null 2>&1; then mgr="$name"; col="$c"; break; fi
done
if [ -n "$mgr" ]; then
  row=(testtool testtool "" "" "" "" "" "" "" "" "" "" "" "" "")  # 15 fields, all installers empty
  row[$((col-1))]="testtool-pkg"                                   # fill only the detected manager's column
  ( IFS=$'\t'; printf '%s\n' "${row[*]}" ) > "$idx"
  out="$(CNF_INDEX="$idx" CNF_DRY=1 __cnf_resolve testtool 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "\[CNF_DRY\] would install via $mgr: testtool-pkg"; then
    pass "dry-run resolves testtool -> $mgr: testtool-pkg (no install performed)"
  else
    fail "dry-run resolve (rc=$rc) :: $out"
  fi
else
  skip "no supported package manager on runner — dry-run resolve skipped"
fi

# 2. index builder end-to-end (needs yq+jq OR python3+pyyaml)
SW="$ROOT/software.yml"
built="$tmp/built.tsv"
if { command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; } || python3 -c 'import yaml' 2>/dev/null; then
  if bash "$BUILDER" "$SW" "$built" >/dev/null 2>&1; then
    lines="$(wc -l < "$built" | tr -d ' ')"
    if [ -s "$built" ] && [ "${lines:-0}" -gt 100 ]; then
      pass "build-index.sh produced $lines binary rows from software.yml"
    else
      fail "build-index.sh index too small ($lines rows)"
    fi
  else
    fail "build-index.sh exited non-zero"
  fi
else
  skip "no yq+jq or python3+pyyaml — index builder test skipped"
fi

say "command-not-found: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
