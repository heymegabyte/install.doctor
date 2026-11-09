#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
source "$ROOT/scripts/provision.sh"
logg() { :; }

cat > "$TMP/engine.mjs" <<'NODE'
import fs from 'node:fs';
const path=process.argv[process.argv.indexOf('--input')+1];
const input=JSON.parse(fs.readFileSync(path,'utf8'));
const stdin=fs.readFileSync(0,'utf8');
if(stdin!=='')throw new Error('enrollment engine stdin was not detached');
fs.appendFileSync(process.env.TEST_LEDGER,`${input.command}\n`);
const mode=process.env.TEST_MODE;
if(input.command==='device-authorization-status'){
  if(mode==='approved')process.stdout.write(JSON.stringify({schemaVersion:1,status:'approved',requestId:'request-1',credentialId:'credential-1',profileId:'profile-1',targetKeyFingerprint:'a'.repeat(64),scopes:['profile:read'],expiresAt:'2099-01-01T00:00:00.000Z'}));
  else if(mode==='pending')process.stdout.write(JSON.stringify({schemaVersion:1,status:'pending',requestId:'request-1',verificationCode:'ABCD-EF12',approvalUri:'https://profile.desktop.tools/approve',expiresAt:'2099-01-01T00:00:00.000Z'}));
  else if(mode==='expired')process.stdout.write(JSON.stringify({schemaVersion:1,status:'expired',requestId:'request-1',credentialId:'credential-1',profileId:'profile-1',targetKeyFingerprint:'a'.repeat(64),scopes:['profile:read'],expiresAt:'2020-01-01T00:00:00.000Z'}));
  else process.stdout.write(JSON.stringify({schemaVersion:1,status:'absent'}));
}else if(input.command==='device-authorization-start'){
  if(input.origin!=='https://profile.desktop.tools'||input.profileId!=='profile-1'||input.scopes.join(',')!=='profile:read,run:authorize,status:write')throw new Error('start authority differs');
  process.stdout.write(JSON.stringify({schemaVersion:1,status:'pending',requestId:'request-1',verificationCode:'ABCD-EF12',approvalUri:'https://profile.desktop.tools/approve',expiresAt:input.expiresAt}));
}else if(input.command==='device-authorization-wait'){
  process.stdout.write(JSON.stringify({schemaVersion:1,status:'approved',requestId:'request-1',credentialId:'credential-1',expiresAt:'2099-01-01T00:00:00.000Z'}));
}else if(input.command==='profile-desired-state-sync'){
  if(input.origin!=='https://profile.desktop.tools'||input.expectedProfileId!=='profile-1'||input.machineId!=='zen'
    ||input.expectedProfileDigest!=='0'.repeat(64))throw new Error('desired-state authority differs');
  process.stdout.write(JSON.stringify({schemaVersion:1,profileId:'profile-1',profileDigest:'0'.repeat(64),revision:'revision-1',
    machineId:'zen',machineRole:'workstation',selectedPackages:['git','ripgrep'],selectedServices:['alloy'],
    environmentPath:input.environmentPath,unchanged:false}));
}else throw new Error('unexpected command');
NODE
chmod 0700 "$TMP/engine.mjs"

run_case() {
  local mode="$1" expected="$2" home ledger
  home="$TMP/$mode-home"; ledger="$TMP/$mode-ledger"
  mkdir -p "$home"
  TEST_MODE="$mode" TEST_LEDGER="$ledger" HOME="$home" XDG_STATE_HOME="$home/state" XDG_CONFIG_HOME="$home/config" \
    DESKTOP_TOOLS_PROFILE_ID=profile-1 DESKTOP_TOOLS_PROFILE_SLUG=profile \
    DESKTOP_TOOLS_PROFILE_DIGEST="$(printf '%064d' 0)" INSTALL_DOCTOR_ENGINE_PATH="$TMP/engine.mjs" \
    INSTALL_DOCTOR_RUNTIME_NODE="$(command -v node)" idEnsureDesktopToolsDeviceAuthorization > "$TMP/$mode-output"
  [ "$(paste -sd, "$ledger")" = "$expected" ]
}

run_case approved device-authorization-status
run_case pending device-authorization-status,device-authorization-wait
run_case absent device-authorization-status,device-authorization-start,device-authorization-wait

if TEST_MODE=expired TEST_LEDGER="$TMP/expired-ledger" HOME="$TMP/expired-home" XDG_STATE_HOME="$TMP/expired-home/state" XDG_CONFIG_HOME="$TMP/expired-home/config" \
  DESKTOP_TOOLS_PROFILE_ID=profile-1 DESKTOP_TOOLS_PROFILE_SLUG=profile DESKTOP_TOOLS_PROFILE_DIGEST="$(printf '%064d' 0)" \
  INSTALL_DOCTOR_ENGINE_PATH="$TMP/engine.mjs" INSTALL_DOCTOR_RUNTIME_NODE="$(command -v node)" \
  idEnsureDesktopToolsDeviceAuthorization > "$TMP/expired-output" 2>&1; then
  printf 'expired enrollment unexpectedly succeeded\n' >&2
  exit 1
fi

grep -q 'Matching code: ABCD-EF12' "$TMP/absent-output"
grep -q 'Matching code: ABCD-EF12' "$TMP/pending-output"
(
  export HOME="$TMP/sync-home" XDG_STATE_HOME="$TMP/sync-home/state" XDG_CONFIG_HOME="$TMP/sync-home/config"
  export DESKTOP_TOOLS_PROFILE_ID=profile-1 DESKTOP_TOOLS_PROFILE_SLUG=profile DESKTOP_TOOLS_PROFILE_DIGEST="$(printf '%064d' 0)"
  export DESKTOP_TOOLS_MACHINE_ID=zen INSTALL_DOCTOR_ENGINE_PATH="$TMP/engine.mjs" INSTALL_DOCTOR_RUNTIME_NODE="$(command -v node)"
  export TEST_LEDGER="$TMP/sync-ledger"
  idSyncDesktopToolsDesiredState
  [ "$INSTALL_DOCTOR_SELECTED_PACKAGES" = git,ripgrep ]
  [ "$INSTALL_DOCTOR_SELECTED_SERVICES" = alloy ]
  [ "$INSTALL_DOCTOR_ROLE" = workstation ]
  [ "$INSTALL_DOCTOR_ENVIRONMENT_PATH" = "$TMP/sync-home/config/desktop-tools/ENVIRONMENT.md" ]
)
printf 'desktop-tools-device-enrollment: pass\n'
