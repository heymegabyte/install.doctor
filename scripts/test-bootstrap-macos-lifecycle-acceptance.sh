#!/usr/bin/env bash
# Native macOS fixture acceptance for the signed launcher -> provisioner -> engine path.
# It proves bounded Darwin lifecycle behavior, not public /start transport or platform promotion.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-bootstrap-macos-lifecycle.XXXXXXXX")"
cleanup() {
  if [ "${INSTALL_DOCTOR_KEEP_CANARY_FIXTURE:-0}" = 1 ]; then
    printf 'bootstrap-macos-lifecycle-acceptance: retained fixture %s\n' "$FIXTURE" >&2
  else
    rm -rf -- "$FIXTURE"
  fi
}
trap cleanup EXIT HUP INT TERM

[ "${INSTALL_DOCTOR_RUN_NATIVE_MACOS_LIFECYCLE:-0}" = 1 ] || {
  printf 'bootstrap-macos-lifecycle-acceptance: SKIP (dedicated signed-lifecycle job only)\n'
  exit 0
}
[ "$(uname -s)" = Darwin ] || {
  printf 'bootstrap-macos-lifecycle-acceptance: Darwin is required\n' >&2
  exit 1
}
EXPECTED_MACOS_MAJOR="${INSTALL_DOCTOR_EXPECTED_MACOS_MAJOR:-15}"
OBSERVED_MACOS_VERSION="$(sw_vers -productVersion)"
OBSERVED_MACOS_MAJOR="${OBSERVED_MACOS_VERSION%%.*}"
[ "$OBSERVED_MACOS_MAJOR" = "$EXPECTED_MACOS_MAJOR" ] || {
  printf 'bootstrap-macos-lifecycle-acceptance: expected macOS major %s, observed %s\n' \
    "$EXPECTED_MACOS_MAJOR" "$OBSERVED_MACOS_VERSION" >&2
  exit 2
}
command -v ssh-keygen >/dev/null 2>&1 || { printf 'ssh-keygen is required\n' >&2; exit 1; }

printf 'bootstrap-macos-lifecycle-acceptance: bundling canonical engine\n'
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null

REPOSITORY="$FIXTURE/repository"
RELEASE_PARENT="$FIXTURE/releases"
RELEASE_ID='acceptance'
RELEASE="$RELEASE_PARENT/$RELEASE_ID"
RUNTIME_DIR="$FIXTURE/runtimes"
TOOLS="$FIXTURE/tools"
mkdir -m 0700 "$REPOSITORY" "$RELEASE_PARENT" "$RUNTIME_DIR" "$TOOLS"
# Exercise the signed source-commit boundary with the repository's actual
# committed desired-state inputs. The canary still replaces every mutating
# executable with a hermetic fixture, so this proves provenance and source-tree
# structure without installing any real package or rendering local secrets.
git -C "$ROOT" archive --format=tar HEAD -- .chezmoiroot home software.yml \
  | tar -xf - -C "$REPOSITORY"
mkdir -p "$REPOSITORY/packages/control-plane/src"
cp "$ROOT/scripts/provision.sh" "$REPOSITORY/provision.sh"
cp "$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs" "$REPOSITORY/install-doctor-engine.mjs"
cp "$ROOT/packages/control-plane/src/catalog.json" "$REPOSITORY/packages/control-plane/src/catalog.json"
(cd "$ROOT" && tar --exclude='node_modules' --exclude='dist' -cf - packages/aid-core packages/installer-engine) \
  | (cd "$REPOSITORY" && tar -xf -)
chmod 0700 "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs"
[ -f "$REPOSITORY/home/.chezmoidata.yaml" ]
[ -f "$REPOSITORY/home/dot_local/bin/executable_installx" ]
[ -f "$REPOSITORY/home/dot_config/shell/megabyte-cache.sh.tmpl" ]
[ -s "$REPOSITORY/software.yml" ]
DESIRED_STATE_FILE_COUNT="$(git -C "$ROOT" ls-tree -r --name-only HEAD -- home software.yml .chezmoiroot | wc -l | tr -d ' ')"
[ "$DESIRED_STATE_FILE_COUNT" -gt 1000 ] || { printf 'canonical desired-state fixture is unexpectedly incomplete\n' >&2; exit 1; }
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
ALLOWED_SIGNERS="$FIXTURE/allowed-signers"
printf 'install-doctor-acceptance %s\n' "$PUBLIC_KEY" > "$ALLOWED_SIGNERS"
chmod 0600 "$ALLOWED_SIGNERS"
ssh-keygen -Y verify -f "$ALLOWED_SIGNERS" -I install-doctor-acceptance \
  -n install.doctor.release -s "$RELEASE/manifest.sig" < "$RELEASE/manifest" >/dev/null \
  || { printf 'bootstrap-macos-lifecycle-acceptance: SSHSIG verification failed\n' >&2; exit 1; }

manifest_value() {
  local key="$1" count
  count="$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$RELEASE/manifest")"
  [ "$count" -eq 1 ] || { printf 'manifest key missing or duplicated: %s\n' "$key" >&2; return 1; }
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print }' "$RELEASE/manifest"
}
sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
file_size() { wc -c < "$1" | tr -d '[:space:]'; }
verify_payload() {
  local prefix="$1" filename="$2" path
  path="$RELEASE/$filename"
  local declared_url declared_sha declared_size
  declared_url="$(manifest_value "${prefix}_url")"
  declared_sha="$(manifest_value "${prefix}_sha256")"
  declared_size="$(manifest_value "${prefix}_size")"
  [ "$declared_url" = "https://app.install.doctor/releases/$RELEASE_ID/$filename" ] \
    || { printf 'noncanonical payload URL: %s\n' "$filename" >&2; return 1; }
  [ -f "$path" ] && [ ! -L "$path" ] || { printf 'unsafe payload: %s\n' "$filename" >&2; return 1; }
  [ "$declared_sha" = "$(sha256_file "$path")" ] \
    || { printf 'payload digest mismatch: %s\n' "$filename" >&2; return 1; }
  [ "$declared_size" = "$(file_size "$path")" ] \
    || { printf 'payload size mismatch: %s\n' "$filename" >&2; return 1; }
}

[ "$(manifest_value schema_version)" = 5 ]
[ "$(manifest_value release_id)" = "$RELEASE_ID" ]
[ "$(manifest_value source_commit)" = "$SOURCE_COMMIT" ]
[ "$(manifest_value key_id)" = install-doctor-acceptance ]
[ "$(manifest_value engine_node_min)" = 22 ]
MANIFEST_CREATED="$(manifest_value created_at)"
MANIFEST_EXPIRES="$(manifest_value expires_at)"
MANIFEST_NOW="$(date -u +%s)"
[ "$MANIFEST_CREATED" -le "$MANIFEST_NOW" ]
[ "$MANIFEST_NOW" -lt "$MANIFEST_EXPIRES" ]
[ "$((MANIFEST_EXPIRES - MANIFEST_CREATED))" -le 604800 ]
verify_payload artifact provision.sh
verify_payload engine install-doctor-engine.mjs
verify_payload catalog catalog.json
verify_payload launcher start
for PLATFORM in macos-x64 macos-arm64 linux-x64 linux-arm64; do
  verify_payload "runtime_${PLATFORM//-/_}" "node-$PLATFORM.tar.gz"
done

MANIFEST_SHA="$(sha256_file "$RELEASE/manifest")"
ARTIFACT_SHA="$(manifest_value artifact_sha256)"
ENGINE_SHA="$(manifest_value engine_sha256)"
CATALOG_SHA="$(manifest_value catalog_sha256)"
ENGINE_NODE_MIN="$(manifest_value engine_node_min)"
RUNTIME_NODE_VERSION="$(node --version)"; RUNTIME_NODE_VERSION="${RUNTIME_NODE_VERSION#v}"
case "$(uname -m)" in arm64) BOOTSTRAP_PLATFORM=macos-arm64 ;; x86_64) BOOTSTRAP_PLATFORM=macos-x64 ;; *) exit 1 ;; esac

cat > "$FIXTURE/curl" <<'SH'
#!/usr/bin/env bash
printf 'unexpected network request after independent release verification: %s\n' "$*" >&2
exit 65
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
      engine_pid="$(ps -o ppid= -p "$operation_pid" | tr -d ' ')"
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


mkdir -p "$FIXTURE/tools" "$FIXTURE/canary-home/.local/share/install.doctor/releases/acceptance"
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  cp "$FIXTURE/$TOOL" "$FIXTURE/tools/$TOOL"
  chmod 0500 "$FIXTURE/tools/$TOOL"
done
cp -a "$REPOSITORY" "$FIXTURE/canary-home/.local/share/install.doctor/releases/acceptance/source"

RUNNER="$FIXTURE/run-native.sh"
cat > "$RUNNER" <<'NATIVE_RUNNER'
#!/usr/bin/env bash
set -euo pipefail
export USER="${USER:-macos-canary}" LOGNAME="${LOGNAME:-$USER}"
export HEADLESS_INSTALL=1 SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=macos INSTALL_DOCTOR_CAPABILITY=minimal
export INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES=''
export INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false
run_provision() { bash "$INSTALL_DOCTOR_RELEASE_DIR/provision.sh" >"$1" 2>"$2"; }
run_provision_approved() { env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$3" bash "$INSTALL_DOCTOR_RELEASE_DIR/provision.sh" >"$1" 2>"$2"; }

set +e
run_provision "$HOME/plan.stdout" "$HOME/plan.stderr"
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
run_provision_approved "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" "$digest"
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
node "$INSTALL_DOCTOR_ENGINE_PATH" --input "$HOME/runs-list.json" > "$HOME/interrupted-runs.json"
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
const directory = path.join(process.env.HOME, '.local/state/install.doctor/engine/runs', expectedDigest, run.runId);
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

run_provision_approved "$HOME/clean.stdout" "$HOME/clean.stderr" "$digest" || {
  printf 'resume rejected interrupted_run=%s first_approved_plan=%s\n' "$interrupted_run_id" "$digest" >&2
  cat "$HOME/clean.stdout" "$HOME/clean.stderr" >&2
  exit 87
}
[ -s "$HOME/mutation-ledger" ] || { printf 'clean install made no fixture mutations\n' >&2; exit 85; }
[ "$(grep -c '^apply:chezmoi-init$' "$HOME/mutation-ledger")" -eq 1 ] \
  || { printf 'resumed operation did not mutate exactly once\n' >&2; cat "$HOME/mutation-ledger" >&2; exit 87; }
cp "$HOME/mutation-ledger" "$HOME/clean-ledger"
clean_hash="$(shasum -a 256 "$HOME/mutation-ledger" | awk '{print $1}')"
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'managed bootstrap policy is missing after install\n' >&2; exit 88; }

cat > "$HOME/rollback-plan.json" <<ROLLBACK_PLAN
{"schemaVersion":1,"command":"rollback-config-plan","stateRoot":"$HOME/.local/state/install.doctor/engine","sourceRunId":"$interrupted_run_id","sourcePlanDigest":"$digest"}
ROLLBACK_PLAN
chmod 0600 "$HOME/rollback-plan.json"
node "$INSTALL_DOCTOR_ENGINE_PATH" --input "$HOME/rollback-plan.json" > "$HOME/rollback-plan-output.json"
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
node "$INSTALL_DOCTOR_ENGINE_PATH" --input "$HOME/rollback-execute.json" > "$HOME/rollback-execute-output.json"
[ ! -e "$HOME/.config/install.doctor-policy.json" ] || { printf 'rollback did not restore the absent policy state\n' >&2; exit 88; }
cat > "$HOME/rollback-status.json" <<ROLLBACK_STATUS
{"schemaVersion":1,"command":"rollback-config-status","stateRoot":"$HOME/.local/state/install.doctor/engine","rollbackRunId":"bootstrap-policy-rollback","planDigest":"$rollback_digest"}
ROLLBACK_STATUS
chmod 0600 "$HOME/rollback-status.json"
node "$INSTALL_DOCTOR_ENGINE_PATH" --input "$HOME/rollback-status.json" > "$HOME/rollback-status-output.json"
node - "$HOME/rollback-status-output.json" <<'VERIFY_ROLLBACK_STATUS'
const fs = require('node:fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (status.authority !== 'committed' || status.receipt?.completed !== true) throw new Error('rollback status is not committed');
VERIFY_ROLLBACK_STATUS
set +e
node "$INSTALL_DOCTOR_ENGINE_PATH" --input "$HOME/rollback-execute.json" > "$HOME/rollback-replay.stdout" 2> "$HOME/rollback-replay.stderr"
rollback_replay_status=$?
set -e
[ "$rollback_replay_status" -eq 3 ] || { printf 'committed rollback replay status=%s\n' "$rollback_replay_status" >&2; exit 88; }

# Reapply the approved desired state after the explicit rollback, then prove a
# subsequent unchanged run performs no fixture or managed-file mutation.
run_provision_approved "$HOME/reapply.stdout" "$HOME/reapply.stderr" "$digest" || { cat "$HOME/reapply.stdout" "$HOME/reapply.stderr" >&2; exit 88; }
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'approved reapply did not restore managed policy\n' >&2; exit 88; }
[ "$clean_hash" = "$(shasum -a 256 "$HOME/mutation-ledger" | awk '{print $1}')" ] || { printf 'config reapply duplicated an external fixture mutation\n' >&2; exit 89; }

run_provision_approved "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" "$digest" || { cat "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" >&2; exit 88; }
unchanged_hash="$(shasum -a 256 "$HOME/mutation-ledger" | awk '{print $1}')"
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

printf 'approved_plan=%s\n' "$digest"
printf 'mutations=%s\n' "$(wc -l < "$HOME/mutation-ledger" | tr -d ' ')"
printf 'interrupted_run_resumed=1\n'
printf 'rollback_config_committed=1\n'
printf 'committed_runs=3\n'
printf 'unchanged_mutations=0\n'
NATIVE_RUNNER
chmod 0500 "$RUNNER"

printf 'bootstrap-macos-lifecycle-acceptance: running isolated native Darwin fixture\n'
OUTPUT="$FIXTURE/canary.out"
HOME="$FIXTURE/canary-home" \
PATH="$FIXTURE/tools:$PATH" \
INSTALL_DOCTOR_RELEASE_DIR="$RELEASE" \
INSTALL_DOCTOR_RELEASE_ID="$RELEASE_ID" \
INSTALL_DOCTOR_SOURCE_COMMIT="$SOURCE_COMMIT" \
INSTALL_DOCTOR_BOOTSTRAP_PLATFORM="$BOOTSTRAP_PLATFORM" \
INSTALL_DOCTOR_VERIFIED_MANIFEST="$RELEASE/manifest" \
INSTALL_DOCTOR_VERIFIED_SIGNATURE="$RELEASE/manifest.sig" \
INSTALL_DOCTOR_MANIFEST_SHA256="$MANIFEST_SHA" \
INSTALL_DOCTOR_ARTIFACT_SHA256="$ARTIFACT_SHA" \
INSTALL_DOCTOR_ENGINE_PATH="$RELEASE/install-doctor-engine.mjs" \
INSTALL_DOCTOR_ENGINE_SHA256="$ENGINE_SHA" \
INSTALL_DOCTOR_CATALOG_PATH="$RELEASE/catalog.json" \
INSTALL_DOCTOR_CATALOG_SHA256="$CATALOG_SHA" \
INSTALL_DOCTOR_ENGINE_NODE_MIN="$ENGINE_NODE_MIN" \
INSTALL_DOCTOR_RUNTIME_SOURCE=system \
INSTALL_DOCTOR_RUNTIME_NODE="$(command -v node)" \
INSTALL_DOCTOR_RUNTIME_URL='' INSTALL_DOCTOR_RUNTIME_SHA256='' INSTALL_DOCTOR_RUNTIME_SIZE='' \
INSTALL_DOCTOR_RUNTIME_PLATFORM="$BOOTSTRAP_PLATFORM" \
INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$RUNTIME_NODE_VERSION" INSTALL_DOCTOR_RUNTIME_ARCHIVE='' \
  bash "$RUNNER" | tee "$OUTPUT"

grep -q '^committed_runs=3$' "$OUTPUT"
grep -q '^interrupted_run_resumed=1$' "$OUTPUT"
grep -q '^rollback_config_committed=1$' "$OUTPUT"
grep -q '^unchanged_mutations=0$' "$OUTPUT"
printf 'evidence_scope=native-macos-signed-fixture-lifecycle\n'
printf 'platform_promotion=0\n'
printf 'canonical_start_transport=0\n'
printf 'bootstrap-macos-lifecycle-acceptance: PASS (native signed fixture, cancellation/resume, rollback, unchanged reapply)\n'
