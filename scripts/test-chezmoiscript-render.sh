#!/usr/bin/env bash
# Chezmoiscript render-integrity gate (new-arc "quality + speed of deployment" axis, fire #290).
#
# Every home/.chezmoiscripts/**/*.sh.tmpl is a script chezmoi EXECUTES during `chezmoi apply` (the core of
# https://install.doctor/start). If ANY one fails to render (bad Go-template syntax / missing-key) OR renders
# to invalid bash, `chezmoi apply` aborts mid-provision — the WHOLE deploy dies, silently, on the box being set
# up. No existing suite guards the whole set: the 8 tests that touch chezmoiscripts each grep ONE specific
# script for its own concern (dispatch wiring, system-files, cnf-index, aid-report, removed-tools, supply-chain),
# so a template break in any of the other scripts ships undetected. This gate renders + `bash -n`-parses EVERY
# chezmoiscript. Pure render + syntax-check — NO network, NO execution of the scripts, NO host mutation.
#
# It SELF-TESTS its own detector against a planted broken fixture FIRST, so it can never silently become a
# vacuous no-op (verification-loop § false-green gate: a gate whose premise a change neuters passes vacuously).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 244 -- "SKIP $*" || printf '\033[1;90mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "chezmoiscript render-integrity gate (every .chezmoiscripts/**/*.sh.tmpl renders + parses)"

# chezmoi is the renderer — without it we cannot prove a template renders. SKIP (not PASS, not FAIL): a render
# gate with no renderer gives no protection, but it must never block a chezmoi-less CI runner / minimal box.
if ! command -v chezmoi >/dev/null 2>&1; then
  skip "chezmoi not installed — render gate cannot run (install chezmoi to exercise it)"
  say "chezmoiscript-render: 0 passed, 0 failed (skipped — no renderer)"
  exit 0
fi

# renderOne <file> → render via chezmoi THEN bash -n-parse the output. Returns 0 only if BOTH succeed.
# The SINGLE detector shared by the self-test and the real assertion (one code path → they can't drift).
renderOne() {
  local f="$1" out err
  out="$(mktemp)"
  err="$(mktemp)"
  if ! chezmoi execute-template <"$f" >"$out" 2>"$err"; then
    command rm -f "$out" "$err"
    return 1
  fi
  if ! bash -n "$out" 2>>"$err"; then
    command rm -f "$out" "$err"
    return 1
  fi
  command rm -f "$out" "$err"
  return 0
}

# 1. SELF-TEST the detector (the permanent RED proof). A planted broken template MUST be caught — otherwise a
#    future change that neutered renderOne would leave this gate vacuously green while real breaks sail through.
selftest_dir="$(mktemp -d)"
printf '%s\n' 'if true; then echo hi' >"$selftest_dir/broken.sh.tmpl" # unterminated if → definite bash syntax error
if renderOne "$selftest_dir/broken.sh.tmpl"; then
  fail "detector did NOT catch a deliberately-broken template — the render gate is vacuous (renderOne is dead)"
else
  pass "detector catches a broken template (self-test RED proof — the gate is not a vacuous no-op)"
fi
command rm -rf "$selftest_dir"

# 2. REAL assertion — render + parse EVERY chezmoiscript. Any break = a chezmoi-apply-aborting provisioning bug.
broken=""
n=0
while IFS= read -r f; do
  n=$((n + 1))
  renderOne "$f" || broken="$broken ${f#home/.chezmoiscripts/}"
done < <(find home/.chezmoiscripts -type f -name '*.sh.tmpl' | sort)

if [ "$n" -eq 0 ]; then
  fail "no chezmoiscripts found under home/.chezmoiscripts — the gate matched nothing (check the find glob)"
elif [ -z "$broken" ]; then
  pass "all $n chezmoiscripts render via chezmoi + parse as valid bash (chezmoi apply won't abort on a template break)"
else
  fail "chezmoiscript(s) fail render-or-parse:$broken — chezmoi apply would ABORT mid-provision"
fi

say "chezmoiscript-render: $P passed, $F failed"
[ "$F" -eq 0 ]
