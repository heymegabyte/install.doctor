#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# Deliberately shaped as a one-item loop so additional generated provisioners
# can be added without duplicating the contract assertions.
# shellcheck disable=SC2066
for source_file in "$ROOT/scripts/provision.sh"; do
  extracted="$(mktemp)"
  sed -n '/^# BEGIN INSTALL_DOCTOR_TASK_UI$/,/^# END INSTALL_DOCTOR_TASK_UI$/p' "$source_file" > "$extracted"
  if bash -n "$extracted" && grep -q '^idTaskRun()' "$extracted"; then
    pass "${source_file#"$ROOT"/} carries valid task-event TUI"
  else
    fail "${source_file#"$ROOT"/} task-event TUI missing or invalid"
  fi
  if grep -q 'INSTALL_DOCTOR_AGENT_TASK_DIR' "$source_file" && grep -q 'idTaskPool "${AGENT_TASKS\[@\]}"' "$source_file"; then
    pass "${source_file#"$ROOT"/} invokes the bounded pool for configured agent tasks"
  else
    fail "${source_file#"$ROOT"/} defines an unused task display"
  fi
  if grep -q 'INSTALL_DOCTOR_AGENT_TASKS_CONSENT' "$source_file" \
    && grep -q 'INSTALL_DOCTOR_AGENT_FAILURE_POLICY:-fail' "$source_file"; then
    pass "${source_file#"$ROOT"/} requires consent and defaults agent failures to fatal"
  else
    fail "${source_file#"$ROOT"/} lacks safe agent execution policy"
  fi
  rm -f "$extracted"
done

# The test intentionally loads the delimited implementation under test. Use a
# real temporary file: Bash 3.2 can close process-substitution producers early
# while sourcing, leaving a partial definition set.
task_ui_source="$(mktemp)"
sed -n '/^# BEGIN INSTALL_DOCTOR_TASK_UI$/,/^# END INSTALL_DOCTOR_TASK_UI$/p' "$ROOT/scripts/provision.sh" >"$task_ui_source"
# shellcheck disable=SC1090
source "$task_ui_source"
rm -f "$task_ui_source"
state_parent="$(mktemp -d)"
state="$state_parent/run"
trap 'rm -rf "$state_parent"' EXIT
INSTALL_DOCTOR_TUI_STATE="$state"
INSTALL_DOCTOR_TUI=plain
INSTALL_DOCTOR_CONCURRENCY=2
export INSTALL_DOCTOR_TUI_STATE INSTALL_DOCTOR_TUI INSTALL_DOCTOR_CONCURRENCY
idTaskUiInit

control_value=$'quote" slash\\ backspace\b formfeed\f newline\n return\r tab\t end'
escaped_control="$(_idTaskJson "$control_value")"
if command -v jq >/dev/null 2>&1 && printf '"%s"\n' "$escaped_control" | jq -e . >/dev/null \
  && printf '%s' "$escaped_control" | grep -q '\\u0008' \
  && printf '%s' "$escaped_control" | grep -q '\\u000c'; then
  pass 'JSON encoding escapes quotes, slashes, and every exercised control byte'
else
  fail 'JSON encoding permits invalid control bytes'
fi

untrusted_state="$state_parent/untrusted"
mkdir "$untrusted_state"
INSTALL_DOCTOR_TUI_STATE="$untrusted_state"
if idTaskUiInit >/dev/null 2>&1; then fail 'pre-existing unmarked state directory was trusted'; else pass 'pre-existing unmarked state directory is rejected'; fi
ln -s "$state" "$state_parent/state-link"
INSTALL_DOCTOR_TUI_STATE="$state_parent/state-link"
if idTaskUiInit >/dev/null 2>&1; then fail 'symlink state directory was trusted'; else pass 'symlink state directory is rejected'; fi
INSTALL_DOCTOR_TUI_STATE="$state"
idTaskUiInit

noisy_ok() { printf 'alpha\nbeta\n'; }
flaky_marker="$state/flaky-marker"
flaky() { [ -f "$flaky_marker" ] && return 0; printf 'temporary failure\n'; : > "$flaky_marker"; return 1; }

idTaskRun 1 task-a 'Parallel alpha' noisy_ok & a=$!
idTaskRun 2 task-b 'Parallel beta' noisy_ok & b=$!
wait "$a"; wait "$b"

if [ "$(grep -c '"type":"status"' "$INSTALL_DOCTOR_TUI_EVENTS")" -eq 4 ] \
  && grep -q '"status":"running"' "$INSTALL_DOCTOR_TUI_EVENTS" \
  && grep -q '"status":"passed"' "$INSTALL_DOCTOR_TUI_EVENTS"; then
  pass 'parallel workers emit complete structured lifecycle events'
else
  fail 'parallel worker event stream is missing or corrupted'
fi
if [ "$(grep -c '"type":"output"' "$INSTALL_DOCTOR_TUI_EVENTS")" -eq 4 ]; then
  pass 'every concurrent output line is emitted as a structured event'
else
  fail 'concurrent output lines were lost or merged'
fi
if command -v jq >/dev/null 2>&1 && jq -e . "$INSTALL_DOCTOR_TUI_EVENTS" >/dev/null; then
  pass 'structured lifecycle stream is valid JSONL'
else
  fail 'structured lifecycle stream is not valid JSONL'
fi

if find "$state/logs" -name 'task-a-*.attempt-1.log' -size +0c | grep -q . \
  && find "$state/logs" -name 'task-b-*.attempt-1.log' -size +0c | grep -q .; then
  pass 'concurrent task output is isolated in per-task logs'
else
  fail 'concurrent output was not captured per task'
fi

INSTALL_DOCTOR_TASK_RETRIES=1 idTaskRun 1 retry-task 'Retry task' flaky
grep -q '"status":"retrying"' "$INSTALL_DOCTOR_TUI_EVENTS" \
  && pass 'failed work emits retry status before succeeding' \
  || fail 'retry lifecycle event missing'

if [ "$(find "$state/logs" -name 'retry-task-*.attempt-*.log' | wc -l | tr -d ' ')" -eq 2 ] \
  && grep '"status":"retrying"' "$INSTALL_DOCTOR_TUI_EVENTS" | grep -q '"preview":"temporary failure"'; then
  pass 'retry attempts preserve separate logs and structured previews'
else
  fail 'retry output was overwritten or omitted from events'
fi

summary="$(idTaskSummary)"
printf '%s' "$summary" | grep -q 'passed=3' \
  && printf '%s' "$summary" | grep -q 'failed=0' \
  && pass 'final summary reports status counts and elapsed time' \
  || fail 'final summary is incomplete'

task_dir="$(mktemp -d)"
for name in one two three; do
  printf '#!/usr/bin/env bash\nprintf "%s output\\n"\n' "$name" > "$task_dir/$name.sh"
  chmod +x "$task_dir/$name.sh"
done
if idTaskResolveTrustedDir "$task_dir" >/dev/null 2>&1; then
  fail 'agent task directory ran without explicit consent'
else
  pass 'agent task directory requires explicit consent'
fi
INSTALL_DOCTOR_AGENT_TASKS_CONSENT=1
export INSTALL_DOCTOR_AGENT_TASKS_CONSENT
resolved_task_dir="$(idTaskResolveTrustedDir "$task_dir")"
[ "$resolved_task_dir" = "$(cd -P "$task_dir" && pwd)" ] \
  && pass 'consented agent task directory is canonicalized' \
  || fail 'agent task directory was not canonicalized'
ln -s "$task_dir" "$state_parent/task-link"
if idTaskResolveTrustedDir "$state_parent/task-link" >/dev/null 2>&1; then fail 'symlink task directory was trusted'; else pass 'symlink task directory is rejected'; fi
chmod 777 "$task_dir"
if idTaskResolveTrustedDir "$task_dir" >/dev/null 2>&1; then fail 'writable task directory was trusted'; else pass 'group/world-writable task directory is rejected'; fi
chmod 700 "$task_dir"
idTaskUiInit
idTaskPool "$task_dir"/*.sh
[ "$(grep -c '"status":"passed"' "$INSTALL_DOCTOR_TUI_EVENTS")" -eq 3 ] \
  && grep -q '"worker":2' "$INSTALL_DOCTOR_TUI_EVENTS" \
  && pass 'real executable task pool runs with bounded worker slots' \
  || fail 'bounded executable task pool did not run through the event TUI'

first="$(_idTaskSafeId 'a/b')"; second="$(_idTaskSafeId 'a b')"
[ "$first" != "$second" ] && pass 'sanitized task IDs remain collision resistant' || fail 'sanitized task IDs collide'

slow_output() { printf 'visible-before-finish\n'; sleep 1; printf 'finished\n'; }
live_capture="$(mktemp)"
idTaskRun 1 live-task 'Live agent' slow_output > "$live_capture" & live_pid=$!
live_seen=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if kill -0 "$live_pid" 2>/dev/null && grep -q 'visible-before-finish' "$live_capture"; then live_seen=1; break; fi
  sleep 0.1
done
wait "$live_pid"
[ "$live_seen" -eq 1 ] && pass 'task output is visible before the task completes' || fail 'task output is buffered until completion'
grep -q '^\[worker 1/2\] Live agent | visible-before-finish$' "$live_capture" \
  && pass 'live lines carry serialized worker and agent prefixes' \
  || fail 'live output lacks an unambiguous worker/agent prefix'
rm -f "$live_capture"

if idTaskRun 1 exit-task 'Exit status agent' bash -c 'printf "failure-line\\n"; exit 7' >/dev/null; then
  fail 'failed command was reported as successful'
else
  rc=$?
  [ "$rc" -eq 7 ] && pass 'real command exit status survives streaming under set -e' || fail "streaming changed exit status to $rc"
fi

if idTaskPool "$task_dir/one.sh" "$state_parent/missing-task" >/dev/null; then
  pass 'pool ignores a missing non-task entry without masking real task status'
else
  fail 'pool changed successful task status because of a missing non-task entry'
fi
failing_task="$task_dir/failing.sh"
printf '#!/usr/bin/env bash\nexit 9\n' > "$failing_task"; chmod 700 "$failing_task"
if idTaskPool "$failing_task" >/dev/null; then
  fail 'failed agent pool was reported as successful'
else
  pass 'failed agent pool propagates failure for fatal-by-default provisioning'
fi
rm -rf "$task_dir"

printf 'task-event-tui: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
