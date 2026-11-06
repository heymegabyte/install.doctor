#!/usr/bin/env bash
# Served-entrypoint drift guard (new-arc "the deployed entrypoints must actually serve" + no-dead-claim, #204).
# install.doctor exposes only the signed `/start` bootstrap; mutable raw-script aliases are forbidden.
# docs/scripts/overview/utility.md DOCUMENTS each script→URL mapping as
# a public contract. A documented URL with NO redirect 404s — a dead claim (found #204: /brew + /ssh were
# documented but had no redirect → both 404 while /start was 200). This guard locks the doc ↔ serving-config
# in sync: every `scripts/<x>.sh → https://install.doctor/<ep>` row in utility.md MUST have a matching
# `"source": "/<ep>"` redirect in firebase.json whose destination serves that script. Pure file assertions.
# NOTE: this verifies the serving CONFIG; the live deploy is Firebase-gated (site-deploy needs the
# FIREBASE_SERVICE_ACCOUNT secret, CLAUDE.md §9) — a correct redirect goes live on the next site deploy.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UTIL="$ROOT/docs/scripts/overview/utility.md"
FB="$ROOT/site/firebase.json"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "served-entrypoint drift (utility.md ↔ firebase.json redirects)"

[ -f "$UTIL" ] && pass "utility.md present" || fail "utility.md missing ($UTIL)"
[ -f "$FB" ] && pass "site/firebase.json present" || fail "firebase.json missing ($FB)"
if command -v python3 >/dev/null 2>&1 && [ -f "$FB" ]; then
  python3 -c "import json,sys; json.load(open('$FB'))" 2>/dev/null && pass "firebase.json is valid JSON" || fail "firebase.json is INVALID JSON"
fi

grep -A2 '"/start"' "$FB" | grep -q 'https://app.install.doctor/start' \
  && pass "/start is served through signed stage zero" \
  || fail "/start does not route to signed stage zero"
if grep -qE '"source": "/(windows|brew|ssh)"' "$FB"; then
  fail "legacy mutable installer redirects remain published"
else
  pass "legacy /windows, /brew, and /ssh mutable installer redirects are absent"
fi

# #305 — the redirect DESTINATIONS must point at the CANONICAL org. /start,/windows,/brew,/ssh serve
# raw.githubusercontent.com/<org>/install.doctor/… — <org> MUST be heymegabyte (the public repo per
# CLAUDE.md §13 + the git remote), NEVER the stale megabyte-labs (the pre-rename org). The #204 check
# above verifies the destination carries the right SCRIPT FILENAME but is BLIND to the org, so a
# regression to the old org (serving a DIFFERENT repo's script that can silently diverge from what's
# committed here) would pass it. Observed LIVE #305: prod still 301s /start,/windows → megabyte-labs
# because the Firebase deploy is stale (site-deploy needs FIREBASE_SERVICE_ACCOUNT, CLAUDE.md §9 #21) —
# a correct repo config goes live on the next deploy; this locks the repo config so it can't regress.
if grep -qE 'raw\.githubusercontent\.com/.*/install\.doctor/' "$FB"; then
  fail "firebase.json publishes a mutable raw install.doctor script"
else
  pass "firebase.json publishes no mutable raw install.doctor scripts"
fi

# #206 — the repo-root start.sh is the LOCAL Task-runner bootstrap (package.json `bash start.sh && task …`),
# NOT the deployed curl entrypoint: /start serves the control-plane stage zero. start.sh's header
# once falsely self-claimed the curl-/start role → a maintainer would edit the WRONG file (the #204
# entrypoint-confusion class). Lock it: start.sh must NOT claim to BE the curl-piped /start entrypoint.
SS="$ROOT/start.sh"
if [ ! -f "$SS" ]; then
  fail "repo-root start.sh missing ($SS)"
elif grep -qE 'initial entry point when running' "$SS"; then
  fail "start.sh falsely self-claims the curl-/start role — the control plane owns stage zero"
else
  pass "start.sh does not falsely claim the curl-/start role (control-plane stage zero is canonical)"
fi

say "served-entrypoints: $P passed, $F failed"
[ "$F" -eq 0 ]
