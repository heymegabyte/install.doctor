#!/usr/bin/env bash
# Focused B08 shell renderer coverage: narrow/non-TTY, resize, terminal truth, spill logs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if bash -n "$PROVISION"; then pass 'provisioner remains valid Bash'; else fail 'provisioner has invalid Bash syntax'; fi

if COLUMNS=40 bash -c 'source "$1"; idTaskRenderLine 1 4 "A very long task label" "abcdefghijklmnopqrstuvwxyz0123456789"' _ "$PROVISION" > "$TMP/narrow"; then
  width="$(awk '{ if (length > max) max=length } END { print max+0 }' "$TMP/narrow")"
  if [ "$width" -le 40 ]; then pass 'narrow non-TTY output respects current width'; else fail "narrow output is $width columns"; fi
  if ! grep -q $'\033' "$TMP/narrow"; then pass 'non-TTY task output contains no ANSI control sequences'; else fail 'non-TTY output contains ANSI'; fi
else
  fail 'narrow renderer failed'
fi

{
  COLUMNS=36 bash -c 'source "$1"; idTaskRenderLine 1 4 resize "abcdefghijklmnopqrstuvwxyz0123456789"' _ "$PROVISION"
  COLUMNS=72 bash -c 'source "$1"; idTaskRenderLine 1 4 resize "abcdefghijklmnopqrstuvwxyz0123456789"' _ "$PROVISION"
} > "$TMP/resized"
first="$(sed -n '1p' "$TMP/resized" | awk '{print length}')"
second="$(sed -n '2p' "$TMP/resized" | awk '{print length}')"
if [ "$first" -le 36 ] && [ "$second" -gt "$first" ] && [ "$second" -le 72 ]; then pass 'renderer recalculates width for every output line'; else fail 'renderer did not adapt to width change'; fi

if INSTALL_DOCTOR_TUI_STATE="$TMP/state" bash -c '
  source "$1"
  idTaskUiInit
  _idTaskEmit "{\"type\":\"status\",\"task\":\"ok\",\"status\":\"running\"}"
  _idTaskEmit "{\"type\":\"status\",\"task\":\"ok\",\"status\":\"passed\"}"
  _idTaskEmit "{\"type\":\"status\",\"task\":\"bad\",\"status\":\"failed\"}"
  _idTaskEmit "{\"type\":\"status\",\"task\":\"wait\",\"status\":\"pending\"}"
  _idTaskEmit "{\"type\":\"status\",\"task\":\"stop\",\"status\":\"cancelled\"}"
  idTaskSummary
' _ "$PROVISION" > "$TMP/summary"; then
  if grep -q 'passed=1 failed=1 pending=1 cancelled=1 running=0' "$TMP/summary"; then pass 'summary reports final task states truthfully'; else fail "summary is incorrect: $(cat "$TMP/summary")"; fi
  if grep -Fq "logs=$TMP/state/logs" "$TMP/summary"; then pass 'summary exposes the protected spill-log location'; else fail 'summary omits spill-log location'; fi
else
  fail 'terminal summary failed'
fi

cat > "$TMP/fail.sh" <<'SH'
#!/usr/bin/env bash
printf 'failure detail\n'
exit 9
SH
chmod 0700 "$TMP/fail.sh"
INSTALL_DOCTOR_TUI_STATE="$TMP/run-state" INSTALL_DOCTOR_CONCURRENCY=1 \
  bash -c 'source "$1"; idTaskUiInit; idTaskRun 1 failed-task "Failed task" "$2"' _ "$PROVISION" "$TMP/fail.sh" >/dev/null 2>&1 || true
log="$(find "$TMP/run-state/logs" -type f -name '*.log' -print -quit)"
if [ -n "$log" ] && [ -f "$log" ] && [ ! -L "$log" ] && [ "$(stat -f '%Lp' "$log" 2>/dev/null || stat -c '%a' "$log")" = 600 ]; then pass 'spill logs are private regular files'; else fail 'spill log is unsafe or not mode 0600'; fi
if grep -q '"log":"' "$TMP/run-state/events.ndjson" && grep -q '"status":"failed"' "$TMP/run-state/events.ndjson"; then pass 'failure evidence identifies its spill log'; else fail 'failure evidence does not identify spill log'; fi

cat > "$TMP/cancel.sh" <<'SH'
#!/usr/bin/env bash
exit 143
SH
chmod 0700 "$TMP/cancel.sh"
INSTALL_DOCTOR_TUI_STATE="$TMP/cancel-state" INSTALL_DOCTOR_CONCURRENCY=1 \
  bash -c 'source "$1"; idTaskUiInit; idTaskRun 1 cancelled-task "Cancelled task" "$2"' _ "$PROVISION" "$TMP/cancel.sh" >/dev/null 2>&1 || true
if grep -q '"status":"cancelled"' "$TMP/cancel-state/events.ndjson" \
  && ! grep -q '"status":"failed"' "$TMP/cancel-state/events.ndjson"; then
  pass 'signal-style exit is reported as cancelled rather than failed'
else
  fail 'signal-style exit has false terminal status'
fi

printf 'task-tui-resilience: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
