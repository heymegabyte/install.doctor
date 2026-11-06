#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/bootstrap-install-acceptance.yml"
ACCEPTANCE="$ROOT/scripts/test-bootstrap-macos-lifecycle-acceptance.sh"

fail() { printf 'bootstrap-macos-lifecycle-contract: FAIL: %s\n' "$*" >&2; exit 1; }

[ -f "$WORKFLOW" ] || fail 'signed bootstrap workflow is missing'
[ -f "$ACCEPTANCE" ] || fail 'native macOS lifecycle acceptance is missing'
[ -x "$ACCEPTANCE" ] || fail 'native macOS lifecycle acceptance must be executable'

node - "$WORKFLOW" "$ACCEPTANCE" <<'NODE'
const fs = require('node:fs');

const [workflowPath, acceptancePath] = process.argv.slice(2);
const workflow = fs.readFileSync(workflowPath, 'utf8');
const acceptance = fs.readFileSync(acceptancePath, 'utf8');
const failures = [];
const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) failures.push(message);
};

const nativeJob = workflow.match(/^  macos-signed-lifecycle:\n[\s\S]*$/m)?.[0] ?? '';
requireMatch(nativeJob, /^  macos-signed-lifecycle:\n[\s\S]*?^    runs-on: \$\{\{ matrix\.runner \}\}$/m,
  'workflow must have a tuple-bound native macOS signed lifecycle job');
requireMatch(nativeJob, /include:\s*\n\s*- architecture: arm64\s*\n\s*runner: macos-15\s*\n\s*- architecture: x64\s*\n\s*runner: macos-15-intel/,
  'workflow must prove lifecycle semantics on both native macOS 15 architectures');
requireMatch(nativeJob, /uses: actions\/setup-node@[a-f0-9]{40}[\s\S]*?node-version: 24\.22\.2/,
  'workflow must install the pinned supported Node runtime');
requireMatch(nativeJob, /timeout-minutes: 20/, 'native lifecycle job must have a bounded timeout');
requireMatch(nativeJob, /name: Verify native macOS signed lifecycle fixture \(not platform promotion or canonical \/start transport proof\)[\s\S]*?bash scripts\/test-bootstrap-macos-lifecycle-contract\.sh[\s\S]*?INSTALL_DOCTOR_RUN_NATIVE_MACOS_LIFECYCLE=1 bash scripts\/test-bootstrap-macos-lifecycle-acceptance\.sh/,
  'workflow must run the contract before the native lifecycle acceptance and state its evidence limits');
requireMatch(nativeJob, /npm --prefix packages\/aid-core ci --ignore-scripts --no-audit --no-fund[\s\S]*?npm --prefix packages\/control-plane ci --ignore-scripts --no-audit --no-fund[\s\S]*?npm --prefix packages\/installer-engine ci --ignore-scripts --no-audit --no-fund/,
  'native job must install every locked release-build dependency');
if (/continue-on-error:\s*true/.test(nativeJob)) failures.push('native lifecycle job must remain blocking');

requireMatch(acceptance, /\[ "\$\(uname -s\)" = Darwin \]/,
  'acceptance must reject non-Darwin execution rather than silently skip');
requireMatch(acceptance, /\[ "\$\{INSTALL_DOCTOR_RUN_NATIVE_MACOS_LIFECYCLE:-0\}" = 1 \]/,
  'acceptance must run only when its dedicated blocking workflow opts in');
requireMatch(acceptance, /OBSERVED_MACOS_VERSION="\$\(sw_vers -productVersion\)"[\s\S]*?\[ "\$OBSERVED_MACOS_MAJOR" = "\$EXPECTED_MACOS_MAJOR" \]/,
  'acceptance must bind the fixture to the expected observed macOS major');
requireMatch(acceptance, /ssh-keygen -Y verify[\s\S]*?-n install\.doctor\.release[\s\S]*?< "\$RELEASE\/manifest"/,
  'acceptance must independently verify the exact manifest SSHSIG');
for (const payload of ['provision.sh', 'install-doctor-engine.mjs', 'catalog.json', 'start']) {
  if (!acceptance.includes(payload)) failures.push(`acceptance does not explicitly cover signed payload ${payload}`);
}
requireMatch(acceptance, /for PLATFORM in macos-x64 macos-arm64 linux-x64 linux-arm64; do[\s\S]*?verify_payload "runtime_\$\{PLATFORM\/\/-\/_\}" "node-\$PLATFORM\.tar\.gz"/,
  'acceptance must independently verify all four signed runtime payloads');
requireMatch(acceptance, /declared_sha="\$\(manifest_value[\s\S]*?\[ "\$declared_sha" = "\$\(sha256_file "\$path"\)" \][\s\S]*?\[ "\$declared_size" = "\$\(file_size "\$path"\)" \]/,
  'acceptance must independently verify every declared payload digest and size');
requireMatch(acceptance, /run_provision\(\) \{ bash "\$INSTALL_DOCTOR_RELEASE_DIR\/provision\.sh"/,
  'lifecycle must invoke the exact independently verified released provisioner directly');
requireMatch(acceptance, /INSTALL_DOCTOR_VERIFIED_MANIFEST="\$RELEASE\/manifest"[\s\S]*?INSTALL_DOCTOR_VERIFIED_SIGNATURE="\$RELEASE\/manifest\.sig"[\s\S]*?INSTALL_DOCTOR_ARTIFACT_SHA256="\$ARTIFACT_SHA"/,
  'direct provisioner invocation must carry the verified release authority');
requireMatch(acceptance, /HOME="\$FIXTURE\/canary-home"[\s\S]*?XDG_CONFIG_HOME="\$FIXTURE\/canary-home\/\.config"[\s\S]*?XDG_STATE_HOME="\$FIXTURE\/canary-home\/\.local\/state"[\s\S]*?XDG_DATA_HOME="\$FIXTURE\/canary-home\/\.local\/share"/,
  'native lifecycle must isolate HOME and every persistent XDG authority from the runner account');
requireMatch(acceptance, /evidence_scope=native-macos-signed-fixture-lifecycle/,
  'acceptance must identify the bounded evidence scope');
requireMatch(acceptance, /platform_promotion=0/, 'acceptance must disclaim platform promotion');
requireMatch(acceptance, /canonical_start_transport=0/, 'acceptance must disclaim canonical /start transport proof');
requireMatch(acceptance, /interrupted_run_resumed=1/, 'acceptance must prove interrupted-run resume');
requireMatch(acceptance, /rollback_config_committed=1/, 'acceptance must prove committed configuration rollback');
requireMatch(acceptance, /unchanged_mutations=0/, 'acceptance must prove unchanged reapplication');

if (/curl[^\n]*https:\/\/(?:app\.)?install\.doctor\/start/.test(acceptance)) {
  failures.push('fixture acceptance must not imply canonical /start transport coverage');
}
if (/bash[^\n]*start\.sh/.test(acceptance) || /run_start(?:_approved)?\s*\(/.test(acceptance)) {
  failures.push('native lifecycle must not execute the rendered stage-zero launcher');
}
if (/platform-support-matrix|status:\s*verified|canary-receipt/.test(acceptance)) {
  failures.push('fixture acceptance must not mint or mutate platform-promotion evidence');
}

if (failures.length > 0) {
  console.error('bootstrap macOS lifecycle contract rejected:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
NODE

printf 'bootstrap-macos-lifecycle-contract: PASS\n'
