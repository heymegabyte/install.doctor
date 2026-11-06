#!/usr/bin/env bash
# The root-to-user transition and credential cache must be plan-bound and engine-verified.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

for task in stage-zero.install-user-transition stage-zero.sudo-credential; do
  section="$(grep -F -A 12 "id: '$task'" "$PROVISION")"
  if [ -n "$section" ] && printf '%s\n' "$section" | grep -q inputDigest \
    && printf '%s\n' "$section" | grep -q operations \
    && printf '%s\n' "$section" | grep -q lockDomains; then
    pass "$task is plan-bound and typed"
  else
    fail "$task lacks typed stage-zero authority"
  fi
done

if grep -q "installUser: required('INSTALL_DOCTOR_USER')" "$PROVISION" \
  && grep -q 'INSTALL_DOCTOR_USER: rawPlan.installUser' "$PROVISION"; then
  pass 'install-user identity is bound into the immutable plan environment'
else
  fail 'install-user identity remains ambient after approval'
fi

if bash -c 'source "$1"; INSTALL_DOCTOR_USER="$(id -un)"; idRunEngineOperation stage-zero-install-user-check' _ "$PROVISION"; then
  pass 'matching non-root install user verifies'
else
  fail 'matching non-root install user did not verify'
fi

TMP="$(mktemp -d)"; trap 'rm -rf -- "$TMP"' EXIT
cat > "$TMP/sudo" <<'SCRIPT'
#!/usr/bin/env bash
exit 1
SCRIPT
chmod 0700 "$TMP/sudo"
if PATH="$TMP:/usr/bin:/bin" bash -c 'source "$1"; idRunEngineOperation stage-zero-sudo-check; [ "$?" -eq 10 ]' _ "$PROVISION"; then
  pass 'absent sudo authority requires acquisition instead of fabricated success or inapplicability'
else
  fail 'absent sudo cache has false verification semantics'
fi

if grep -q 'stage-zero-install-user-apply).*return 2' "$PROVISION" \
  && grep -q 'stage-zero-sudo-apply).*return 2' "$PROVISION"; then
  pass 'engine cannot duplicate stage-zero transitions'
else
  fail 'stage-zero transitions have an unsafe engine apply path'
fi

printf 'stage-zero-authority: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
