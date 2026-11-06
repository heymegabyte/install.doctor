#!/usr/bin/env bash
# Deploy-pipeline integrity gate (fire #352). The CORE deliverable — `install.doctor/start` — is served by
# Firebase Hosting routes /start to the control-plane signed stage-zero endpoint.
# The deploy pipeline that pushes firebase.json live was
# UNGATED — `.github/workflows/site-deploy.yml` is the last mile, and nothing asserted it is correctly wired.
# Prod /start is currently STALE (serves the old megabyte-labs org) blocked ONLY on the human re-adding the
# FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR secret (CLAUDE.md §9 #21; the cred is confirmed-absent from the secret
# rail, fire #352). This gate PROVES the secret is the SOLE remaining blocker: the workflow references that EXACT
# secret name, targets the right Firebase project + live channel, fires on the right paths, AND builds on a
# SUPPORTED Node — NOT EOL 16 (Node 16 EOL'd 2023-09; a build on a dead runtime is a latent reliability defect on
# the deploy path, found + fixed fire #352 → Node 20, the newest in Stencil 3.2's tested matrix). Pure file
# assertions, no network. SITE_DEPLOY_WF overrides the target for non-vacuity (planted-break) testing.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WF="${SITE_DEPLOY_WF:-$ROOT/.github/workflows/site-deploy.yml}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qE "$2" "$1" 2>/dev/null; }

say "site-deploy workflow integrity (the /start deploy last-mile)"

if [ ! -f "$WF" ]; then
  fail "site-deploy.yml MISSING ($WF) — a firebase.json redirect edit can never go live"
  say "site-deploy: $P passed, $F failed"
  exit 1
fi
pass "site-deploy.yml present"

# 1. Fires on a push to the default branch for site/** changes (so a firebase.json redirect edit auto-deploys).
if has "$WF" '^[[:space:]]*-[[:space:]]*(master|main)[[:space:]]*$' && has "$WF" 'site/\*\*'; then
  pass "trigger: push to master/main on paths site/** (a redirect edit auto-deploys)"
else
  fail "trigger drift — must be 'on: push' to master/main scoped to paths site/**"
fi

# 2. References the EXACT secret the human must re-add (CLAUDE.md §9 #21, confirmed-absent fire #352). A rename
#    here silently orphans the secret → the deploy fails forever with no obvious cause. This IS the sole blocker.
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

# 6 (#353). The SIBLING Firebase-deploy workflow — site-preview.yml (the PR preview) — shares the deploy path
#    and MUST hold the same invariants. It is NOT a push/live deploy (ephemeral PR channel, no channelId:live),
#    so only the SHARED invariants apply: same secret + Firebase project + a SUPPORTED Node. #352 fixed Node on
#    site-deploy.yml but MISSED this sibling (it kept EOL 16) — this closes that gate gap so neither can drift.
PREVIEW="${SITE_PREVIEW_WF:-$ROOT/.github/workflows/site-preview.yml}"
if [ ! -f "$PREVIEW" ]; then
  pass "no site-preview.yml sibling (nothing to drift)"
else
  if has "$PREVIEW" 'secrets\.FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR' && has "$PREVIEW" 'projectId:[[:space:]]*install-doctor'; then
    pass "sibling site-preview.yml wired to the same Firebase project + secret (consistent deploy path)"
  else
    fail "site-preview.yml drifted — must deploy projectId install-doctor via secrets.FIREBASE_SERVICE_ACCOUNT_INSTALL_DOCTOR"
  fi
  pvnode="$(grep -oE 'node-version:[[:space:]]*"?[0-9]+' "$PREVIEW" | grep -oE '[0-9]+$' | head -1)"
  if [ -n "$pvnode" ] && [ "$pvnode" -ge 18 ]; then
    pass "sibling site-preview.yml builds on a supported Node (node-version: $pvnode >= 18 — off EOL 16, consistent with site-deploy.yml)"
  else
    fail "site-preview.yml node-version '${pvnode:-none}' is EOL/unsupported (<18) — the PR-preview build runs on a dead runtime; match site-deploy.yml (#352/#353)"
  fi
fi

say "site-deploy: $P passed, $F failed"
[ "$F" -eq 0 ]
