#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
if ! printf '%s\n' "$logic" | grep -q 'ensureWarpDisconnected'; then
  pass 'top-level orchestration does not disconnect WARP outside the engine'
else
  fail 'top-level orchestration still disconnects WARP outside the engine'
fi

if grep -q "id: 'network.warp-disconnect'" "$PROVISION" \
  && grep -q "rawPlan.network === 'cloudflare-warp' && rawPlan.consents.network === true" "$PROVISION"; then
  pass 'WARP task exists only for the exact approved network selection and consent'
else
  fail 'WARP task is not strictly selection-and-consent bound'
fi

warp_section="$(grep -F -A 14 "id: 'network.warp-disconnect'" "$PROVISION")"
if printf '%s\n' "$warp_section" | grep -q "consent: 'network'" \
  && printf '%s\n' "$warp_section" | grep -q "lockDomains: \['network:cloudflare-warp'\]" \
  && printf '%s\n' "$warp_section" | grep -q "compensation: 'none'" \
  && printf '%s\n' "$warp_section" | grep -q "failurePolicy: 'abort-run'" \
  && printf '%s\n' "$warp_section" | grep -q "disconnect-no-automatic-reconnect-v1"; then
  pass 'WARP effect has explicit consent, lock, and honest no-rollback policy'
else
  fail 'WARP task effect policy is incomplete or misleading'
fi

if grep -q "'warp-disconnect-check'" "$PROVISION" \
  && grep -q "'warp-disconnect-apply'" "$PROVISION" \
  && grep -q "'warp-disconnect-verify'" "$PROVISION"; then
  pass 'WARP lifecycle operations are present in the approved operation manifest'
else
  fail 'WARP lifecycle operation manifest is incomplete'
fi

if grep -q 'warp-disconnect-check).*idWarpDisconnectedCheck' "$PROVISION" \
  && grep -q 'warp-disconnect-apply).*idWarpDisconnectedApply' "$PROVISION" \
  && grep -q 'warp-disconnect-verify).*idWarpDisconnectedVerify' "$PROVISION"; then
  pass 'operation dispatch uses current-state check/apply/verify'
else
  fail 'operation dispatch does not enforce the WARP postcondition'
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
FAKE="$TMP/warp-cli"
STATE="$TMP/state"
COUNT="$TMP/count"
printf '%s\n' connected > "$STATE"
printf '0\n' > "$COUNT"
cat > "$FAKE" <<'SCRIPT'
#!/usr/bin/env bash
set -eu
case "${1:-}" in
  status)
    case "$(cat "$WARP_TEST_STATE")" in
      connected) printf '%s\n' 'Status update: Connected' ;;
      disconnected) printf '%s\n' 'Status update: Disconnected' ;;
      unknown) printf '%s\n' 'Status update: Paused' ;;
    esac
    ;;
  disconnect)
    count="$(cat "$WARP_TEST_COUNT")"
    printf '%s\n' "$((count + 1))" > "$WARP_TEST_COUNT"
    printf '%s\n' disconnected > "$WARP_TEST_STATE"
    [ "${WARP_TEST_INTERRUPT_ONCE:-0}" != 1 ] || exit 130
    ;;
  *) exit 64 ;;
esac
SCRIPT
chmod 0700 "$FAKE"

# Exercise the production functions while replacing one compile-time fixed path
# in a private test copy; production has no caller-selectable executable path.
awk '/^idResolveWarpCli\(\) \{/{copy=1} copy{print} copy && /^}/{done++; if(done==4) exit}' "$PROVISION" \
  | sed "s#/usr/local/bin/warp-cli#$FAKE#g" > "$TMP/functions.sh"
# The functions are adjacent and the fourth closing brace terminates verify.
if ! grep -q '^idWarpDisconnectedVerify()' "$TMP/functions.sh"; then
  fail 'unable to isolate WARP lifecycle functions for behavioral test'
else
  idSha256File() { shasum -a 256 "$1" | awk '{print $1}'; }
  # shellcheck disable=SC1090
  source "$TMP/functions.sh"
  export WARP_TEST_STATE="$STATE" WARP_TEST_COUNT="$COUNT"
  export INSTALL_DOCTOR_WARP_CLI_PATH="$FAKE"
  INSTALL_DOCTOR_WARP_CLI_SHA256="$(shasum -a 256 "$FAKE" | awk '{print $1}')"
  export INSTALL_DOCTOR_WARP_CLI_SHA256
  if idWarpDisconnectedCheck; then fail 'connected WARP incorrectly passed check';
  elif [ "$?" -eq 10 ]; then pass 'connected WARP requests exactly one apply';
  else fail 'connected WARP returned the wrong check status'; fi
  if idWarpDisconnectedApply && idWarpDisconnectedVerify && [ "$(cat "$COUNT")" = 1 ]; then
    pass 'apply disconnects and verify observes the current state'
  else
    fail 'apply/verify did not establish the disconnected postcondition'
  fi
  if idWarpDisconnectedApply && idWarpDisconnectedVerify && [ "$(cat "$COUNT")" = 1 ]; then
    pass 'resume/reapply is idempotent and does not duplicate disconnect'
  else
    fail 'resume/reapply duplicated the WARP mutation'
  fi
  printf '%s\n' connected > "$STATE"
  printf '0\n' > "$COUNT"
  export WARP_TEST_INTERRUPT_ONCE=1
  if idWarpDisconnectedApply >/dev/null 2>&1; then
    fail 'interrupted disconnect incorrectly reported success'
  elif [ "$(cat "$STATE")" = disconnected ] && [ "$(cat "$COUNT")" = 1 ]; then
    unset WARP_TEST_INTERRUPT_ONCE
    if idWarpDisconnectedApply && idWarpDisconnectedVerify && [ "$(cat "$COUNT")" = 1 ]; then
      pass 'resume after a post-effect interruption verifies without duplicating the mutation'
    else
      fail 'resume after a post-effect interruption duplicated or lost the postcondition'
    fi
  else
    fail 'interruption fixture did not occur after the WARP effect'
    unset WARP_TEST_INTERRUPT_ONCE
  fi
  printf '%s\n' unknown > "$STATE"
  if idWarpDisconnectedVerify >/dev/null 2>&1; then
    fail 'unknown WARP state incorrectly verified'
  else
    pass 'failed/unknown verification blocks task success'
  fi
fi

printf 'provision-warp-engine-boundary: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
