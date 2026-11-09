#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/provision.sh
source "$ROOT/scripts/provision.sh"

PASS=0
FAIL=0
pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

run_offline_lifecycle() (
  set -e
  export INSTALL_DOCTOR_OFFLINE=true
  LEDGER="${TMPDIR:-/tmp}/desktop-tools-offline-ledger.$$"
  : > "$LEDGER"
  record() { printf '%s\n' "$1" >> "$LEDGER"; }
  idRequireRootInstallUserEnrollment() { record enrollment; }
  idProvisionEvidenceInit() { record evidence; }
  idEmitProvisionStatus() { record "status:$2"; }
  idProvisionExit() { :; }
  setEnvironmentVariables() { record environment; }
  setCIEnvironmentVariables() { record ci; }
  applyEnvClassDefaults() { record defaults; }
  idResolvePlatform() { record platform; }
  ensureProvisionerNodeRuntime() { record runtime; }
  runOfflineBundleProvisioning() { record offline; }
  forbidden() { record "FORBIDDEN:$1"; return 91; }
  collectInputsUpfront() { forbidden inputs; }
  idReconcileStaleSudoOwnership() { forbidden sudo-reconcile; }
  configureInstallPlan() { forbidden plan; }
  idAuthorizePlatform() { forbidden authorize-online; }
  ensureInstallUser() { forbidden handoff; }
  runCanonicalProvisionEngine() { forbidden ordinary-engine; }
  postProvision() { forbidden post-provision; }
  provisionLogic
  if grep -q '^FORBIDDEN:' "$LEDGER"; then cat "$LEDGER" >&2; rm -f "$LEDGER"; exit 1; fi
  EXPECTED='enrollment evidence status:started environment ci defaults platform runtime offline status:success'
  ACTUAL="$(tr '\n' ' ' < "$LEDGER" | sed 's/ $//')"
  rm -f "$LEDGER"
  [ "$ACTUAL" = "$EXPECTED" ]
)

if run_offline_lifecycle; then pass 'offline mode bypasses input, sudo, online planning, handoff, agents, and post-provision work'
else fail 'offline lifecycle reached forbidden ordinary provisioning work'; fi

if ( INSTALL_DOCTOR_OFFLINE=yes; idNormalizeOfflineMode >/dev/null 2>&1 ); then
  fail 'malformed offline selector was accepted'
else
  pass 'malformed offline selector fails closed'
fi

ORDER="$(awk '
  /idRunRequiredProvisionStep "Validating offline execution selection"/ { normalize=NR }
  /if \[ "\$INSTALL_DOCTOR_OFFLINE" = true \]/ { branch=NR }
  /idRunRequiredProvisionStep "Collecting required inputs up front"/ { inputs=NR }
  /idRunRequiredProvisionStep "Reconciling stale sudo acquisition ownership"/ { sudo=NR }
  /idRunRequiredProvisionStep "Resolving the install plan before mutation"/ { plan=NR }
  END { if (normalize && branch > normalize && inputs > branch && sudo > branch && plan > branch) print "safe" }
' "$ROOT/scripts/provision.sh")"
if [ "$ORDER" = safe ]; then pass 'offline branch structurally precedes input, sudo, and ordinary planning'
else fail 'offline branch ordering is unsafe'; fi

if grep -A8 'runOfflineBundleProvisioning()' "$ROOT/scripts/provision.sh" | grep -Eq 'curl|wget|git|ssh|opencode|infisical'; then
  fail 'offline dispatcher directly references a network or agent client'
else
  pass 'offline dispatcher has no direct network, secret-service, or agent client dependency'
fi

for variable in INSTALL_DOCTOR_OFFLINE_BUNDLE_DIR INSTALL_DOCTOR_OFFLINE_AUTHORITY_PATH \
  INSTALL_DOCTOR_OFFLINE_MODE INSTALL_DOCTOR_OFFLINE_RUN_ID INSTALL_DOCTOR_RENDERER; do
  if awk '/for HANDOFF_VARIABLE in/,/WORK_ENVIRONMENT; do/' "$ROOT/scripts/provision.sh" | grep -qw "$variable"; then
    pass "root handoff preserves $variable"
  else
    fail "root handoff drops $variable"
  fi
done

run_dispatch_contract() (
  set -e
  FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/desktop-tools-offline-contract.XXXXXX")"
  trap 'rm -rf -- "$FIXTURE"' EXIT
  mkdir -p "$FIXTURE/bundle" "$FIXTURE/home" "$FIXTURE/state"
  DIGEST='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  PLAN_DIGEST='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  cat > "$FIXTURE/authority.json" <<JSON
{"trust":{"keyId":"bundle","publicKey":"ssh-ed25519 AAAA"},"releaseTrust":{"keyId":"release","publicKey":"ssh-ed25519 AAAA"},"expected":{"releaseId":"r1","planDigest":"$PLAN_DIGEST","platform":{"os":"linux","arch":"x64","environment":"native"},"selectedTaskIds":["task"],"artifactIds":["artifact"]},"approvedManifestDigest":"$DIGEST","approvedPlanDigest":"$PLAN_DIGEST"}
JSON
  chmod 0600 "$FIXTURE/authority.json"
  cat > "$FIXTURE/fake-engine.mjs" <<'NODE'
import fs from 'node:fs';
const forbidden = [
  'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'INFISICAL_TOKEN', 'LITELLM_API_KEY',
  'OPENAI_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
];
const leaked = forbidden.filter(name => Object.hasOwn(process.env, name));
if (leaked.length > 0) throw new Error(`offline engine inherited forbidden ambient authority: ${leaked.join(',')}`);
const input=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--input')+1],'utf8'));
fs.appendFileSync(process.env.HOME+'/calls',`${JSON.stringify(input)}\n`);
if(input.command==='bundle-plan') process.stdout.write(JSON.stringify({manifestDigest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',manifest:{planDigest:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}}));
if(input.command==='bundle-apply') fs.mkdirSync(input.destinationDirectory,{recursive:false});
NODE
  chmod 0700 "$FIXTURE/fake-engine.mjs"
  export HOME="$FIXTURE/home" XDG_STATE_HOME="$FIXTURE/state"
  export INSTALL_DOCTOR_ENGINE_PATH="$FIXTURE/fake-engine.mjs"
  export INSTALL_DOCTOR_ENGINE_SHA256="$(idSha256File "$FIXTURE/fake-engine.mjs")"
  export INSTALL_DOCTOR_RUNTIME_NODE="$(node -p 'process.execPath')"
  export INSTALL_DOCTOR_OFFLINE_BUNDLE_DIR="$FIXTURE/bundle"
  export INSTALL_DOCTOR_OFFLINE_AUTHORITY_PATH="$FIXTURE/authority.json"
  export INSTALL_DOCTOR_OFFLINE_MODE=execute INSTALL_DOCTOR_OFFLINE_RUN_ID=offline-test INSTALL_DOCTOR_RENDERER=headless
  export ANTHROPIC_API_KEY=must-not-reach-offline-engine
  export DEEPSEEK_API_KEY=must-not-reach-offline-engine
  export INFISICAL_TOKEN=must-not-reach-offline-engine
  export LITELLM_API_KEY=must-not-reach-offline-engine
  export OPENAI_API_KEY=must-not-reach-offline-engine
  export HTTPS_PROXY=http://must-not-reach-offline-engine.invalid
  export HTTP_PROXY=http://must-not-reach-offline-engine.invalid
  export ALL_PROXY=socks5://must-not-reach-offline-engine.invalid
  export NO_PROXY=must-not-reach-offline-engine.invalid
  runOfflineBundleProvisioning >/dev/null || return $?
  node - "$FIXTURE/home/calls" <<'NODE'
const fs=require('node:fs'); const calls=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse);
const names=calls.map(x=>x.command).join(','); if(names!=='bundle-verify,bundle-plan,bundle-apply,bundle-execute') throw new Error(names);
const execute=calls.at(-1); if(execute.offline!==true||execute.networkPolicy!=='deny') throw new Error('network policy weakened');
if(execute.approvedManifestDigest!=='a'.repeat(64)||execute.approvedPlanDigest!=='b'.repeat(64)) throw new Error('approval digest changed');
NODE
)
if run_dispatch_contract; then pass 'offline dispatcher preserves exact approvals, strips provider authority, and keeps deny-network execution order'
else fail 'offline dispatcher contract was weakened'; fi

printf 'provision-offline-dispatch: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
