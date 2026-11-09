#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/control-plane-production.yml"
POLICY="$ROOT/config/infisical/bootstrap-release-identities.json"
WRANGLER="$ROOT/packages/control-plane/wrangler.toml"
DESKTOP_ROUTING="$ROOT/config/cloudflare/desktop-tools-routing.json"
BETTER_AUTH_MIGRATION="$ROOT/packages/control-plane/migrations/0018_better_auth_schema.sql"
CONTROL_PLANE_SOURCE="$ROOT/packages/control-plane/src/index.ts"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$*"; }

test -f "$WORKFLOW" || fail "control-plane production workflow missing"
grep -Fq 'pattern = "install.doctor/start", zone_name = "install.doctor"' "$WRANGLER" \
  || fail "canonical curl endpoint is not owned by the source-pinned Worker"
grep -Fq 'pattern = "desktop.tools", custom_domain = true' "$WRANGLER" \
  || fail "Desktop Tools apex is not an explicit custom domain"
grep -Fq 'pattern = "*.desktop.tools/*", zone_name = "desktop.tools"' "$WRANGLER" \
  || fail "Desktop Tools wildcard profile route is missing"
jq -e '
  .zone == "desktop.tools" and .activation == "manual-only" and .enrollmentEnabled == false and
  .dns == {"type":"AAAA","name":"*","content":"100::","proxied":true,"purpose":"Originless wildcard required before the Worker route can receive profile traffic"} and
  .tls.requiredHostnames == ["desktop.tools","*.desktop.tools"] and
  .worker.reservedHostsRemainExplicit == true
' "$DESKTOP_ROUTING" >/dev/null || fail "Desktop Tools DNS/TLS routing contract is unsafe or incomplete"
grep -Fq 'workflow_dispatch:' "$WORKFLOW" || fail "deployment is not manual"
! grep -Eq '^  (push|pull_request|schedule):' "$WORKFLOW" || fail "deployment has an automatic trigger"
grep -Fq "if: github.ref == 'refs/heads/master'" "$WORKFLOW" || fail "master guard missing"
grep -Fq 'environment: control-plane-production' "$WORKFLOW" || fail "protected environment missing"
grep -Fq 'permissions: {}' "$WORKFLOW" || fail "global permissions are not empty"
grep -Fq 'contents: read' "$WORKFLOW" && grep -Fq 'id-token: write' "$WORKFLOW" || fail "job permissions incomplete"
grep -Fq 'ref: ${{ github.workflow_sha }}' "$WORKFLOW" || fail "checkout is not source pinned"
grep -Fq 'persist-credentials: false' "$WORKFLOW" || fail "checkout credentials persist"
grep -Fq 'npm --prefix packages/control-plane test' "$WORKFLOW" || fail "tested deploy subject missing"
grep -Fq 'needs: migrate' "$WORKFLOW" || fail "deployment does not wait for schema migration"
grep -Fq 'secret-path: /ci/control-plane/migrator' "$WORKFLOW" || fail "exact migration Infisical leaf missing"
grep -Fq 'secret-path: /ci/control-plane/deployer' "$WORKFLOW" || fail "exact Infisical leaf missing"
grep -Fq 'include-imports: false' "$WORKFLOW" && grep -Fq 'recursive: false' "$WORKFLOW" || fail "secret expansion is broad"
! grep -Fq 'secrets.' "$WORKFLOW" || fail "GitHub Actions secret dependency found"
! grep -Eq 'wrangler secret put|npx wrangler|--env production' "$WORKFLOW" || fail "workflow has forbidden deploy authority"
grep -Fq 'd1 time-travel info aid-control-plane --remote --json' "$WORKFLOW" || fail "pre-migration recovery bookmark missing"
grep -Fq 'd1 migrations apply aid-control-plane --remote' "$WORKFLOW" || fail "reviewed migration apply missing"
grep -Fq "grep -Fq 'No migrations to apply'" "$WORKFLOW" || fail "post-migration empty-plan proof missing"
test -f "$BETTER_AUTH_MIGRATION" || fail "reviewed Better Auth migration missing"
grep -Fq 'CREATE UNIQUE INDEX IF NOT EXISTS "rateLimit_key_unique"' "$BETTER_AUTH_MIGRATION" \
  || fail "Better Auth rate-limit key uniqueness is not migration-owned"
! grep -Fq 'runMigrations()' "$CONTROL_PLANE_SOURCE" \
  || fail "runtime Better Auth schema mutation authority remains enabled"
grep -Fq './node_modules/.bin/wrangler deploy --strict --keep-vars' "$WORKFLOW" || fail "lockfile Wrangler strict deploy missing"
grep -Fq 'deployments-before.json' "$WORKFLOW" && grep -Fq 'previousVersionId' "$WORKFLOW" || fail "rollback receipt missing"
grep -Fq '"hosts":["app.install.doctor"]' "$WORKFLOW" && grep -Fq 'jq -r .success' "$WORKFLOW" || fail "scoped purge proof missing"
grep -Fq 'CLOUDFLARE_API_TOKEN=\n' "$WORKFLOW" || fail "credentials are not cleared"
grep -Fq 'release_channel_unavailable' "$WORKFLOW" && grep -Fq 'release_trust_not_configured' "$WORKFLOW" || fail "exact fail-closed states missing"
grep -Fq 'raw\.githubusercontent\.com' "$WORKFLOW" || fail "mutable launcher denial missing"
if grep -E 'uses: [^ ]+@(main|master|v[0-9]+([[:space:]#]|$))' "$WORKFLOW"; then fail "moving action reference found"; fi

jq -e '
  .workloads | map(select(.id == "github-control-plane-migrator")) | length == 1 and
  .[0].auth.claims.environment == "control-plane-production" and
  .[0].auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/control-plane-production.yml@refs/heads/master" and
  .[0].authorization.path == "/ci/control-plane/migrator" and
  .[0].authorization.secretNames == ["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"] and
  .[0].platformBindings[0].platform == "cloudflare-d1-production-migrations" and
  .[0].authorization.inheritedGrants == []
' "$POLICY" >/dev/null || fail "dedicated migration identity boundary invalid"
jq -e '
  .workloads | map(select(.id == "github-control-plane-deployer")) | length == 1 and
  .[0].auth.claims.environment == "control-plane-production" and
  .[0].auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/control-plane-production.yml@refs/heads/master" and
  .[0].authorization.path == "/ci/control-plane/deployer" and
  .[0].authorization.secretNames == ["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN","CLOUDFLARE_ZONE_ID"] and
  .[0].authorization.inheritedGrants == []
' "$POLICY" >/dev/null || fail "dedicated deploy identity boundary invalid"
pass "manual source-pinned least-privilege production deployment contract"
