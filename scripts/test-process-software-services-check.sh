#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBJECT="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-services"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
mkdir -p "$TMP/bin" "$TMP/home/.local/share/chezmoi"
printf 'softwarePackages: {}\n' >"$TMP/home/.local/share/chezmoi/software.yml"
cat >"$TMP/detect-os.sh" <<'SH'
detect_service_manager() { printf '%s\n' "${TEST_MANAGER:-unknown}"; [[ "${TEST_MANAGER:-unknown}" != unknown ]]; }
SH
cat >"$TMP/bin/yq" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'keys[]'*) [[ -n "${NO_PACKAGES:-}" ]] || printf '%s\n' alpha ;;
  *'._bin // ""'*) printf '%s\n' fixture-bin ;;
  *'._service // []'*) printf '%s\n' '["alpha.service"]' ;;
  *'type'*) printf '%s\n' '!!str' ;;
  *'.[] | @json'*) printf '%s\n' '"alpha.service"' ;;
  *) exit 22 ;;
esac
SH
cat >"$TMP/bin/fixture-bin" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat >"$TMP/bin/systemctl" <<'SH'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >>"$CALL_LOG"
case "$1" in is-enabled) exit "${SYSTEMD_ENABLED:-0}" ;; is-active) exit "${SYSTEMD_ACTIVE:-0}" ;; *) exit 99 ;; esac
SH
cat >"$TMP/bin/launchctl" <<'SH'
#!/usr/bin/env bash
printf 'launchctl %s\n' "$*" >>"$CALL_LOG"
[[ "$1" == print ]] || exit 99
exit "${LAUNCHD_LOADED:-0}"
SH
cat >"$TMP/bin/brew" <<'SH'
#!/usr/bin/env bash
printf 'brew %s\n' "$*" >>"$CALL_LOG"
[[ "$1 $2" == 'services list' ]] || exit 99
[[ -n "${BREW_STATE:-}" ]] && printf 'alpha.service %s user file\n' "$BREW_STATE"
SH
chmod +x "$TMP/bin/"*
run_check() {
  HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" \
    INSTALL_DOCTOR_SELECTED_SERVICES=alpha \
    TEST_MANAGER="$1" SYSTEMD_ENABLED="${2:-0}" SYSTEMD_ACTIVE="${3:-0}" LAUNCHD_LOADED="${2:-0}" BREW_STATE="${4:-}" \
    bash "$SUBJECT" --check >"$TMP/out" 2>"$TMP/err"
}

: >"$TMP/calls"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" TEST_MANAGER=unknown NO_PACKAGES=1 \
  bash "$SUBJECT" --check >"$TMP/out" 2>"$TMP/err"; status=$?
[[ "$status" -eq 0 && "$(cat "$TMP/out")" == $'CONVERGED\tno-selected-services' && ! -s "$TMP/calls" ]] \
  && pass 'unselected services converge without manager inspection or mutation' || fail 'unselected services were inspected or treated as drift'

: >"$TMP/calls"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" TEST_MANAGER=unknown \
  bash "$SUBJECT" >"$TMP/out" 2>"$TMP/err"; status=$?
[[ "$status" -eq 0 && ! -s "$TMP/calls" ]] && pass 'unset apply authority is a no-op without manager lookup' || fail 'unset apply authority reached a manager or failed'

: >"$TMP/calls"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" TEST_MANAGER=systemd \
  INSTALL_DOCTOR_SELECTED_SERVICES='missing' bash "$SUBJECT" --check >"$TMP/out" 2>"$TMP/err"; status=$?
[[ "$status" -gt 10 && ! -s "$TMP/calls" ]] && pass 'unknown selected key fails before manager inspection' || fail 'unknown selected key reached a manager or returned an unsafe status'

: >"$TMP/calls"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" TEST_MANAGER=systemd \
  INSTALL_DOCTOR_SELECTED_SERVICES='missing' bash "$SUBJECT" >"$TMP/out" 2>"$TMP/err"; status=$?
[[ "$status" -gt 10 && ! -s "$TMP/calls" ]] && pass 'unknown apply key fails before manager inspection or mutation' || fail 'unknown apply key reached a manager or returned an unsafe status'

: >"$TMP/calls"
HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin" INSTALL_DOCTOR_DETECT_OS_LIB="$TMP/detect-os.sh" CALL_LOG="$TMP/calls" TEST_MANAGER=systemd \
  INSTALL_DOCTOR_SELECTED_SERVICES='alpha,,bad key' bash "$SUBJECT" --check >"$TMP/out" 2>"$TMP/err"; status=$?
[[ "$status" -gt 10 && ! -s "$TMP/calls" ]] && pass 'malformed selected keys fail before manager inspection' || fail 'malformed selected keys reached a manager or returned an unsafe status'

: >"$TMP/calls"; run_check systemd 0 0; status=$?
[[ "$status" -eq 0 && "$(cat "$TMP/out")" == $'CONVERGED\talpha\talpha.service\tsystemd' ]] && pass 'systemd converged returns 0 with deterministic output' || fail "systemd converged status/output ($status)"
if grep -Eq '^systemctl (enable|start|restart|stop|disable)( |$)' "$TMP/calls"; then fail 'systemd check attempted mutation'; else pass 'systemd check is read-only'; fi
cp "$TMP/out" "$TMP/first"; : >"$TMP/calls"; run_check systemd 0 0; cmp -s "$TMP/first" "$TMP/out" && pass 'check output is deterministic' || fail 'check output changed between identical runs'

: >"$TMP/calls"; run_check systemd 1 0; status=$?
[[ "$status" -eq 10 && "$(cat "$TMP/out")" == $'NEEDS_MUTATION\talpha\talpha.service\tsystemd' ]] && pass 'systemd drift returns 10' || fail "systemd drift did not return 10 ($status)"
if grep -Eq '^systemctl (enable|start|restart|stop|disable)( |$)' "$TMP/calls"; then fail 'drift check attempted mutation'; else pass 'drift check remains read-only'; fi

: >"$TMP/calls"; run_check launchd 0 0; status=$?
[[ "$status" -eq 0 && "$(cat "$TMP/out")" == $'CONVERGED\talpha\talpha.service\tlaunchd' ]] && pass 'launchctl converged inspection returns 0' || fail "launchctl converged failed ($status)"
if grep -q '^launchctl print ' "$TMP/calls" && ! grep -Eq '^launchctl (load|unload|bootstrap|bootout|enable|disable|kickstart)( |$)' "$TMP/calls"; then pass 'launchctl check uses print only'; else fail 'launchctl check used a mutating verb'; fi

: >"$TMP/calls"; run_check launchd 0 0  started; status=$?
[[ "$status" -eq 0 && "$(cat "$TMP/out")" == $'CONVERGED\talpha\talpha.service\tbrew' ]] && pass 'brew service converged inspection returns 0' || fail "brew converged failed ($status)"
if grep -Ev '^brew services list$' "$TMP/calls" | grep -q .; then fail 'brew check used a non-list command'; else pass 'brew check uses services list only'; fi

: >"$TMP/calls"; run_check unknown; status=$?
[[ "$status" -gt 10 ]] && pass 'unknown manager is uninspectable and returns greater than 10' || fail "unknown manager returned $status"

if grep -Eq 'bash[[:space:]]+-c|eval[[:space:]]' "$SUBJECT"; then
  fail 'apply path contains shell-string execution'
else
  pass 'apply path uses argv execution without bash -c or eval'
fi
if grep -Fq 'CMD=(sudo -n "${CMD[@]}")' "$SUBJECT"; then
  pass 'privileged service apply is explicitly non-interactive'
else
  fail 'privileged service apply can prompt or loses argv boundaries'
fi
if grep -Fq 'Invalid service name in desired state' "$SUBJECT"; then
  pass 'service names are validated before manager execution'
else
  fail 'service names are not validated before manager execution'
fi

printf 'process-software-services-check: %d passed, %d failed\n' "$P" "$F"
[[ "$F" -eq 0 ]]
