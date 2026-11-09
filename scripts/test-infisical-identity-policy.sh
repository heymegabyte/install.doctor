#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

test -f "$ROOT/config/infisical/identity-policy.schema.json" || fail "identity policy schema missing"
test -f "$ROOT/config/infisical/bootstrap-release-identities.json" || fail "bootstrap release identity policy missing"
jq -e '.properties.workloads.items.required | index("rotation") != null' "$ROOT/config/infisical/identity-policy.schema.json" >/dev/null \
  || fail "schema does not require rotation policy"
test -f "$ROOT/.github/workflows/infisical-policy.yml" || fail "policy workflow missing"
grep -Fq 'permissions:' "$ROOT/.github/workflows/infisical-policy.yml" || fail "workflow permissions missing"
grep -Fq 'contents: read' "$ROOT/.github/workflows/infisical-policy.yml" || fail "workflow contents permission missing"
! grep -Fq 'id-token: write' "$ROOT/.github/workflows/infisical-policy.yml" \
  || fail "read-only policy workflow must not mint OIDC tokens"
grep -Fq 'test-infisical-identity-policy.sh' "$ROOT/.github/workflows/infisical-policy.yml" \
  || fail "workflow does not execute focused policy test"

node "$ROOT/scripts/infisical-identity-policy.mjs" validate "$ROOT/config/infisical/bootstrap-release-identities.json" >"$TMP/bootstrap-release.out"
grep -Fq '"valid": true' "$TMP/bootstrap-release.out" || fail "bootstrap release identity policy was rejected"
node "$ROOT/scripts/infisical-identity-policy.mjs" plan "$ROOT/config/infisical/bootstrap-release-identities.json" >"$TMP/bootstrap-release-plan.json"
jq -e '
  (.workloads | length) == 15 and all(.workloads[]; .authMode == "github-oidc") and
  ([.workloads[].claims.environment] | unique | length) == 14 and
  ([.workloads[].claims.workflowRef] | unique | length) == 9 and
  ([.workloads[].authorization.path] | unique | length) == 15
' "$TMP/bootstrap-release-plan.json" >/dev/null || fail "CI workloads do not have fifteen disjoint workflow-bound OIDC/path boundaries"
jq -e '
  (.workloads | map(select(.id == "github-bootstrap-release-signer"))[0].authorization.secretNames == ["INSTALL_DOCTOR_RELEASE_SIGNING_KEY"]) and
  (.workloads | map(select(.id == "github-bootstrap-release-publisher"))[0].authorization.secretNames == [
    "INSTALL_DOCTOR_RELEASE_R2_ACCESS_KEY_ID",
    "INSTALL_DOCTOR_RELEASE_R2_BUCKET",
    "INSTALL_DOCTOR_RELEASE_R2_ENDPOINT",
    "INSTALL_DOCTOR_RELEASE_R2_SECRET_ACCESS_KEY"
  ]) and
  (.workloads | map(select(.id == "github-bootstrap-release-activator"))[0].authorization.secretNames | index("INSTALL_DOCTOR_RELEASE_SIGNING_KEY") == null) and
  (.workloads | map(select(.id == "github-offline-bundle-authority"))[0] |
    (.authorization.secretNames == [
      "INSTALL_DOCTOR_OFFLINE_R2_ACCESS_KEY_ID",
      "INSTALL_DOCTOR_OFFLINE_R2_BUCKET",
      "INSTALL_DOCTOR_OFFLINE_R2_ENDPOINT",
      "INSTALL_DOCTOR_OFFLINE_R2_SECRET_ACCESS_KEY",
      "INSTALL_DOCTOR_OFFLINE_SIGNING_KEY"
    ]) and
    (.auth.claims.environment == "offline-bundle-authority") and
    (.auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/offline-bundle-authority.yml@refs/heads/master")) and
  (.workloads | map(select(.id == "github-desktop-tools-release-monitor"))[0] |
    (.authorization.secretNames | all(startswith("DESKTOP_TOOLS_"))) and
    (.authorization.secretNames | index("DESKTOP_TOOLS_RELEASE_SIGNING_KEY") == null) and
    (.auth.claims.environment == "desktop-tools-release-monitor") and
    (.platformBindings | length == 1) and
    (.platformBindings[0].platform == "cloudflare-r2-desktop-tools-channel-and-release-read-only")) and
  (.workloads | map(select(.id == "github-desktop-tools-release-signer"))[0] |
    (.authorization.secretNames == ["DESKTOP_TOOLS_RELEASE_SIGNING_KEY"]) and
    (.auth.claims.environment == "desktop-tools-release-sign")) and
  (.workloads | map(select(.id == "github-desktop-tools-release-publisher"))[0] |
    (.authorization.secretNames | all(startswith("DESKTOP_TOOLS_RELEASE_R2_"))) and
    (.authorization.secretNames | index("DESKTOP_TOOLS_RELEASE_SIGNING_KEY") == null) and
    (.auth.claims.environment == "desktop-tools-release-publish")) and
  (.workloads | map(select(.id == "github-desktop-tools-release-activator"))[0] |
    (.authorization.secretNames | index("DESKTOP_TOOLS_RELEASE_SIGNING_KEY") == null) and
    (.authorization.secretNames | any(startswith("DESKTOP_TOOLS_CHANNEL_R2_"))) and
    (.auth.claims.environment == "desktop-tools-release-activate")) and
  (.workloads | map(select(.id == "github-control-plane-deployer"))[0] |
    (.authorization.secretNames == ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"]) and
    (.authorization.secretNames | index("INSTALL_DOCTOR_RELEASE_SIGNING_KEY") == null) and
    (all(.authorization.secretNames[]; test("R2|SIGNING") | not)) and
    (.auth.claims.environment == "control-plane-production") and
    (.auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/control-plane-production.yml@refs/heads/master")) and
  (.workloads | map(select(.id == "github-control-plane-migrator"))[0] |
    (.authorization.secretNames == ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) and
    (.authorization.secretNames | index("CLOUDFLARE_ZONE_ID") == null) and
    (all(.authorization.secretNames[]; test("R2|SIGNING") | not)) and
    (.platformBindings[0].platform == "cloudflare-d1-production-migrations") and
    (.auth.claims.environment == "control-plane-production") and
    (.auth.claims.workflow_ref == "heymegabyte/install.doctor/.github/workflows/control-plane-production.yml@refs/heads/master"))
' "$ROOT/config/infisical/bootstrap-release-identities.json" >/dev/null \
  || fail "CI secret allowlists do not match their code authority boundaries"

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
          "repository_id": "588807533",
          "repository_owner_id": "82490183",
          "ref": "refs/heads/master",
          "environment": "prod",
          "workflow_ref": "heymegabyte/install.doctor/.github/workflows/bootstrap-release-production.yml@refs/heads/master",
          "event_name": "workflow_dispatch",
          "aud": "https://github.com/heymegabyte",
          "sub": "repo:heymegabyte/install.doctor:environment:prod"
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
grep -Fq 'immutable repository IDs, exact workflow/ref/environment/audience/subject claims' "$TMP/wildcard.out" || fail "OIDC claim diagnostic missing"

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
