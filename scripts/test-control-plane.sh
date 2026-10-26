#!/usr/bin/env bash
# Phase-A control-plane skeleton gate.
#   build gate : `wrangler deploy --dry-run` bundles the Hono Worker (fails if src/imports break).
#   prod  gate : if CONTROL_PLANE_URL is set, assert the live skeleton — /health 200 {status:ok},
#                /api/ai/v1/<known-route> 501 (provider wiring pending), /api/ai/v1/<bogus> 404.
# The Worker imports aid-core's route contracts (ROUTES/chooseRoute) by relative path so
# esbuild bundles them — no workspace link needed. See docs/aid/MASTER-PROMPT.md §2,§8,§17.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CP="$ROOT/packages/control-plane"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "control-plane skeleton"

if [ ! -f "$CP/wrangler.toml" ] || [ ! -f "$CP/src/index.ts" ]; then
  fail "control-plane not scaffolded (packages/control-plane/{wrangler.toml,src/index.ts})"
else
  pass "control-plane scaffolded"
  # build gate: dry-run bundles the Worker (needs hono installed + wrangler available via npx)
  if ( cd "$CP" && npx --yes wrangler deploy --dry-run --outdir /tmp/cp-dist ) >/tmp/cp-build.log 2>&1; then
    pass "wrangler dry-run build OK"
  else
    fail "wrangler dry-run build failed (see /tmp/cp-build.log)"; tail -5 /tmp/cp-build.log 2>/dev/null
  fi
fi

if [ -n "${CONTROL_PLANE_URL:-}" ]; then
  u="${CONTROL_PLANE_URL%/}"
  code="$(curl -fsS -o /tmp/cp-health.json -w '%{http_code}' "$u/health" 2>/dev/null || echo 000)"
  if [ "$code" = 200 ] && grep -q '"status":"ok"' /tmp/cp-health.json 2>/dev/null; then pass "GET /health 200 {status:ok}"; else fail "GET /health -> $code"; fi
  rc="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rc" = 501 ] && pass "GET /api/ai/v1/economy -> 501 (wiring pending)" || fail "known route -> $rc (want 501)"
  rb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/definitely-not-a-route" 2>/dev/null || echo 000)"
  [ "$rb" = 404 ] && pass "GET /api/ai/v1/<bogus> -> 404" || fail "bogus route -> $rb (want 404)"
else
  skip "CONTROL_PLANE_URL unset — prod /health + routing E2E skipped (set after deploy)"
fi

say "control-plane: $P passed, $F failed"
[ "$F" -eq 0 ]
