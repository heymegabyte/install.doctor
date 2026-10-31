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

say "chezmoiscript integrity gate (ordering invariants + every .chezmoiscripts/**/*.sh.tmpl renders + parses)"

# 0. ORDERING invariant (#307) — chezmoi runs the run_after_* scripts ALPHABETICALLY, so the NN numeric prefix
#    is the ONLY thing sequencing them. The load-bearing dependency (run_after_20's own header + CLAUDE.md §4):
#    the installx EXECUTOR must run BEFORE the post-install DISPATCHER — the post-install hooks CONFIGURE the
#    tools installx installed, so running them first makes every hook self-skip (tool absent) = a silently
#    UNCONFIGURED provision (the prompt's "pre-installed AND configured" broken, with NO error). Scripts are
#    identified by UNIQUE CONTENT markers (`command -v installx` / `runPostInstallxHooks`), NOT a name glob
#    (which mis-matched run_after_01-pre-install), so a rename that keeps the role is still caught. Pure file
#    math — NO chezmoi, NO execution — so it runs even on a renderer-less CI (where the render check below skips).
CS="home/.chezmoiscripts/universal"
prefixOf() { basename "$1" 2>/dev/null | grep -oE 'run_after_[0-9]+' | grep -oE '[0-9]+'; }
instList="$(grep -lE 'command -v installx' "$CS"/run_after_*.sh.tmpl 2>/dev/null)"
postList="$(grep -lE 'runPostInstallxHooks' "$CS"/run_after_*.sh.tmpl 2>/dev/null)"
ninst="$(printf '%s\n' "$instList" | grep -c .)"
npost="$(printf '%s\n' "$postList" | grep -c .)"
if [ "$ninst" = 1 ] && [ "$npost" = 1 ]; then
  ip="$(prefixOf "$instList")"
  pp="$(prefixOf "$postList")"
  if [ -n "$ip" ] && [ -n "$pp" ] && [ "$((10#$ip))" -lt "$((10#$pp))" ]; then
    pass "ordering: installx executor (run_after_$ip) runs BEFORE post-install dispatch (run_after_$pp) — tools installed before their config hooks fire (pre-installed AND configured)"
  else
    fail "ordering BROKEN: installx-executor prefix='$ip' is NOT < post-install-dispatch prefix='$pp' — config hooks would self-skip (tools not yet installed) = a silently UNCONFIGURED provision"
  fi
else
  fail "ordering: expected exactly 1 installx-executor + 1 post-install-dispatcher run_after script, found $ninst + $npost — the provisioning spine moved; re-anchor this invariant"
fi

# 0b. DECRYPT-GUARD/ordering invariant (#308) — the age-key DECRYPTOR (the run_before that decrypts
#    key.txt.age → the age identity, or on failure DELETES every encrypted_ file) sanitizes the secret state
#    later scripts rely on. A run_before using chezmoi's `{{ | decrypt }}` AFTER the decryptor may guard only on
#    `stat(secret)` (no key ⇒ the decryptor already removed the encrypted_ file). But a run_before that decrypts
#    BEFORE the decryptor CANNOT rely on that cleanup, so it MUST also guard on the age-key's existence
#    (`stat(.config/age/chezmoi.txt)`) — else a keyless host renders `decrypt` against a not-yet-cleaned encrypted
#    file → chezmoi apply ABORTS. run_before_02 correctly uses the belt-and-suspenders `and (stat age-key)
#    (stat secret)` guard; this locks it so a future edit (or a NEW pre-decryptor decrypt) can't drop the age-key
#    precondition. (This is the #307-deferred invariant, now correctly understood.) Pure file math — no chezmoi.
prefixBefore() { basename "$1" 2>/dev/null | grep -oE 'run_before_[0-9]+' | grep -oE '[0-9]+'; }
dpfxFile="$(grep -lE 'age/chezmoi\.txt|key\.txt\.age' "$CS"/run_before_*.sh.tmpl 2>/dev/null | sort | head -1)"
if [ -z "$dpfxFile" ]; then
  fail "ordering(decrypt): no age-key decryptor run_before found (marker age/chezmoi.txt|key.txt.age) — provisioning spine moved; re-anchor"
else
  dpfx="$(prefixBefore "$dpfxFile")"
  unguarded=""
  while IFS= read -r df; do
    [ -z "$df" ] && continue
    dfp="$(prefixBefore "$df")"
    if [ -n "$dfp" ] && [ -n "$dpfx" ] && [ "$((10#$dfp))" -lt "$((10#$dpfx))" ]; then
      grep -qE 'stat.*age.*chezmoi\.txt' "$df" || unguarded="$unguarded $(basename "$df")"
    fi
  done < <(grep -lE '\| *decrypt' "$CS"/run_before_*.sh.tmpl 2>/dev/null | sort)
  if [ -z "$unguarded" ]; then
    pass "ordering: every run_before using | decrypt BEFORE the decryptor (run_before_$dpfx) also guards on the age-key existence — safe on a keyless host, before the decryptor's encrypted_ cleanup"
  else
    fail "ordering: pre-decryptor decrypt-user(s) MISSING the stat(age-key) guard:$unguarded — a keyless host renders | decrypt against a not-yet-cleaned encrypted file → chezmoi apply ABORT"
  fi
fi

# chezmoi is the renderer — without it we cannot prove a template renders. SKIP the RENDER checks (the ordering
# invariants above already ran): a render gate with no renderer gives no render-protection, but must never block
# a chezmoi-less CI — and the ordering invariants above still gate.
if ! command -v chezmoi >/dev/null 2>&1; then
  skip "chezmoi not installed — render checks skipped (the ordering invariants above ran)"
  say "chezmoiscript integrity: $P passed, $F failed (render skipped — no chezmoi)"
  [ "$F" -eq 0 ]
  exit $?
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

say "chezmoiscript integrity: $P passed, $F failed"
[ "$F" -eq 0 ]
