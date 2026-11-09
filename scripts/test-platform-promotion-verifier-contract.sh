#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/platform-promotion-verifier.yml"
VERIFIER="$ROOT/scripts/promote-platform-canary-receipt.mjs"
VALIDATOR="$ROOT/scripts/validate-platform-support-matrix.mjs"
P=0 F=0
pass(){ printf 'PASS %s\n' "$*"; P=$((P+1)); }
fail(){ printf 'FAIL %s\n' "$*" >&2; F=$((F+1)); }

grep -Fq 'permissions: {}' "$WORKFLOW" && pass 'workflow defaults to no permissions' || fail 'workflow has ambient permissions'
grep -Fq 'secret-path: /ci/offline-bundle/promotion-read' "$WORKFLOW" && grep -Fq 'recursive: false' "$WORKFLOW" \
  && pass 'private evidence uses a dedicated nonrecursive read identity' || fail 'private evidence identity is not least privilege'
grep -Fq 'promotion-inputs/sha256/' "$WORKFLOW" && grep -Fq 'sha256sum promotion-input.json' "$WORKFLOW" \
  && pass 'private object is immutable and content addressed' || fail 'private evidence can be fetched by mutable identity'
grep -Fq "verifyIndependentPromotionEvidence" "$VERIFIER" && grep -Fq "ssh-keygen" "$VERIFIER" \
  && grep -Fq "gh', ['attestation', 'verify'" "$VERIFIER" \
  && pass 'adapter delegates all cryptographic authorities to real verifiers' || fail 'adapter contains an unverified promotion path'
grep -Fq "schemaVersion: 3" "$VERIFIER" && grep -Fq "self-authored canary receipts cannot promote support" "$VALIDATOR" \
  && pass 'matrix consumes only independently promoted receipts' || fail 'raw finalizer receipt remains promotable'
grep -Fq 'canary=canary/receipt.json' "$WORKFLOW" && grep -Fq 'maxdepth 1' "$WORKFLOW" \
  && ! grep -Fq 'find canary -type f -name receipt.json -print -quit' "$WORKFLOW" \
  && pass 'promotion selects one exact top-level receipt' || fail 'promotion receipt selection is ambiguous'
grep -Fq "JSON.stringify(canary.value.tuple) !== JSON.stringify(expectedTuple)" "$VERIFIER" \
  && pass 'promotion binds the complete canonical platform tuple' || fail 'promotion does not bind the complete platform tuple'
if grep -Eq 'offline_bundle_url|offline_bundle_sha256|curl .*(promotion|evidence)' "$WORKFLOW"; then
  fail 'promotion trusts a caller URL or digest pair'
else pass 'promotion has no caller URL plus SHA authority'; fi

printf 'platform-promotion-verifier-contract: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
