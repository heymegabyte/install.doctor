#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/control-plane-production.yml"
POLICY="$ROOT/config/infisical/bootstrap-release-identities.json"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$*"; }

test -f "$WORKFLOW" || fail "control-plane production workflow missing"
grep -Fq 'workflow_dispatch:' "$WORKFLOW" || fail "deployment is not manual"
! grep -Eq '^  (push|pull_request|schedule):' "$WORKFLOW" || fail "deployment has an automatic trigger"
grep -Fq "if: github.ref == 'refs/heads/master'" "$WORKFLOW" || fail "master guard missing"
grep -Fq 'environment: control-plane-production' "$WORKFLOW" || fail "protected environment missing"
grep -Fq 'permissions: {}' "$WORKFLOW" || fail "global permissions are not empty"
grep -Fq 'contents: read' "$WORKFLOW" && grep -Fq 'id-token: write' "$WORKFLOW" || fail "job permissions incomplete"
grep -Fq 'ref: ${{ github.workflow_sha }}' "$WORKFLOW" || fail "checkout is not source pinned"
grep -Fq 'persist-credentials: false' "$WORKFLOW" || fail "checkout credentials persist"
grep -Fq 'npm --prefix packages/control-plane test' "$WORKFLOW" || fail "tested deploy subject missing"
grep -Fq 'secret-path: /ci/control-plane/deployer' "$WORKFLOW" || fail "exact Infisical leaf missing"
grep -Fq 'include-imports: false' "$WORKFLOW" && grep -Fq 'recursive: false' "$WORKFLOW" || fail "secret expansion is broad"
! grep -Fq 'secrets.' "$WORKFLOW" || fail "GitHub Actions secret dependency found"
! grep -Eq 'wrangler secret put|d1 migrations apply|npx wrangler|--env production' "$WORKFLOW" || fail "workflow has forbidden deploy authority"
grep -Fq './node_modules/.bin/wrangler deploy --strict --keep-vars' "$WORKFLOW" || fail "lockfile Wrangler strict deploy missing"
grep -Fq 'deployments-before.json' "$WORKFLOW" && grep -Fq 'previousVersionId' "$WORKFLOW" || fail "rollback receipt missing"
grep -Fq '"hosts":["app.install.doctor"]' "$WORKFLOW" && grep -Fq 'jq -r .success' "$WORKFLOW" || fail "scoped purge proof missing"
grep -Fq 'CLOUDFLARE_API_TOKEN=\n' "$WORKFLOW" || fail "credentials are not cleared"
grep -Fq 'release_channel_unavailable' "$WORKFLOW" && grep -Fq 'release_trust_not_configured' "$WORKFLOW" || fail "exact fail-closed states missing"
grep -Fq 'raw\.githubusercontent\.com' "$WORKFLOW" || fail "mutable launcher denial missing"
if grep -E 'uses: [^ ]+@(main|master|v[0-9]+([[:space:]#]|$))' "$WORKFLOW"; then fail "moving action reference found"; fi

jq -e '
  .workloads | map(select(.id == "github-control-plane-deployer")) | length == 1 and
  .[0].auth.claims.environment == "control-plane-production" and
  .[0].auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/control-plane-production.yml@refs/heads/master" and
  .[0].authorization.path == "/ci/control-plane/deployer" and
  .[0].authorization.secretNames == ["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN","CLOUDFLARE_ZONE_ID"] and
  .[0].authorization.inheritedGrants == []
' "$POLICY" >/dev/null || fail "dedicated deploy identity boundary invalid"
pass "manual source-pinned least-privilege production deployment contract"
