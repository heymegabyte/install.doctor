#!/usr/bin/env bash
# W-series — ONE command to run every scripts/test-*.sh suite (+ the software.yml structural
# validator, scripts/validate-software-yml.sh) so the LOCAL one-command gate enforces catalog
# integrity at parity with CI (test-linux.yml). Prints a per-suite result + a grand
# total of assertions, and exits non-zero if ANY runnable suite fails. Orchestrates; never replaces the
# standalone suites. Passes CONTROL_PLANE_URL through (prod-gated suites skip their live asserts if unset).
#
# Platform orchestration harnesses (`test-linux.sh` and `test-macos.sh`) are not
# zero-argument assertion suites. They are skipped with an explicit reason and
# run only from tuple-bound workflows; auto-invoking them here either fails for
# missing arguments or mutates a host through a live entrypoint.
#
# Usage:   bash scripts/test-all.sh            # run all runnable suites
#          CONTROL_PLANE_URL=https://app.install.doctor bash scripts/test-all.sh   # + live prod asserts
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="$(uname -s 2>/dev/null || echo unknown)" # Darwin | Linux | …

c() { command -v gum >/dev/null 2>&1 && gum style --foreground "$1" -- "$2" || printf '%s\n' "$2"; }
say() { c 51 "$*"; }
ok() { c 46 "PASS $*"; }
bad() { c 196 "FAIL $*"; }
skp() { c 214 "SKIP $*"; }

# needs_os <suite-basename> -> prints the required OS token, or empty if the suite runs everywhere.
needs_os() {
  case "$1" in
  test-linux.sh|test-macos.sh) echo harness ;;
  *) echo "" ;;
  esac
}

say "test-all · host=$HOST · CONTROL_PLANE_URL=${CONTROL_PLANE_URL:-<unset>}"
RUN=0
SUITE_FAIL=0
SKIPPED=0
TOTP=0
TOTF=0
for t in "$DIR"/test-*.sh "$DIR"/validate-software-yml.sh; do
  b="$(basename "$t")"
  [ "$b" = "test-all.sh" ] && continue
  [ -f "$t" ] || continue
  req="$(needs_os "$b")"
  if [ "$req" = harness ]; then
    skp "$b (platform orchestration harness; invoked only by its tuple-bound workflow)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  if [ -n "$req" ] && [ "$req" != "$HOST" ]; then
    skp "$b (requires $req; host is $HOST)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  RUN=$((RUN + 1))
  log="$(mktemp)"
  rc=0
  bash "$t" </dev/null >"$log" 2>&1 || rc=$?
  sm="$(grep -oE '[0-9]+ passed, [0-9]+ failed' "$log" | tail -1)"
  p="$(printf '%s' "$sm" | grep -oE '^[0-9]+')"
  f="$(printf '%s' "$sm" | sed -nE 's/.* ([0-9]+) failed/\1/p')"
  p="${p:-0}"
  f="${f:-0}"
  TOTP=$((TOTP + p))
  TOTF=$((TOTF + f))
  if [ "$rc" = 0 ]; then
    ok "$b — ${sm:-exit 0}"
  else
    bad "$b — ${sm:-no summary} (exit $rc)"
    SUITE_FAIL=$((SUITE_FAIL + 1))
    # Preserve enough context to identify the first failed assertion. Six
    # lines routinely showed only a suite footer, forcing an otherwise
    # unnecessary rerun on the same platform before a defect was actionable.
    printf '%s\n' "    ---- last 80 lines of $b ----"
    tail -80 "$log" | sed 's/^/    /'
  fi
  rm -f "$log"
done

say "──────────────────────────────────────────────"
say "suites run: $RUN · skipped: $SKIPPED · assertions: ${TOTP} passed, ${TOTF} failed · failing suites: $SUITE_FAIL"
if [ "$SUITE_FAIL" -eq 0 ]; then
  ok "ALL $RUN SUITES GREEN"
else
  bad "$SUITE_FAIL SUITE(S) FAILED"
fi
[ "$SUITE_FAIL" -eq 0 ]
