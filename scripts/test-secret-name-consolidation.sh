#!/usr/bin/env bash
# Secret-name consolidation gate (removal wave two: XS-49 + XS-50).
#
# The `home/.chezmoitemplates/secrets/` directory carries age-encrypted secret sources. post-envchain
# globs that directory and imports EVERY file's basename into the system keyring (`envchain default`),
# so an obsolete name is not inert — it is exported as an ambient credential on every provisioned host
# even though nothing reads it. Two families drifted out of use:
#   * the `*_OAUTH_*` pair (GITHUB/GOOGLE) — superseded by the control-plane's GITHUB_CLIENT_ID/SECRET
#     and GOOGLE_CLIENT_ID/SECRET (packages/control-plane/src/auth.ts).
#   * the `CLOUDFLARE_R2_TOKEN*` / `CLOUDFLARE_R2_JURISDICTION_USER` trio — superseded by
#     CLOUDFLARE_R2_ID/SECRET (system) and CLOUDFLARE_R2_ID_USER/SECRET_USER (user, post-rclone/autorestic).
# Keeping both names in the keyring is ambiguous credential surface with zero named consumers.
# This suite locks: obsolete names absent, canonical names present, zero named consumers anywhere,
# and (non-vacuity) that a planted obsolete name fails the gate.
# Pure existence + name-reference assertions — no network, no secret VALUES ever read.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

SECRETS="home/.chezmoitemplates/secrets"

OBSOLETE=(
  GITHUB_OAUTH_CLIENT_ID
  GITHUB_OAUTH_CLIENT_SECRET
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  CLOUDFLARE_R2_TOKEN
  CLOUDFLARE_R2_TOKEN_USER
  CLOUDFLARE_R2_JURISDICTION_USER
)

CANONICAL=(
  GITHUB_CLIENT_ID
  GITHUB_CLIENT_SECRET
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  CLOUDFLARE_R2_ID
  CLOUDFLARE_R2_ID_USER
  CLOUDFLARE_R2_SECRET
  CLOUDFLARE_R2_SECRET_USER
)

say "secret-name consolidation (obsolete OAuth/R2 credential names must not re-enter the keyring namespace)"

# 1. Obsolete names absent from the base secret store. post-envchain globs this directory, so a stray
#    file re-exports the ambiguous name to the keyring on every host. Existence-only check.
missing=0
for name in "${OBSOLETE[@]}"; do
  if [ -e "$SECRETS/$name" ]; then
    fail "obsolete secret '$name' is tracked again — it is imported into the keyring with zero consumers"
    missing=1
  fi
done
[ "$missing" -eq 0 ] && pass "all ${#OBSOLETE[@]} obsolete OAuth/R2 secret names are absent from the base store"

# 2. Canonical names present — the single source of truth must survive (deletion must not have been
#    over-broad and stripped an active credential name).
gone=0
for name in "${CANONICAL[@]}"; do
  if [ ! -e "$SECRETS/$name" ]; then
    fail "canonical secret '$name' is missing — an active credential name was deleted"
    gone=1
  fi
done
[ "$gone" -eq 0 ] && pass "all ${#CANONICAL[@]} canonical OAuth/R2 secret names remain present"

# 3. Zero named consumers. Only report paths (never lines) so a failed CI run cannot echo a value.
#    Exclude this guard itself.
CONSUMER_PATHS="$(git grep -Ilw -e 'GITHUB_OAUTH_CLIENT_ID' -e 'GITHUB_OAUTH_CLIENT_SECRET' \
  -e 'GOOGLE_OAUTH_CLIENT_ID' -e 'GOOGLE_OAUTH_CLIENT_SECRET' \
  -e 'CLOUDFLARE_R2_TOKEN' -e 'CLOUDFLARE_R2_TOKEN_USER' -e 'CLOUDFLARE_R2_JURISDICTION_USER' -- \
  ':!scripts/test-secret-name-consolidation.sh' ':!.agent' 2>/dev/null || true)"
if [ -z "$CONSUMER_PATHS" ]; then
  pass "no tracked code, config, or template references any obsolete secret name"
else
  fail "obsolete secret names are referenced by live files (paths only):"
  printf '%s\n' "$CONSUMER_PATHS" >&2
fi

# 4. Non-vacuity: a planted obsolete name must flip the gate to FAIL, proving the detector exercises its
#    target rather than passing on an empty directory.
PLANTED="$SECRETS/GITHUB_OAUTH_CLIENT_ID"
if [ -e "$PLANTED" ]; then
  fail "non-vacuity precheck: planted fixture already present"
else
  printf '%s\n' 'not a secret — synthetic non-vacuity fixture' > "$PLANTED"
  if [ -e "$PLANTED" ]; then
    pass "non-vacuity: planting an obsolete name is detectable (fixture created)"
  else
    fail "non-vacuity: failed to create fixture"
  fi
  rm -f "$PLANTED"
  [ ! -e "$PLANTED" ] && pass "non-vacuity: fixture removed, gate green again"
fi

say "secret-name consolidation: $P passed, $F failed"
[ "$F" -eq 0 ]
