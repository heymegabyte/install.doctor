#!/usr/bin/env bash
# Post-installx DISPATCH-contract gate (new-arc fire #250 detect → #251 WIRE + regression-lock).
#
# The prompt's "commonly used ... software should be pre-installed AND CONFIGURED" + "ensuring that
# cloudflared has the machine connected, CloudFlare WARP ... including the right certificate" promise
# depends on the post-installx hooks ACTUALLY RUNNING. Tracing installx (fire #250, verify-against-
# source) established the dispatch paths:
#   (a) a software.yml package entry may carry a `script:` key invoking its hook — installx `case 'script'`
#       (home/dot_local/bin/executable_installx:436) -> runScript (:46) -> `bash`. Only `wazuh` uses this.
#   (b) #251 added the GENERAL dispatcher: run_after_20-post-install.sh.tmpl (runs AFTER installx at
#       run_after_10) iterates ~/.local/bin/post-installx/post-*.sh and runs each — error-tolerant, and
#       each hook self-guards on OS + tool-presence + idempotency (post-installx/_TEMPLATE.sh), so running
#       them all is safe. This closed the #250 gap (29/30 config hooks were built but undispatched).
#   installx itself still has NO readdir of the hooks dir; postInstall() (:469) does only flatpak links.
#
# This gate is hermetic (pure file assertions, no network):
#   A1 sanity   — enumerate hooks on disk.
#   A2 LOCK     — the per-tool dispatch example (wazuh) stays wired (hook on disk + a software.yml
#                 `script:` entry invokes it). Breaking either side REDs.
#   A3 integrity— no software.yml `script:` entry points at a MISSING hook (dangling dispatch).
#   A4 LOCK     — the #251 GENERAL dispatcher exists in run_after_20 (defines runPostInstallxHooks +
#                 globs post-installx/post-*.sh). Removing it REDs (the gap reopens).
#   A5 LOCK     — the dispatcher is INVOKED (not just defined) AND error-tolerant (one hook's failure
#                 is logged, never fatal) — so provisioning can't be aborted by a single bad hook.
#   A6 coverage — every on-disk hook is reachable by the dispatcher glob (#250's 29/30 gap is CLOSED).
#   A7 headless — the dispatcher runs each hook with stdin </dev/null, so an interactive read/prompt in a
#                 hook gets EOF (never HANGS a non-interactive / headless provision). CLAUDE.md §3. #252.
#   A8 fail-fast — every hook declares `set -euo pipefail` (_TEMPLATE contract #1), load-bearing now the
#                 dispatcher RUNS them: a hook missing it could silently continue past a failed step. #253.
#                 (The _TEMPLATE's OS-gate #2 is NOT asserted — valid guards vary: OS check / command -v /
#                 `[ -f config ]` file-presence; post-vim + post-tabby correctly guard on file-presence, so a
#                 naive OSTYPE/command-v assertion would false-fail them — verified-against-source #253.)
#   A9 parity   — no hook hardcodes the dev-box user (`apple`) in a chown/chgrp. The dispatcher runs hooks
#                 FLEET-WIDE now, so a dev-Mac `chown apple:staff` FAILS on every other machine (no `apple`
#                 user) — use a var (`$(id -un):$(id -gn)`). CLAUDE.md §3 cross-platform parity. #254.
#   A10 set-u-safe — no hook references the debug-toggle env (`$DEBUG`/`$DEBUG_MODE`) WITHOUT a `:-` default;
#                 under the hooks' `set -euo pipefail`, an unset ref crashes the hook mid-config — now live
#                 via the #251 dispatcher (which doesn't export DEBUG_MODE). #255.
#   A11 tmp-clean — every hook that `mktemp`s sets a `trap ... EXIT` cleanup (_TEMPLATE req 5). The hooks run
#                 `set -Eeo pipefail` + an ERR trap that only LOGS, so an error between mktemp and the happy-
#                 path mv/consume strands the temp — now leakable fleet-wide via the #251 dispatcher. #291.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS="$ROOT/home/dot_local/bin/post-installx"
SW="$ROOT/software.yml"
DISPATCHER="$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "post-installx dispatch contract (run_after_20 loop + wazuh script: entry)"

# A1 — sanity: hooks exist on disk (executable_post-*.sh; _TEMPLATE.sh excluded by the glob).
nhooks=$(find "$HOOKS" -maxdepth 1 -name 'executable_post-*.sh' 2>/dev/null | wc -l | tr -d ' ')
if [ "$nhooks" -gt 0 ]; then pass "enumerated $nhooks post-installx hooks on disk"; else fail "no post-installx hooks found at $HOOKS"; fi

# A2 — the per-tool dispatch example (wazuh) is intact. Regression lock: break the hook OR its
#      software.yml `script:` reference and this REDs.
if [ -f "$HOOKS/executable_post-wazuh.sh" ]; then pass "post-wazuh.sh present on disk (the per-tool dispatch example)"; else fail "post-wazuh.sh missing from $HOOKS"; fi
if grep -qE 'script:[[:space:]]*bash[^#]*post-installx/post-wazuh\.sh' "$SW"; then
  pass "software.yml dispatches post-wazuh.sh via a script: entry (per-tool mechanism intact)"
else
  fail "post-wazuh.sh not dispatched by any software.yml script: entry (the working example regressed)"
fi

# A3 — integrity: every hook a software.yml `script:` entry points at must exist on disk (no dangling dispatch).
dangling=""
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  [ -f "$HOOKS/executable_$ref" ] || dangling="$dangling $ref"
done < <(grep -oE 'post-installx/post-[a-z0-9-]+\.sh' "$SW" | sed 's#post-installx/##' | sort -u)
if [ -z "$dangling" ]; then pass "every software.yml script:-dispatched hook exists on disk (no dangling dispatch)"; else fail "dangling dispatch — script: entry points at a missing hook:$dangling"; fi

# A4 — the #251 GENERAL dispatcher exists (closes the #250 gap). Defines the function + globs the hooks dir.
if [ -f "$DISPATCHER" ] && grep -q 'runPostInstallxHooks' "$DISPATCHER" && grep -qE 'post-installx' "$DISPATCHER" && grep -qE 'post-\*\.sh' "$DISPATCHER"; then
  pass "run_after_20 defines runPostInstallxHooks + globs ~/.local/bin/post-installx/post-*.sh (general dispatcher present)"
else
  fail "run_after_20 post-installx dispatcher MISSING — the 29/30 undispatched gap (#250) is OPEN"
fi

# A5 — the dispatcher is INVOKED (name appears >=2x: definition + call) AND error-tolerant (a `||` fallback
#      so one hook's non-zero exit is logged, never aborts provisioning).
calls=$(grep -cE 'runPostInstallxHooks' "$DISPATCHER" 2>/dev/null)
calls=${calls:-0}
if [ "$calls" -ge 2 ] && grep -qE '\|\|[[:space:]]*gum log' "$DISPATCHER" 2>/dev/null; then
  pass "dispatcher is invoked (${calls}x: def+call) + error-tolerant (one hook's failure is non-fatal)"
else
  fail "dispatcher not invoked (${calls}x, need >=2: def+call) OR not error-tolerant (no '|| gum log' fallback on the hook run)"
fi

# A6 — coverage: the hooks dir holds only _TEMPLATE + executable_post-*.sh, so the dispatcher's post-*.sh
#      glob misses NONE. A stray hook named outside post-* (e.g. configure-foo.sh) would be undispatchable.
stray=$(find "$HOOKS" -maxdepth 1 -type f -name '*.sh' ! -name '_TEMPLATE.sh' ! -name 'executable_post-*.sh' 2>/dev/null | wc -l | tr -d ' ')
if [ "${stray:-0}" -eq 0 ]; then
  pass "dispatch coverage: all $nhooks hooks match the post-*.sh glob, no stray undispatchable hook (#250 gap CLOSED)"
else
  fail "$stray hook(s) in $HOOKS not named post-*.sh — the run_after_20 glob would MISS them"
fi

# A7 — headless-safe: the dispatcher runs each hook with stdin from /dev/null. 4 hooks have `read` loops
#      (cloudflared/envchain/vscode/wazuh) + only 1/30 hooks respects HEADLESS_INSTALL, so a bare read of
#      inherited stdin would HANG a non-interactive provision; </dev/null gives EOF instead. #252.
if grep -qE 'bash "\$HOOK"[[:space:]]*<[[:space:]]*/dev/null' "$DISPATCHER" 2>/dev/null; then
  pass "dispatcher runs hooks with </dev/null (headless-safe: a hook's read gets EOF, can't hang provisioning)"
else
  fail "dispatcher does NOT redirect hook stdin from /dev/null — an interactive read could HANG a headless provision (#252)"
fi

# A8 — _TEMPLATE contract #1: every hook declares `set -euo pipefail` (fail-fast). Load-bearing now the
#      dispatcher RUNS all hooks — a hook missing it could silently half-configure past a failed step.
noset=""
for f in "$HOOKS"/executable_post-*.sh; do
  grep -qE '^set -euo pipefail' "$f" || noset="$noset $(basename "$f" | sed 's/^executable_//')"
done
if [ -z "$noset" ]; then
  pass "every post-installx hook declares 'set -euo pipefail' (fail-fast; $nhooks/$nhooks)"
else
  fail "post-installx hook(s) missing 'set -euo pipefail' (fail-fast contract):$noset"
fi

# A9 — cross-platform parity: no hook hardcodes the dev-box user (`apple`) in a chown/chgrp. The #251
#      dispatcher runs hooks FLEET-WIDE, so `chown apple:staff` (this Mac's user) FAILS on every other
#      machine (no `apple` user); use `$(id -un):$(id -gn)`. CLAUDE.md §3 "a var, not a dev-user/hostname".
devuser=$(grep -rlE 'ch(own|grp)[^#]* apple:' "$HOOKS"/executable_post-*.sh 2>/dev/null | sed 's#.*/executable_##;s/\.sh$//' | tr '\n' ' ')
if [ -z "$devuser" ]; then
  pass "no post-installx hook hardcodes the dev-box user in a chown/chgrp (cross-platform parity)"
else
  fail "hook(s) hardcode the dev-box user 'apple' in a chown/chgrp — fails on the non-Mac fleet:$devuser"
fi

# A10 — set -u safety: no hook references the debug-toggle env (`$DEBUG`/`$DEBUG_MODE`) WITHOUT a `:-`
#       default. Under the hooks' `set -euo pipefail`, an unset ref crashes the hook mid-config — now live
#       via the #251 dispatcher (which does NOT export DEBUG_MODE), so the crash would skip later steps.
baddbg=""
for f in "$HOOKS"/executable_post-*.sh; do
  if grep -E '\$\{?DEBUG(_MODE)?' "$f" 2>/dev/null | grep -vE 'DEBUG(_MODE)?:-' | grep -q .; then
    baddbg="$baddbg $(basename "$f" | sed 's/^executable_//;s/\.sh$//')"
  fi
done
if [ -z "$baddbg" ]; then
  pass "no hook references \$DEBUG/\$DEBUG_MODE without a :- default (set -u-safe — won't crash mid-config)"
else
  fail "hook(s) reference \$DEBUG/\$DEBUG_MODE with NO :- default — crash under set -u when unset:$baddbg"
fi

# A11 — temp-file cleanup (_TEMPLATE.sh req 5: "Clean up temp files on exit (trap)"): a hook that `mktemp`s
#       MUST set a `trap ... EXIT` so a mid-hook failure can't leak the temp. Every hook runs `set -Eeo
#       pipefail` + an ERR trap that only LOGS; the happy-path `mv`/consume isn't enough (an error between
#       mktemp and the mv strands the file) — and the #251 dispatcher now runs these fleet-wide. In scope:
#       only hooks that create a temp (no mktemp → nothing to clean).
notmp=""
for f in "$HOOKS"/executable_post-*.sh; do
  grep -qE 'mktemp' "$f" 2> /dev/null || continue
  grep -qE '^[[:space:]]*trap .*EXIT' "$f" 2> /dev/null || notmp="$notmp $(basename "$f" | sed 's/^executable_//;s/\.sh$//')"
done
if [ -z "$notmp" ]; then
  pass "every post-installx hook that mktemps cleans it via a trap ... EXIT (_TEMPLATE req 5 — no temp leak on an error path)"
else
  fail "hook(s) mktemp WITHOUT a trap ... EXIT cleanup — a mid-hook error leaks the temp (_TEMPLATE req 5):$notmp"
fi

echo
say "post-installx-dispatch: $P passed, $F failed"
[ "$F" -eq 0 ]
