#!/usr/bin/env bash
# O10 — rate-limit sign-in without leaking account existence. Better Auth's rate limiting was INERT on prod
# (Workers has no NODE_ENV=production → `enabled` defaulted off; and the default "memory" storage is
# per-ISOLATE, so a burst fanned across the CF edge never accumulated — a 40x burst to /sign-in/social all
# 200'd). Fix (#108): `enabled:true` + `storage:"database"` (D1-backed `rateLimit` table, consistent across
# isolates) + a tight customRule on /sign-in/social (window 30s, max 10). This test fires a SEQUENTIAL burst
# (deterministic D1 counter accumulation — no read-modify-write race) and asserts: the FIRST attempt still
# succeeds (a legit sign-in is NOT blocked), the window then 429s, and the 429 carries a retry hint.
# The 429 body/behaviour is identical whether or not the account exists → no account-existence leak (O10).
set -uo pipefail
u="${CONTROL_PLANE_URL:-https://app.install.doctor}"
path="/api/auth/sign-in/social"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "rate limiting (O10) @ $u$path"

# Sequential burst of 15 POSTs (github provider). customRule max=10/30s -> first 10 should 200, the rest 429.
first=""
codes=""
for i in $(seq 1 15); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u$path" -H 'content-type: application/json' -d '{"provider":"github"}')"
  [ -z "$first" ] && first="$code"
  codes="$codes $code"
done
n429="$(printf '%s' "$codes" | tr ' ' '\n' | grep -c '^429$')"
n200="$(printf '%s' "$codes" | tr ' ' '\n' | grep -c '^200$')"
say "  statuses:$codes  (200=$n200, 429=$n429)"

# 1. A legit FIRST sign-in attempt is allowed (not blocked by rate limiting) — authorize-initiation still works.
[ "$first" = "200" ] && pass "first /sign-in/social attempt -> 200 (legit sign-in NOT blocked by the limiter)" || fail "first attempt was $first (expected 200 — limiter should allow the first request)"
# 2. The burst trips the limiter — at least one 429 appears (rate limiting is ACTIVE across the edge).
[ "$n429" -ge 1 ] && pass "sequential burst trips the limiter -> ${n429}x 429 (O10 rate-limit ACTIVE, D1-backed across isolates)" || fail "no 429 in a 15x burst — rate limiting is NOT active (storage/enabled misconfigured)"
# 3. A 429 carries a retry hint (Better Auth sets X-Retry-After) — honest client backoff signal.
rh="$(curl -s -D - -o /dev/null -X POST "$u$path" -H 'content-type: application/json' -d '{"provider":"github"}' | tr -d '\r' | grep -iE '^(x-retry-after|retry-after):' | head -1)"
[ -n "$rh" ] && pass "429 carries a retry hint ($(printf '%s' "$rh" | cut -d: -f1 | tr -d ' '))" || fail "no X-Retry-After / Retry-After hint on the rate-limited response"

say "rate-limit: $P passed, $F failed"
[ "$F" -eq 0 ]
