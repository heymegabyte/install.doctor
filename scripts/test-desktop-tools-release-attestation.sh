#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/desktop-tools-release-production.yml"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
sed -n '/^  attest:/,/^  publish:/p' "$WORKFLOW" >"$TMP/attest"
sed -n '/^  publish:/,$p' "$WORKFLOW" >"$TMP/publish"
PASS=0; FAIL=0
check() { local label="$1"; shift; if "$@"; then PASS=$((PASS+1)); echo "PASS $label"; else FAIL=$((FAIL+1)); echo "FAIL $label"; fi; }
check 'attestor depends on build and sign' grep -Fq 'needs: [build, sign]' "$TMP/attest"
check 'attestor has OIDC and attestation authority' grep -Fq 'attestations: write' "$TMP/attest"
check 'attestor binds exact subject checksums' grep -Fq 'subject-checksums: subject-checksums.sha256' "$TMP/attest"
check 'attestor action is immutable-SHA pinned' grep -Eq 'uses: actions/attest@[a-f0-9]{40}' "$TMP/attest"
check 'attestor has no secret or publication authority' bash -c '! grep -Eq "Infisical|publish-release-to-r2|RELEASE_SIGNING_KEY" "$1"' _ "$TMP/attest"
check 'publisher depends on attestation' grep -Fq 'needs: [build, sign, attest]' "$TMP/publish"
check 'publisher compares the complete subject set' grep -Fq 'cmp actual-subjects.sha256 attestation-evidence/subject-checksums.sha256' "$TMP/publish"
for binding in \
  '--repo heymegabyte/install.doctor' \
  '--signer-workflow heymegabyte/install.doctor/.github/workflows/desktop-tools-release-production.yml' \
  '--signer-digest "$GITHUB_SHA"' \
  '--source-digest "$GITHUB_SHA"' \
  '--source-ref refs/heads/master' \
  '--cert-oidc-issuer https://token.actions.githubusercontent.com' \
  '--deny-self-hosted-runners'; do
  check "publisher enforces $binding" grep -Fq -- "$binding" "$TMP/publish"
done
admission_line="$(grep -n 'Admit only exact hosted-build provenance' "$WORKFLOW" | cut -d: -f1)"
secret_line="$(grep -n 'Infisical/secrets-action' "$WORKFLOW" | tail -1 | cut -d: -f1)"
check 'provenance rejection occurs before publisher secret resolution' test "$admission_line" -lt "$secret_line"
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
