#!/usr/bin/env bash
# X03 gate — docs/aid/api-reference.md documents EVERY control-plane HTTP route, and ONLY real routes.
# Derives the live route set from src/index.ts `app.<method>('<path>')` registrations and diffs BOTH ways:
#   (a) every live route has a backtick-wrapped `METHOD /path` entry in the doc (no UNdocumented route);
#   (b) every `METHOD /path` entry in the doc is a live route (no STALE / fabricated route).
# Backtick-exact whole-line match avoids prefix false-positives (/api/device/current vs .../current.md).
# Portable: awk toupper (not GNU sed \U). No network — pure source+doc diff, runs anywhere.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/control-plane/src/index.ts"
DOC="$ROOT/docs/aid/api-reference.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "api-reference (X03)"

[ -f "$SRC" ] || { fail "control-plane src missing ($SRC)"; say "api-reference: $P passed, $F failed"; exit 1; }
if [ ! -s "$DOC" ]; then
  fail "docs/aid/api-reference.md missing ($DOC)"
  say "api-reference: $P passed, $F failed"
  exit 1
fi

# Live route set: METHOD /path (uppercased method), unique+sorted.
LIVE="$(grep -oE "app\.(get|post|put|delete)\('[^']+'" "$SRC" \
  | sed -E "s/app\.([a-z]+)\('([^']+)'/\1 \2/" \
  | awk '{ print toupper($1) " " $2 }' | sort -u)"
# Documented route set: backtick-wrapped `METHOD /path`, unique+sorted.
DOCR="$(grep -oE '`(GET|POST|PUT|DELETE) /[^`]*`' "$DOC" | tr -d '`' | sort -u)"

livec="$(printf '%s\n' "$LIVE" | grep -c .)"
docc="$(printf '%s\n' "$DOCR" | grep -c .)"

# (a) every live route is documented
missing=0
while IFS= read -r r; do
  [ -z "$r" ] && continue
  printf '%s\n' "$DOCR" | grep -qxF "$r" || { fail "undocumented route: $r"; missing=1; }
done <<EOF
$LIVE
EOF
[ "$missing" = 0 ] && pass "every live route is documented ($livec routes)"

# (b) every documented route exists in src (no stale/fabricated entries)
stale=0
while IFS= read -r r; do
  [ -z "$r" ] && continue
  printf '%s\n' "$LIVE" | grep -qxF "$r" || { fail "doc lists a non-existent route: $r"; stale=1; }
done <<EOF
$DOCR
EOF
[ "$stale" = 0 ] && pass "every documented route exists in src ($docc entries, no stale)"

# parity + structure
[ "$livec" = "$docc" ] && pass "route count parity: $livec live == $docc documented" || fail "count mismatch: $livec live vs $docc documented"
grep -qiE '\| *auth *\||auth' "$DOC" && pass "doc records an auth column/field per route" || fail "doc missing auth classification"
grep -qiE 'device token|AID_ADMIN_TOKEN|admin' "$DOC" && pass "doc names the real auth mechanisms (admin token / device token)" || fail "doc missing real auth mechanisms"
# fire #100 — X03 is route-derived + can't catch a new PARAM on an existing route. The /api/catalog row MUST
# reflect the real filters the API gained: ?q= now searches descriptions (#94) + ?platform= (#97). Lock it so
# the doc can't silently drift from the shipped filters (verify-against-source-of-truth).
catline="$(grep -F '`GET /api/catalog`' "$DOC")"
{ printf '%s' "$catline" | grep -qi 'platform' && printf '%s' "$catline" | grep -qiE 'descrip'; } && pass "doc documents /api/catalog filters (?platform= + description search, not just name/bin)" || fail "catalog filters stale in api-reference (needs ?platform= + description) -> $(printf '%s' "$catline" | head -c 160)"

say "api-reference: $P passed, $F failed"
[ "$F" -eq 0 ]
