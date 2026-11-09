#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
STATE="$TMP/sudo-active"

cat > "$TMP/sudo" <<'SCRIPT'
#!/usr/bin/env bash
set -eu
case "${1:-}" in
  -n) [ -f "$FAKE_SUDO_STATE" ] || compgen -G "$FAKE_SUDO_STATE.*" >/dev/null ;;
  -k) rm -f -- "$FAKE_SUDO_STATE" ;;
  -K) rm -f -- "$FAKE_SUDO_STATE" "$FAKE_SUDO_STATE".* ;;
  *) exit 64 ;;
esac
SCRIPT
chmod 0700 "$TMP/sudo"

run_operation() {
  PATH="$TMP:/usr/bin:/bin" FAKE_SUDO_STATE="$STATE" INSTALL_DOCTOR_SUDO_PREEXISTING="$1" \
    bash -c 'source "$1"; idRunEngineOperation "$2"' _ "$PROVISION" "$2"
}

if run_operation false stage-zero-sudo-check; then
  printf 'absent sudo authority verified\n' >&2; exit 1
else
  [ "$?" -eq 10 ]
fi
: > "$STATE"
run_operation false stage-zero-sudo-check

sudo_function="$(sed -n '/^removePasswordlessSudo() {/,/^}/p' "$PROVISION")"
! grep -qE 'dscl|sudoers\.d|rm -f /tmp/install-doctor-passwordless-sudo' <<< "$sudo_function"
! grep -q '/tmp/install-doctor-passwordless-sudo' "$PROVISION"
grep -q "id: 'system.sudo-credential-cleanup'" "$PROVISION"
grep -q "lifecycle: 'run-finalizer'" "$PROVISION"
grep -q "selectedTaskIds: \[...(nativeComposition ? \[nativeComposition.task.id\] : \[\]), ...caskLauncherTasks.map(task => task.id), ...flatpakLauncherTasks.map(task => task.id), ...artifactTasks.map(task => task.id), rebootAssessmentTask.id, sudoCleanupTask.id\]" "$PROVISION"
grep -q "sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting" "$PROVISION"
grep -q "kind: 'sudo-credential-cleanup'" "$PROVISION"
! grep -q 'sudo-cleanup-check)' "$PROVISION"

# A dead owner from a different release is reconciled before the next plan can
# classify its timestamp as preexisting. No credential value is persisted.
OWNERSHIP_ROOT="$TMP/state-home/install.doctor/sudo-ownership"
mkdir -p "$OWNERSHIP_ROOT"; chmod 0700 "$TMP/state-home" "$TMP/state-home/install.doctor" "$OWNERSHIP_ROOT"
cat > "$OWNERSHIP_ROOT/old-release.intent" <<EOF
schema=1
pid=999999
uid=$(id -u)
process_start=dead-owner
host=fixture
release=old-release
state=acquiring
EOF
chmod 0600 "$OWNERSHIP_ROOT/old-release.intent"
: > "$STATE.former-tty"
PATH="$TMP:/usr/bin:/bin" FAKE_SUDO_STATE="$STATE" XDG_STATE_HOME="$TMP/state-home" INSTALL_DOCTOR_RELEASE_ID=new-release \
  bash -c 'source "$1"; logg() { :; }; idReconcileStaleSudoOwnership' _ "$PROVISION"
[ ! -e "$STATE.former-tty" ] && [ ! -e "$OWNERSHIP_ROOT/old-release.intent" ]
! grep -qEi 'password|secret|token' "$OWNERSHIP_ROOT"/*.intent 2>/dev/null || { printf 'ownership evidence contains secret-like fields\n' >&2; exit 1; }

# A live foreign owner is fenced rather than revoked.
sleep 30 & LIVE_PID=$!
LIVE_START="$(ps -o lstart= -p "$LIVE_PID" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
cat > "$OWNERSHIP_ROOT/live.intent" <<EOF
schema=1
pid=$LIVE_PID
uid=$(id -u)
process_start=$LIVE_START
host=fixture
release=new-release
state=acquiring
EOF
chmod 0600 "$OWNERSHIP_ROOT/live.intent"; : > "$STATE"
if PATH="$TMP:/usr/bin:/bin" FAKE_SUDO_STATE="$STATE" XDG_STATE_HOME="$TMP/state-home" INSTALL_DOCTOR_RELEASE_ID=new-release \
  bash -c 'source "$1"; logg() { :; }; idReconcileStaleSudoOwnership' _ "$PROVISION"; then
  printf 'live sudo ownership was not fenced\n' >&2; kill "$LIVE_PID"; exit 1
fi
[ -e "$STATE" ] && [ -e "$OWNERSHIP_ROOT/live.intent" ]
kill "$LIVE_PID" 2>/dev/null || true; wait "$LIVE_PID" 2>/dev/null || true
rm -f "$OWNERSHIP_ROOT/live.intent"

# A reused live PID with the wrong immutable start identity is stale, not live.
sleep 30 & REUSED_PID=$!
cat > "$OWNERSHIP_ROOT/reused.intent" <<EOF
schema=1
pid=$REUSED_PID
uid=$(id -u)
process_start=not-the-live-process-start
host=fixture
release=old-release
state=acquired
EOF
chmod 0600 "$OWNERSHIP_ROOT/reused.intent"; : > "$STATE.former-tty"
PATH="$TMP:/usr/bin:/bin" FAKE_SUDO_STATE="$STATE" XDG_STATE_HOME="$TMP/state-home" INSTALL_DOCTOR_RELEASE_ID=new-release \
  bash -c 'source "$1"; logg() { :; }; idReconcileStaleSudoOwnership' _ "$PROVISION"
[ ! -e "$OWNERSHIP_ROOT/reused.intent" ] && [ ! -e "$STATE.former-tty" ]
kill "$REUSED_PID" 2>/dev/null || true; wait "$REUSED_PID" 2>/dev/null || true

# Ambient deletion targets are ignored; retirement derives and validates the
# exact current identity. Protected roots reject symlinks.
VICTIM="$TMP/must-survive"; : > "$VICTIM"
INSTALL_DOCTOR_SUDO_OWNERSHIP_INTENT="$VICTIM" XDG_STATE_HOME="$TMP/state-home" INSTALL_DOCTOR_RELEASE_ID=absent \
  bash -c 'source "$1"; idRetireSudoOwnership >/dev/null 2>&1 || true' _ "$PROVISION"
[ -e "$VICTIM" ]
mkdir "$TMP/real-state"; ln -s "$TMP/real-state" "$TMP/symlink-state"
if XDG_STATE_HOME="$TMP/symlink-state" INSTALL_DOCTOR_RELEASE_ID=new-release \
  bash -c 'source "$1"; idPrepareSudoOwnershipRoot' _ "$PROVISION" >/dev/null 2>&1; then
  printf 'symlinked sudo ownership root was accepted\n' >&2; exit 1
fi

# Exercise the real journal/CLI boundary with a fixed executable. The fixture
# records exact argv and the bounded environment visible to the executable.
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null
ENGINE="$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs"
node --test "$ROOT/packages/installer-engine/test/sudo-credential-cleanup.test.mjs"
# Runtime acceptance uses the actual pinned sudo identity only through the
# preexisting-authority branch; that branch must not spawn it. Exact lifecycle
# calls are covered by the injected runner above without weakening root-owned
# sudo invariants for a user-owned fixture.
printf 'provision-sudo-lifecycle: pass\n'
