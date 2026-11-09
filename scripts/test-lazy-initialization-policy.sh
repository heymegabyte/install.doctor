#!/usr/bin/env bash
# Optional catalog entries must not be configured merely because they already exist.
# Provisioning may initialize only its eager desired-state closure; cnf dispatches a
# named post-install hook separately when an optional command is installed on first use.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POST_PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-post-scripts"
POST_DISPATCHER="$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"
CNF_HOOK="$ROOT/home/dot_config/shell/not-found-hook.sh"
SERVICE_PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-services"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
PROVISION="$ROOT/scripts/provision.sh"

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
P=0 F=0

selection='.softwarePackages | with_entries(select(.value._default != false and (.value._preload == true or .value._serviceEnabled == true))) | keys[]'

grep -Fq 'select(.value._default != false and (.value._preload == true or .value._serviceEnabled == true))' "$POST_PROCESSOR" \
  && grep -Fq 'Catalog _post commands are unsupported' "$POST_PROCESSOR" \
  && ! grep -Fq 'bash -c' "$POST_PROCESSOR" \
  && pass 'catalog post metadata is validated only for the eager closure and never executed' \
  || fail 'catalog post metadata validation is unsafe or scans optional software'

grep -Fq "$selection" "$POST_DISPATCHER" \
  && pass 'post-install hook dispatch is limited to the eager desired-state closure' \
  || fail 'post-install hook dispatcher still scans every hook'

grep -Fq 'post-${__key:-$cmd}.sh' "$CNF_HOOK" \
  && pass 'first-use installation retains targeted post-install configuration' \
  || fail 'first-use installation no longer configures its selected package'

grep -Fq '.value._default != false and .value._serviceEnabled == true' "$SERVICE_PROCESSOR" \
  && grep -Fq 'selected services are unsupported until an installer-engine-owned, manager-specific privileged operation is available' "$PROVISION" \
  && ! grep -Fq "id: 'desired.services'" "$PROVISION" \
  && pass 'legacy service mutation is preserved for compatibility but excluded from provisioning authority' \
  || fail 'provisioning can still reach an uncompensated legacy service mutation'

if grep -Fq 'for HOOK in "$POST_INSTALLX_DIR"/post-*.sh' "$POST_DISPATCHER"; then
  fail 'provisioning still blindly dispatches every optional integration hook'
else
  pass 'provisioning does not blindly dispatch every optional integration hook'
fi

grep -Fq "INSTALL_DOCTOR_SELECTED_PACKAGES: legacySelectedPackages.join(',')" "$PROVISION" \
  && grep -Fq 'selectedPackages, selectedServices' "$PROVISION" \
  && grep -Fq 'selectedPackageKeys.has(x.listKey)' "$INSTALLX" \
  && pass 'approved native packages are digest-bound and added to the eager baseline' \
  || fail 'approved native package selection is not wired end to end'

grep -Fq 'const selectedHookClosure = loadPlan.items.filter(item => item.selected)' "$PROVISION" \
  && grep -Fq 'INSTALL_DOCTOR_CUSTOM_HOOK_KEYS: customHookKeysEnvironment' "$PROVISION" \
  && grep -Fq 'INSTALL_DOCTOR_CUSTOM_HOOK_KEYS//,' "$PROVISION" \
  && pass 'custom hooks use the exact approved load-plan closure' \
  || fail 'custom hooks can diverge from the approved load-plan closure'

printf 'lazy-initialization-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
