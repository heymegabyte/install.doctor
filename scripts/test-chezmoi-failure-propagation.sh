#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AFTER_01="$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
AFTER_10="$ROOT/home/.chezmoiscripts/universal/run_after_10-install.sh.tmpl"
AFTER_20="$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"
AFTER_24="$ROOT/home/.chezmoiscripts/universal/run_after_24-cleanup.sh.tmpl"
BEFORE_04="$ROOT/home/.chezmoiscripts/universal/run_before_04-requirements.sh.tmpl"
BEFORE_05="$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
GROUP_PROCESSOR="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-groups"

assert_contains() {
  grep -Fq "$2" "$1" || { printf 'missing failure guard in %s: %s\n' "$1" "$2" >&2; exit 1; }
}

assert_contains "$AFTER_10" 'installSelectedPackages || exit 1'
if grep -Fq 'installx --all' "$AFTER_10"; then
  printf 'compatibility package path still broadens selection with installx --all\n' >&2
  exit 1
fi
assert_contains "$AFTER_10" "process-software-groups || exit 1"
assert_contains "$AFTER_20" 'wait "$PID" || POST_TASK_STATUS=1'
assert_contains "$AFTER_20" "runPostInstallxHooks || exit 1"
assert_contains "$AFTER_24" 'wait "$PID" || CLEANUP_STATUS=1'
assert_contains "$BEFORE_04" 'Package requirements are owned by the install.doctor desired-state plan'
if grep -Eq '(brew|apt-get|dnf|pacman|zypper|pkg|npm|go|rustup)[[:space:]]+(install|tap|upgrade|add)' "$BEFORE_04"; then
  echo 'requirements compatibility hook bypasses canonical failure authority' >&2
  exit 1
fi
assert_contains "$BEFORE_05" 'waitForPids $SYSTEM_TASK_PIDS ||'
assert_contains "$BEFORE_05" 'Docker is not selected; preliminary setup will leave it absent'
if sed -n '/^installDocker() {/,/^}/p' "$BEFORE_05" | grep -Eq 'apt(-get)? install|dnf install|pacman .*docker|systemctl (enable|start).*docker'; then
  echo 'installDocker bypasses desired state or mutates the Docker service' >&2
  exit 1
fi
assert_contains "$AFTER_01" 'waitForPids $POST_APPLY_PIDS ||'

# Execute the exact PID aggregation helper embedded in the template. A failure
# from an earlier child must remain visible even when the final child succeeds.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed -n '/^waitForPids() {/,/^}/p' "$AFTER_01" > "$TMP/wait-for-pids.sh"
# shellcheck source=/dev/null
source "$TMP/wait-for-pids.sh"
(exit 23) & FAILED_PID=$!
(exit 0) & SUCCESS_PID=$!
if waitForPids "$FAILED_PID" "$SUCCESS_PID"; then
  echo 'waitForPids hid an earlier child failure' >&2
  exit 1
fi

# Exercise the real group processor with hermetic command doubles. One failed
# privileged operation must make the complete processor fail.
mkdir -p "$TMP/bin" "$TMP/data/chezmoi"
: > "$TMP/data/chezmoi/software.yml"
cat > "$TMP/bin/gum" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TMP/bin/yq" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = -e ] && exit 0
case "$*" in
  *'_folders'*) echo /opt/fixture ;;
  *'_groups'*) echo fixture-group ;;
  *) exit 1 ;;
esac
EOF
cat > "$TMP/bin/id" <<'EOF'
#!/usr/bin/env bash
case "$1" in -u) echo 1000 ;; -Gn) echo fixture-group ;; *) exit 1 ;; esac
EOF
cat > "$TMP/bin/getent" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TMP/bin/dscl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TMP/bin/own-folder" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TMP/bin/sudo" <<'EOF'
#!/usr/bin/env bash
: > "${SUDO_CALLED:?}"
exit 42
EOF
chmod +x "$TMP/bin/"*
if PATH="$TMP/bin:$PATH" XDG_DATA_HOME="$TMP/data" INSTALL_DOCTOR_SELECTED_PACKAGES=broken SUDO_CALLED="$TMP/sudo-called" \
  bash "$GROUP_PROCESSOR"; then
  echo 'process-software-groups hid a privileged operation failure' >&2
  exit 1
fi
[ -f "$TMP/sudo-called" ] || { echo 'fixture did not reach the privileged operation' >&2; exit 1; }

echo 'Chezmoi failure propagation tests passed.'
