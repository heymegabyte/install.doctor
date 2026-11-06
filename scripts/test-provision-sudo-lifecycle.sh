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
if run_operation false sudo-cleanup-check; then
  printf 'installer-acquired credential did not require cleanup\n' >&2; exit 1
else
  [ "$?" -eq 10 ]
fi
run_operation false sudo-cleanup-apply
[ ! -e "$STATE" ]
run_operation false sudo-cleanup-verify

# Authority that existed before planning is not owned by this run. Cleanup is
# inapplicable and must not invalidate it.
: > "$STATE"
run_operation true sudo-cleanup-check
run_operation true sudo-cleanup-apply
run_operation true sudo-cleanup-verify
[ -e "$STATE" ]

sudo_function="$(sed -n '/^removePasswordlessSudo() {/,/^}/p' "$PROVISION")"
! grep -qE 'dscl|sudoers\.d|rm -f /tmp/install-doctor-passwordless-sudo' <<< "$sudo_function"
! grep -q '/tmp/install-doctor-passwordless-sudo' "$PROVISION"
grep -q "id: 'system.sudo-credential-cleanup'" "$PROVISION"
grep -q "lifecycle: 'run-finalizer'" "$PROVISION"
grep -q "selectedTaskIds: \[rebootAssessmentTask.id, sudoCleanupTask.id\]" "$PROVISION"
grep -q "sudoPreexisting: rawPlan.privilegeContext.sudoPreexisting" "$PROVISION"

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

# Exercise the real journal/CLI boundary: the credential is already active
# when the graph begins, the terminal cleanup node mutates it, verifies the
# postcondition, and commits both task outcomes.
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null
ENGINE="$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs"
INVOCATION="$TMP/invocation.json"; PLAN="$TMP/normalized-plan.json"
PROVISION_SHA="$(shasum -a 256 "$PROVISION" | awk '{print $1}')"
: > "$STATE"
node - "$INVOCATION" "$PROVISION" "$PROVISION_SHA" "$TMP" "$STATE" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [path, provisioner, sha256, temporary, sudoState] = process.argv.slice(2);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const task = (id, dependencies, operations) => ({ schemaVersion: 1, id, inputDigest: digest(id), dependencies,
  predicate: 'host-supported', requiredCapabilities: [], operations, timeoutMs: 5_000,
  retry: { class: 'never', maxAttempts: 1, backoffMs: 0 }, resources: { cpu: 1, memoryMiB: 32, network: false },
  privilege: 'user', network: 'none', consent: 'none', lockDomains: ['privilege'], cleanup: 'none',
  compensation: 'none', failurePolicy: 'abort-run' });
const credential = task('stage-zero.sudo-credential', [], { check: 'stage-zero-sudo-check', apply: 'stage-zero-sudo-apply', verify: 'stage-zero-sudo-verify' });
const cleanup = task('system.sudo-credential-cleanup', [credential.id], { check: 'sudo-cleanup-check', apply: 'sudo-cleanup-apply', verify: 'sudo-cleanup-verify' });
cleanup.dependencies = [];
cleanup.lifecycle = 'run-finalizer';
const environment = { PATH: `${temporary}:/usr/bin:/bin`, FAKE_SUDO_STATE: sudoState, INSTALL_DOCTOR_SUDO_PREEXISTING: 'false' };
const operation = name => ({ argv: ['/bin/bash', provisioner, '--engine-operation', name], env: environment,
  verifiedExecutable: { argvIndex: 1, sha256 } });
fs.writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, command: 'plan', runId: 'sudo-lifecycle-run', releaseId: 'sudo-lifecycle-release',
  facts: { schemaVersion: 1, hostId: 'sudo-fixture', collectedAt: '2026-11-06T00:00:00.000Z', os: process.platform === 'darwin' ? 'darwin' : 'linux',
    osVersion: 'fixture', arch: process.arch, environment: 'native', roles: ['fixture'], packageManagers: [], capabilities: [] },
  desiredState: { schemaVersion: 1, revision: 'sudo-lifecycle-v1', hostId: 'sudo-fixture', packages: [], services: [], consents: [], offline: true },
  plan: { tasks: [credential, cleanup], selectedTaskIds: [credential.id, cleanup.id] },
  operations: Object.fromEntries(['stage-zero-sudo-check','stage-zero-sudo-apply','stage-zero-sudo-verify','sudo-cleanup-check','sudo-cleanup-apply','sudo-cleanup-verify'].map(name => [name, operation(name)])) })}\n`, { mode: 0o600 });
NODE
node "$ENGINE" --input "$INVOCATION" > "$PLAN"
PLAN_DIGEST="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).digest)' "$PLAN")"
node - "$INVOCATION" "$PLAN_DIGEST" "$TMP/state" <<'NODE'
const fs = require('node:fs'); const [path, digest, stateRoot] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path)); value.command = 'run'; value.approvedPlanDigest = digest;
value.renderer = 'ndjson'; value.stateRoot = stateRoot; fs.writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
NODE
node "$ENGINE" --input "$INVOCATION" > "$TMP/events.ndjson"
[ ! -e "$STATE" ]
grep -q '"taskId":"system.sudo-credential-cleanup","status":"verified"' "$TMP/events.ndjson"
grep -q '"kind":"run-status","status":"success"' "$TMP/events.ndjson"

printf 'provision-sudo-lifecycle: pass\n'
