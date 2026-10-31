#!/usr/bin/env bash
# Served-entrypoint drift guard (new-arc "the deployed entrypoints must actually serve" + no-dead-claim, #204).
# install.doctor serves standalone bootstrap scripts at short URLs via site/firebase.json `redirects`
# (e.g. /start → scripts/provision.sh). docs/scripts/overview/utility.md DOCUMENTS each script→URL mapping as
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

# Every utility.md row mapping `scripts/<x>.sh` → `https://install.doctor/<ep>` is a served-URL contract.
# Here-string (not a pipe) so the pass/fail counters survive (no subshell).
pairs="$(grep -E '`scripts/[a-z.-]+`' "$UTIL" 2>/dev/null | grep 'install.doctor/' \
  | sed -E 's#.*`(scripts/[a-z.-]+)`.*install\.doctor/([a-z]+).*#\2 \1#' | grep -E '^[a-z]+ scripts/')"
if [ -z "$pairs" ]; then
  fail "no documented script→URL entrypoint rows found in utility.md (extraction broke?)"
else
  while read -r ep script; do
    [ -z "$ep" ] && continue
    sfile="$(basename "$script")"
    if grep -qE "\"source\": \"/$ep\"" "$FB" && grep -qE "$sfile\"" "$FB"; then
      pass "/$ep is served — firebase.json redirects it to $script (documented in utility.md)"
    else
      fail "/$ep is DOCUMENTED (→ $script) but has NO matching firebase.json redirect → it 404s (dead claim)"
    fi
  done <<< "$pairs"
fi

# #305 — the redirect DESTINATIONS must point at the CANONICAL org. /start,/windows,/brew,/ssh serve
# raw.githubusercontent.com/<org>/install.doctor/… — <org> MUST be heymegabyte (the public repo per
# CLAUDE.md §13 + the git remote), NEVER the stale megabyte-labs (the pre-rename org). The #204 check
# above verifies the destination carries the right SCRIPT FILENAME but is BLIND to the org, so a
# regression to the old org (serving a DIFFERENT repo's script that can silently diverge from what's
# committed here) would pass it. Observed LIVE #305: prod still 301s /start,/windows → megabyte-labs
# because the Firebase deploy is stale (site-deploy needs FIREBASE_SERVICE_ACCOUNT, CLAUDE.md §9 #21) —
# a correct repo config goes live on the next deploy; this locks the repo config so it can't regress.
dests="$(grep -oE 'raw\.githubusercontent\.com/[a-z0-9.-]+/install\.doctor/' "$FB" 2>/dev/null)"
if [ -z "$dests" ]; then
  fail "no install.doctor raw-githubusercontent redirect destinations found in firebase.json (extraction broke?)"
elif printf '%s\n' "$dests" | grep -qE 'megabyte-labs/install\.doctor/'; then
  fail "a firebase.json redirect points at the STALE megabyte-labs/install.doctor org — must be heymegabyte (CLAUDE.md §13)"
elif printf '%s\n' "$dests" | grep -qvE 'heymegabyte/install\.doctor/'; then
  fail "a firebase.json install.doctor redirect destination is not on the canonical heymegabyte org"
else
  pass "every install.doctor redirect destination uses the canonical heymegabyte org (not the stale megabyte-labs)"
fi

# #206 — the repo-root start.sh is the LOCAL Task-runner bootstrap (package.json `bash start.sh && task …`),
# NOT the deployed curl entrypoint: /start serves scripts/provision.sh (asserted above). start.sh's header
# once falsely self-claimed the curl-/start role → a maintainer would edit the WRONG file (the #204
# entrypoint-confusion class). Lock it: start.sh must NOT claim to BE the curl-piped /start entrypoint.
SS="$ROOT/start.sh"
if [ ! -f "$SS" ]; then
  fail "repo-root start.sh missing ($SS)"
elif grep -qE 'initial entry point when running' "$SS"; then
  fail "start.sh falsely self-claims the curl-/start entrypoint role — but /start serves scripts/provision.sh (edit provision.sh for the deployed bootstrap)"
else
  pass "start.sh does not falsely claim the curl-/start role (the deployed /start is scripts/provision.sh; start.sh is the local Task bootstrap)"
fi

say "served-entrypoints: $P passed, $F failed"
[ "$F" -eq 0 ]
