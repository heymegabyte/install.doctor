#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/offline-bundle-authority.yml"
MODULE="$ROOT/packages/control-plane/scripts/offline-bundle-publication.mjs"
CLI="$ROOT/packages/control-plane/scripts/publish-offline-bundle.mjs"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
test -f "$WORKFLOW" && test -f "$MODULE" && test -f "$CLI" || fail 'authority files missing'
grep -Fq 'environment: offline-bundle-authority' "$WORKFLOW" || fail 'protected environment missing'
grep -Fq 'id-token: write' "$WORKFLOW" || fail 'OIDC permission missing'
grep -Fq 'include-imports: false' "$WORKFLOW" || fail 'Infisical imports not disabled'
grep -Fq 'recursive: false' "$WORKFLOW" || fail 'Infisical recursive secret export not disabled'
grep -Fq 'GITHUB_WORKFLOW_SHA: ${{ github.workflow_sha }}' "$WORKFLOW" || fail 'immutable workflow revision not bound'
grep -Fq "ref: \${{ github.workflow_sha }}" "$WORKFLOW" || fail 'authority tools are not checked out at the reviewed workflow revision'
test "$(grep -Fc "test \"\$(jq -r .path <<<\"\$run\")\" = '.github/workflows/offline-bundle-request.yml'" "$WORKFLOW")" -eq 2 \
  || fail 'both boundary jobs must bind the exact producer workflow path'
test "$(grep -Fc 'test "$(jq -r .head_sha <<<"$run")" = "$GITHUB_WORKFLOW_SHA"' "$WORKFLOW")" -eq 2 \
  || fail 'both boundary jobs must bind the producer to the immutable authority revision'
grep -Fq 'IfNoneMatch' "$ROOT/packages/control-plane/scripts/r2-publication-storage.mjs" || fail 'storage lacks create-if-absent'
grep -Fq "offline-bundles/sha256/" "$MODULE" || fail 'bundle is not content addressed'
grep -Fq "install.doctor.offline-publication-receipt" "$MODULE" || fail 'publication receipt is not namespace-signed'
grep -Fq "install.doctor.offline-signer-delegation" "$CLI" || fail 'delegation verification namespace drifted'
grep -Fq "install.doctor.offline-request-authority-delegation" "$CLI" || fail 'request authority is not trusted through a distinct release-root delegation'
grep -Fq "install.doctor.offline-request-authority" "$CLI" || fail 'independent reconstruction authority is not verified'
! grep -Eq "verifyReleaseRootSignature\(authority,.*offline-request-authority'" "$CLI" \
  || fail 'release root must not sign per-host request-authority attestations'
grep -Fq 'request nonce was already consumed' "$MODULE" || fail 'nonce replay is not rejected'
! grep -Eq 'upload-artifact.*publication-result|path: publication-result' "$WORKFLOW" || fail 'private publication result must not become a CI artifact'
sign_line="$(grep -n 'name: Sign and privately publish' "$WORKFLOW" | cut -d: -f1)"
tail -n "+$sign_line" "$WORKFLOW" | grep -Fq 'actions/checkout' && fail 'protected authority must have no checkout'
node --test "$ROOT/packages/control-plane/test/offline-bundle-publication.test.mjs"
printf 'offline-bundle-authority-workflow: PASS\n'
