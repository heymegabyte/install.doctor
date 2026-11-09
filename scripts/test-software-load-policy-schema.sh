#!/usr/bin/env bash
# Hermetic source-catalog load-policy schema regression coverage.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALIDATOR="$ROOT/scripts/validate-software-load-policy.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

validate() { node "$VALIDATOR" "$1" >/dev/null 2>&1; }
expect_reject() {
  local name="$1" fixture="$2"
  if validate "$fixture"; then fail "$name"; else pass "$name"; fi
}

if validate "$ROOT/software.yml"; then
  pass 'authoritative software catalog satisfies the load-policy schema'
else
  fail 'authoritative software catalog violates the load-policy schema'
fi

cat >"$TMP/valid.yml" <<'YAML'
softwarePackages:
  lazy-tool:
    _name: Lazy tool
    brew: lazy-tool
  eager-tool:
    _name: Eager tool
    _preload: true
    _preloadReason: bootstrap-critical
    _loadPolicy: eager-bootstrap
    _loadRationale: bootstrap:scripts/provision.sh
    brew: eager-tool
  configured-tool:
    _name: Configured tool
    _postInstallPrivilege: user
    brew: configured-tool
YAML
if validate "$TMP/valid.yml"; then
  pass 'lazy defaults and an explicitly owned eager exception are accepted'
else
  fail 'valid lazy/eager policy fixture was rejected'
fi

cp "$TMP/valid.yml" "$TMP/unknown-policy.yml"
sed -i.bak 's/_loadPolicy: eager-bootstrap/_loadPolicy: eager-convenience/' "$TMP/unknown-policy.yml"
expect_reject 'unknown eager policy is rejected' "$TMP/unknown-policy.yml"

cp "$TMP/valid.yml" "$TMP/missing-rationale.yml"
sed -i.bak '/_loadRationale:/d' "$TMP/missing-rationale.yml"
expect_reject 'eager policy without an owning rationale is rejected' "$TMP/missing-rationale.yml"

cp "$TMP/valid.yml" "$TMP/mismatched-policy.yml"
sed -i.bak 's/_loadPolicy: eager-bootstrap/_loadPolicy: eager-service/' "$TMP/mismatched-policy.yml"
expect_reject 'policy inconsistent with the declared preload reason is rejected' "$TMP/mismatched-policy.yml"

cp "$TMP/valid.yml" "$TMP/orphan-lazy-rationale.yml"
awk '/brew: lazy-tool/ { print "    _loadRationale: default-lazy" } { print }' \
  "$TMP/orphan-lazy-rationale.yml" >"$TMP/orphan-lazy-rationale.next"
mv "$TMP/orphan-lazy-rationale.next" "$TMP/orphan-lazy-rationale.yml"
expect_reject 'a partial explicit lazy declaration is rejected' "$TMP/orphan-lazy-rationale.yml"

cp "$TMP/valid.yml" "$TMP/invalid-post-install-privilege.yml"
sed -i.bak 's/_postInstallPrivilege: user/_postInstallPrivilege: root/' "$TMP/invalid-post-install-privilege.yml"
expect_reject 'unknown post-install privilege is rejected' "$TMP/invalid-post-install-privilege.yml"

printf 'software-load-policy-schema: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
