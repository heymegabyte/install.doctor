#!/usr/bin/env bash
# O-series — Better Auth sign-in (Phase 3 keystone; fire #102). The control plane mounts Better Auth at
# /api/auth/* with GitHub + Google social providers backed by D1. This suite verifies the VERIFIABLE half:
# the OAuth authorize-INITIATION — POST /api/auth/sign-in/social returns the provider's real authorize URL
# carrying the configured client_id + the app.install.doctor callback. Sign-in COMPLETION (callback → session)
# is human-gated on the OAuth app having the callback URL registered, and is NOT asserted here (honest).
set -uo pipefail
u="${CONTROL_PLANE_URL:-https://app.install.doctor}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "Better Auth sign-in (O-series) @ $u"

# 1. The Better Auth handler is mounted (a GET under /api/auth/* is NOT the control-plane's generic 404).
authget="$(curl -s "$u/api/auth/ok" 2>/dev/null)"
echo "$authget" | grep -qiE '"ok"|ok' && pass "GET /api/auth/ok -> Better Auth handler responds (mounted)" || fail "auth handler not mounted -> $(printf '%s' "$authget" | head -c 120)"

# 2. GitHub social sign-in -> a real github.com authorize URL carrying a client_id (O01).
gh="$(curl -s -X POST -H 'content-type: application/json' -d '{"provider":"github","callbackURL":"/"}' "$u/api/auth/sign-in/social" 2>/dev/null)"
echo "$gh" | jq -e '(.url // "") | test("github\\.com/login/oauth/authorize") and test("client_id=")' >/dev/null 2>&1 && pass "POST /api/auth/sign-in/social github -> real github.com authorize URL + client_id (O01 authorize-initiation)" || fail "github authorize-init -> $(printf '%s' "$gh" | head -c 200)"

# 3. Google social sign-in -> a real accounts.google.com authorize URL (O02).
goog="$(curl -s -X POST -H 'content-type: application/json' -d '{"provider":"google","callbackURL":"/"}' "$u/api/auth/sign-in/social" 2>/dev/null)"
echo "$goog" | jq -e '(.url // "") | test("accounts\\.google\\.com") and test("client_id=")' >/dev/null 2>&1 && pass "POST /api/auth/sign-in/social google -> real accounts.google.com authorize URL + client_id (O02 authorize-initiation)" || fail "google authorize-init -> $(printf '%s' "$goog" | head -c 200)"

# 4. The authorize URL points the callback back at app.install.doctor (O04 production callback URL).
echo "$gh" | jq -e '(.url // "") | test("app\\.install\\.doctor")' >/dev/null 2>&1 && pass "github authorize URL redirect_uri targets app.install.doctor (O04 prod callback)" || fail "github redirect_uri not app.install.doctor -> $(printf '%s' "$gh" | head -c 200)"

# 5. The OAuth client SECRETS are never exposed to the browser (O06) — the authorize URL has no client_secret.
echo "$gh" | grep -qiE 'client_secret|GOCSPX|ghs_|github_pat' && fail "a client secret leaked into the authorize response" || pass "no client secret in the authorize response (secrets stay backend-side)"

# 6. fire #103 — the /login PAGE (intended-experience step 3; M06 clear GitHub/Google sign-in choices):
#    GitHub + Google buttons wired to the live POST /api/auth/sign-in/social.
lp="$(curl -s "$u/login" 2>/dev/null)"
{ echo "$lp" | grep -qiE 'sign in' && echo "$lp" | grep -qi 'GitHub' && echo "$lp" | grep -qi 'Google' && echo "$lp" | grep -q '/api/auth/sign-in/social' && echo "$lp" | grep -q 'signIn('; } && pass "GET /login -> GitHub + Google sign-in page wired to /api/auth/sign-in/social (M06 #103)" || fail "login page -> $(printf '%s' "$lp" | grep -oiE 'sign in|github|google|/api/auth/sign-in/social|signIn\(' | sort -u | tr '\n' ' ')"
# 7. /login is reachable from the landing page (interconnectedness — not an orphan route).
curl -s "$u/" 2>/dev/null | grep -q 'href="/login"' && pass "landing page links to /login (sign-in discoverable; M06)" || fail "landing page has no /login link"

# 8. fire #104 — GET /api/auth/get-session returns null when unauthenticated (honest no-session; O13).
[ "$(curl -s "$u/api/auth/get-session" 2>/dev/null)" = "null" ] && pass "GET /api/auth/get-session (unauth) -> null (honest no-session; O13)" || fail "get-session unauth -> $(curl -s "$u/api/auth/get-session" 2>/dev/null | head -c 80)"
# 9. The shared page chrome shows a session-aware auth status: get-session -> user + Sign out | Sign in (O13).
ch="$(curl -s "$u/machines" 2>/dev/null)"
{ echo "$ch" | grep -q 'aidAuthStatus' && echo "$ch" | grep -q '/api/auth/get-session' && echo "$ch" | grep -qi 'Sign out' && echo "$ch" | grep -q '/api/auth/sign-out' && echo "$ch" | grep -q 'href="/login"'; } && pass "dashboard chrome -> session-aware auth status (get-session -> user+Sign out | Sign in; O13 #104)" || fail "auth status chrome -> $(printf '%s' "$ch" | grep -oE 'aidAuthStatus|get-session|Sign out|sign-out' | sort -u | tr '\n' ' ')"

say "auth: $P passed, $F failed"
[ "$F" -eq 0 ]
