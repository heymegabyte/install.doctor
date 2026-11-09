#!/usr/bin/env bash
# Hermetic regression coverage for the provisioner's structured terminal-status events.
# A failed run must emit a "failed" terminal event (and no "success"), while cleanup still
# runs; a successful run must emit a single "success" terminal event after post-provision.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISIONER="$ROOT_DIR/scripts/provision.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

P=0
F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

mkdir -p "$TMP_DIR/home"

awk '/^_idTaskJson\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/json-helper.sh"
awk '/^idProvisionEvidenceInit\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/evidence-init.sh"
awk '/^idEmitProvisionStatus\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/status-helper.sh"
awk '/^idOnProvisionExit\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/exit-guard.sh"
awk '/^provisionLogic\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' "$PROVISIONER" > "$TMP_DIR/provision-logic.sh"
if ! grep -q 'provisionLogic' "$TMP_DIR/provision-logic.sh"; then
  printf 'Failed to extract provisionLogic() from the provisioner\n' >&2
  exit 1
fi
if ! grep -q 'idOnProvisionExit' "$TMP_DIR/exit-guard.sh"; then
  printf 'Failed to extract idOnProvisionExit() from the provisioner\n' >&2
  exit 1
fi
cat "$TMP_DIR/json-helper.sh" "$TMP_DIR/evidence-init.sh" "$TMP_DIR/status-helper.sh" "$TMP_DIR/exit-guard.sh" "$TMP_DIR/provision-logic.sh" > "$TMP_DIR/combined.sh"

runScenario() {
  local label="$1" chezmoi_status="$2" event_log="$3" cleanup_marker="$4" preengine_status="${5:-0}" finalizer_verified="${6:-true}"
  rm -f "$event_log" "$cleanup_marker"
  set +e
  HOME="$TMP_DIR/home" \
  INSTALL_DOCTOR_EVENT_LOG="$event_log" \
  TEST_CHEZMOI_STATUS="$chezmoi_status" \
  TEST_PREENGINE_STATUS="$preengine_status" \
  TEST_FINALIZER_VERIFIED="$finalizer_verified" \
  TEST_EARLY_EXIT="${TEST_EARLY_EXIT:-0}" \
  TEST_EARLY_REDIRECT="${TEST_EARLY_REDIRECT:-0}" \
  CLEANUP_MARKER="$cleanup_marker" \
  bash -c '
    set -u
    logg() { :; }
    idRunRequiredProvisionStep() { shift; "$@"; }
    idRequireRootInstallUserEnrollment() { :; }
    idProvisionExit() { if [ "${INSTALL_DOCTOR_SUDO_PREPARED:-false}" = true ]; then removePasswordlessSudo || true; fi; idOnProvisionExit "$1"; }
    idPersistVerifiedReleaseProvenance() { :; }
    detect_os() { printf "%s\n" linux; }
    configureInstallPlan() { if [ "${TEST_EARLY_EXIT:-0}" -ne 0 ]; then exit "$TEST_EARLY_EXIT"; fi; if [ "${TEST_EARLY_REDIRECT:-0}" -eq 1 ]; then exit 0; fi; INSTALL_DOCTOR_NETWORK=none; export INSTALL_DOCTOR_NETWORK; }
    ensureInstallUser() { :; }
    loadHomebrew() { :; }
    setEnvironmentVariables() { :; }
    setCIEnvironmentVariables() { :; }
    idNormalizeHeadlessMode() {
      case "${HEADLESS_INSTALL:-}" in
        true|1) HEADLESS_INSTALL=true ;;
        false|0|"") HEADLESS_INSTALL="" ;;
        *) return 2 ;;
      esac
      export HEADLESS_INSTALL
    }
    applyEnvClassDefaults() { :; }
    idResolvePlatform() { :; }
    idNormalizeOfflineMode() { INSTALL_DOCTOR_OFFLINE=false; export INSTALL_DOCTOR_OFFLINE; }
    idAuthorizePlatform() { :; }
    collectInputsUpfront() { :; }
    ensureWarpDisconnected() { :; }
    setupPasswordlessSudo() { return "${TEST_PREENGINE_STATUS:-0}"; }
    ensureBasicDeps() { :; }
    ensureProvisionerNodeRuntime() { :; }
    idInstallDesktopToolsRuntimeClosure() { :; }
    idEnsureDesktopToolsDeviceAuthorization() { :; }
    idSyncDesktopToolsDesiredState() { :; }
    idReconcileStaleSudoOwnership() { :; }
    idRetireSudoOwnership() { :; }
    cloneChezmoiSourceRepo() { :; }
    ensureFullDiskAccess() { :; }
    importCloudFlareCert() { :; }
    ensureHomebrew() { :; }
    ensureHomebrewDeps() { :; }
    handleQubesDom0() { :; }
    initChezmoiAndPrompt() { :; }
    runChezmoi() { return "${TEST_CHEZMOI_STATUS:-0}"; }
    runCanonicalProvisionEngine() {
      [ "${1:-}" = --plan-only ] && return 0
      if [ "${INSTALL_DOCTOR_SUDO_PREPARED:-false}" != true ]; then
        setupPasswordlessSudo || return $?
        INSTALL_DOCTOR_SUDO_PREPARED=true
        export INSTALL_DOCTOR_SUDO_PREPARED
      fi
      local status=0
      runChezmoi || status=$?
      INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED="${TEST_FINALIZER_VERIFIED:-true}"
      export INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED
      return "$status"
    }
    removePasswordlessSudo() { : > "$CLEANUP_MARKER"; }
    handleRequiredReboot() { :; }
    postProvision() { :; }
    source "$1"
    provisionLogic
  ' _ "$TMP_DIR/combined.sh"
  STATUS=$?
  set -e
  printf '%s' "$STATUS" > "$TMP_DIR/last-status"
  printf '%s' "$label"
}

# Scenario 1: successful run
runScenario "success" 0 "$TMP_DIR/events-success.ndjson" "$TMP_DIR/cleanup-success"
if [ "$(cat "$TMP_DIR/last-status")" -eq 0 ]; then pass "successful run exits 0"; else fail "successful run exited non-zero"; fi
if [ -f "$TMP_DIR/events-success.ndjson" ]; then pass "successful run emits an event log"; else fail "successful run emitted no event log"; fi
if grep -q '"status":"started"' "$TMP_DIR/events-success.ndjson"; then pass "successful run records a started event"; else fail "successful run omitted its started event"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-success.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"success"'; then pass "successful run terminates with a success event"; else fail "successful run did not terminate with a success event"; fi
if ! grep -q '"status":"failed"' "$TMP_DIR/events-success.ndjson"; then pass "successful run records no failed event"; else fail "successful run recorded a spurious failed event"; fi

# Scenario 2: failed run (chezmoi returns 7)
runScenario "failure" 7 "$TMP_DIR/events-failure.ndjson" "$TMP_DIR/cleanup-failure"
if [ "$(cat "$TMP_DIR/last-status")" -eq 7 ]; then pass "failed run propagates its exit code"; else fail "failed run swallowed its exit code"; fi
if [ ! -f "$TMP_DIR/cleanup-failure" ]; then pass "ordinary failure delegates cleanup to the engine finalizer"; else fail "ordinary failure ran competing shell cleanup"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-failure.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"failed"'; then pass "failed run terminates with a failed event"; else fail "failed run did not terminate with a failed event"; fi
if printf '%s' "$LAST" | grep -q '"exitCode":7'; then pass "failed event carries the real exit code"; else fail "failed event omitted the exit code"; fi
if ! grep -q '"status":"success"' "$TMP_DIR/events-failure.ndjson"; then pass "failed run records no success event"; else fail "failed run recorded a false success event"; fi

runScenario "finalizer-failure" 7 "$TMP_DIR/events-finalizer-failure.ndjson" "$TMP_DIR/cleanup-finalizer-failure" 0 false
if [ -f "$TMP_DIR/cleanup-finalizer-failure" ]; then pass "missing verified finalizer evidence triggers shell fallback"; else fail "finalizer failure skipped evidence-driven fallback"; fi

# Engine exit 6 is pending verification, not a generic failure.
runScenario "pending" 6 "$TMP_DIR/events-pending.ndjson" "$TMP_DIR/cleanup-pending"
if [ "$(cat "$TMP_DIR/last-status")" -eq 6 ]; then pass "pending run preserves engine exit 6"; else fail "pending run changed its exit code"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-pending.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"pending"'; then pass "pending verification has a truthful terminal event"; else fail "pending verification was mislabeled"; fi
if ! grep -q '"status":"failed"' "$TMP_DIR/events-pending.ndjson"; then pass "pending verification is distinct from failure"; else fail "pending verification recorded failure"; fi

runScenario "cancelled" 130 "$TMP_DIR/events-cancelled.ndjson" "$TMP_DIR/cleanup-cancelled"
if [ "$(cat "$TMP_DIR/last-status")" -eq 130 ]; then pass "cancelled run preserves exit 130"; else fail "cancelled run changed its exit code"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-cancelled.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"cancelled"'; then pass "cancelled run has a truthful terminal event"; else fail "cancelled run was mislabeled"; fi

# A required failure before the engine must stop immediately, clean temporary
# privilege state, and never reach the canonical apply.
runScenario "preengine-failure" 0 "$TMP_DIR/events-preengine.ndjson" "$TMP_DIR/cleanup-preengine" 23
if [ "$(cat "$TMP_DIR/last-status")" -eq 23 ]; then pass "pre-engine failure propagates its exit code"; else fail "pre-engine failure was swallowed"; fi
if [ ! -f "$TMP_DIR/cleanup-preengine" ]; then pass "credential-bootstrap failure does not clean an unprepared sudo cache"; else fail "credential-bootstrap failure ran cleanup before preparation"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-preengine.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"failed"' && printf '%s' "$LAST" | grep -q '"exitCode":23'; then pass "pre-engine failure records truthful terminal evidence"; else fail "pre-engine failure terminal evidence is false"; fi
if ! grep -q '"status":"success"' "$TMP_DIR/events-preengine.ndjson"; then pass "pre-engine failure records no success"; else fail "pre-engine failure recorded false success"; fi

# Scenario 3: a phase hard-exits non-zero (for example, root-user handoff),
# bypassing the explicit emits — the EXIT trap must still record a truthful "failed" terminal event.
TEST_EARLY_EXIT=9 runScenario "early-exit" 0 "$TMP_DIR/events-early.ndjson" "$TMP_DIR/cleanup-early"
if [ "$(cat "$TMP_DIR/last-status")" -eq 9 ]; then pass "early-exit run propagates its exit code"; else fail "early-exit run swallowed its exit code"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-early.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"failed"'; then pass "early-exit run terminates with a failed event"; else fail "early-exit run did not terminate with a failed event"; fi
if printf '%s' "$LAST" | grep -q '"exitCode":9'; then pass "early-exit failed event carries the real exit code"; else fail "early-exit failed event omitted the exit code"; fi
if ! grep -q '"status":"success"' "$TMP_DIR/events-early.ndjson"; then pass "early-exit run records no success event"; else fail "early-exit run recorded a false success event"; fi

# Scenario 4: a phase redirects completion (exit 0 without an explicit success emit — the macOS
# FDA kickstart / Qubes dom0 delegation). Must record "redirected", never "success".
TEST_EARLY_REDIRECT=1 runScenario "redirect" 0 "$TMP_DIR/events-redirect.ndjson" "$TMP_DIR/cleanup-redirect"
if [ "$(cat "$TMP_DIR/last-status")" -eq 0 ]; then pass "redirected run exits 0"; else fail "redirected run exited non-zero"; fi
LAST="$(tail -n 1 "$TMP_DIR/events-redirect.ndjson")"
if printf '%s' "$LAST" | grep -q '"status":"redirected"'; then pass "redirected run terminates with a redirected event"; else fail "redirected run did not terminate with a redirected event"; fi
if ! grep -q '"status":"success"' "$TMP_DIR/events-redirect.ndjson"; then pass "redirected run records no success event"; else fail "redirected run recorded a false success event"; fi

# Every emitted line must be valid JSON
for log in "$TMP_DIR"/events-*.ndjson; do
  while IFS= read -r line || [ -n "$line" ]; do
    if ! printf '%s' "$line" | python3 -c 'import json,sys; json.loads(sys.stdin.read())'; then
      fail "non-JSON event line in $(basename "$log")"
      break
    fi
  done < "$log"
done
pass "all emitted events are valid JSON lines"

# Static ordering: the failed terminal event is emitted before the failure return, and the
# success terminal event is emitted only after postProvision.
python3 - "$PROVISIONER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()
started = text.index('idEmitProvisionStatus provision started 0')
run = text.index('runCanonicalProvisionEngine apply || CHEZMOI_STATUS=$?')
gate = text.index('if [ "$CHEZMOI_STATUS" -ne 0 ]', run)
fallback = text.index('if [ "${INSTALL_DOCTOR_SUDO_FINALIZER_VERIFIED:-false}" != true ]', run)
cleanup = text.index('removePasswordlessSudo', fallback)
fail_emit = text.index('idEmitProvisionStatus provision failed "$CHEZMOI_STATUS"', gate)
fail_return = text.index('return "$CHEZMOI_STATUS"', fail_emit)
post = text.index('postProvision', fail_return)
success_emit = text.index('idEmitProvisionStatus provision success 0', post)
assert started < run < fallback < cleanup < gate < fail_emit < fail_return < post < success_emit
PY
if [ $? -eq 0 ]; then pass "terminal-status emission is ordered correctly around cleanup and failure propagation"; else fail "terminal-status emission ordering is wrong"; fi

if grep -q '_idCleanupHandoffAndReport.*idOnProvisionExit' "$PROVISIONER" \
  && ! grep -q 'trap - EXIT' "$PROVISIONER"; then
  pass "root-user handoff composes cleanup with the terminal-status EXIT trap"
else
  fail "root-user handoff can replace or clear the terminal-status EXIT trap"
fi

printf 'provision-structured-results: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
