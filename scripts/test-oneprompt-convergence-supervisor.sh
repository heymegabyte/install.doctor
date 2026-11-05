#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="$ROOT/home/dot_local/bin/executable_oneprompt-convergence-supervisor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
BIN_DIR="$TMP/bin"
REPO="$TMP/oneprompt"
STATE="$TMP/manager-state"
CALLS="$TMP/manager-calls"
mkdir -p "$HOME_DIR" "$BIN_DIR" "$REPO/scripts"

cat >"$REPO/scripts/run-convergence-loop.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$REPO/scripts/run-convergence-loop.sh"

cat >"$BIN_DIR/launchctl" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>"$FAKE_MANAGER_CALLS"
case "${1:-}" in
  print)
    test "$(cat "$FAKE_MANAGER_STATE" 2>/dev/null || true)" = active || exit 1
    printf 'state = running\n'
    ;;
  bootstrap|kickstart)
    printf active >"$FAKE_MANAGER_STATE"
    ;;
  bootout)
    printf inactive >"$FAKE_MANAGER_STATE"
    ;;
esac
SH
chmod +x "$BIN_DIR/launchctl"

run_tool() {
  env \
    HOME="$HOME_DIR" \
    PATH="$BIN_DIR:/usr/bin:/bin" \
    XDG_STATE_HOME="$HOME_DIR/.local/state" \
    ONEPROMPT_SUPERVISOR_MANAGER=launchd \
    FAKE_MANAGER_STATE="$STATE" \
    FAKE_MANAGER_CALLS="$CALLS" \
    "$TOOL" "$@"
}

fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$1"; }

run_tool install --repo "$REPO"
PLIST="$HOME_DIR/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist"
test -f "$PLIST" || fail "install renders launchd definition"
pass "install renders launchd definition"

first_hash="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
run_tool install --repo "$REPO"
second_hash="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
test "$first_hash" = "$second_hash" || fail "install is idempotent"
test ! -s "$CALLS" || fail "install does not start or register the service"
pass "repeated install is byte-stable and does not start a writer"

run_tool start
grep -q '^bootstrap ' "$CALLS" || fail "start registers the installed definition"
grep -q '^kickstart ' "$CALLS" || fail "start requests the canonical service"
pass "start uses the canonical launchd identity"

run_tool pause
test -f "$HOME_DIR/.local/state/oneprompt-convergence/pause" || fail "pause intent persists"
test "$(cat "$STATE")" = inactive || fail "pause stops the service"
pass "pause persists before stopping"

run_tool resume
test ! -e "$HOME_DIR/.local/state/oneprompt-convergence/pause" || fail "resume clears pause"
test "$(cat "$STATE")" = active || fail "resume restarts the service"
pass "resume revalidates and restarts"

run_tool stop
test -f "$HOME_DIR/.local/state/oneprompt-convergence/stop" || fail "stop intent persists"
if run_tool start >/dev/null 2>&1; then
  fail "start must not override stop intent"
fi
pass "stop intent blocks automatic restart"

mkdir -p "$HOME_DIR/.local/state/oneprompt-convergence"
touch -t 202001010000 "$HOME_DIR/.local/state/oneprompt-convergence/heartbeat"
status_json="$(run_tool status --json)"
node -e '
const status = JSON.parse(process.argv[1]);
if (status.desiredMode !== "stopped") process.exit(1);
if (status.serviceState !== "inactive") process.exit(2);
if (status.heartbeat !== "stale") process.exit(3);
if (status.healthy !== false) process.exit(4);
' "$status_json" || fail "status distinguishes intent, liveness, and heartbeat"
pass "machine-readable status does not mistake stale logs for health"

run_tool verify >/dev/null
pass "verify accepts the isolated installed definition"

run_tool run | grep -q 'stop intent present' || fail "scheduled wake respects stop intent"
pass "scheduled wake cannot override durable stop intent"

HOME_LINUX="$TMP/home-linux"
BIN_LINUX="$TMP/bin-linux"
SYSTEMD_CALLS="$TMP/systemd-calls"
mkdir -p "$HOME_LINUX" "$BIN_LINUX"
cat >"$BIN_LINUX/systemctl" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>"$FAKE_SYSTEMD_CALLS"
case "$*" in
  *is-active*) exit 3 ;;
esac
SH
chmod +x "$BIN_LINUX/systemctl"

env \
  HOME="$HOME_LINUX" \
  PATH="$BIN_LINUX:/usr/bin:/bin" \
  XDG_STATE_HOME="$HOME_LINUX/.local/state" \
  ONEPROMPT_SUPERVISOR_MANAGER=systemd \
  FAKE_SYSTEMD_CALLS="$SYSTEMD_CALLS" \
  "$TOOL" install --repo "$REPO" >/dev/null
UNIT="$HOME_LINUX/.config/systemd/user/oneprompt-convergence.service"
test -f "$UNIT" || fail "install renders systemd definition"
grep -q '^Restart=no$' "$UNIT" || fail "systemd does not restart explicit bounded completion"
test -f "$HOME_LINUX/.config/systemd/user/oneprompt-convergence.timer" || fail "systemd timer is rendered"
grep -q '^OnUnitActiveSec=15min$' "$HOME_LINUX/.config/systemd/user/oneprompt-convergence.timer" || fail "systemd uses bounded watch interval"
test ! -s "$SYSTEMD_CALLS" || fail "systemd install remains inert"
pass "systemd definition is portable and install remains inert"

run_tool uninstall >/dev/null
test ! -e "$PLIST" || fail "uninstall removes only the managed definition"
test -e "$HOME_DIR/.local/state/oneprompt-convergence/stop" || fail "uninstall retains stop intent"
pass "uninstall is explicit and retains recovery intent"

HOME_UNMANAGED="$TMP/home-unmanaged"
UNMANAGED_PLIST="$HOME_UNMANAGED/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist"
mkdir -p "$(dirname "$UNMANAGED_PLIST")"
printf 'operator-owned-definition\n' >"$UNMANAGED_PLIST"
if env \
  HOME="$HOME_UNMANAGED" \
  PATH="$BIN_DIR:/usr/bin:/bin" \
  XDG_STATE_HOME="$HOME_UNMANAGED/.local/state" \
  ONEPROMPT_SUPERVISOR_MANAGER=launchd \
  FAKE_MANAGER_STATE="$STATE" \
  FAKE_MANAGER_CALLS="$CALLS" \
  "$TOOL" install --repo "$REPO" >/dev/null 2>&1; then
  fail "install must not overwrite an unmanaged canonical service"
fi
test "$(cat "$UNMANAGED_PLIST")" = operator-owned-definition || fail "unmanaged definition remains unchanged"
pass "existing operator-owned service fails closed instead of duplicating or overwriting"
