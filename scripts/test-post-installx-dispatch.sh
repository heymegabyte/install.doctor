#!/usr/bin/env bash
# Post-installx DISPATCH-contract gate (new-arc fire #250).
#
# The prompt's "commonly used ... software should be pre-installed AND CONFIGURED" + "ensuring that
# cloudflared has the machine connected, CloudFlare WARP ... including the right certificate" promise
# depends on the post-installx hooks ACTUALLY RUNNING. Tracing installx (fire #250, verify-against-
# source-of-truth) established the REAL dispatch mechanism:
#   a software.yml package entry carries a `script:` key that invokes its hook — installx `case 'script'`
#   (home/dot_local/bin/executable_installx:436) -> runScript (:46) -> `bash <the script>`.
# It is NOT an automatic per-package convention: installx has no readdir/glob of the hooks dir,
# postInstall() (:469) does only flatpak links, and no chezmoiscript/provision.sh/Taskfile runs the dir.
# Only `wazuh` is currently wired (software.yml:`script: bash "$HOME/.local/bin/post-installx/post-wazuh.sh"`).
#
# This gate is hermetic (pure file assertions, no network):
#   A1 sanity   — enumerate hooks on disk.
#   A2 LOCK     — the one working dispatch example (wazuh) stays wired (hook on disk + a software.yml
#                 `script:` entry invokes it). Breaking either side REDs (regression lock).
#   A3 integrity— no software.yml `script:` entry points at a MISSING hook (dangling dispatch).
#   A4 DETECTOR — report-only (audit-arc "surface" step): count built-but-undispatched hooks (the gap
#                 the wiring fix closes; tracked in docs/aid/BACKLOG.md). Never fails the suite.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS="$ROOT/home/dot_local/bin/post-installx"
SW="$ROOT/software.yml"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "post-installx dispatch contract (installx case 'script' -> runScript -> bash)"

# A1 — sanity: hooks exist on disk (executable_post-*.sh; _TEMPLATE.sh excluded by the glob).
nhooks=$(find "$HOOKS" -maxdepth 1 -name 'executable_post-*.sh' 2>/dev/null | wc -l | tr -d ' ')
if [ "$nhooks" -gt 0 ]; then pass "enumerated $nhooks post-installx hooks on disk"; else fail "no post-installx hooks found at $HOOKS"; fi

# A2 — the ONE working dispatch example (wazuh) is intact. Regression lock: break the hook OR its
#      software.yml `script:` reference and this REDs.
if [ -f "$HOOKS/executable_post-wazuh.sh" ]; then pass "post-wazuh.sh present on disk (the wired dispatch example)"; else fail "post-wazuh.sh missing from $HOOKS"; fi
if grep -qE 'script:[[:space:]]*bash[^#]*post-installx/post-wazuh\.sh' "$SW"; then
  pass "software.yml dispatches post-wazuh.sh via a script: entry (dispatch mechanism intact)"
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

# A4 — DETECTOR (report-only): built-but-undispatched gap. Surfaces the number every run; never fails.
wired=$(grep -oE 'post-installx/post-[a-z0-9-]+\.sh' "$SW" | sort -u | wc -l | tr -d ' ')
gap=$((nhooks - wired))
pass "dispatch detector: $wired/$nhooks hooks wired via software.yml script: entries; $gap built-but-undispatched (BACKLOG wiring fix)"

echo
say "post-installx-dispatch: $P passed, $F failed"
[ "$F" -eq 0 ]
