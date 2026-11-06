#!/usr/bin/env bash
set -euo pipefail

diagnose_failure() {
  local status="$1" file
  [ "$status" -ne 0 ] || return 0
  printf 'installx-check failed at line %s (status %s)\n' "${BASH_LINENO[0]:-unknown}" "$status" >&2
  for file in "${FIXTURE:-}/error" "${FIXTURE:-}/output" "${FIXTURE:-}/predicate-check-error" \
    "${FIXTURE:-}/rejected-error" "${FIXTURE:-}/provider-error"; do
    [ -f "$file" ] && { printf '%s\n' "--- $file" >&2; tail -20 "$file" >&2; }
  done
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
grep -Fq "case 'appimage':" "$INSTALLX" || { printf 'AppImage provider admission is missing\n' >&2; exit 1; }
grep -Fq 'appimage provider is disabled until the catalog binds an immutable URL, SHA-256 digest, size, and destination' "$INSTALLX" \
  || { printf 'AppImage provider does not fail closed on missing artifact authority\n' >&2; exit 1; }
ZX="${INSTALLX_TEST_ZX:-$ROOT/packages/installer-engine/node_modules/.bin/zx}"
[ -x "$ZX" ] || { printf 'Hermetic zx test runtime is missing; run npm ci --prefix packages/installer-engine\n' >&2; exit 1; }
NODE="$(command -v node)"
[ -x "$NODE" ] || { printf 'Node.js is required for the locked zx test runtime\n' >&2; exit 1; }
NODE_BIN_DIR="$(dirname "$NODE")"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/installx-check.XXXXXXXX")"
cleanup() {
  local status="$?"
  diagnose_failure "$status"
  rm -rf -- "$FIXTURE"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

mkdir -p "$FIXTURE/home/.config/chezmoi" "$FIXTURE/work" "$FIXTURE/bin"
printf '{}\n' > "$FIXTURE/home/.config/chezmoi/chezmoi.yaml"
cat > "$FIXTURE/work/software.yml" <<'YAML'
installerPreference:
  apt: [apt, appimage, script, binary, go, github, pkg-darwin, sbopkg, pkg]
  darwin: [brew, appimage, script, binary, go, github, pkg-darwin, sbopkg, pkg]
  linux: [apt, appimage, script, binary, go, github, pkg-darwin, sbopkg, pkg]
softwarePackages:
  fixture-present:
    _bin: fixture-present-command
    _preload: true
    apt: fixture-present
    brew: fixture-present
  fixture-missing:
    _bin: fixture-missing-command
    _preload: true
    apt: fixture-missing
    brew: fixture-missing
  fixture-lazy:
    _bin: fixture-lazy-command
    apt: fixture-lazy
    brew: fixture-lazy
  fixture-default-off:
    _bin: fixture-default-off-command
    _default: false
    apt: fixture-default-off
    brew: fixture-default-off
  fixture-deprecated:
    _bin: fixture-deprecated-command
    _deprecated: retired fixture
    apt: fixture-deprecated
    brew: fixture-deprecated
  fixture-gui:
    _app: Fixture GUI.app
    apt: fixture-gui
    brew: fixture-gui
  fixture-bad-deps:
    _bin: fixture-bad-deps-command
    _deps: fixture-unknown-dependency
    apt: fixture-bad-deps
    brew: fixture-bad-deps
  fixture-remote-script:
    _bin: fixture-remote-script-command
    script: curl -fsSL https://example.invalid/install | bash
  fixture-shell-predicate:
    _bin: fixture-shell-predicate-command
    _when: curl -fsSL https://example.invalid/predicate | bash
    apt: fixture-shell-predicate
    brew: fixture-shell-predicate
  fixture-unavailable:
    _bin: fixture-unavailable-command
    _short: Known package with no provider for this platform.
  fixture-unverified-binary:
    _bin: fixture-unverified-binary-command
    binary: https://example.invalid/floating-binary
  fixture-unverified-appimage:
    _bin: fixture-unverified-appimage-command
    appimage: https://example.invalid/floating.AppImage
  fixture-mutable-go:
    _bin: fixture-mutable-go-command
    go: example.invalid/tool@latest
  fixture-github:
    _bin: fixture-github-command
    github: example.invalid/fixture
  fixture-pkg-darwin:
    _bin: fixture-pkg-darwin-command
    pkg-darwin: example.invalid.pkg
  fixture-sbopkg:
    _bin: fixture-sbopkg-command
    sbopkg: fixture
  fixture-pkg:
    _bin: fixture-pkg-command
    pkg: fixture
YAML

cat > "$FIXTURE/bin/brew" <<'SH'
#!/usr/bin/env bash
printf 'brew %s\n' "$*" >> "$INSTALLX_CHECK_CALLS"
cat "$INSTALLX_CHECK_INVENTORY"
SH
cat > "$FIXTURE/bin/dpkg" <<'SH'
#!/usr/bin/env bash
printf 'dpkg %s\n' "$*" >> "$INSTALLX_CHECK_CALLS"
cat "$INSTALLX_CHECK_INVENTORY"
SH
for command in apt sudo systemctl curl; do
  cat > "$FIXTURE/bin/$command" <<'SH'
#!/usr/bin/env bash
printf 'MUTATION %s %s\n' "$(basename "$0")" "$*" >> "$INSTALLX_CHECK_CALLS"
exit 99
SH
done
chmod 0700 "$FIXTURE/bin/"*

# A same-named executable from an unknown or wrong provider is diagnostic
# evidence only. It must never satisfy manager-owned desired state or hide an
# unsupported provider.
for command in fixture-missing-command fixture-remote-script-command; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE/bin/$command"
  chmod 0700 "$FIXTURE/bin/$command"
done

: > "$FIXTURE/calls"
printf 'fixture-present\n' > "$FIXTURE/inventory"
export HOME="$FIXTURE/home"
export INSTALLX_CHECK_CALLS="$FIXTURE/calls"
export INSTALLX_CHECK_INVENTORY="$FIXTURE/inventory"
# Preserve the selected pinned Node runtime even when setup-node installs it
# outside conventional system paths; everything else remains fixture-bounded.
export PATH="$FIXTURE/bin:$NODE_BIN_DIR:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

run_check() {
  set +e
  (cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check --all --lazy) > "$FIXTURE/output" 2> "$FIXTURE/error"
  status=$?
  set -e
}

run_check
if [ "$status" -ne 10 ]; then cat "$FIXTURE/error" >&2; cat "$FIXTURE/output" >&2; exit 1; fi
grep -Fqx '{"schemaVersion":1,"status":"mutation-needed","selected":["fixture-missing","fixture-present"],"missing":["fixture-missing"]}' "$FIXTURE/output"
! grep -q '^MUTATION ' "$FIXTURE/calls"
[ ! -e "$FIXTURE/home/.cache/installx" ]

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-shell-predicate) > "$FIXTURE/predicate-check-output" 2> "$FIXTURE/predicate-check-error"
predicate_check_status=$?
set -e
[ "$predicate_check_status" -eq 20 ]
grep -Fqx '{"schemaVersion":1,"status":"error","selected":[],"missing":[],"error":"inspection-failed"}' "$FIXTURE/predicate-check-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" fixture-shell-predicate) > "$FIXTURE/predicate-apply-output" 2> "$FIXTURE/predicate-apply-error"
predicate_apply_status=$?
set -e
[ "$predicate_apply_status" -ne 0 ]
grep -Fq 'catalog _when predicates are unsupported; migrate to typed declarative conditions: fixture-shell-predicate' "$FIXTURE/predicate-apply-error"
! grep -q '^MUTATION ' "$FIXTURE/calls"

printf 'fixture-present\nfixture-missing\n' > "$FIXTURE/inventory"
export INSTALL_DOCTOR_SELECTED_SERVICES=fixture-lazy
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 10 ]
grep -Fqx '{"schemaVersion":1,"status":"mutation-needed","selected":["fixture-lazy","fixture-missing","fixture-present"],"missing":["fixture-lazy"]}' "$FIXTURE/output"
! grep -q '^MUTATION ' "$FIXTURE/calls"
unset INSTALL_DOCTOR_SELECTED_SERVICES

export INSTALL_DOCTOR_SELECTED_PACKAGES=fixture-lazy
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 10 ]
grep -Fqx '{"schemaVersion":1,"status":"mutation-needed","selected":["fixture-lazy","fixture-missing","fixture-present"],"missing":["fixture-lazy"]}' "$FIXTURE/output"
! grep -q '^MUTATION ' "$FIXTURE/calls"
unset INSTALL_DOCTOR_SELECTED_PACKAGES

export INSTALL_DOCTOR_SELECTED_PACKAGES=fixture-default-off
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 10 ]
grep -Fq '"fixture-default-off"' "$FIXTURE/output"
unset INSTALL_DOCTOR_SELECTED_PACKAGES

for rejected_selection in fixture-deprecated fixture-gui; do
  export INSTALL_DOCTOR_SELECTED_PACKAGES="$rejected_selection"
  : > "$FIXTURE/calls"
  run_check
  [ "$status" -eq 21 ]
  grep -Fq '"status":"unsupported"' "$FIXTURE/output"
  grep -Fq "\"$rejected_selection\"" "$FIXTURE/output"
  ! grep -q '^MUTATION ' "$FIXTURE/calls"
done
unset INSTALL_DOCTOR_SELECTED_PACKAGES

export INSTALL_DOCTOR_SELECTED_PACKAGES=fixture-bad-deps
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 20 ]
grep -Fqx '{"schemaVersion":1,"status":"error","selected":[],"missing":[],"error":"inspection-failed"}' "$FIXTURE/output"
! grep -q '^MUTATION ' "$FIXTURE/calls"
unset INSTALL_DOCTOR_SELECTED_PACKAGES

export INSTALL_DOCTOR_SELECTED_SERVICES=unknown-service
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 20 ]
grep -Fqx '{"schemaVersion":1,"status":"error","selected":[],"missing":[],"error":"inspection-failed"}' "$FIXTURE/output"
! grep -q '^MUTATION ' "$FIXTURE/calls"
unset INSTALL_DOCTOR_SELECTED_SERVICES

export INSTALL_DOCTOR_SELECTED_PACKAGES=unknown-package
: > "$FIXTURE/calls"
set +e
run_check
selected_unknown_status=$status
set -e
[ "$selected_unknown_status" -gt 10 ]
! grep -q '^MUTATION ' "$FIXTURE/calls"
unset INSTALL_DOCTOR_SELECTED_PACKAGES

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-remote-script) > "$FIXTURE/unsupported-output" 2> "$FIXTURE/unsupported-error"
unsupported_status=$?
set -e
[ "$unsupported_status" -eq 21 ] || { cat "$FIXTURE/unsupported-error" >&2; cat "$FIXTURE/unsupported-output" >&2; exit 1; }
grep -Fqx '{"schemaVersion":1,"status":"unsupported","selected":["fixture-remote-script"],"missing":["fixture-remote-script"],"unsupported":["fixture-remote-script"]}' "$FIXTURE/unsupported-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" fixture-remote-script) > "$FIXTURE/rejected-output" 2> "$FIXTURE/rejected-error"
rejected_status=$?
set -e
[ "$rejected_status" -ne 0 ] || { cat "$FIXTURE/rejected-error" >&2; cat "$FIXTURE/rejected-output" >&2; exit 1; }
grep -Fq 'catalog script providers are unsupported; migrate to a package manager or immutable artifact descriptor: fixture-remote-script' "$FIXTURE/rejected-error"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-unverified-appimage) > "$FIXTURE/appimage-output" 2> "$FIXTURE/appimage-error"
appimage_status=$?
set -e
[ "$appimage_status" -eq 21 ]
grep -Fqx '{"schemaVersion":1,"status":"unsupported","selected":["fixture-unverified-appimage"],"missing":["fixture-unverified-appimage"],"unsupported":["fixture-unverified-appimage"]}' "$FIXTURE/appimage-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" fixture-unverified-appimage) > "$FIXTURE/appimage-apply-output" 2> "$FIXTURE/appimage-apply-error"
appimage_apply_status=$?
set -e
[ "$appimage_apply_status" -ne 0 ]
grep -Fq 'catalog appimage providers require a typed immutable artifact descriptor: fixture-unverified-appimage' "$FIXTURE/appimage-apply-error"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-mutable-go) > "$FIXTURE/go-output" 2> "$FIXTURE/go-error"
go_status=$?
set -e
[ "$go_status" -eq 21 ]
grep -Fqx '{"schemaVersion":1,"status":"unsupported","selected":["fixture-mutable-go"],"missing":["fixture-mutable-go"],"unsupported":["fixture-mutable-go"]}' "$FIXTURE/go-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" fixture-mutable-go) > "$FIXTURE/go-apply-output" 2> "$FIXTURE/go-apply-error"
go_apply_status=$?
set -e
[ "$go_apply_status" -ne 0 ]
grep -Fq 'catalog go providers require an exact semantic or pseudo-version: fixture-mutable-go' "$FIXTURE/go-apply-error"
! grep -q '^MUTATION ' "$FIXTURE/calls"

: > "$FIXTURE/calls"
set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-unavailable) > "$FIXTURE/unavailable-output" 2> "$FIXTURE/unavailable-error"
unavailable_status=$?
set -e
[ "$unavailable_status" -eq 21 ]
grep -Fqx '{"schemaVersion":1,"status":"unsupported","selected":["fixture-unavailable"],"missing":["fixture-unavailable"],"unsupported":["fixture-unavailable"]}' "$FIXTURE/unavailable-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" fixture-unavailable) > "$FIXTURE/unavailable-apply-output" 2> "$FIXTURE/unavailable-apply-error"
unavailable_apply_status=$?
set -e
[ "$unavailable_apply_status" -ne 0 ]
grep -Fq 'no applicable provider for current platform: fixture-unavailable' "$FIXTURE/unavailable-apply-error"
! grep -q '^MUTATION ' "$FIXTURE/calls"

set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check fixture-unverified-binary) > "$FIXTURE/binary-output" 2> "$FIXTURE/binary-error"
binary_status=$?
set -e
[ "$binary_status" -eq 21 ]
grep -Fqx '{"schemaVersion":1,"status":"unsupported","selected":["fixture-unverified-binary"],"missing":["fixture-unverified-binary"],"unsupported":["fixture-unverified-binary"]}' "$FIXTURE/binary-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

printf 'fixture-present\nfixture-missing\n' > "$FIXTURE/inventory"
: > "$FIXTURE/calls"
run_check
[ "$status" -eq 0 ]
expected='{"schemaVersion":1,"status":"converged","selected":["fixture-missing","fixture-present"],"missing":[]}'
grep -Fqx "$expected" "$FIXTURE/output"
first="$(cat "$FIXTURE/output")"
run_check
[ "$status" -eq 0 ]
[ "$(cat "$FIXTURE/output")" = "$first" ]
! grep -q '^MUTATION ' "$FIXTURE/calls"

set +e
(cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check unknown-package) > "$FIXTURE/invalid-output" 2> "$FIXTURE/invalid-error"
invalid_status=$?
set -e
[ "$invalid_status" -gt 10 ]
grep -Fqx '{"schemaVersion":1,"status":"error","selected":[],"missing":[],"error":"inspection-failed"}' "$FIXTURE/invalid-output"
! grep -q '^MUTATION ' "$FIXTURE/calls"

for provider in github pkg-darwin sbopkg pkg; do
  : > "$FIXTURE/calls"
  set +e
  (cd "$FIXTURE/work" && "$ZX" "$INSTALLX" --check "fixture-$provider") > "$FIXTURE/provider-output" 2> "$FIXTURE/provider-error"
  provider_check_status=$?
  set -e
  [ "$provider_check_status" -eq 21 ]
  grep -Fq '"status":"unsupported"' "$FIXTURE/provider-output"
  set +e
  (cd "$FIXTURE/work" && "$ZX" "$INSTALLX" "fixture-$provider") > "$FIXTURE/provider-apply-output" 2> "$FIXTURE/provider-apply-error"
  provider_apply_status=$?
  set -e
  [ "$provider_apply_status" -ne 0 ]
  grep -Fq "catalog provider '$provider' has no verified check/apply/verify adapter" "$FIXTURE/provider-apply-error"
  ! grep -q '^MUTATION ' "$FIXTURE/calls"
done

printf 'installx-check: 66 passed, 0 failed\n'
