#!/usr/bin/env bash
# Docker-template default-credential gate (removal-wave-two SEC-05..SEC-10).
#
# Six committed docker-compose templates shipped literal default/placeholder credentials: Directus
# (admin email/password + KEY/SECRET), Rallly (POSTGRES_PASSWORD + the password inside DATABASE_URL),
# Rundeck (RUNDECK_DATABASE_PASSWORD + POSTGRES_PASSWORD), Wazuh (indexer + API passwords), Browserless
# (the "your-strong-token" token), and Kasm (Docker-Hub USER/PASS placeholders). A deployer running
# `docker compose up` on them as-committed stood up a service with a KNOWN default password or a
# misleading placeholder. Each is now an environment-variable substitution: required secrets use
# `${VAR:?msg}` (fail-closed -- compose errors out if unset), optional ones use `${VAR:-}` (empty,
# documented). This gate locks that state:
#   1. no docker template still contains a literal known-default credential string,
#   2. every remediated template file still exists (no collateral deletion),
#   3. the detector is non-vacuous (a planted fixture carrying a default credential is flagged).
#
# Matches source strings only -- no secret VALUE is ever read, derived, or printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

TMPL_DIR="$ROOT/home/dot_config/docker/templates"

# Literal default/placeholder credential strings that must never ship in a committed template. Each is
# the exact byte the security-secrets wave-two audit flagged as a shipped default/placeholder credential.
DEFAULTS=(
  'SecretPassword'
  'MyS3cr37P450r'
  'your-strong-token'
  'your-secret-key'
  'your-secret-secret'
  'POSTGRES_PASSWORD=postgres'
  'POSTGRES_PASSWORD=rundeck'
  'RUNDECK_DATABASE_PASSWORD: rundeck'
  'DIRECTUS_ADMIN_PASSWORD: "password"'
  'DIRECTUS_ADMIN_EMAIL: "admin@example.com"'
  'DOCKER_HUB_PASSWORD: PASS'
  'DOCKER_HUB_USERNAME: USER'
)

REMEDIATED=(
  directus/docker-compose.yml
  rallly/docker-compose.yml
  rundeck/docker-stack.yml.tmpl
  wazuh/wazuh.docker-stack.yml.tmpl
  browserless/docker-stack.yml.tmpl
  kasm/docker-compose.yml.tmpl
)

say "docker-template default-credential gate (SEC-05..SEC-10; source-only)"

if [ ! -d "$TMPL_DIR" ]; then
  fail "docker templates dir missing: $TMPL_DIR"
  say "docker-template default credentials: $P passed, $F failed"
  exit 1
fi
pass "docker templates dir present"

# 1. No committed template may contain a literal default/placeholder credential.
found=0
while IFS= read -r file; do
  for token in "${DEFAULTS[@]}"; do
    if grep -qF -- "$token" "$file"; then
      fail "default/placeholder credential still shipped: $(basename "$file") :: $token"
      found=$((found + 1))
    fi
  done
done < <(find "$TMPL_DIR" -type f \( -name '*.yml' -o -name '*.yaml' -o -name '*.tmpl' \) | sort)
[ "$found" -eq 0 ] && pass "no template ships a literal default/placeholder credential"

# 2. Every remediated template still exists (no collateral deletion).
for f in "${REMEDIATED[@]}"; do
  if [ -f "$TMPL_DIR/$f" ]; then
    pass "remediated template preserved: $f"
  else
    fail "remediated template missing: $f"
  fi
done

# 3. Non-vacuity: plant a fixture carrying a default credential and prove the detector flags it.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' \
  'services:' \
  '  db:' \
  '    environment:' \
  '      - POSTGRES_PASSWORD=postgres' > "$tmp/planted.yml"
hit=0
for token in "${DEFAULTS[@]}"; do
  if grep -qF -- "$token" "$tmp/planted.yml"; then
    hit=$((hit + 1))
  fi
done
if [ "$hit" -gt 0 ]; then
  pass "detector flags a planted default credential (non-vacuous)"
else
  fail "detector missed a planted default credential -- the check is vacuous"
fi

# 4. Stateful templates must not expose an internal database by default, use
# obsolete Compose schema declarations, or run without init/restart policy.
if grep -Eq '^[[:space:]]*version:' "$TMPL_DIR/directus/docker-compose.yml"; then
  fail "Directus retains an obsolete top-level Compose version"
else
  pass "Directus uses the current Compose specification"
fi
grep -Fq 'init: true' "$TMPL_DIR/directus/docker-compose.yml" \
  && pass "Directus enables init for signal and zombie handling" \
  || fail "Directus does not enable init"
grep -Fq 'postgres:14.2@sha256:' "$TMPL_DIR/rallly/docker-compose.yml" \
  && pass "Rallly pins Postgres by digest" \
  || fail "Rallly Postgres image is not digest-pinned"
if grep -Fq '5450:5432' "$TMPL_DIR/rallly/docker-compose.yml"; then
  fail "Rallly exposes its database on the host"
else
  pass "Rallly keeps its database on the private Compose network"
fi

say "docker-template default credentials: $P passed, $F failed"
[ "$F" -eq 0 ]
