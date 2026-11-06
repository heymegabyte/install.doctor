#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if grep -q '^runCanonicalProvisionEngine() {' "$PROVISION"; then pass 'canonical engine runner exists'; else fail 'canonical engine runner missing'; fi
if grep -q 'INSTALL_DOCTOR_ENGINE_NODE_MIN' "$PROVISION" && grep -q 'node --version' "$PROVISION"; then pass 'engine runtime version is checked'; else fail 'engine runtime version is not checked'; fi
if grep -q 'stateRoot' "$PROVISION" && grep -q 'selectedTaskIds' "$PROVISION"; then pass 'provisioner creates a strict persistent engine invocation'; else fail 'engine invocation contract is absent'; fi
if grep -q 'maxConcurrency: rawPlan.concurrency' "$PROVISION" \
  && grep -q 'networkConcurrency: rawPlan.concurrency' "$PROVISION"; then
  pass 'approved concurrency controls the plan-bound engine execution policy'
else
  fail 'concurrency selection is not bound to scheduler authority'
fi
if grep -q "id: 'bootstrap.installx-tool'" "$PROVISION" && grep -q "id: 'desired.packages'" "$PROVISION" && grep -q "id: 'desired.services'" "$PROVISION"; then
  pass 'package tooling, package closure, and explicit services are separate typed nodes'
else
  fail 'desired package/service typed-node cutover is incomplete'
fi
if grep -q 'INSTALL_DOCTOR_ENGINE_OWNS_PACKAGES' "$ROOT/home/.chezmoiscripts/universal/run_after_10-install.sh.tmpl" \
  && grep -q 'INSTALL_DOCTOR_ENGINE_OWNS_SERVICES' "$ROOT/home/.chezmoiscripts/universal/run_after_10-install.sh.tmpl"; then
  pass 'Chezmoi compatibility script defers package and service ownership to the engine'
else
  fail 'Chezmoi compatibility script retains competing package/service ownership'
fi
if grep -q 'installx-tool-apply).*--exclude=scripts' "$PROVISION"; then
  pass 'targeted installx materialization excludes the global Chezmoi script set'
else
  fail 'targeted installx materialization can unexpectedly execute Chezmoi scripts'
fi
if grep -q -- '--engine-operation' "$PROVISION" && grep -q 'chezmoi-check\|chezmoi-apply\|chezmoi-verify' "$PROVISION"; then pass 'engine operations use the staged provisioner adapter'; else fail 'engine operation adapter is absent'; fi
logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
if printf '%s\n' "$logic" | grep -q 'runCanonicalProvisionEngine apply || CHEZMOI_STATUS=$?' && ! printf '%s\n' "$logic" | grep -q 'runChezmoi || CHEZMOI_STATUS=$?'; then
  pass 'production orchestration executes chezmoi through the canonical engine'
else
  fail 'production orchestration still bypasses the canonical engine'
fi
if ! printf '%s\n' "$logic" | grep -q 'ensureWarpDisconnected' \
  && grep -q "id: 'network.warp-disconnect'" "$PROVISION"; then
  pass 'selected WARP disconnection is owned by the canonical engine'
else
  fail 'WARP disconnection still bypasses the canonical engine'
fi
plan_line="$(printf '%s\n' "$logic" | grep -n 'runCanonicalProvisionEngine --plan-only' | cut -d: -f1)"
mutation_line="$(printf '%s\n' "$logic" | grep -n 'idPersistVerifiedReleaseProvenance' | cut -d: -f1)"
if [ -n "$plan_line" ] && [ -n "$mutation_line" ] && [ "$plan_line" -lt "$mutation_line" ]; then
  pass 'exact normalized plan approval precedes host mutation'
else
  fail 'host mutation can occur before exact normalized plan approval'
fi
if grep -q 'INSTALL_DOCTOR_ROLE INSTALL_DOCTOR_CAPABILITY INSTALL_DOCTOR_NETWORK INSTALL_DOCTOR_CONCURRENCY' "$PROVISION" \
  && grep -q 'INSTALL_DOCTOR_USER INSTALL_DOCTOR_SELECTED_SERVICES' "$PROVISION"; then pass 'root handoff preserves selected desired state'; else fail 'root handoff drops selected desired state'; fi
if grep -q "command: 'runs-list'" "$PROVISION" && grep -q "command: 'resume'" "$PROVISION"; then pass 'shell discovers and resumes exact protected interrupted runs'; else fail 'shell always abandons interrupted run identity'; fi
if grep -q "id: 'system.reboot-assessment'" "$PROVISION" \
  && grep -q "policy: 'explicit-operator-reboot-v1'" "$PROVISION" \
  && ! grep -Eq 'sudo[[:space:]]+(softwareupdate[^\n]*-R|reboot)|shutdown[[:space:]]+-r|reboot\.target' "$PROVISION"; then
  pass 'reboot requirement is a typed operator boundary with no automatic restart path'
else
  fail 'provisioning can reboot outside the typed operator boundary'
fi

TMP_DIR="$(realpath "$(mktemp -d)")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
mkdir -p "$TMP_DIR/bin" "$TMP_DIR/home" "$TMP_DIR/state"
mkdir -p "$TMP_DIR/home/.config/chezmoi"
printf '%s\n' 'sourceDir: fixture' > "$TMP_DIR/home/.config/chezmoi/chezmoi.yaml"
SOURCE_ROOT="$TMP_DIR/data/install.doctor/releases/test-release/source"
mkdir -p "$SOURCE_ROOT/home" "$SOURCE_ROOT/packages/control-plane/src"
: > "$SOURCE_ROOT/.chezmoiroot"
printf '[]\n' > "$SOURCE_ROOT/packages/control-plane/src/catalog.json"
git -C "$SOURCE_ROOT" init --quiet
git -C "$SOURCE_ROOT" config user.email fixture@example.invalid
git -C "$SOURCE_ROOT" config user.name Fixture
git -C "$SOURCE_ROOT" add .
git -C "$SOURCE_ROOT" commit --quiet -m fixture
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_ORIGIN="file://$TMP_DIR/source-origin"
git -C "$SOURCE_ROOT" remote add origin "$SOURCE_ORIGIN"
cat > "$TMP_DIR/bin/chezmoi" <<'SCRIPT'
#!/usr/bin/env bash
set -eu
if [ "${1:-}" = --source ]; then shift 2; fi
printf '%s %s\n' "$1" "${SOFTWARE_GROUP:-missing}" >> "$HOME/ledger"
case "$1" in
  data) : ;;
  verify) [ -f "$HOME/applied" ] ;;
  apply)
    : > "$HOME/applied"
    case " $* " in
      *" $HOME/.local/bin/installx "*)
        mkdir -p "$HOME/.local/bin"
        cat > "$HOME/.local/bin/installx" <<'INSTALLX'
#!/usr/bin/env bash
set -eu
case " $* " in
  *" --check "*)
    if [ -f "$HOME/installx-applied" ]; then
      printf '%s\n' '{"schemaVersion":1,"status":"converged","selected":[],"missing":[]}'
      exit 0
    fi
    printf '%s\n' '{"schemaVersion":1,"status":"needed","selected":["fixture"],"missing":["fixture"]}'
    exit 10
    ;;
esac
: > "$HOME/installx-applied"
printf '%s\n' package-apply >> "$HOME/ledger"
exit 0
INSTALLX
        chmod 0700 "$HOME/.local/bin/installx"
        ;;
    esac
    ;;
  *) exit 64 ;;
esac
SCRIPT
cat > "$TMP_DIR/bin/xrandr" <<'SCRIPT'
#!/usr/bin/env bash
exit 1
SCRIPT
cp "$TMP_DIR/bin/xrandr" "$TMP_DIR/bin/system_profiler"
cat > "$TMP_DIR/bin/brew" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$TMP_DIR/bin/gum" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$*"
exit 0
SCRIPT
cp "$TMP_DIR/bin/brew" "$TMP_DIR/bin/zx"
cat > "$TMP_DIR/bin/sudo" <<'SCRIPT'
#!/usr/bin/env bash
# Fixture models authority that predated the installer and must be preserved.
exit 0
SCRIPT
cat > "$TMP_DIR/bin/process-software-groups" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cp "$TMP_DIR/bin/process-software-groups" "$TMP_DIR/bin/process-software-post-scripts"
chmod 0700 "$TMP_DIR/bin/chezmoi" "$TMP_DIR/bin/brew" "$TMP_DIR/bin/gum" "$TMP_DIR/bin/zx" "$TMP_DIR/bin/sudo" "$TMP_DIR/bin/xrandr" "$TMP_DIR/bin/system_profiler" "$TMP_DIR/bin/process-software-groups" "$TMP_DIR/bin/process-software-post-scripts"
printf '{"schemaVersion":2,"host":{"hostname":"fixture","os":"linux"},"role":"workstation","capability":"minimal","network":"none","softwareGroup":"Minimal","installUser":"%s","offline":false,"concurrency":2,"selectedPackages":[],"selectedServices":[],"selectedSupportedPaths":[],"lazyResolverRequirements":[],"consents":{"privileged":true,"network":true,"bestEffort":true},"platformAdmission":{"policyRevision":"platform-support-matrix-v1","cellId":"debian-12-x64-container","status":"best-effort","os":"debian","release":"12","arch":"x64","environment":"container","role":"debian","limitation":"Fixture lifecycle evidence is incomplete."},"privilegeContext":{"sudoPreexisting":true},"createdAt":"2026-11-06T00:00:00.000Z"}\n' "$(id -un)" > "$TMP_DIR/plan.json"
chmod 0600 "$TMP_DIR/plan.json"

# Exercise the real Homebrew-tools operation adapter with an isolated fake
# package manager. Merely putting pre-existing gum/zx shims on PATH would let
# the engine's check operation skip the mutation and leave this cutover
# untested.
make_brew_fixture() {
  local FIXTURE_ROOT="$1" FAIL_TOOL="${2:-}"
  mkdir -p "$FIXTURE_ROOT/bin" "$FIXTURE_ROOT/home"
  cat > "$FIXTURE_ROOT/bin/brew" <<'SCRIPT'
#!/usr/bin/env bash
set -eu
[ "${1:-}" = install ] || exit 64
shift
[ "${1:-}" != --quiet ] || shift
tool="${1:-}"
printf '%s\n' "$tool" >> "$BREW_LEDGER"
if [ -n "${BREW_FAIL_TOOL:-}" ] && [ "$tool" = "$BREW_FAIL_TOOL" ]; then exit 42; fi
cat > "$BREW_FAKE_BIN/$tool" <<EOF
#!/usr/bin/env bash
exit 0
EOF
chmod 0700 "$BREW_FAKE_BIN/$tool"
SCRIPT
  chmod 0700 "$FIXTURE_ROOT/bin/brew"
  : > "$FIXTURE_ROOT/ledger"
  if PATH="$FIXTURE_ROOT/bin:/usr/bin:/bin" HOME="$FIXTURE_ROOT/home" \
    BREW_LEDGER="$FIXTURE_ROOT/ledger" BREW_FAKE_BIN="$FIXTURE_ROOT/bin" BREW_FAIL_TOOL="$FAIL_TOOL" \
    bash -c '
      source "$1"
      idRunEngineOperation homebrew-tools-check
      [ "$?" -eq 10 ] || exit 90
      idRunEngineOperation homebrew-tools-apply
      apply_status=$?
      [ "$apply_status" -eq "${2:-0}" ] || exit 91
      if [ "$apply_status" -eq 0 ]; then idRunEngineOperation homebrew-tools-verify; fi
    ' _ "$PROVISION" "${3:-0}"; then
    return 0
  fi
  return $?
}

if make_brew_fixture "$TMP_DIR/tool-success" '' 0 \
  && [ "$(cat "$TMP_DIR/tool-success/ledger")" = $'gum\nchezmoi\nzx' ] \
  && ! grep -qx gcc "$TMP_DIR/tool-success/ledger"; then
  pass 'engine Homebrew-tools task installs only chezmoi, gum, and zx through fake brew'
else
  fail 'engine Homebrew-tools task did not complete the minimal fake-brew closure'
fi

if make_brew_fixture "$TMP_DIR/tool-failure" zx 42; then
  if [ "$(cat "$TMP_DIR/tool-failure/ledger")" = $'gum\nchezmoi\nzx' ] \
    && [ ! -e "$TMP_DIR/tool-failure/bin/zx" ]; then
    pass 'Homebrew-tools task preserves a package failure and does not fabricate the failed tool'
  else
    fail 'Homebrew-tools failure fixture did not exercise the expected package order'
  fi
else
  fail 'Homebrew-tools operation swallowed or remapped the fake brew failure'
fi

if npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null 2>&1; then
  ENGINE="$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs"
  if PATH="$TMP_DIR/bin:$PATH" HOME="$TMP_DIR/home" XDG_CONFIG_HOME="$TMP_DIR/home/.config" XDG_STATE_HOME="$TMP_DIR/state" XDG_DATA_HOME="$TMP_DIR/data" \
    INSTALL_DOCTOR_ENGINE_PATH="$ENGINE" INSTALL_DOCTOR_ENGINE_SHA256="$(shasum -a 256 "$ENGINE" | awk '{print $1}')" \
    INSTALL_DOCTOR_ENGINE_NODE_MIN=22 INSTALL_DOCTOR_RELEASE_ID=test-release INSTALL_DOCTOR_PLAN="$TMP_DIR/plan.json" \
    INSTALL_DOCTOR_ROLE=workstation INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none SOFTWARE_GROUP=Full \
    INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=true INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true \
    INSTALL_DOCTOR_PLATFORM_CELL=debian-12-x64-container INSTALL_DOCTOR_PLATFORM_STATUS=best-effort \
    INSTALL_DOCTOR_PLATFORM_OS=debian INSTALL_DOCTOR_PLATFORM_RELEASE=12 INSTALL_DOCTOR_PLATFORM_ARCH=x64 \
    INSTALL_DOCTOR_PLATFORM_ENVIRONMENT=container INSTALL_DOCTOR_PLATFORM_ROLE=debian INSTALL_DOCTOR_PLATFORM_LIMITATION='Fixture lifecycle evidence is incomplete.' \
    INSTALL_DOCTOR_SUDO_PREEXISTING=true \
    INSTALL_DOCTOR_OFFLINE=false INSTALL_DOCTOR_SOURCE_COMMIT="$SOURCE_COMMIT" START_REPO="$SOURCE_ORIGIN" \
    HEADLESS_INSTALL=true KEEP_GOING='' DEBUG_MODE='' DEBUG='' NO_RESTART=true \
    bash -c 'source "$1"; runCanonicalProvisionEngine; first=$?; [ "$first" -eq 3 ] || exit 91; [ ! -e "$HOME/ledger" ] || exit 93; set -- "$XDG_STATE_HOME/install.doctor/engine/approvals/"*.json; [ "$#" -eq 1 ] || exit 92; approval="${1##*/}"; export INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="${approval%.json}"; runCanonicalProvisionEngine; runCanonicalProvisionEngine' _ "$PROVISION" >"$TMP_DIR/engine.out" 2>&1; then
    apply_count="$(grep -c '^apply Minimal$' "$TMP_DIR/home/ledger" || true)"
    verify_count="$(grep -c '^verify Minimal$' "$TMP_DIR/home/ledger" || true)"
    package_apply_count="$(grep -c '^package-apply$' "$TMP_DIR/home/ledger" || true)"
    if [ "$apply_count" -eq 1 ] && [ "$verify_count" -eq 5 ] && [ "$package_apply_count" -eq 1 ]; then
      pass 'real engine cutover applies once while typed tool/file checks and unchanged reruns verify without duplicate mutation'
    else
      fail "real engine cutover ledger was apply=$apply_count verify=$verify_count package-apply=$package_apply_count"
    fi
    pass 'headless planning performs no desired-state operation before exact digest approval'
    if grep -q ' Full$' "$TMP_DIR/home/ledger"; then
      fail 'ambient software selection overrode the immutable plan'
    else
      pass 'engine operations use the immutable plan selection, not ambient environment'
    fi
    if find "$TMP_DIR/state/install.doctor/engine/invocations" -type f -print -quit | grep -q .; then
      fail 'canonical engine left an ephemeral invocation behind'
    else
      pass 'canonical engine removes ephemeral invocations'
    fi
    compensation_path="$(find "$TMP_DIR/state/install.doctor/engine/runs" -path '*/compensations/*.json' -type f -print -quit)"
    policy_path="$TMP_DIR/home/.config/install.doctor-policy.json"
    if [ -n "$compensation_path" ] && [ -f "$policy_path" ] \
      && node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.exit(v.record.taskId === "installer.bootstrap-policy" ? 0 : 1)' "$compensation_path"; then
      source_run_dir="$(dirname "$(dirname "$compensation_path")")"
      source_run_id="$(basename "$source_run_dir")"
      source_plan_digest="$(basename "$(dirname "$source_run_dir")")"
      rollback_input="$TMP_DIR/rollback-plan.json"
      rollback_plan="$TMP_DIR/rollback-plan-output.json"
      node - "$rollback_input" "$TMP_DIR/state/install.doctor/engine" "$source_run_id" "$source_plan_digest" <<'NODE'
const fs = require('node:fs');
const [destination, stateRoot, sourceRunId, sourcePlanDigest] = process.argv.slice(2);
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 1, command: 'rollback-config-plan', stateRoot, sourceRunId, sourcePlanDigest,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
      if node "$ENGINE" --input "$rollback_input" > "$rollback_plan"; then
        rollback_digest="$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(v.digest)' "$rollback_plan")"
        rollback_execute="$TMP_DIR/rollback-execute.json"
        node - "$rollback_execute" "$TMP_DIR/state/install.doctor/engine" "$source_run_id" "$source_plan_digest" "$rollback_digest" <<'NODE'
const fs = require('node:fs');
const [destination, stateRoot, sourceRunId, sourcePlanDigest, approvedPlanDigest] = process.argv.slice(2);
fs.writeFileSync(destination, `${JSON.stringify({
  schemaVersion: 1, command: 'rollback-config-execute', stateRoot, sourceRunId, sourcePlanDigest,
  rollbackRunId: 'fixture-bootstrap-policy-rollback', approvedPlanDigest,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
        if node "$ENGINE" --input "$rollback_execute" >/dev/null && [ ! -e "$policy_path" ]; then
          pass 'production managed policy records compensation and rollback-config removes the newly created file'
        else
          fail 'production managed policy rollback did not restore the absent prior state'
        fi
      else
        fail 'production managed policy compensation could not produce a rollback plan'
      fi
    else
      fail 'production managed policy did not publish bounded compensation evidence'
    fi
  else
    sed -n '1,120p' "$TMP_DIR/engine.out" >&2
    fail 'real canonical engine cutover failed'
  fi
else
  fail 'installer engine bundle failed'
fi

cat > "$TMP_DIR/forged-engine.mjs" <<'SCRIPT'
import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--input') + 1], 'utf8'));
if (input.command === 'load-plan') process.stdout.write(`${JSON.stringify({ schemaVersion: 1, platform: input.platform, architecture: input.architecture, roles: input.roles, items: [], installOrder: [], resolverOrder: [], digest: 'a'.repeat(64) })}\n`);
if (input.command === 'plan') process.stdout.write(`${JSON.stringify({ schemaVersion: 1, digest: 'd'.repeat(64), createdAt: new Date().toISOString() })}\n`);
if (input.command === 'runs-list') process.stdout.write(`${JSON.stringify({ schemaVersion: 1, runs: [] })}\n`);
process.exit(0);
SCRIPT
chmod 0700 "$TMP_DIR/forged-engine.mjs"
printf '[]\n' > "$TMP_DIR/forged-catalog.json"
chmod 0600 "$TMP_DIR/forged-catalog.json"
if PATH="$TMP_DIR/bin:$PATH" HOME="$TMP_DIR/home" XDG_STATE_HOME="$TMP_DIR/forged-state" \
  INSTALL_DOCTOR_ENGINE_PATH="$TMP_DIR/forged-engine.mjs" INSTALL_DOCTOR_ENGINE_SHA256="$(shasum -a 256 "$TMP_DIR/forged-engine.mjs" | awk '{print $1}')" \
  INSTALL_DOCTOR_ENGINE_NODE_MIN=22 INSTALL_DOCTOR_RELEASE_ID=test-release INSTALL_DOCTOR_PLAN="$TMP_DIR/plan.json" \
  INSTALL_DOCTOR_CATALOG_PATH="$TMP_DIR/forged-catalog.json" INSTALL_DOCTOR_CATALOG_SHA256="$(shasum -a 256 "$TMP_DIR/forged-catalog.json" | awk '{print $1}')" \
  INSTALL_DOCTOR_ROLE=workstation INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none SOFTWARE_GROUP=Minimal \
  INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=true INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true \
  INSTALL_DOCTOR_PLATFORM_CELL=debian-12-x64-container INSTALL_DOCTOR_PLATFORM_STATUS=best-effort \
  INSTALL_DOCTOR_PLATFORM_OS=debian INSTALL_DOCTOR_PLATFORM_RELEASE=12 INSTALL_DOCTOR_PLATFORM_ARCH=x64 \
  INSTALL_DOCTOR_PLATFORM_ENVIRONMENT=container INSTALL_DOCTOR_PLATFORM_ROLE=debian INSTALL_DOCTOR_PLATFORM_LIMITATION='Fixture lifecycle evidence is incomplete.' \
  INSTALL_DOCTOR_SUDO_PREEXISTING=true \
  INSTALL_DOCTOR_OFFLINE=false INSTALL_DOCTOR_CHEZMOI_SOURCE="$TMP_DIR/source" HEADLESS_INSTALL=true INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$(printf 'd%.0s' {1..64})" \
  bash -c 'source "$1"; runCanonicalProvisionEngine' _ "$PROVISION" >"$TMP_DIR/forged.out" 2>&1; then
  fail 'forged engine stdout/exit success passed without committed evidence'
elif grep -q 'without independently verifiable committed evidence' "$TMP_DIR/forged.out"; then
  pass 'shell rejects engine exit zero without authoritative committed evidence'
else
  sed -n '1,80p' "$TMP_DIR/forged.out" >&2
  fail 'forged engine failed for an unrelated reason'
fi

printf 'provision-engine-cutover: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
