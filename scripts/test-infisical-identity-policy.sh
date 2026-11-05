#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

test -f "$ROOT/config/infisical/identity-policy.schema.json" || fail "identity policy schema missing"
jq -e '.properties.workloads.items.required | index("rotation") != null' "$ROOT/config/infisical/identity-policy.schema.json" >/dev/null \
  || fail "schema does not require rotation policy"
test -f "$ROOT/.github/workflows/infisical-policy.yml" || fail "policy workflow missing"
grep -Fq 'permissions:' "$ROOT/.github/workflows/infisical-policy.yml" || fail "workflow permissions missing"
grep -Fq 'contents: read' "$ROOT/.github/workflows/infisical-policy.yml" || fail "workflow contents permission missing"
! grep -Fq 'id-token: write' "$ROOT/.github/workflows/infisical-policy.yml" \
  || fail "read-only policy workflow must not mint OIDC tokens"
grep -Fq 'test-infisical-identity-policy.sh' "$ROOT/.github/workflows/infisical-policy.yml" \
  || fail "workflow does not execute focused policy test"

cat >"$TMP/valid.json" <<'JSON'
{
  "schemaVersion": 1,
  "workloads": [
    {
      "id": "github-release",
      "runtime": "github-actions",
      "availableAuthModes": ["github-oidc", "universal-auth"],
      "auth": {
        "mode": "github-oidc",
        "issuer": "https://token.actions.githubusercontent.com",
        "claims": {
          "repository": "heymegabyte/install.doctor",
          "ref": "refs/heads/master",
          "environment": "prod"
        },
        "accessTokenTtlSeconds": 900,
        "accessTokenMaxTtlSeconds": 1800,
        "accessTokenMaxUses": 20,
        "trustedIpRationale": "GitHub-hosted runner addresses are not stable; claims are the primary boundary."
      },
      "authorization": {
        "project": "install-doctor",
        "environment": "prod",
        "path": "/ci/github-release",
        "secretNames": ["CLOUDFLARE_API_TOKEN"],
        "inheritedGrants": []
      },
      "platformBindings": [
        {
          "platform": "cloudflare",
          "binding": "CLOUDFLARE_API_TOKEN",
          "sourceRef": "infisical://install-doctor/prod/ci/github-release/CLOUDFLARE_API_TOKEN",
          "authority": "infisical"
        }
      ],
      "revocation": {
        "tokenCacheWindowSeconds": 60,
        "urgentProcedure": ["disable-identity", "revoke-issuing-credential", "wait-cache-window", "verify-denied"]
      },
      "rotation": {
        "overlapSeconds": 300,
        "steps": ["issue-new", "reload-consumer", "health-check", "revoke-old", "verify-old-denied"],
        "healthCheck": "cloudflare-token-read-only"
      }
    },
    {
      "id": "legacy-daemon",
      "runtime": "bare-metal-daemon",
      "availableAuthModes": ["universal-auth"],
      "federationUnavailableReason": "The installed daemon has no OIDC or native workload identity integration.",
      "auth": {
        "mode": "universal-auth",
        "issuer": "infisical",
        "accessTokenTtlSeconds": 600,
        "accessTokenMaxTtlSeconds": 1200,
        "accessTokenMaxUses": 50,
        "trustedCidrs": ["10.0.0.0/24"],
        "trustedIpRationale": "Daemon has a fixed private subnet egress address.",
        "clientSecretExpiresAt": "2099-01-01T00:00:00Z",
        "clientSecretExpiryAlertDays": 30
      },
      "authorization": {
        "project": "install-doctor",
        "environment": "prod",
        "path": "/services/legacy-daemon",
        "secretNames": ["DATABASE_PASSWORD"],
        "inheritedGrants": []
      },
      "platformBindings": [],
      "revocation": {
        "tokenCacheWindowSeconds": 60,
        "urgentProcedure": ["disable-identity", "revoke-issuing-credential", "wait-cache-window", "verify-denied"]
      },
      "rotation": {
        "overlapSeconds": 300,
        "steps": ["issue-new", "reload-consumer", "health-check", "revoke-old", "verify-old-denied"],
        "healthCheck": "daemon-ready"
      }
    }
  ]
}
JSON

node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/valid.json" >"$TMP/valid.out"
grep -Fq '"valid": true' "$TMP/valid.out" || fail "valid policy was rejected"
! grep -Fq 'CLOUDFLARE_API_TOKEN"' "$TMP/valid.out" || fail "validator emitted a secret name"

node "$ROOT/scripts/infisical-identity-policy.mjs" plan "$TMP/valid.json" >"$TMP/plan.json"
jq -e '.mutation == false and .workloads[0].authMode == "github-oidc"' "$TMP/plan.json" >/dev/null \
  || fail "planner did not emit a deterministic non-mutating plan"
jq -e '.workloads[0].claims.repository == "heymegabyte/install.doctor" and .workloads[0].claims.ref == "refs/heads/master" and .workloads[0].claims.environment == "prod"' "$TMP/plan.json" >/dev/null \
  || fail "GitHub OIDC claims missing from plan"
jq -e '.workloads[1].clientSecretExpiryAlertDays == 30' "$TMP/plan.json" >/dev/null \
  || fail "Universal Auth expiry policy missing from plan"
jq -e '.workloads[0].revocation.cacheWindowAcknowledged == true and .workloads[0].rotation.reloadBeforeRevoke == true' "$TMP/plan.json" >/dev/null \
  || fail "revocation or rotation safeguards missing"
jq -e '.workloads[0].platformBindings[0].singleAuthority == true' "$TMP/plan.json" >/dev/null \
  || fail "platform binding did not preserve Infisical authority"

jq '.workloads[0].authorization.inheritedGrants = [{"source":"organization-viewer","scope":"project-wide"}]' "$TMP/valid.json" >"$TMP/inherited.json"
if node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/inherited.json" >"$TMP/inherited.out" 2>&1; then
  fail "additive inherited grant was accepted"
fi
grep -Fq 'inherited grants are additive' "$TMP/inherited.out" || fail "inherited-grant diagnostic missing"

jq '(.workloads[0].auth.claims.ref) = "*"' "$TMP/valid.json" >"$TMP/wildcard.json"
if node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/wildcard.json" >"$TMP/wildcard.out" 2>&1; then
  fail "wildcard GitHub ref was accepted"
fi
grep -Fq 'exact repository/ref/environment claims' "$TMP/wildcard.out" || fail "OIDC claim diagnostic missing"

jq '(.workloads[1].auth.clientSecretExpiresAt) = null' "$TMP/valid.json" >"$TMP/no-expiry.json"
if node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/no-expiry.json" >"$TMP/no-expiry.out" 2>&1; then
  fail "non-expiring Universal Auth client secret was accepted"
fi
grep -Fq 'finite clientSecretExpiresAt' "$TMP/no-expiry.out" || fail "client-secret expiry diagnostic missing"

jq '(.workloads[1].availableAuthModes) = ["platform-oidc", "universal-auth"]' "$TMP/valid.json" >"$TMP/oidc-available.json"
if node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/oidc-available.json" >"$TMP/oidc-available.out" 2>&1; then
  fail "Universal Auth was accepted when platform OIDC was available"
fi
grep -Fq 'preferred available auth mode is platform-oidc' "$TMP/oidc-available.out" \
  || fail "auth-mode selection diagnostic missing"

jq '(.workloads[0].rotation.steps) = ["issue-new", "revoke-old", "reload-consumer", "health-check", "verify-old-denied"]' "$TMP/valid.json" >"$TMP/bad-rotation.json"
if node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$TMP/bad-rotation.json" >"$TMP/bad-rotation.out" 2>&1; then
  fail "revoke-before-reload rotation was accepted"
fi
grep -Fq 'reload and health-check before revoke-old' "$TMP/bad-rotation.out" || fail "rotation ordering diagnostic missing"

printf 'infisical-identity-policy: PASS\n'
