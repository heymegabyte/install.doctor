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
  # inference route pre-flight (fire #8): POST-only; restricted fails closed; fail-closed when unconfigured
  rc="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rc" = 503 ] && pass "POST /api/ai/v1/economy -> 503 (provider not configured, fail-closed)" || fail "economy POST -> $rc (want 503)"
  rr="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/restricted" 2>/dev/null || echo 000)"
  [ "$rr" = 451 ] && pass "POST /api/ai/v1/restricted -> 451 (restricted fails closed — no public gateway)" || fail "restricted POST -> $rr (want 451)"
  rg="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rg" = 405 ] && pass "GET /api/ai/v1/economy -> 405 (inference uses POST)" || fail "economy GET -> $rg (want 405)"
  rb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/definitely-not-a-route" 2>/dev/null || echo 000)"
  [ "$rb" = 404 ] && pass "GET /api/ai/v1/<bogus> -> 404" || fail "bogus route -> $rb (want 404)"

  # routing-policy decisions — reuses aid-core chooseRoute at the HTTP boundary (no inference performed)
  rp(){ curl -s -X POST -H 'content-type: application/json' -d "$1" "$u/api/ai/v1/resolve" 2>/dev/null; }
  echo "$(rp '{}')"                                                                                | grep -q '"route":"economy"'    && pass "resolve {} -> economy (routine default)"          || fail "resolve {} -> $(rp '{}')"
  echo "$(rp '{"sensitivity":"restricted","kind":"code","verificationFailed":true,"allowPremium":true}')" | grep -q '"route":"restricted"' && pass "restricted fails closed (ignores premium)"    || fail "restricted not failing closed"
  echo "$(rp '{"kind":"architecture","allowPremium":false}')"                                      | grep -q '"route":"code"'      && pass "architecture w/o premium -> code (opt-in gate)"  || fail "architecture gate wrong"
  echo "$(rp '{"kind":"code","verificationFailed":true,"allowPremium":true}')"                      | grep -q '"route":"critical"'  && pass "verified-failure + premium -> critical"          || fail "escalation wrong"
  rbad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"sensitivity":"bogus"}' "$u/api/ai/v1/resolve" 2>/dev/null || echo 000)"
  [ "$rbad" = 400 ] && pass "invalid body -> 400 (Zod boundary)" || fail "invalid body -> $rbad (want 400)"
else
  skip "CONTROL_PLANE_URL unset — prod /health + routing E2E skipped (set after deploy)"
fi

say "control-plane: $P passed, $F failed"
[ "$F" -eq 0 ]
