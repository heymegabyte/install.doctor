#!/usr/bin/env bash
# aid-pair bootstrap gate (machine side of S04 browser-first pairing, MASTER-PROMPT §2).
#   static : source present (chezmoi executable_) + bash -n + shellcheck clean.
#   e2e    : if CONTROL_PLANE_URL is set — run aid-pair against prod, assert it prints a pairing code
#            (start leg, unauthenticated); if the admin token is available, approve the code and assert
#            aid-pair claims + stores the device token at a 0600 path.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/home/dot_local/bin/executable_aid-pair"
CP="$ROOT/packages/control-plane"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "aid-pair bootstrap"

if [ ! -f "$SRC" ]; then
  fail "aid-pair source missing ($SRC)"
else
  pass "aid-pair source present (chezmoi executable_)"
  bash -n "$SRC" 2>/dev/null && pass "bash -n clean" || fail "bash -n failed"
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -S warning "$SRC" >/tmp/aid-pair-sc.log 2>&1 && pass "shellcheck clean" || { fail "shellcheck findings"; tail -6 /tmp/aid-pair-sc.log 2>/dev/null; }
  else
    skip "shellcheck not installed"
  fi
fi

if [ -n "${CONTROL_PLANE_URL:-}" ] && [ -f "$SRC" ]; then
  u="${CONTROL_PLANE_URL%/}"
  ADMIN="${AID_ADMIN_TOKEN:-}"
  [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"
  [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
  RUN="$(mktemp)"
  cp "$SRC" "$RUN"
  chmod +x "$RUN"
  TOK="$(mktemp -u)"
  LOG="$(mktemp)"
  AID_CONTROL_PLANE_URL="$u" AID_TOKEN_PATH="$TOK" AID_TENANT="_default" AID_PAIR_TIMEOUT=60 AID_PAIR_INTERVAL=2 HEADLESS_INSTALL=1 bash "$RUN" >"$LOG" 2>&1 &
  PID=$!
  code=""
  for _ in $(seq 1 20); do
    code="$(grep -i 'PAIRING CODE' "$LOG" 2>/dev/null | grep -oE '[0-9A-F]{8}' | head -1)"
    [ -n "$code" ] && break
    sleep 1
  done
  if [ -n "$code" ]; then
    pass "aid-pair start leg -> printed pairing code + verify URL (unauthenticated)"
    if [ -n "$ADMIN" ]; then
      curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "{\"code\":\"$code\"}" "$u/api/devices/pair/approve" >/dev/null 2>&1
      wait "$PID"
      rc=$?
      { [ "$rc" = 0 ] && [ -s "$TOK" ] && grep -q '^aid_' "$TOK"; } && pass "aid-pair E2E: start->approve->claim stored device token" || fail "aid-pair E2E rc=$rc (log: $(tail -1 "$LOG" 2>/dev/null))"
      perm="$(stat -f '%Lp' "$TOK" 2>/dev/null || stat -c '%a' "$TOK" 2>/dev/null || echo '?')"
      [ "$perm" = 600 ] && pass "aid-pair: token file mode 0600" || fail "token perm $perm (want 600)"
    else
      kill "$PID" 2>/dev/null || true
      wait "$PID" 2>/dev/null || true
      skip "AID_ADMIN_TOKEN unavailable — approve+claim E2E skipped (start leg verified)"
    fi
  else
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    fail "aid-pair did not print a pairing code (log: $(tail -2 "$LOG" 2>/dev/null))"
  fi
  rm -f "$RUN" "$LOG" "$TOK"
else
  skip "CONTROL_PLANE_URL unset — aid-pair E2E skipped (static gates only)"
fi

# fire #194 — A11 offline resilience (sibling of the #193 aid fix): aid-pair's control-plane curls
# (pair/start + the pair/poll loop) must carry --connect-timeout so an unreachable control plane fails
# FAST with an honest error instead of hanging on curl's multi-minute default (a poll loop would hang
# EACH iteration). Completes the #193 A11 fix across BOTH aid client scripts (aid + aid-pair). RED pre-fix.
pair_noto="$(grep -nE '\bcurl ' "$SRC" | grep -cvE -- '--connect-timeout')"
{ [ "$pair_noto" = 0 ]; } && pass "A11 — every aid-pair control-plane curl carries --connect-timeout (pairing fails fast on an unreachable CP, never hangs)" || fail "$pair_noto aid-pair curl call(s) lack --connect-timeout (pairing would hang on an unreachable control plane)"

say "aid-pair: $P passed, $F failed"
[ "$F" -eq 0 ]
