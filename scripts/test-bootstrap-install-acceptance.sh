#!/usr/bin/env bash
# Hermetic acceptance of the complete signed /start -> provisioner -> engine
# path. All mutations occur inside a disposable, network-disabled container.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${INSTALL_DOCTOR_CANARY_IMAGE:-node@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40}"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-bootstrap-acceptance.XXXXXXXX")"
cleanup() {
  if [ "${INSTALL_DOCTOR_KEEP_CANARY_FIXTURE:-0}" = 1 ]; then
    printf 'bootstrap-install-acceptance: retained fixture %s\n' "$FIXTURE" >&2
  else
    rm -rf -- "$FIXTURE"
  fi
}
trap cleanup EXIT HUP INT TERM

command -v docker >/dev/null 2>&1 || {
  printf 'SKIP bootstrap-install-acceptance: docker is unavailable\n'
  exit 0
}
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  printf 'SKIP bootstrap-install-acceptance: pinned image is unavailable locally: %s\n' "$IMAGE"
  exit 0
}
command -v ssh-keygen >/dev/null 2>&1 || { printf 'ssh-keygen is required\n' >&2; exit 1; }

printf 'bootstrap-install-acceptance: bundling canonical engine\n'
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null

REPOSITORY="$FIXTURE/repository"
RELEASE_PARENT="$FIXTURE/releases"
RELEASE_ID='acceptance'
RELEASE="$RELEASE_PARENT/$RELEASE_ID"
RUNTIME_DIR="$FIXTURE/runtimes"
TOOLS="$FIXTURE/tools"
mkdir -m 0700 "$REPOSITORY" "$RELEASE_PARENT" "$RUNTIME_DIR" "$TOOLS"
mkdir -p "$REPOSITORY/home"
mkdir -p "$REPOSITORY/packages/control-plane/src"
cp "$ROOT/scripts/provision.sh" "$REPOSITORY/provision.sh"
cp "$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs" "$REPOSITORY/install-doctor-engine.mjs"
cp "$ROOT/packages/control-plane/src/catalog.json" "$REPOSITORY/packages/control-plane/src/catalog.json"
(cd "$ROOT" && tar --exclude='node_modules' --exclude='dist' -cf - packages/aid-core packages/installer-engine) \
  | (cd "$REPOSITORY" && tar -xf -)
chmod 0700 "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs"
printf '.\n' > "$REPOSITORY/.chezmoiroot"
printf 'fixture desired state\n' > "$REPOSITORY/home/README.fixture"
git -C "$REPOSITORY" init --quiet
git -C "$REPOSITORY" config user.name 'Install Doctor Acceptance'
git -C "$REPOSITORY" config user.email 'acceptance@install.doctor.invalid'
git -C "$REPOSITORY" add .
git -C "$REPOSITORY" commit --quiet -m 'immutable acceptance release'
SOURCE_COMMIT="$(git -C "$REPOSITORY" rev-parse HEAD)"
git -C "$REPOSITORY" remote add origin 'https://github.com/heymegabyte/install.doctor.git'

SIGNING_KEY="$FIXTURE/release-key"
ssh-keygen -q -t ed25519 -N '' -C install-doctor-acceptance -f "$SIGNING_KEY"
RUNTIME_VERSION='24.22.2'
SHASUMS="$FIXTURE/SHASUMS256.txt"
for PLATFORM in darwin-x64 darwin-arm64 linux-x64 linux-arm64; do
  ARCHIVE="$RUNTIME_DIR/node-v$RUNTIME_VERSION-$PLATFORM.tar.gz"
  printf 'unused system-runtime acceptance fixture: %s\n' "$PLATFORM" > "$ARCHIVE"
  shasum -a 256 "$ARCHIVE" | awk -v name="node-v$RUNTIME_VERSION-$PLATFORM.tar.gz" '{print $1 "  " name}' >> "$SHASUMS"
done
printf 'acceptance-only detached provenance fixture\n' > "$FIXTURE/SHASUMS256.txt.sig"
printf 'acceptance-only keyring fixture\n' > "$FIXTURE/node-release-keyring.gpg"
cat > "$TOOLS/gpgv" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0700 "$TOOLS/gpgv"

CREATED="$(date -u +%s)"
EXPIRES="$((CREATED + 3600))"
UNSIGNED_RELEASE="$RELEASE.unsigned"
PATH="$TOOLS:$PATH" \
INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$RUNTIME_VERSION" \
INSTALL_DOCTOR_RUNTIME_DIR="$RUNTIME_DIR" \
INSTALL_DOCTOR_NODE_SHASUMS="$SHASUMS" \
INSTALL_DOCTOR_NODE_SHASUMS_SIGNATURE="$FIXTURE/SHASUMS256.txt.sig" \
INSTALL_DOCTOR_NODE_RELEASE_KEYRING="$FIXTURE/node-release-keyring.gpg" \
  bash "$ROOT/scripts/publish-bootstrap-release.sh" \
    "$RELEASE_ID" "$SOURCE_COMMIT" "$CREATED" "$EXPIRES" install-doctor-acceptance \
    - "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs" "$UNSIGNED_RELEASE"
bash "$ROOT/scripts/sign-bootstrap-release.sh" install-doctor-acceptance "$SIGNING_KEY" "$UNSIGNED_RELEASE" "$RELEASE"

PUBLIC_KEY="$(cat "$SIGNING_KEY.pub")"
node - "$FIXTURE/bootstrap-config.json" "$PUBLIC_KEY" <<'NODE'
const fs = require('node:fs');
const [destination, signerPublicKey] = process.argv.slice(2);
fs.writeFileSync(destination, `${JSON.stringify({
  manifestUrl: 'https://app.install.doctor/releases/acceptance/manifest',
  signatureUrl: 'https://app.install.doctor/releases/acceptance/manifest.sig',
  signerIdentity: 'install-doctor-acceptance', signerPublicKey,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
node "$ROOT/scripts/helpers/render-bootstrap.mjs" "$FIXTURE/bootstrap-config.json" > "$FIXTURE/start.sh"
# The launcher contains only public trust material. A Linux bind mount preserves
# the host UID, which need not match the pinned image UID, so grant read/execute
# without granting mutation to the canary process.
chmod 0555 "$FIXTURE/start.sh"

cat > "$FIXTURE/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output' ]; then destination="$argument"; fi
  previous="$argument"
done
[ -n "$destination" ] || exit 64
url="${!#}"
case "$url" in
  https://app.install.doctor/releases/acceptance/manifest) source=/fixture/release/manifest ;;
  https://app.install.doctor/releases/acceptance/manifest.sig) source=/fixture/release/manifest.sig ;;
  https://app.install.doctor/releases/acceptance/provision.sh) source=/fixture/release/provision.sh ;;
  https://app.install.doctor/releases/acceptance/install-doctor-engine.mjs) source=/fixture/release/install-doctor-engine.mjs ;;
  https://app.install.doctor/releases/acceptance/catalog.json) source=/fixture/release/catalog.json ;;
  https://app.install.doctor/releases/acceptance/node-*.tar.gz) source="/fixture/release/${url##*/}" ;;
  *) printf 'unexpected network request: %s\n' "$url" >&2; exit 65 ;;
esac
printf '%s\n' "$url" >> "$HOME/release-requests.log"
/bin/cp "$source" "$destination"
SH

cat > "$FIXTURE/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' true '*|*' -k '*) exit 0 ;;
esac
printf 'unexpected sudo invocation: %s\n' "$*" >&2
exit 64
SH

cat > "$FIXTURE/rsync" <<'SH'
#!/usr/bin/env bash
printf 'unexpected rsync invocation\n' >&2
exit 64
SH

cat > "$FIXTURE/brew" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --prefix) printf '%s\n' "$HOME/.fixture-brew" ;;
  *) exit 0 ;;
esac
SH

cat > "$FIXTURE/gum" <<'SH'
#!/usr/bin/env bash
# Styling is presentation-only in this headless canary.
printf '%s\n' "${*: -1}"
exit 0
SH
cat > "$FIXTURE/zx" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$FIXTURE/chezmoi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = '--source' ]; then shift 2; fi
command="${1:-}"; shift || true
mkdir -p "$HOME/.fixture" "$HOME/.config/chezmoi"
case "$command" in
  data) exit 0 ;;
  init)
    if [ ! -e "$HOME/.fixture/interruption-triggered" ]; then
      : > "$HOME/.fixture/interruption-triggered"
      operation_pid="$PPID"
      engine_pid="$(awk '{print $4}' "/proc/$operation_pid/stat")"
      kill -INT "$engine_pid"
      sleep 30
      exit 130
    fi
    [ ! -e "$HOME/.fixture/chezmoi-init" ] || exit 97
    : > "$HOME/.fixture/chezmoi-init"
    printf 'sourceDir: fixture\n' > "$HOME/.config/chezmoi/chezmoi.yaml"
    printf 'apply:chezmoi-init\n' >> "$HOME/mutation-ledger"
    ;;
  verify)
    last_argument="${!#}"
    if [ "$last_argument" = "$HOME/.local/bin/installx" ]; then
      [ -x "$HOME/.local/bin/installx" ]
    else
      [ -e "$HOME/.fixture/chezmoi-applied" ]
    fi
    ;;
  apply)
    last_argument="${!#}"
    if [ "$last_argument" = "$HOME/.local/bin/installx" ]; then
        [ ! -e "$HOME/.local/bin/installx" ] || exit 97
        mkdir -p "$HOME/.local/bin"
        cat > "$HOME/.local/bin/installx" <<'INSTALLX'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.fixture"
case " $* " in
  *' --check '*) [ -e "$HOME/.fixture/packages-applied" ] && exit 0 || exit 10 ;;
esac
[ ! -e "$HOME/.fixture/packages-applied" ] || exit 97
: > "$HOME/.fixture/packages-applied"
printf 'apply:desired-packages\n' >> "$HOME/mutation-ledger"
INSTALLX
        chmod 0700 "$HOME/.local/bin/installx"
        printf 'apply:installx-tool\n' >> "$HOME/mutation-ledger"
    else
        [ ! -e "$HOME/.fixture/chezmoi-applied" ] || exit 97
        : > "$HOME/.fixture/chezmoi-applied"
        printf 'apply:chezmoi\n' >> "$HOME/mutation-ledger"
    fi
    ;;
  *) printf 'unexpected chezmoi command: %s\n' "$command" >&2; exit 64 ;;
esac
SH

cat > "$FIXTURE/process-software-groups" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = --check ]; then [ -f "$HOME/.fixture/software-groups-current" ] && exit 0 || exit 10; fi
: > "$HOME/.fixture/software-groups-current"
printf 'apply:software-groups\n' >> "$HOME/mutation-ledger"
SH
cat > "$FIXTURE/process-software-post-scripts" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
# Catalog post metadata validation is intentionally read-only and may be
# repeated on every reconciliation without becoming an external mutation.
exit 0
SH

cat > "$FIXTURE/container-run.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
chmod 0700 /canary-home
cp -a /fixture/repository /canary-home/source
mkdir -p /canary-home/.local/share/install.doctor/releases/acceptance
mv /canary-home/source /canary-home/.local/share/install.doctor/releases/acceptance/source
chown -R node:node /canary-home

cat > /canary-home/run-as-node.sh <<'NODE_RUN'
#!/usr/bin/env bash
set -euo pipefail
export HOME=/canary-home USER=node LOGNAME=node
export HEADLESS_INSTALL=1 SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal
export INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES=''
export INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false
run_start() { bash /fixture/start.sh >"$1" 2>"$2"; }
run_start_approved() { env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$3" bash /fixture/start.sh >"$1" 2>"$2"; }

set +e
run_start "$HOME/plan.stdout" "$HOME/plan.stderr"
plan_status=$?
set -e
[ "$plan_status" -eq 3 ] || { printf 'planning status=%s\n' "$plan_status" >&2; cat "$HOME/plan.stdout" "$HOME/plan.stderr" >&2; exit 80; }
[ ! -e "$HOME/mutation-ledger" ] || { printf 'mutation occurred before approval\n' >&2; exit 81; }
set -- "$HOME/.local/state/install.doctor/engine/approvals/"*.json
[ "$#" -eq 1 ] && [ -f "$1" ] || { printf 'approval plan is missing or ambiguous\n' >&2; exit 82; }
digest="${1##*/}"; digest="${digest%.json}"
case "$digest" in ''|*[!a-f0-9]*) exit 83 ;; esac
[ "${#digest}" -eq 64 ] || exit 83
export INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$digest"
printf 'first_approved_plan=%s\n' "$digest" >&2

set +e
run_start_approved "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" "$digest"
interrupted_status=$?
set -e
[ "$interrupted_status" -eq 130 ] || {
  printf 'interrupted run status=%s first_approved_plan=%s\n' "$interrupted_status" "$digest" >&2
  cat "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" >&2
  exit 84
}
[ ! -e "$HOME/mutation-ledger" ] || { printf 'cancelled operation recorded a completed mutation\n' >&2; exit 85; }

cat > "$HOME/runs-list.json" <<RUNS
{"schemaVersion":1,"command":"runs-list","stateRoot":"$HOME/.local/state/install.doctor/engine"}
RUNS
chmod 0600 "$HOME/runs-list.json"
node /fixture/release/install-doctor-engine.mjs --input "$HOME/runs-list.json" > "$HOME/interrupted-runs.json"
interrupted_run_id="$(node - "$HOME/interrupted-runs.json" "$digest" <<'INSPECT_INTERRUPTED'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, expectedDigest] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const matches = report.runs.filter(run => run.planDigest === expectedDigest);
if (matches.length !== 1) throw new Error(`expected one interrupted run, found ${matches.length}`);
const [run] = matches;
if (run.authority !== 'uncommitted' || run.resumeCandidate !== true) {
  throw new Error(`interrupted run is not resumable: ${JSON.stringify(run)}`);
}
const directory = path.join('/canary-home/.local/state/install.doctor/engine/runs', expectedDigest, run.runId);
if (fs.existsSync(path.join(directory, 'owner.json'))) throw new Error('interrupted run retained a live owner');
const commits = fs.existsSync(path.join(directory, 'commits'))
  ? fs.readdirSync(path.join(directory, 'commits')).filter(name => name.endsWith('.commit.json')) : [];
const receipts = fs.existsSync(path.join(directory, 'receipts'))
  ? fs.readdirSync(path.join(directory, 'receipts')).filter(name => name.endsWith('.receipt.json')) : [];
if (commits.length !== 0 || receipts.length !== 0) throw new Error('interrupted run published terminal evidence');
process.stdout.write(run.runId);
INSPECT_INTERRUPTED
)"
[ -n "$interrupted_run_id" ] || { printf 'interrupted run identity is missing\n' >&2; exit 86; }

run_start_approved "$HOME/clean.stdout" "$HOME/clean.stderr" "$digest" || {
  printf 'resume rejected interrupted_run=%s first_approved_plan=%s\n' "$interrupted_run_id" "$digest" >&2
  cat "$HOME/clean.stdout" "$HOME/clean.stderr" >&2
  exit 87
}
[ -s "$HOME/mutation-ledger" ] || { printf 'clean install made no fixture mutations\n' >&2; exit 85; }
[ "$(grep -c '^apply:chezmoi-init$' "$HOME/mutation-ledger")" -eq 1 ] \
  || { printf 'resumed operation did not mutate exactly once\n' >&2; cat "$HOME/mutation-ledger" >&2; exit 87; }
cp "$HOME/mutation-ledger" "$HOME/clean-ledger"
clean_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'managed bootstrap policy is missing after install\n' >&2; exit 88; }

cat > "$HOME/rollback-plan.json" <<ROLLBACK_PLAN
{"schemaVersion":1,"command":"rollback-config-plan","stateRoot":"$HOME/.local/state/install.doctor/engine","sourceRunId":"$interrupted_run_id","sourcePlanDigest":"$digest"}
ROLLBACK_PLAN
chmod 0600 "$HOME/rollback-plan.json"
node /fixture/release/install-doctor-engine.mjs --input "$HOME/rollback-plan.json" > "$HOME/rollback-plan-output.json"
rollback_digest="$(node - "$HOME/rollback-plan-output.json" <<'READ_ROLLBACK_PLAN'
const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!/^[a-f0-9]{64}$/.test(plan.digest)) throw new Error('rollback plan digest is invalid');
if (JSON.stringify(plan.taskOrder) !== JSON.stringify(['installer.bootstrap-policy'])) {
  throw new Error(`unexpected rollback task order: ${JSON.stringify(plan.taskOrder)}`);
}
process.stdout.write(plan.digest);
READ_ROLLBACK_PLAN
)"
cat > "$HOME/rollback-execute.json" <<ROLLBACK_EXECUTE
{"schemaVersion":1,"command":"rollback-config-execute","stateRoot":"$HOME/.local/state/install.doctor/engine","sourceRunId":"$interrupted_run_id","sourcePlanDigest":"$digest","rollbackRunId":"bootstrap-policy-rollback","approvedPlanDigest":"$rollback_digest"}
ROLLBACK_EXECUTE
chmod 0600 "$HOME/rollback-execute.json"
node /fixture/release/install-doctor-engine.mjs --input "$HOME/rollback-execute.json" > "$HOME/rollback-execute-output.json"
[ ! -e "$HOME/.config/install.doctor-policy.json" ] || { printf 'rollback did not restore the absent policy state\n' >&2; exit 88; }
cat > "$HOME/rollback-status.json" <<ROLLBACK_STATUS
{"schemaVersion":1,"command":"rollback-config-status","stateRoot":"$HOME/.local/state/install.doctor/engine","rollbackRunId":"bootstrap-policy-rollback","planDigest":"$rollback_digest"}
ROLLBACK_STATUS
chmod 0600 "$HOME/rollback-status.json"
node /fixture/release/install-doctor-engine.mjs --input "$HOME/rollback-status.json" > "$HOME/rollback-status-output.json"
node - "$HOME/rollback-status-output.json" <<'VERIFY_ROLLBACK_STATUS'
const fs = require('node:fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (status.authority !== 'committed' || status.receipt?.completed !== true) throw new Error('rollback status is not committed');
VERIFY_ROLLBACK_STATUS
set +e
node /fixture/release/install-doctor-engine.mjs --input "$HOME/rollback-execute.json" > "$HOME/rollback-replay.stdout" 2> "$HOME/rollback-replay.stderr"
rollback_replay_status=$?
set -e
[ "$rollback_replay_status" -eq 3 ] || { printf 'committed rollback replay status=%s\n' "$rollback_replay_status" >&2; exit 88; }

# Reapply the approved desired state after the explicit rollback, then prove a
# subsequent unchanged run performs no fixture or managed-file mutation.
run_start_approved "$HOME/reapply.stdout" "$HOME/reapply.stderr" "$digest" || { cat "$HOME/reapply.stdout" "$HOME/reapply.stderr" >&2; exit 88; }
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'approved reapply did not restore managed policy\n' >&2; exit 88; }
[ "$clean_hash" = "$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')" ] || { printf 'config reapply duplicated an external fixture mutation\n' >&2; exit 89; }

run_start_approved "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" "$digest" || { cat "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" >&2; exit 88; }
unchanged_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
[ "$clean_hash" = "$unchanged_hash" ] || { printf 'unchanged run added a mutation\n' >&2; diff -u "$HOME/clean-ledger" "$HOME/mutation-ledger" >&2 || true; exit 89; }

node - "$HOME/.local/state/install.doctor/engine" "$digest" "$interrupted_run_id" <<'VERIFY'
const fs = require('node:fs');
const path = require('node:path');
const [root, expectedDigest, interruptedRunId] = process.argv.slice(2);
const runsRoot = path.join(root, 'runs', expectedDigest);
const runs = fs.readdirSync(runsRoot).filter(name => !name.startsWith('.'));
if (runs.length !== 3) throw new Error(`expected three approved runs, found ${runs.length}`);
for (const run of runs) {
  const directory = path.join(runsRoot, run);
  const commits = fs.readdirSync(path.join(directory, 'commits')).filter(name => name.endsWith('.commit.json'));
  if (commits.length !== 1) throw new Error(`${run} has ${commits.length} commits`);
  const receiptsDirectory = path.join(directory, 'receipts');
  const receipts = fs.readdirSync(receiptsDirectory).filter(name => name.endsWith('.receipt.json'));
  if (receipts.length !== 1) throw new Error(`${run} has ${receipts.length} receipts`);
  const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDirectory, receipts[0]), 'utf8'));
  if (receipt.status !== 'success' || receipt.planDigest !== expectedDigest) throw new Error(`${run} receipt is not authoritative success`);
}
if (!runs.includes(interruptedRunId)) throw new Error('automatic resume did not commit the interrupted run identity');
VERIFY

[ "$(wc -l < "$HOME/release-requests.log" | tr -d ' ')" -eq 25 ] || {
  printf 'unexpected release request count\n' >&2; cat "$HOME/release-requests.log" >&2; exit 88;
}
printf 'approved_plan=%s\n' "$digest"
printf 'mutations=%s\n' "$(wc -l < "$HOME/mutation-ledger" | tr -d ' ')"
printf 'interrupted_run_resumed=1\n'
printf 'rollback_config_committed=1\n'
printf 'committed_runs=3\n'
printf 'unchanged_mutations=0\n'
NODE_RUN
chmod 0700 /canary-home/run-as-node.sh
chown node:node /canary-home/run-as-node.sh
su -s /bin/bash node -c 'bash /canary-home/run-as-node.sh'
SH

mkdir "$FIXTURE/container-tools"
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  cp "$FIXTURE/$TOOL" "$FIXTURE/container-tools/$TOOL"
  chmod 0700 "$FIXTURE/container-tools/$TOOL"
done
mkdir "$FIXTURE/container-fixture"
cp -a "$RELEASE" "$FIXTURE/container-fixture/release"
cp -a "$REPOSITORY" "$FIXTURE/container-fixture/repository"
cp "$FIXTURE/start.sh" "$FIXTURE/container-fixture/start.sh"
cp "$FIXTURE/container-run.sh" "$FIXTURE/container-fixture/container-run.sh"
cp -a "$FIXTURE/container-tools" "$FIXTURE/container-fixture/tools"
# Everything in this read-only mount is public release/canary material. The
# pinned image UID intentionally differs from the CI host UID, so permit read
# and directory/script traversal while stripping every group/other write bit.
chmod -R a+rX,go-w "$FIXTURE/container-fixture"

printf 'bootstrap-install-acceptance: running pinned, network-disabled container\n'
OUTPUT="$FIXTURE/canary.out"
DOCKER_MOUNTS=()
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  DOCKER_MOUNTS+=(--mount "type=bind,src=$FIXTURE/container-fixture/tools/$TOOL,dst=/usr/local/bin/$TOOL,readonly")
done
docker run --rm --network=none --read-only --entrypoint /bin/bash \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,mode=1777 \
  --tmpfs /canary-home:rw,nosuid,nodev,exec,mode=0700 \
  --mount "type=bind,src=$FIXTURE/container-fixture,dst=/fixture,readonly" \
  "${DOCKER_MOUNTS[@]}" \
  "$IMAGE" /fixture/container-run.sh | tee "$OUTPUT"

grep -q '^committed_runs=3$' "$OUTPUT"
grep -q '^interrupted_run_resumed=1$' "$OUTPUT"
grep -q '^rollback_config_committed=1$' "$OUTPUT"
grep -q '^unchanged_mutations=0$' "$OUTPUT"
printf 'bootstrap-install-acceptance: PASS (signed /start, released cancellation, automatic same-run resume, committed config rollback, unchanged reapply)\n'
