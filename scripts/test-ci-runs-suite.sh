#!/usr/bin/env bash
# CI-runs-the-suite gate (fire #354). `scripts/test-all.sh` is the project's quality gate (51 suites / 877
# assertions) and its own header declares it runs "at parity with CI (test-linux.yml)" — but CI invoked only a
# few individual suites (validate-software-yml / test-templates / test-detect-os) + the live bootstrap, so the
# other ~48 gates (chezmoiscript-render · system-files · served-entrypoints · site-deploy-workflow · update-cron
# · the security/catalog/secret-hygiene gates …) NEVER ran on a push/PR — they protected only LOCAL loop fires.
# This locks that BOTH CI test workflows actually INVOKE the full auto-discovering harness (sibling parity —
# #353's lesson: never wire one + miss the sibling). The suite is blocking: warning-only execution creates false
# confidence and lets a broken checked-out installer merge while mutable production remains healthy.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/scripts/test-all.sh"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
inv() { grep -qE 'bash[[:space:]]+scripts/test-all\.sh' "$1" 2> /dev/null; }
blocking() { ! grep -E 'scripts/test-all\.sh.*(\|\||continue-on-error)' "$1" >/dev/null 2>&1; }

say "CI runs the full test suite (both OS workflows)"

# 1. the harness exists + AUTO-DISCOVERS every test-*.sh (so wiring it covers new suites automatically — a
#    hand-listed subset in CI would silently omit each future gate).
if [ -f "$HARNESS" ] && grep -qE 'for .* "\$DIR"/test-\*\.sh' "$HARNESS"; then
  pass "scripts/test-all.sh exists + auto-discovers test-*.sh (wiring it covers every current + future suite)"
else
  fail "scripts/test-all.sh missing or not auto-discovering test-*.sh — the harness is the thing CI must run"
fi

# 2+3. BOTH CI test workflows invoke the harness (sibling parity — the #353 lesson: fixing one + missing the
#      sibling is the drift to avoid). A report-only `… || echo ::warning` invocation still satisfies this.
for wf in test-linux test-macos; do
  f="$ROOT/.github/workflows/$wf.yml"
  if [ -f "$f" ] && inv "$f"; then
    pass "$wf.yml invokes scripts/test-all.sh (the full suite runs in CI, not just a few hand-listed suites)"
  else
    fail "$wf.yml does NOT invoke scripts/test-all.sh — ~48 gates never run on a push/PR there (regressions invisible to CI)"
  fi
  if [ -f "$f" ] && blocking "$f"; then
    pass "$wf.yml treats full-suite failures as blocking"
  else
    fail "$wf.yml swallows test-all.sh failures — installer regressions can merge green"
  fi
done

# PR validation is owned by the exact tuple-bound Linux and macOS workflows.
# A third direct-provision workflow previously duplicated them on mutable
# `*-latest` runners and invoked a tuple the admission policy correctly rejects.
for wf in test-linux test-macos; do
  f="$ROOT/.github/workflows/$wf.yml"
  if grep -q '^  pull_request:' "$f" && grep -q 'actions/checkout@' "$f" \
    && ! grep -q 'curl .*install\.doctor/start' "$f"; then
    pass "$wf.yml validates pull requests from the checked-out revision"
  else
    fail "$wf.yml must validate pull requests from the checked-out revision, not mutable production /start"
  fi
done
if [ ! -e "$ROOT/.github/workflows/pr-install-doctor.yml" ]; then
  pass "redundant mutable-runner PR provision workflow remains retired"
else
  fail "pr-install-doctor.yml duplicates tuple-bound PR validation and must remain retired"
fi

say "ci-runs-suite: $P passed, $F failed"
[ "$F" -eq 0 ]
