#!/usr/bin/env bash
# Focused B03/B04 regression coverage for post-approval task cutover.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if bash -n "$PROVISION"; then pass 'provisioner remains valid Bash'; else fail 'provisioner has invalid Bash syntax'; fi

for task in bootstrap.macos-full-disk-access bootstrap.macos-cloudflare-certificate bootstrap.configured-agent-tasks; do
  if grep -Fq "id: '$task'" "$PROVISION"; then pass "$task is a typed task node"; else fail "$task is missing from the typed graph"; fi
done

for operation in macos-full-disk-access macos-certificate configured-agent-tasks; do
  section="$(grep -F -A 12 "id: 'bootstrap.${operation/macos-certificate/macos-cloudflare-certificate}'" "$PROVISION")"
  if printf '%s\n' "$section" | grep -q 'inputDigest:' \
    && printf '%s\n' "$section" | grep -q 'operations:' \
    && printf '%s\n' "$section" | grep -q 'timeoutMs:' \
    && printf '%s\n' "$section" | grep -q 'retry:' \
    && printf '%s\n' "$section" | grep -q 'privilege:' \
    && printf '%s\n' "$section" | grep -q 'network:' \
    && printf '%s\n' "$section" | grep -q 'consent:' \
    && printf '%s\n' "$section" | grep -q 'lockDomains:'; then
    pass "$operation declares the complete typed lifecycle policy"
  else
    fail "$operation is missing typed lifecycle metadata"
  fi
done

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
for legacy in 'ensureFullDiskAccess' 'importCloudFlareCert' 'idRunConfiguredAgentTasks'; do
  if printf '%s\n' "$logic" | grep -Fq "$legacy"; then fail "$legacy still mutates before the engine"; else pass "$legacy is no longer a pre-engine mutation"; fi
done

if grep -q 'INSTALL_DOCTOR_AGENT_TASK_DIR INSTALL_DOCTOR_AGENT_TASKS_CONSENT' "$PROVISION" \
  && grep -q 'INSTALL_DOCTOR_AGENT_FAILURE_POLICY INSTALL_DOCTOR_TASK_RETRIES' "$PROVISION"; then
  pass 'root handoff preserves the approved configured-agent selection'
else
  fail 'root handoff drops configured-agent plan inputs'
fi

mkdir -m 0700 "$TMP/tasks" "$TMP/home" "$TMP/state"
cat > "$TMP/tasks/one.sh" <<'SH'
#!/usr/bin/env bash
printf 'ran\n' >> "$AGENT_TEST_MARKER"
SH
chmod 0700 "$TMP/tasks/one.sh"
DIGEST="$(node - "$TMP/tasks/one.sh" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = process.argv[2];
const manifest = [{ name: 'one.sh', sha256: crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex') }];
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
NODE
)"

if HOME="$TMP/home" XDG_STATE_HOME="$TMP/state" INSTALL_DOCTOR_AGENT_TASK_DIR="$TMP/tasks" \
  INSTALL_DOCTOR_AGENT_TASKS_CONSENT=1 INSTALL_DOCTOR_AGENT_TASKS_DIGEST="$DIGEST" \
  INSTALL_DOCTOR_CONCURRENCY=1 AGENT_TEST_MARKER="$TMP/agent-runs" \
  bash -c 'source "$1"; export AGENT_TEST_MARKER; idApplyConfiguredAgentTasks && idVerifyConfiguredAgentTasksReceipt' _ "$PROVISION"; then
  pass 'configured agent task apply produces verifiable content-addressed evidence'
else
  fail 'configured agent task apply/verify failed'
fi
if [ "$(wc -l < "$TMP/agent-runs" 2>/dev/null || printf 0)" -eq 1 ]; then pass 'configured agent task ran exactly once'; else fail 'configured agent task run count is incorrect'; fi

printf '\n# changed after approval\n' >> "$TMP/tasks/one.sh"
if HOME="$TMP/home" XDG_STATE_HOME="$TMP/state" INSTALL_DOCTOR_AGENT_TASK_DIR="$TMP/tasks" \
  INSTALL_DOCTOR_AGENT_TASKS_CONSENT=1 INSTALL_DOCTOR_AGENT_TASKS_DIGEST="$DIGEST" \
  bash -c 'source "$1"; idVerifyConfiguredAgentTasksReceipt' _ "$PROVISION"; then
  fail 'changed configured agent task retained stale approval authority'
else
  pass 'changed configured agent task invalidates its approved manifest'
fi

mkdir -m 0700 "$TMP/too-many"
for index in $(seq 1 65); do printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/too-many/task-$index.sh"; chmod 0700 "$TMP/too-many/task-$index.sh"; done
if HOME="$TMP/home" INSTALL_DOCTOR_AGENT_TASK_DIR="$TMP/too-many" INSTALL_DOCTOR_AGENT_TASKS_CONSENT=1 \
  INSTALL_DOCTOR_AGENT_TASKS_DIGEST="$(printf 0%.0s {1..64})" \
  bash -c 'source "$1"; idVerifyConfiguredAgentTaskManifest' _ "$PROVISION"; then
  fail 'oversized configured-agent task set passed verification'
else
  pass 'configured-agent task count is bounded before execution'
fi

mkdir -m 0700 "$TMP/oversized"
dd if=/dev/zero of="$TMP/oversized/large.sh" bs=1048577 count=1 2>/dev/null
chmod 0700 "$TMP/oversized/large.sh"
if HOME="$TMP/home" INSTALL_DOCTOR_AGENT_TASK_DIR="$TMP/oversized" INSTALL_DOCTOR_AGENT_TASKS_CONSENT=1 \
  INSTALL_DOCTOR_AGENT_TASKS_DIGEST="$(printf 0%.0s {1..64})" \
  bash -c 'source "$1"; idVerifyConfiguredAgentTaskManifest' _ "$PROVISION"; then
  fail 'oversized configured-agent task passed verification'
else
  pass 'configured-agent task bytes are bounded before hashing or execution'
fi

if HEADLESS_INSTALL=true bash -c 'source "$1"; detect_os() { printf "macos\n"; }; idRunEngineOperation macos-full-disk-access-check; [ "$?" -eq 20 ]' _ "$PROVISION"; then
  pass 'headless macOS full-disk-access task is explicitly inapplicable'
else
  fail 'headless macOS full-disk-access task did not report inapplicable'
fi

if bash -c 'source "$1"; detect_os() { printf "macos\n"; }; plutil() { return 1; }; idRunEngineOperation macos-full-disk-access-verify; [ "$?" -eq 30 ]' _ "$PROVISION"; then
  pass 'ungranted interactive full-disk access remains pending verification'
else
  fail 'ungranted interactive full-disk access did not remain pending'
fi

printf 'typed-post-approval-tasks: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
