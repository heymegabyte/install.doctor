#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDITOR="$ROOT/scripts/audit-desktop-tools-production-readiness.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/ready.json" <<'JSON'
{"schemaVersion":1,"signerIds":["desktop-production-1"],"variableNames":["DESKTOP_TOOLS_RELEASE_SIGNER_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_ACTIVATOR_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_MONITOR_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_PUBLISHER_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_SIGNER_ID","INFISICAL_PROJECT_SLUG"],"environmentNames":["desktop-tools-release-activate","desktop-tools-release-monitor","desktop-tools-release-publish","desktop-tools-release-sign"],"commandErrors":[],"dns":{"apex":["192.0.2.1"],"profile":["192.0.2.2"]},"http":{"profile":{"reachable":true,"status":200,"shellLauncher":true},"unknown":{"reachable":true,"status":404,"shellLauncher":false}}}
JSON
node "$AUDITOR" --evidence "$TMP/ready.json" >"$TMP/ready.out"
jq -e '.ready == true and all(.checks[]; .status == "PASS")' "$TMP/ready.out" >/dev/null

jq '.signerIds=[] | .variableNames=[] | .environmentNames=[] | .commandErrors=["gh exited 1"] | .dns={apex:[],profile:[]} | .http.profile={reachable:false,status:0,shellLauncher:false} | .http.unknown={reachable:false,status:0,shellLauncher:false}' "$TMP/ready.json" >"$TMP/blocked.json"
if node "$AUDITOR" --evidence "$TMP/blocked.json" >"$TMP/blocked.out"; then
  printf '%s\n' 'readiness auditor accepted an unconfigured production boundary' >&2
  exit 1
else
  test "$?" -eq 2
fi
jq -e '.ready == false and ([.checks[] | select(.status == "BLOCKED")] | length) == 8' "$TMP/blocked.out" >/dev/null
! grep -Eiq '(token|secret)[=:][^ ]+' "$TMP/ready.out" "$TMP/blocked.out"
printf '%s\n' 'desktop-tools-production-readiness: 4 passed, 0 failed'
