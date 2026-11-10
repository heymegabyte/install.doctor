#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDITOR="$ROOT/scripts/audit-desktop-tools-production-readiness.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/ready.json" <<'JSON'
{"schemaVersion":1,"signerIds":["desktop-production-1"],"configuredSignerId":"desktop-production-1","variableNames":["DESKTOP_TOOLS_RELEASE_SIGNER_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_ACTIVATOR_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_MONITOR_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_PUBLISHER_ID","INFISICAL_DESKTOP_TOOLS_RELEASE_SIGNER_ID","INFISICAL_PROJECT_SLUG"],"environmentNames":["desktop-tools-release-activate","desktop-tools-release-monitor","desktop-tools-release-publish","desktop-tools-release-sign"],"environmentPolicies":{"desktop-tools-release-activate":{"branchPolicy":true,"reviewerCount":1,"preventSelfReview":true},"desktop-tools-release-monitor":{"branchPolicy":true,"reviewerCount":0,"preventSelfReview":false},"desktop-tools-release-publish":{"branchPolicy":true,"reviewerCount":0,"preventSelfReview":false},"desktop-tools-release-sign":{"branchPolicy":true,"reviewerCount":1,"preventSelfReview":true}},"commandErrors":[],"dns":{"apex":["192.0.2.1"],"profile":["192.0.2.2"]},"http":{"profile":{"reachable":true,"status":200,"contentType":"text/x-shellscript; charset=utf-8","shellLauncher":true},"unknown":{"reachable":true,"status":404,"contentType":"application/json","shellLauncher":false}}}
JSON
node "$AUDITOR" --evidence "$TMP/ready.json" >"$TMP/ready.out"
jq -e '.ready == true and all(.checks[]; .status == "PASS")' "$TMP/ready.out" >/dev/null

jq '.signerIds=[] | .configuredSignerId="" | .variableNames=[] | .environmentNames=[] | .environmentPolicies={} | .commandErrors=["gh exited 1"] | .dns={apex:[],profile:[]} | .http.profile={reachable:false,status:0,shellLauncher:false} | .http.unknown={reachable:false,status:0,shellLauncher:false}' "$TMP/ready.json" >"$TMP/blocked.json"
if node "$AUDITOR" --evidence "$TMP/blocked.json" >"$TMP/blocked.out"; then
  printf '%s\n' 'readiness auditor accepted an unconfigured production boundary' >&2
  exit 1
else
  test "$?" -eq 2
fi
jq -e '.ready == false and ([.checks[] | select(.status == "BLOCKED")] | length) == 10' "$TMP/blocked.out" >/dev/null

jq '.configuredSignerId="desktop-untrusted"' "$TMP/ready.json" >"$TMP/untrusted.json"
if node "$AUDITOR" --evidence "$TMP/untrusted.json" >"$TMP/untrusted.out"; then exit 1; else test "$?" -eq 2; fi
jq -e '.checks[] | select(.id == "signer-variable-binding" and .status == "BLOCKED")' "$TMP/untrusted.out" >/dev/null

jq '.environmentPolicies["desktop-tools-release-sign"].preventSelfReview=false | .environmentPolicies["desktop-tools-release-monitor"].reviewerCount=1' "$TMP/ready.json" >"$TMP/unsafe-environments.json"
if node "$AUDITOR" --evidence "$TMP/unsafe-environments.json" >"$TMP/unsafe-environments.out"; then exit 1; else test "$?" -eq 2; fi
jq -e '.checks[] | select(.id == "environment-protections" and .status == "BLOCKED")' "$TMP/unsafe-environments.out" >/dev/null
! grep -Eiq '(token|secret)[=:][^ ]+' "$TMP/ready.out" "$TMP/blocked.out"
printf '%s\n' 'desktop-tools-production-readiness: 8 passed, 0 failed'
