#!/usr/bin/env bash
# aid client gate (machine-side consumer of the device token from aid-pair).
#   static : source present (chezmoi executable_) + bash -n + shellcheck clean.
#   e2e    : no token -> not-paired (exit 2). If CONTROL_PLANE_URL + admin token — mint a _default
#            device token, then `aid status` -> paired summary, `aid pull` -> writes ENVIRONMENT.md.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/home/dot_local/bin/executable_aid"
CP="$ROOT/packages/control-plane"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "aid client"

if [ ! -f "$SRC" ]; then
  fail "aid source missing ($SRC)"
else
  pass "aid source present (chezmoi executable_)"
  bash -n "$SRC" 2>/dev/null && pass "bash -n clean" || fail "bash -n failed"
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -S warning "$SRC" >/tmp/aid-sc.log 2>&1 && pass "shellcheck clean" || { fail "shellcheck findings"; tail -6 /tmp/aid-sc.log 2>/dev/null; }
  else
    skip "shellcheck not installed"
  fi
fi

if [ -f "$SRC" ]; then
  RUN="$(mktemp)"
  cp "$SRC" "$RUN"
  chmod +x "$RUN"
  # no-token -> not paired (exit 2) — independent of the control plane
  rc=0
  AID_TOKEN_PATH="/nonexistent/aid-token-$$" bash "$RUN" status >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] && pass "aid status (no token) -> not-paired (exit 2)" || fail "aid status no-token exit=$rc (want 2)"

  if [ -n "${CONTROL_PLANE_URL:-}" ]; then
    u="${CONTROL_PLANE_URL%/}"
    ADMIN="${AID_ADMIN_TOKEN:-}"
    [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"
    [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
    if [ -n "$ADMIN" ]; then
      TOK="$(mktemp -u)"
      ENVF="$(mktemp -u)"
      enr="$(curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_default","label":"aid-client-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
      tok="$(printf '%s' "$enr" | jq -r '.token // empty')"
      did="$(printf '%s' "$enr" | jq -r '.deviceId // empty')"
      printf '%s' "$tok" >"$TOK"
      st="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" bash "$RUN" status 2>&1)"
      echo "$st" | grep -q 'tenant=_default' && pass "aid status -> paired summary (tenant=_default)" || fail "aid status -> $st"
      AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" pull >/dev/null 2>&1
      { [ -s "$ENVF" ] && grep -q 'install-doctor+json' "$ENVF"; } && pass "aid pull -> wrote desired ENVIRONMENT.md (fenced blueprint)" || fail "aid pull -> $(head -c 80 "$ENVF" 2>/dev/null)"
      [ -n "$did" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $ADMIN" "$u/api/devices/$did/revoke" >/dev/null 2>&1
      rm -f "$TOK" "$ENVF"
    else
      skip "admin token unavailable — aid status/pull E2E skipped"
    fi
  else
    skip "CONTROL_PLANE_URL unset — aid status/pull E2E skipped"
  fi
  rm -f "$RUN"
fi

say "aid client: $P passed, $F failed"
[ "$F" -eq 0 ]
