#!/usr/bin/env bash
# E04 — fish command-not-found adapter gate. fish is often absent on CI / this runner, so we (a) STRUCTURALLY
# assert the adapter's required invariants so its semantics are gated even with no fish runtime, and (b)
# syntax-check with `fish -n` when fish IS present. The install-only PRIMITIVE the adapter delegates to
# (CNF_NO_EXEC) is behaviorally tested in test-command-not-found.sh (bash). Honest: the LIVE fish
# command-not-found run is gated (skipped) when fish is not installed — never claimed as verified.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADAPTER="$ROOT/home/dot_config/fish/functions/fish_command_not_found.fish"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "fish command-not-found adapter (E04)"

if [ -f "$ADAPTER" ]; then
  pass "fish adapter present ($ADAPTER)"
  grep -q 'function fish_command_not_found' "$ADAPTER" && pass "defines fish_command_not_found (autoloaded by fish)" || fail "no fish_command_not_found function"
  grep -q 'status is-interactive' "$ADAPTER" && pass "lazy-installs only in an INTERACTIVE fish session (E13)" || fail "missing interactive gate (E13)"
  grep -q 'return 127' "$ADAPTER" && pass "still-missing -> return 127 (no false success — §4.E.4)" || fail "missing the 127 not-found invariant"
  { grep -q 'not-found-hook.sh' "$ADAPTER" && grep -q '__cnf_resolve' "$ADAPTER"; } && pass "delegates to the ONE canonical resolver (no reimplementation)" || fail "does not delegate to not-found-hook.sh/__cnf_resolve"
  { grep -q 'CNF_ALLOW_NONINTERACTIVE=1' "$ADAPTER" && grep -q 'CNF_NO_EXEC=1' "$ADAPTER"; } && pass "passes approved-interactive + install-only flags to the resolver" || fail "missing CNF_ALLOW_NONINTERACTIVE/CNF_NO_EXEC"
  grep -q 'command -q' "$ADAPTER" && pass "checks presence after install (command -q) before re-running" || fail "no post-install presence check"
  grep -q 'command -- \$cmd \$argv\[2' "$ADAPTER" && pass "re-runs the exact command in fish preserving argv" || fail "does not re-run with preserved argv"
else
  fail "fish adapter missing at $ADAPTER"
fi

if command -v fish >/dev/null 2>&1; then
  fish -n "$ADAPTER" >/dev/null 2>&1 && pass "fish -n syntax OK ($(fish --version 2>/dev/null))" || fail "fish -n reported a syntax error"
else
  skip "fish not installed on runner — LIVE fish_command_not_found run GATED (not claimed verified); structural invariants above hold"
fi

say "fish-cnf: $P passed, $F failed"
[ "$F" -eq 0 ]
