#!/usr/bin/env bash
# aid-pair bootstrap gate (machine side of S04 browser-first pairing, MASTER-PROMPT §2).
#   static : source present (chezmoi executable_) + bash -n + shellcheck clean.
#   e2e    : if CONTROL_PLANE_URL is set — run aid-pair against prod, assert it prints a pairing code
#            (start leg, unauthenticated); if the admin token is available, approve the code and assert
#            aid-pair claims + stores the device token at a 0600 path.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/home/dot_local/bin/executable_desktop-tools-pair"
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
      perm="$(stat -c '%a' "$TOK" 2>/dev/null || stat -f '%Lp' "$TOK" 2>/dev/null || echo '?')"
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

# A profile-bound invocation requests privileged authority only with an exact signed profile digest
# and a stable local fingerprint, then repeats the binding during the one-time claim.
PAIR_FIXTURE="$(mktemp -d)"
mkdir -p "$PAIR_FIXTURE/bin" "$PAIR_FIXTURE/home"
cat > "$PAIR_FIXTURE/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
printf '%q ' "$@" >> "$PAIR_CAPTURE"
printf '\n' >> "$PAIR_CAPTURE"
case " $* " in *' --data-binary @- '*) cat >> "$PAIR_CAPTURE"; printf '\n' >> "$PAIR_CAPTURE" ;; esac
case " $* " in
  *'/api/devices/pair/start'*) printf '%s\n' '{"code":"2345-6789-ABCD","verifyUrl":"https://desktop.tools/pair?code=2345-6789-ABCD"}' ;;
  *'/api/devices/pair/poll'*) printf '%s\n' '{"status":"claimed","deviceId":"device-1","token":"aid_fixture_token"}' ;;
  *) exit 22 ;;
esac
MOCK_CURL
chmod 0700 "$PAIR_FIXTURE/bin/curl"
PROFILE_DIGEST="$(printf 'a%.0s' {1..64})"
if HOME="$PAIR_FIXTURE/home" PATH="$PAIR_FIXTURE/bin:$PATH" PAIR_CAPTURE="$PAIR_FIXTURE/calls" \
  HEADLESS_INSTALL=1 DESKTOP_TOOLS_PROFILE_ID=profile-1 DESKTOP_TOOLS_PROFILE_DIGEST="$PROFILE_DIGEST" \
  DESKTOP_TOOLS_PAIR_TIMEOUT=2 DESKTOP_TOOLS_PAIR_INTERVAL=1 bash "$SRC" >/dev/null 2>&1 \
  && grep -q 'authorize-privileged-run' "$PAIR_FIXTURE/calls" \
  && grep -q 'pollSecret' "$PAIR_FIXTURE/calls" \
  && ! grep -q -- '-d .*pollSecret' "$PAIR_FIXTURE/calls" \
  && grep -q 'profileRevisionDigest' "$PAIR_FIXTURE/calls" \
  && grep -q 'x-desktop-tools-device-fingerprint' "$PAIR_FIXTURE/calls" \
  && [ "$(wc -c < "$PAIR_FIXTURE/home/.config/desktop-tools/device-fingerprint" | tr -d ' ')" = 64 ]; then
  pass 'profile-bound pairing requests and claims exact privileged device authority'
else
  fail 'profile-bound pairing omitted exact privileged device authority'
fi
FINGERPRINT_MODE="$(stat -c '%a' "$PAIR_FIXTURE/home/.config/desktop-tools/device-fingerprint" 2>/dev/null || stat -f '%Lp' "$PAIR_FIXTURE/home/.config/desktop-tools/device-fingerprint" 2>/dev/null || echo '?')"
[ "$FINGERPRINT_MODE" = 600 ] && pass 'profile-bound pairing fingerprint is owner-only' || fail "fingerprint mode $FINGERPRINT_MODE (want 600)"
rm -rf -- "$PAIR_FIXTURE"

# Browserless operation accepts the documented boolean spelling, never invokes
# a local opener, and treats owner denial as terminal rather than polling until
# timeout. Polling bounds also reject zero/oversized loops before transport.
HEADLESS_FIXTURE="$(mktemp -d)"
mkdir -p "$HEADLESS_FIXTURE/bin" "$HEADLESS_FIXTURE/home"
cat > "$HEADLESS_FIXTURE/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
case " $* " in
  *'/api/devices/pair/start'*) cat >/dev/null; printf '%s\n' '{"code":"2345-6789-ABCD","verifyUrl":"https://desktop.tools/pair?code=2345-6789-ABCD"}' ;;
  *'/api/devices/pair/poll'*) printf '%s\n' '{"status":"denied"}' ;;
  *) exit 22 ;;
esac
MOCK_CURL
cat > "$HEADLESS_FIXTURE/bin/open" <<'MOCK_OPEN'
#!/usr/bin/env bash
printf 'opened\n' >> "$BROWSER_CAPTURE"
MOCK_OPEN
cp "$HEADLESS_FIXTURE/bin/open" "$HEADLESS_FIXTURE/bin/xdg-open"
chmod 0700 "$HEADLESS_FIXTURE/bin/curl" "$HEADLESS_FIXTURE/bin/open" "$HEADLESS_FIXTURE/bin/xdg-open"
if HOME="$HEADLESS_FIXTURE/home" PATH="$HEADLESS_FIXTURE/bin:$PATH" BROWSER_CAPTURE="$HEADLESS_FIXTURE/browser" \
  HEADLESS_INSTALL=true DESKTOP_TOOLS_PAIR_TIMEOUT=2 DESKTOP_TOOLS_PAIR_INTERVAL=1 bash "$SRC" >"$HEADLESS_FIXTURE/output" 2>&1; then
  fail 'headless denied enrollment returned success'
elif [ ! -e "$HEADLESS_FIXTURE/browser" ] && grep -q 'ended without authorization: denied' "$HEADLESS_FIXTURE/output" \
  && [ ! -e "$HEADLESS_FIXTURE/home/.config/desktop-tools/device-token" ]; then
  pass 'headless true skips browser launch and owner denial terminates without a credential'
else
  fail 'headless denial handling launched a browser, hid denial, or stored a credential'
fi
if HOME="$HEADLESS_FIXTURE/home" PATH="$HEADLESS_FIXTURE/bin:$PATH" DESKTOP_TOOLS_PAIR_INTERVAL=0 bash "$SRC" >/dev/null 2>&1; then
  fail 'zero polling interval was accepted'
else
  pass 'poll timeout and interval are validated before transport'
fi
printf 'preserve-me\n' > "$HEADLESS_FIXTURE/target"
ln -s "$HEADLESS_FIXTURE/target" "$HEADLESS_FIXTURE/device-token"
if HOME="$HEADLESS_FIXTURE/home" PATH="$HEADLESS_FIXTURE/bin:$PATH" DESKTOP_TOOLS_TOKEN_PATH="$HEADLESS_FIXTURE/device-token" \
  HEADLESS_INSTALL=true DESKTOP_TOOLS_PAIR_TIMEOUT=2 DESKTOP_TOOLS_PAIR_INTERVAL=1 bash "$SRC" >/dev/null 2>&1; then
  fail 'symbolic-link credential target was accepted'
elif [ "$(cat "$HEADLESS_FIXTURE/target")" = 'preserve-me' ]; then
  pass 'credential persistence rejects symbolic-link targets without modifying their referent'
else
  fail 'credential persistence modified a symbolic-link referent'
fi
rm -rf -- "$HEADLESS_FIXTURE"

say "aid-pair: $P passed, $F failed"
[ "$F" -eq 0 ]
