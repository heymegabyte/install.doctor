#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
AFTER_10="$ROOT/home/.chezmoiscripts/universal/run_after_10-install.sh.tmpl"
AFTER_20="$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/typed-chezmoi-effects.XXXXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM

for node in desired.software-groups desired.catalog-post-validation desired.custom-post-hooks desired.custom-user-post-hooks; do
  grep -Fq "id: '$node'" "$PROVISION"
done
grep -Fq 'dependencies: [customUserPostHooksTask?.id ?? customPostHooksTask?.id ?? catalogPostValidationTask.id, ...caskLauncherTasks.map' "$PROVISION"
grep -Fq 'INSTALL_DOCTOR_ENGINE_OWNS_SOFTWARE_GROUPS' "$AFTER_10"
grep -Fq 'INSTALL_DOCTOR_ENGINE_OWNS_CATALOG_POST_HOOKS' "$AFTER_10"
grep -Fq 'INSTALL_DOCTOR_ENGINE_OWNS_CUSTOM_POST_HOOKS' "$AFTER_20"

mkdir -p "$TMP/bin" "$TMP/home/.local/bin/post-installx" "$TMP/data/chezmoi" "$TMP/state"
: > "$TMP/data/chezmoi/software.yml"
cat > "$TMP/bin/process-software-groups" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = --check ]; then
  printf 'groups-check\n' >> "$EFFECT_LEDGER"
  [ -f "$GROUP_STATE" ] && exit 0
  exit 10
fi
printf 'groups-apply\n' >> "$EFFECT_LEDGER"
[ "${FAIL_GROUPS:-0}" != 1 ] || exit 1
: > "$GROUP_STATE"
SH
cat > "$TMP/bin/process-software-post-scripts" <<'SH'
#!/usr/bin/env bash
printf 'catalog\n' >> "$EFFECT_LEDGER"
[ "${FAIL_CATALOG:-0}" != 1 ]
SH
cat > "$TMP/bin/yq" <<'SH'
#!/usr/bin/env bash
printf 'eager\n'
SH
cat > "$TMP/home/.local/bin/post-installx/post-eager.sh" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  --check|--verify) [ -f "$CUSTOM_STATE" ] && exit 0 || exit 10 ;;
  --apply) printf 'custom\n' >> "$EFFECT_LEDGER"; : > "$CUSTOM_STATE" ;;
  *) exit 2 ;;
esac
SH
chmod 0700 "$TMP/bin/"* "$TMP/home/.local/bin/post-installx/post-eager.sh"
if command -v sha256sum >/dev/null 2>&1; then
  CUSTOM_HOOK_SHA="$(sha256sum "$TMP/home/.local/bin/post-installx/post-eager.sh" | awk '{print $1}')"
else
  CUSTOM_HOOK_SHA="$(shasum -a 256 "$TMP/home/.local/bin/post-installx/post-eager.sh" | awk '{print $1}')"
fi
export INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST="eager=$CUSTOM_HOOK_SHA"
export INSTALL_DOCTOR_CUSTOM_HOOK_KEYS=eager
: > "$TMP/ledger"

export PATH="$TMP/bin:/usr/bin:/bin"
export HOME="$TMP/home"
export XDG_DATA_HOME="$TMP/data"
export EFFECT_LEDGER="$TMP/ledger"
export CUSTOM_STATE="$TMP/state/custom-ready"
export GROUP_STATE="$TMP/state/groups-current"
export INSTALL_DOCTOR_EFFECT_RECEIPT_DIR="$TMP/state/effects"
export INSTALL_DOCTOR_EFFECT_DIGEST="$(printf 'a%.0s' {1..64})"

# shellcheck source=/dev/null
source "$PROVISION"

run_effect() {
  local id="$1" check="$2" apply="$3" verify="$4" before after status
  export INSTALL_DOCTOR_EFFECT_ID="$id"
  before="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
  set +e
  idRunEngineOperation "$check"
  status=$?
  set -e
  [ "$status" -eq 10 ]
  idRunEngineOperation "$apply"
  idRunEngineOperation "$verify"
  idRunEngineOperation "$check"
  after="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
  [ "$after" -eq $((before + 1)) ]
}

groups_before="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
set +e
idRunEngineOperation software-groups-check
groups_initial_status=$?
set -e
[ "$groups_initial_status" -eq 10 ]
idRunEngineOperation software-groups-apply
idRunEngineOperation software-groups-verify
idRunEngineOperation software-groups-check
groups_after="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
[ "$groups_after" -eq $((groups_before + 4)) ]
[ "$(grep -c '^groups-apply$' "$EFFECT_LEDGER")" -eq 1 ]
[ ! -e "$INSTALL_DOCTOR_EFFECT_RECEIPT_DIR/software-groups.verified" ]
INSTALL_DOCTOR_EFFECT_ID=software-groups
set +e
idEffectReceiptPath >/dev/null
groups_receipt_status=$?
set -e
[ "$groups_receipt_status" -eq 2 ]
INSTALL_DOCTOR_EFFECT_DIGEST="$(printf 'b%.0s' {1..64})"
export INSTALL_DOCTOR_EFFECT_DIGEST
before_catalog="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
idRunEngineOperation catalog-post-validation-check
idRunEngineOperation catalog-post-validation-verify
after_catalog="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
[ "$after_catalog" -eq $((before_catalog + 2)) ]
[ ! -e "$INSTALL_DOCTOR_EFFECT_RECEIPT_DIR/catalog-post-hooks.verified" ]
INSTALL_DOCTOR_EFFECT_ID=catalog-post-hooks
set +e
idEffectReceiptPath >/dev/null
catalog_receipt_status=$?
FAIL_CATALOG=1 idRunEngineOperation catalog-post-validation-check
catalog_failure_status=$?
set -e
[ "$catalog_receipt_status" -eq 2 ]
[ "$catalog_failure_status" -ne 0 ]
INSTALL_DOCTOR_EFFECT_DIGEST="$(printf 'c%.0s' {1..64})"
export INSTALL_DOCTOR_EFFECT_DIGEST
INSTALL_DOCTOR_EFFECT_ID=custom-post-hooks
custom_before_first_apply="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
set +e
idRunEngineOperation custom-post-hooks-check
custom_initial_status=$?
set -e
[ "$custom_initial_status" -eq 10 ]
idRunEngineOperation custom-post-hooks-apply
idRunEngineOperation custom-post-hooks-verify
custom_after_first_apply="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
[ "$custom_after_first_apply" -eq $((custom_before_first_apply + 1)) ]

# Typed postconditions make a second unchanged reconciliation a no-op, while
# state drift is detected independently of historical execution evidence.
INSTALL_DOCTOR_EFFECT_ID=custom-post-hooks
idRunEngineOperation custom-post-hooks-check
custom_before_reapply="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
idRunEngineOperation custom-post-hooks-verify
custom_after_reapply="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
[ "$custom_after_reapply" -eq "$custom_before_reapply" ]
rm -f "$CUSTOM_STATE"
set +e
idRunEngineOperation custom-post-hooks-check
custom_drift_status=$?
set -e
[ "$custom_drift_status" -eq 10 ]
printf '\n# unauthorized mutation\n' >> "$TMP/home/.local/bin/post-installx/post-eager.sh"
set +e
idRunEngineOperation custom-post-hooks-check
custom_digest_status=$?
set -e
[ "$custom_digest_status" -eq 2 ]

# An empty approved hook closure is valid even when unrelated hooks exist on
# disk; filesystem presence must never expand immutable desired state.
INSTALL_DOCTOR_CUSTOM_HOOK_KEYS=''
INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST=''
export INSTALL_DOCTOR_CUSTOM_HOOK_KEYS INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST
custom_before_unselected="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
idRunEngineOperation custom-post-hooks-check
idRunEngineOperation custom-post-hooks-apply
idRunEngineOperation custom-post-hooks-verify
custom_after_unselected="$(wc -l < "$EFFECT_LEDGER" | tr -d ' ')"
[ "$custom_after_unselected" -eq "$custom_before_unselected" ]

INSTALL_DOCTOR_EFFECT_ID=software-groups
INSTALL_DOCTOR_EFFECT_DIGEST="$(printf 'd%.0s' {1..64})"
export INSTALL_DOCTOR_EFFECT_ID INSTALL_DOCTOR_EFFECT_DIGEST
set +e
rm -f "$GROUP_STATE"
FAIL_GROUPS=1 idRunEngineOperation software-groups-apply
failure_status=$?
set -e
[ "$failure_status" -ne 0 ]
set +e
idRunEngineOperation software-groups-check
check_status=$?
set -e
[ "$check_status" -eq 10 ]

printf 'typed-chezmoi-effects: 30 passed, 0 failed\n'
