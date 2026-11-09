#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="$ROOT/.github/workflows/desktop-tools-release-production.yml"
ACTIVATE="$ROOT/.github/workflows/desktop-tools-release-activate.yml"
POLICY="$ROOT/config/infisical/bootstrap-release-identities.json"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sed -n '/^  sign:/,/^  publish:/p' "$RELEASE" >"$tmp/sign"
sed -n '/^  publish:/,$p' "$RELEASE" >"$tmp/publish"
sed -n '/^  activate:/,$p' "$ACTIVATE" >"$tmp/activate"

grep -q '^  workflow_dispatch:' "$RELEASE"
grep -q '^permissions: {}' "$RELEASE"
grep -q "github.ref == 'refs/heads/master'" "$RELEASE"
grep -q 'debian-bookworm-tree-trust-policy.json' "$RELEASE"
grep -q 'config/desktop-tools-opencode.lock.json' "$RELEASE"
grep -q 'sha256sum --check --strict' "$RELEASE"
grep -q 'NODE_RELEASE_KEYS_COMMIT: 481637f813e912c4aa3622d7964ab426c97b8e8d' "$RELEASE"
grep -q 'gpgv --keyring' "$RELEASE"
grep -q 'packages/desktop-tools-runtime/dist/desktop-tools-supervisor.mjs' "$RELEASE"
grep -q '.products\["desktop-tools"\].signers\[\$id\]' "$RELEASE"
grep -q 'environment: desktop-tools-release-sign' "$tmp/sign"
grep -q 'SIGNER_SCRIPT_SHA256.*sha256sum --check --strict' "$tmp/sign"
expected_signer_sha256="$(awk '/^[[:space:]]*SIGNER_SCRIPT_SHA256:/ { print $2; exit }' "$RELEASE")"
actual_signer_sha256="$(shasum -a 256 scripts/sign-desktop-tools-release.sh | awk '{ print $1 }')"
test "$expected_signer_sha256" = "$actual_signer_sha256"
grep -q 'secret-name: DESKTOP_TOOLS_RELEASE_SIGNING_KEY' "$tmp/sign"
grep -q 'include-imports: false' "$tmp/sign"
grep -q 'recursive: false' "$tmp/sign"
! grep -Eq 'actions/checkout@|actions/setup-node@|(^|[[:space:]])(npm|git|node)[[:space:]]' "$tmp/sign"
grep -q 'environment: desktop-tools-release-publish' "$tmp/publish"
! grep -Eq 'DESKTOP_TOOLS_RELEASE_SIGNING_KEY|DESKTOP_TOOLS_CHANNEL_R2_|desktop-activate' "$tmp/publish"
grep -q '^  workflow_dispatch:' "$ACTIVATE"
grep -q 'environment: desktop-tools-release-activate' "$tmp/activate"
grep -q 'desktop-activate' "$tmp/activate"
grep -q 'desktop-reconcile' "$tmp/activate"
! grep -Eq 'actions/checkout@|DESKTOP_TOOLS_RELEASE_SIGNING_KEY|desktop-publish' "$tmp/activate"
! grep -q 'DESKTOP_TOOLS_RELEASE_SIGNING_KEY' "$tmp/publish" "$tmp/activate"
! grep -q 'secrets\.' "$RELEASE" "$ACTIVATE"
jq -e '
  ([.workloads[] | select(.id | startswith("github-desktop-tools-release-"))] | length) == 3 and
  all(.workloads[] | select(.id | startswith("github-desktop-tools-release-"));
    .auth.claims.event_name == "workflow_dispatch" and .authorization.inheritedGrants == [])
' "$POLICY" >/dev/null
printf 'desktop-tools-release-workflow: PASS\n'
