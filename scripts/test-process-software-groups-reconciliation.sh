#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-groups"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/software-groups.XXXXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/bin" "$TMP/data/chezmoi" "$TMP/state"
cat > "$TMP/data/chezmoi/software.yml" <<'YAML'
softwarePackages:
  alpha:
    _groups: [alpha-group]
  beta:
    _groups: [beta-group]
  unsafe:
    _groups: [safe-group]
    _folders: [/tmp/escape]
YAML
cat > "$TMP/bin/id" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  -u) exit 0 ;;
  -Gn) printf 'tester'; for group in "$GROUP_STATE"/*; do [ -e "$group" ] && printf ' %s' "${group##*/}"; done; printf '\n' ;;
  *) exit 64 ;;
esac
SH
cat > "$TMP/bin/getent" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = group ] && [ -f "$GROUP_STATE/${2:-}" ]
SH
cat > "$TMP/bin/dscl" <<'SH'
#!/usr/bin/env bash
case "${3:-}" in /Groups/*) [ -f "$GROUP_STATE/${3##*/}" ] ;; *) exit 1 ;; esac
SH
cat > "$TMP/bin/sudo" <<'SH'
#!/usr/bin/env bash
"$@"
SH
cat > "$TMP/bin/add-usergroup" <<'SH'
#!/usr/bin/env bash
[ "$1" = tester ] || exit 70
: > "$GROUP_STATE/$2"
printf '%s\n' "$2" >> "$GROUP_LEDGER"
SH
chmod 0700 "$TMP/bin/"*
: > "$TMP/ledger"

export PATH="$TMP/bin:/opt/homebrew/bin:/usr/bin:/bin"
export XDG_DATA_HOME="$TMP/data" GROUP_STATE="$TMP/state" GROUP_LEDGER="$TMP/ledger"
export INSTALL_DOCTOR_USER=tester INSTALL_DOCTOR_SELECTED_SERVICES=''

export INSTALL_DOCTOR_SELECTED_PACKAGES=alpha
set +e
bash "$PROCESSOR" --check
status=$?
set -e
[ "$status" -eq 10 ]
bash "$PROCESSOR"
bash "$PROCESSOR" --check
[ "$(cat "$TMP/ledger")" = alpha-group ]
[ ! -e "$TMP/state/beta-group" ]

export INSTALL_DOCTOR_SELECTED_PACKAGES=alpha,beta
set +e
bash "$PROCESSOR" --check
status=$?
set -e
[ "$status" -eq 10 ]
bash "$PROCESSOR"
[ "$(cat "$TMP/ledger")" = $'alpha-group\nbeta-group' ]
bash "$PROCESSOR" --check

export INSTALL_DOCTOR_SELECTED_PACKAGES=unsafe
set +e
bash "$PROCESSOR" --check
unsafe_status=$?
bash "$PROCESSOR"
unsafe_apply_status=$?
INSTALL_DOCTOR_SELECTED_PACKAGES=missing bash "$PROCESSOR" --check
unknown_status=$?
set -e
[ "$unsafe_status" -eq 20 ]
[ "$unsafe_apply_status" -eq 20 ]
[ "$unknown_status" -eq 20 ]
[ "$(wc -l < "$TMP/ledger" | tr -d ' ')" -eq 2 ]

INSTALL_DOCTOR_SELECTED_PACKAGES='' INSTALL_DOCTOR_SELECTED_SERVICES='' bash "$PROCESSOR" --check
printf 'process-software-groups-reconciliation: 12 passed, 0 failed\n'
