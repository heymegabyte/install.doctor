#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

section="$(sed -n '/^function ensureInstallUser()/,/^}/p' "$PROVISION")"
if ! grep -Eq '(^|[^[:alnum:]_])(useradd|chpasswd|usermod|dseditgroup)([^[:alnum:]_]|$)|dscl[^\n]* -(create|passwd)([^[:alnum:]_]|$)|passwd --stdin' <<<"$section"; then
  pass 'root handoff contains no account, password, or administrator mutation path'
else
  fail 'root handoff still mutates account, password, or administrator state'
fi

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
enrollment_line="$(printf '%s\n' "$logic" | grep -n 'idRequireRootInstallUserEnrollment' | head -1 | cut -d: -f1)"
evidence_line="$(printf '%s\n' "$logic" | grep -n 'idProvisionEvidenceInit' | head -1 | cut -d: -f1)"
trap_line="$(printf '%s\n' "$logic" | grep -n "trap 'idProvisionExit" | head -1 | cut -d: -f1)"
if [ -n "$enrollment_line" ] && [ -n "$trap_line" ] && [ -n "$evidence_line" ] \
  && [ "$enrollment_line" -lt "$trap_line" ] && [ "$enrollment_line" -lt "$evidence_line" ]; then
  pass 'root enrollment is proven before local run evidence or handoff mutation'
else
  fail 'root enrollment is not the first mutation gate'
fi

handoff_line="$(printf '%s\n' "$logic" | grep -n 'Handing off planning and execution to the enrolled user' | head -1 | cut -d: -f1)"
plan_line="$(printf '%s\n' "$logic" | grep -n 'Resolving the install plan before mutation' | head -1 | cut -d: -f1)"
authorization_line="$(printf '%s\n' "$logic" | grep -n 'Authorizing this Desktop Tools target' | head -1 | cut -d: -f1)"
if [ -n "$handoff_line" ] && [ -n "$plan_line" ] && [ -n "$authorization_line" ] \
  && [ "$handoff_line" -lt "$authorization_line" ] && [ "$handoff_line" -lt "$plan_line" ]; then
  pass 'root hands off before target enrollment, planning, approval, or mutation'
else
  fail 'root still performs target enrollment or planning before user handoff'
fi

if grep -q "The user-owned plan decides whether a privileged broker is needed" <<<"$section" \
  && grep -q 'if \[ ! -f "\$BROKER_REQUEST" \]' <<<"$section" \
  && grep -q 'DESKTOP_TOOLS_NATIVE_BROKER_REQUESTED=true' <<<"$section"; then
  pass 'root broker authority is demand-driven by the approved user plan'
else
  fail 'root broker authority is still selected before the user-owned plan'
fi

if grep -q 'Install Doctor does not automatically create or elevate accounts' "$PROVISION" \
  && grep -q 'create or enroll the target account explicitly, then rerun' "$PROVISION"; then
  pass 'failure gives explicit enrollment remediation without claiming auto-create support'
else
  fail 'root enrollment failure lacks honest remediation'
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/id" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ID_TEST_LEDGER"
if [ "$#" -eq 1 ] && [ "$1" = -u ]; then printf '0\n'; exit 0; fi
exit 1
SCRIPT
chmod 0700 "$TMP/bin/id"

awk '/^idValidateInstallUserAccount\(\) \{/{copy=1} copy{print} /^idRequireRootInstallUserEnrollment\(\) \{/{wrapper=1} wrapper && /^}/{exit}' "$PROVISION" > "$TMP/functions.sh"
if ! grep -q '^idRequireRootInstallUserEnrollment()' "$TMP/functions.sh"; then
  fail 'unable to isolate the root enrollment gate'
else
  # shellcheck disable=SC1090
  source "$TMP/functions.sh"
  export ID_TEST_LEDGER="$TMP/ledger"
  if PATH="$TMP/bin:$PATH" INSTALL_DOCTOR_USER=missing-user SUDO_USER='' idRequireRootInstallUserEnrollment >"$TMP/out" 2>&1; then
    fail 'an absent target account passed enrollment'
  elif [ "$(wc -l < "$TMP/ledger" | tr -d ' ')" -le 2 ] \
    && ! grep -Eq 'useradd|chpasswd|usermod|dseditgroup|dscl|passwd' "$TMP/ledger"; then
    pass 'absent target fails through read-only identity checks with zero account mutation'
  else
    fail 'absent target invoked an account mutation path'
  fi
fi

mkdir -p "$TMP/home"
if PATH="$TMP/bin:$PATH" HOME="$TMP/home" XDG_STATE_HOME="$TMP/state" \
  ID_TEST_LEDGER="$TMP/full-ledger" INSTALL_DOCTOR_USER=missing-user SUDO_USER='' \
  bash -c 'source "$1"; provisionLogic' _ "$PROVISION" >"$TMP/full-out" 2>&1; then
  fail 'full root provisioning accepted an absent enrollment'
elif [ ! -e "$TMP/state" ] && [ ! -e "$TMP/home/.local" ]; then
  pass 'full absent-enrollment path exits before evidence, journal, or handoff writes'
else
  fail 'absent enrollment wrote local state before failing'
fi

if grep -q '^## Root invocation prerequisite' "$ROOT/docs/advanced/installer.md" \
  && grep -q 'pre-existing' "$ROOT/docs/advanced/installer.md"; then
  pass 'operator documentation records the pre-existing-account limitation'
else
  fail 'operator documentation omits the root enrollment limitation'
fi

printf 'root-handoff-enrollment: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
