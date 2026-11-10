#!/usr/bin/env bash
# Compatibility-site deploy integrity. Desktop Tools uses Cloudflare and profile subdomains; the retired
# Install Doctor Firebase site may be published only by an explicit manual action. Pushes and pull requests
# must validate without receiving the legacy deployment credential or mutating production.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WF="${SITE_DEPLOY_WF:-$ROOT/.github/workflows/site-deploy.yml}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qE "$2" "$1" 2>/dev/null; }

say "legacy site-deploy workflow integrity"

if [ ! -f "$WF" ]; then
  fail "site-deploy.yml MISSING ($WF) — a firebase.json redirect edit can never go live"
  say "site-deploy: $P passed, $F failed"
  exit 1
fi
pass "site-deploy.yml present"

# 1. Legacy Firebase publication is never a push side effect.
if has "$WF" '^[[:space:]]*workflow_dispatch:' && ! has "$WF" '^[[:space:]]*push:'; then
  pass "legacy Firebase publication is manual-only"
else
  fail "legacy Firebase publication must not run on push"
fi
has "$WF" 'name:.*legacy Install Doctor.*manual' && pass "workflow identity discloses legacy manual scope" || fail "workflow identity obscures legacy manual scope"
has "$WF" '^permissions:[[:space:]]*\{\}' && pass "workflow defaults to no GitHub permissions" || fail "workflow has ambient GitHub permissions"
has "$WF" 'persist-credentials:[[:space:]]*false' && pass "checkout does not persist repository credentials" || fail "checkout persists repository credentials"

# 2. The manual compatibility operation retains its exact external credential name.
if has "$WF" 'secrets\.FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR'; then
  pass "consumes secrets.FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR (the exact name the human re-adds)"
else
  fail "secret-name drift — must reference secrets.FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR"
fi

# 3. Deploys the right Firebase project + the LIVE channel (not a throwaway preview).
has "$WF" 'projectId:[[:space:]]*install-doctor' && pass "projectId: install-doctor (correct Firebase project)" || fail "projectId drift — must be install-doctor"
has "$WF" 'channelId:[[:space:]]*live' && pass "channelId: live (publishes to prod, not a preview channel)" || fail "channelId drift — must be live"

# 4. BUILDS on a SUPPORTED Node. Node 16 EOL'd 2023-09 — a Stencil build on a dead runtime is a latent
#    reliability defect on the core deliverable's deploy path. Require >=18 (fixed fire #352 → 20, within
#    Stencil 3.2's tested matrix; a future Stencil 4 + Node 24 bump is a separate backlog upgrade).
nodever="$(grep -oE 'node-version:[[:space:]]*"?[0-9]+' "$WF" | grep -oE '[0-9]+$' | head -1)"
if [ -n "$nodever" ] && [ "$nodever" -ge 18 ]; then
  pass "builds on a supported Node (node-version: $nodever >= 18 — off EOL 16)"
else
  fail "node-version '${nodever:-none}' is EOL/unsupported (<18) — the Stencil build runs on a dead runtime; bump to a supported LTS"
fi

# 5 (#352). The SAME Node must hold for a LOCAL Volta build — site/package.json's volta.node pin is the SECOND
#    Node declaration in the deploy path (CI setup-node + local Volta). If they drift (CI 20 / volta 16) a local
#    build silently uses a dead runtime — BACKLOG #183 flagged exactly this. Lock BOTH >=18 so it can't recur.
if command -v python3 >/dev/null 2>&1; then
  voltaver="$(python3 -c "import json;d=json.load(open('$ROOT/site/package.json'));v=d.get('volta',{}).get('node','');print(v.split('.')[0] if v else '')" 2>/dev/null)"
  if [ -z "$voltaver" ]; then
    pass "no volta.node pin in site/package.json (nothing to drift)"
  elif [ "$voltaver" -ge 18 ]; then
    pass "local Volta builds on a supported Node (volta.node major $voltaver >= 18 — consistent with the CI node-version)"
  else
    fail "site/package.json volta.node major '$voltaver' is EOL/unsupported (<18) — a local Volta build uses a dead runtime; match the CI node-version (BACKLOG #183)"
  fi
else
  pass "python3 absent — volta.node JSON check skipped (the CI node-version is still gated above)"
fi

# 6. Pull-request validation builds the site but MUST NOT deploy a preview or receive deployment secrets.
#    Production is the only environment; tests validate the checked-out revision without external mutation.
PREVIEW="${SITE_PREVIEW_WF:-$ROOT/.github/workflows/site-preview.yml}"
if [ ! -f "$PREVIEW" ]; then
  fail "site-preview.yml build validation is missing"
else
  if has "$PREVIEW" 'FirebaseExtended/action-hosting-deploy|firebaseServiceAccount|secrets\.FIREBASE_SERVICE_ACCOUNT|channelId:'; then
    fail "site-preview.yml may validate builds but must not deploy or receive Firebase credentials"
  else
    pass "pull-request site validation has no deployment action or Firebase credential"
  fi
  has "$PREVIEW" 'npm run build:prod' && has "$PREVIEW" 'test -s www/index.html' \
    && pass "pull-request site validation builds and verifies output" \
    || fail "site-preview.yml must build the checked-out site and verify output"
  pvnode="$(grep -oE 'node-version:[[:space:]]*"?[0-9]+' "$PREVIEW" | grep -oE '[0-9]+$' | head -1)"
  if [ -n "$pvnode" ] && [ "$pvnode" -ge 18 ]; then
    pass "pull-request site validation uses supported Node (node-version: $pvnode >= 18)"
  else
    fail "site-preview.yml node-version '${pvnode:-none}' is EOL/unsupported (<18)"
  fi
fi

say "site-deploy: $P passed, $F failed"
[ "$F" -eq 0 ]
