#!/usr/bin/env bash
# X02 gate — the getting-started guides (desktop + headless) exist, name the REAL commands of the
# working pair->pull->plan->apply loop, carry an HONEST "not yet" section, and contain NO fabricated
# working step (no "sign in with GitHub/Google" imperative — Better Auth is not wired; the dashboard
# uses an admin token). No network; pure file assertions so it runs anywhere.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESK="$ROOT/docs/aid/getting-started-desktop.md"
HEAD="$ROOT/docs/aid/getting-started-headless.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "getting-started guides (X02)"

# Both guides exist + are substantial (not stubs).
for g in "$DESK" "$HEAD"; do
  n="$(basename "$g")"
  if [ -s "$g" ]; then
    lc="$(wc -l <"$g" | tr -d ' ')"
    [ "$lc" -ge 25 ] && pass "$n exists + substantial (${lc} lines)" || fail "$n too thin (${lc} lines, want >=25)"
  else
    fail "$n missing ($g)"
  fi
done

# A guide names a real command/surface.
has() { grep -qiF "$2" "$1"; }
chk() { # chk <file> <needle> <label>
  has "$1" "$2" && pass "$(basename "$1"): names '$2' ($3)" || fail "$(basename "$1"): missing '$2' ($3)"
}

if [ -s "$DESK" ]; then
  chk "$DESK" "install.doctor/start" "bootstrap one-liner (B01)"
  chk "$DESK" "aid-pair" "pairing bootstrap (P01)"
  chk "$DESK" "app.install.doctor/pair" "browser approval surface (P03)"
  chk "$DESK" "aid status" "status + granted scope (fire #55)"
  chk "$DESK" "authorized for" "surfaces the granted scope (P05)"
  chk "$DESK" "aid apply" "install leg (E/F)"
fi
if [ -s "$HEAD" ]; then
  chk "$HEAD" "aid-pair" "pairing bootstrap (P01)"
  chk "$HEAD" "HEADLESS_INSTALL" "headless env flag (B-series)"
  chk "$HEAD" "app.install.doctor/pair" "pair-from-another-browser (P03/M09)"
  chk "$HEAD" "aid up" "one-command sync (fire #28)"
fi

# HONEST status: each guide must carry a "not yet" / limitations section (X14 honesty discipline).
honest() { grep -qiE 'not yet|not available yet|coming soon|current limitation|blocked' "$1"; }
for g in "$DESK" "$HEAD"; do
  [ -s "$g" ] || continue
  honest "$g" && pass "$(basename "$g"): carries an honest 'not yet / limitations' section (X14)" || fail "$(basename "$g"): no honest-status section"
done

# NO-FABRICATION: never present Better-Auth sign-in as a working imperative step (it is NOT wired —
# the dashboard uses an admin token). A descriptive 'not yet' mention is fine; an imperative step is a lie.
nofab() { ! grep -qiE 'sign in (with|using) (github|google)' "$1"; }
for g in "$DESK" "$HEAD"; do
  [ -s "$g" ] || continue
  nofab "$g" && pass "$(basename "$g"): no fabricated 'sign in with GitHub/Google' working step (O ⬜ honest)" || fail "$(basename "$g"): presents Better-Auth sign-in as a working step (not wired!)"
done

say "getting-started: $P passed, $F failed"
[ "$F" -eq 0 ]
