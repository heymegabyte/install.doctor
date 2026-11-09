#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
function_source="$(awk '/^idSealBrokerApprovalDelegation\(\)/ {copy=1} copy {print} copy && /^}/ {exit}' "$PROVISION")"
stage_source="$(awk '/^idStageNativeBrokerAuthority\(\)/ {copy=1} copy {print} copy && /^}/ {exit}' "$PROVISION")"
handoff_source="$(sed -n '/function ensureInstallUser()/,/^}/p' "$PROVISION")"

if grep -Fq 'idSealBrokerApprovalDelegation || return $?' <<< "$stage_source"; then
  pass 'native broker staging seals release delegation before constructing root authority'
else
  fail 'native broker staging can proceed without sealed release delegation'
fi

for binding in \
  "manifest.get('schema_version')!=='9'" \
  "manifest.get('release_id')!==releaseId" \
  "manifest.get('broker_approval_delegation_sha256')!==expectedSha" \
  "manifest.get('broker_approval_minimum_revocation_epoch')!==minimumEpochText" \
  "delegation.releaseId!==releaseId" \
  "delegation.channel!=='stable'" \
  "delegation.revocationEpoch<minimumEpoch" \
  "before>created||after<expires" \
  "publicKey.asymmetricKeyType!=='ed25519'" \
  "delegationDigest!==semanticDigest"; do
  if grep -Fq "$binding" <<< "$function_source"; then pass "root delegation seal enforces $binding"
  else fail "root delegation seal omits $binding"; fi
done

if grep -Fq "fs.constants.O_NOFOLLOW" <<< "$function_source" \
  && grep -Fq "before.nlink!==1n" <<< "$function_source" \
  && grep -Fq "opened.dev!==before.dev||opened.ino!==before.ino" <<< "$function_source"; then
  pass 'root delegation seal rejects links and source replacement races'
else
  fail 'root delegation seal reads caller paths without safe-file identity checks'
fi

if grep -Fq "'/run/desktop-tools/authority'" <<< "$function_source" \
  && grep -Fq "metadata.uid!==0" <<< "$function_source" \
  && grep -Fq "install('broker-approval-signer-delegation.json',delegationBytes,0o400)" <<< "$function_source" \
  && grep -Fq "install('broker-approval-authority.json',evidenceBytes,0o400)" <<< "$function_source"; then
  pass 'delegation and release-binding evidence are atomically sealed under root authority'
else
  fail 'delegation is not sealed with root-owned immutable evidence'
fi

if grep -Fq "DESKTOP_TOOLS_BROKER_APPROVAL_DELEGATION_PATH" <<< "$function_source" \
  && grep -Fq "DESKTOP_TOOLS_BROKER_APPROVAL_DELEGATION_SHA256" <<< "$function_source" \
  && grep -Fq "DESKTOP_TOOLS_BROKER_APPROVAL_MINIMUM_REVOCATION_EPOCH" <<< "$function_source"; then
  pass 'root seal consumes only the verified bootstrap delegation bindings'
else
  fail 'root seal does not consume the exact verified bootstrap bindings'
fi

if grep -Eq 'BROKER_APPROVAL_(DELEGATION_PATH|DELEGATION_SHA256|MINIMUM_REVOCATION_EPOCH)' <<< "$handoff_source"; then
  fail 'caller/bootstrap delegation paths or policy cross into the enrolled-user environment'
else
  pass 'caller/bootstrap delegation authority never crosses the root-to-user environment allowlist'
fi

if grep -Eq 'PUBLIC_KEY|KEY_ID' <<< "$(sed -n '/^idSealBrokerApprovalDelegation()/,/^}/p' "$PROVISION" | grep 'DESKTOP_TOOLS_BROKER_APPROVAL' || true)"; then
  fail 'root seal accepts caller-controlled approval signer trust material'
else
  pass 'root seal accepts no caller-controlled approval signer key or key identifier'
fi

printf 'broker-approval-delegation-handoff: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
