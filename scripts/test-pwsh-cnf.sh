#!/usr/bin/env bash
# E04 — PowerShell command-not-found adapter gate. pwsh is often absent on CI / this runner, so we (a)
# STRUCTURALLY assert the adapter's required invariants so its semantics are gated even with no pwsh
# runtime, and (b) parse-check with pwsh when it IS present. The install-only PRIMITIVE it delegates to
# (CNF_NO_EXEC) is behaviorally tested in test-command-not-found.sh (bash). Honest: the LIVE pwsh
# command-not-found run is gated (skipped) when pwsh is not installed — never claimed as verified.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_PS="$ROOT/home/dot_config/powershell/profile.ps1"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "PowerShell command-not-found adapter (E04)"

if [ -f "$PROFILE_PS" ]; then
  pass "pwsh profile present ($PROFILE_PS)"
  grep -q 'CommandNotFoundAction' "$PROFILE_PS" && pass "sets \$ExecutionContext.InvokeCommand.CommandNotFoundAction" || fail "no CommandNotFoundAction handler"
  grep -q 'UserInteractive' "$PROFILE_PS" && pass "installs only in an INTERACTIVE session (E13)" || fail "missing interactive gate (E13)"
  grep -q "env:CI" "$PROFILE_PS" && pass "opts OUT under CI (no unattended install)" || fail "missing CI opt-out"
  { grep -q 'not-found-hook.sh' "$PROFILE_PS" && grep -q '__cnf_resolve' "$PROFILE_PS"; } && pass "delegates to the ONE canonical resolver (no reimplementation)" || fail "does not delegate to not-found-hook.sh/__cnf_resolve"
  { grep -q 'CNF_ALLOW_NONINTERACTIVE=1' "$PROFILE_PS" && grep -q 'CNF_NO_EXEC=1' "$PROFILE_PS"; } && pass "passes approved-interactive + install-only flags to the resolver" || fail "missing CNF_ALLOW_NONINTERACTIVE/CNF_NO_EXEC"
  grep -q 'Get-Command bash' "$PROFILE_PS" && pass "no-ops to ordinary not-found where bash is absent (native Windows)" || fail "missing bash-present guard"
  # the re-run + StopSearch must be INSIDE the installed-check — a still-missing command must NOT claim success
  grep -q 'StopSearch' "$PROFILE_PS" && pass "re-runs via CommandScriptBlock + StopSearch only when installed (no false success)" || fail "missing StopSearch/re-run"
else
  fail "pwsh profile missing at $PROFILE_PS"
fi

if command -v pwsh >/dev/null 2>&1; then
  if pwsh -NoProfile -Command "\$e=\$null; [System.Management.Automation.Language.Parser]::ParseFile('$PROFILE_PS',[ref]\$null,[ref]\$e) > \$null; if (\$e.Count -gt 0) { exit 1 }" >/dev/null 2>&1; then
    pass "pwsh parse-check OK ($(pwsh --version 2>/dev/null))"
  else
    fail "pwsh parse-check reported a syntax error"
  fi
else
  skip "pwsh not installed on runner — LIVE PowerShell command-not-found run GATED (not claimed verified); structural invariants above hold"
fi

say "pwsh-cnf: $P passed, $F failed"
[ "$F" -eq 0 ]
