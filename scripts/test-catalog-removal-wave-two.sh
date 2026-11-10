#!/usr/bin/env bash
# Regression coverage for catalog audit CATS-13, CATS-14, CATS-15, and CATS-17.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKREST="$ROOT/home/dot_local/bin/post-installx/executable_post-backrest.sh"
NETDATA="$ROOT/home/dot_local/bin/post-installx/executable_post-netdata.sh"
RCLONE="$ROOT/home/dot_local/bin/post-installx/executable_post-rclone.sh"
WARP="$ROOT/home/dot_local/bin/post-installx/executable_post-warp.sh"
WARP_DAEMON="$ROOT/home/dot_config/system/Library/LaunchDaemons/com.cloudflare.warp.plist.tmpl"
WARP_PREF="$ROOT/home/dot_config/system/Library/Managed Preferences/private_com.cloudflare.warp.plist.tmpl"
RCLONE_IGNORE="$ROOT/home/dot_config/system/etc/rcloneignore"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if output="$(env -u INSTALL_DOCTOR_BACKREST bash "$BACKREST" 2>&1)" \
  && printf '%s' "$output" | grep -q 'Backrest provisioning not requested'; then
  pass "Backrest defaults to a no-op unless explicitly requested"
else
  fail "Backrest did not exit cleanly behind its explicit opt-in gate"
fi
grep -q 'INSTALL_DOCTOR_BACKREST.*!=.*1' "$BACKREST" \
  && pass "Backrest requires INSTALL_DOCTOR_BACKREST=1" \
  || fail "Backrest opt-in condition is missing"
if grep -Eq 'systemctl[[:space:]]+(stop|disable)|service[[:space:]].*[[:space:]]stop' "$BACKREST"; then
  fail "Backrest recipe would stop or disable an existing service"
else
  pass "Backrest recipe does not stop or disable existing services"
fi

if grep -Eq 'netdata-debsecan|netdata-speedtest|speedtest-cli|debsecan-by-type' "$NETDATA"; then
  fail "Netdata still references removed debsecan/speedtest assets"
else
  pass "Netdata dead debsecan and speedtest branches are absent"
fi
if grep -Eq 'netdata-claim\.sh|health_alarm_notify\.conf|NETDATA_CLAIM_(TOKEN|ROOMS|URL)' "$NETDATA"; then
  fail "Netdata legacy claim or live-health mutation returned outside typed authority"
elif grep -Fq 'automated claiming and host tuning remain unsupported' "$NETDATA"; then
  pass "Netdata legacy claim and live-health mutation remain fail-closed"
else
  fail "Netdata hook does not disclose its fail-closed migration boundary"
fi
if sed -n '/^  netdata:/,/^  [a-z]/p' "$ROOT/software.yml" | grep -qE 'debsecan|speedtest-cli'; then
  fail "netdata catalog still declares removed debsecan/speedtest-cli dependencies"
else
  pass "netdata catalog no longer declares removed debsecan/speedtest-cli dependencies"
fi

if grep -qE 'rclone/rcloneignore|cp .*rcloneignore' "$RCLONE"; then
  fail "rclone hook still copies the nonexistent per-user rcloneignore"
elif [ -f "$RCLONE_IGNORE" ]; then
  pass "rclone relies on the existing system-tree rcloneignore"
else
  fail "canonical system-tree rcloneignore is missing"
fi

[ ! -e "$WARP_DAEMON" ] \
  && pass "dead-copy WARP LaunchDaemon is absent" \
  || fail "dead-copy WARP LaunchDaemon still exists"
if [ -f "$WARP_PREF" ] && [ -f "$WARP" ] && ! grep -q '/Library/LaunchDaemons/com.cloudflare.warp.plist' "$WARP"; then
  pass "WARP managed preference and enrollment hook remain without stale daemon loading"
else
  fail "WARP preference/enrollment preservation contract is broken"
fi

for script in "$BACKREST" "$NETDATA" "$RCLONE" "$WARP"; do
  bash -n "$script" || fail "syntax error: ${script#"$ROOT/"}"
done

printf 'catalog-removal-wave-two: %s passed, %s failed\n' "$P" "$F"
[ "$F" -eq 0 ]
