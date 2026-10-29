#!/usr/bin/env bash
# D13/X-class gate — the catalog SIZE is a DERIVED stat (bundled catalog.json length, regenerated from
# software.yml on every catalog change). A hardcoded present-tense count in the ledgers therefore ROTS
# the moment the catalog grows (#156 added alloy 1068→1069; #157 "reconciled" one surface but missed the
# siblings + added NO guard → re-drift). This guard makes the drift class impossible: (1) the bundled
# catalog.json length is the ground truth; (2) the LIVE /api/catalog `total` must equal it (deploy/source
# consistency — the real verify-against-source-of-truth reconciliation); (3) no ledger may carry a
# present-tense catalog-TOTAL claim (`N entries` / `N apps` / `N-entry` / `of N apps` / `N of N apps`)
# whose N != the ground truth — HISTORICAL `N→M` transition records and quoted `'N entries'` references
# are exempt. Pure file assertions for (1)+(3); (2) soft-skips when the network is unreachable.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG="$ROOT/packages/control-plane/src/catalog.json"
URL="${CONTROL_PLANE_URL:-https://app.install.doctor}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 244 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "catalog-count doc reconciliation (D13/X-class)"

if [ ! -s "$CATALOG" ]; then
  fail "bundled catalog.json missing ($CATALOG)"
  say "catalog-count: $P passed, $F failed"
  exit 1
fi

# (1) ground truth — the bundled catalog length (what the Worker serves).
GROUND="$(python3 -c "import json;print(len(json.load(open('$CATALOG'))))" 2>/dev/null || echo 0)"
if [ "$GROUND" -gt 0 ] 2>/dev/null; then
  pass "ground-truth catalog size resolved ($GROUND entries)"
else
  fail "could not resolve catalog size from $CATALOG"
  say "catalog-count: $P passed, $F failed"
  exit 1
fi

# (2) live /api/catalog `total` must equal the bundled length (deploy ↔ source consistency). Soft-skip offline.
LIVE="$(curl -fsS --max-time 12 "$URL/api/catalog?limit=1" -H "User-Agent: $UA" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('total',''))" 2>/dev/null || echo "")"
if [ -z "$LIVE" ]; then
  skip "live /api/catalog unreachable — skipping deploy↔source total check (offline/CI)"
elif [ "$LIVE" = "$GROUND" ]; then
  pass "live /api/catalog total ($LIVE) == bundled catalog.json length (deploy matches source)"
else
  fail "live /api/catalog total ($LIVE) != bundled catalog.json length ($GROUND) — deploy/source drift"
fi

# (3) no ledger may carry a STALE present-tense catalog-TOTAL claim. Historical N→M transitions + quoted
# 'N entries' references are stripped first so only present-tense claims are scanned.
SCAN="$(GROUND="$GROUND" python3 - "$ROOT/docs/aid/CURRENT-STATE.md" "$ROOT/docs/aid/NEXT-STEPS.md" "$ROOT/docs/aid/REQUIREMENTS.md" "$ROOT/docs/aid/MASTER-PROMPT.md" <<'PY'
import os, re, sys
ground = int(os.environ["GROUND"])
bad, seen = [], set()
# present-tense catalog-TOTAL claim patterns → the capture group is the TOTAL number asserted. Covers the
# headline count (`N entries`/`N apps`/`N-entry`/`N of N apps`) AND the fraction/breakdown DENOMINATOR
# (`906/1069 entries`, `960/1069 carry …`, `… of 1069`) — gated to 4-digit so small fractions don't trip it.
pats = [
    re.compile(r'(?<!\d)(\d{3,4})\s+entries'),
    re.compile(r'(?<!\d)(\d{3,4})\s+apps'),
    re.compile(r'(?<!\d)(\d{3,4})-entry'),
    re.compile(r'of\s+(\d{3,4})\s+apps'),
    # coverage-fraction DENOMINATOR, anchored to a catalog noun so unrelated 4-digit fractions
    # (research "0/1200", ADR "/0001") are NOT matched: 906/1069 entries · 961/1069 carry …
    re.compile(r'/(\d{4})\s+(?:entries|carry|apps|have)'),
]
QUOTES = "\"'“”‘’"            # straight + smart single/double
for path in sys.argv[1:]:
    if not os.path.exists(path):
        continue
    for i, line in enumerate(open(path, encoding="utf-8"), 1):
        # strip HISTORICAL transition records + quoted/backticked-literal references so only PRESENT-TENSE
        # PROSE claims scan (doc convention: a live claim is bare prose like "1069 entries"; a literal or a
        # historical drift-example is wrapped in `backticks` or quotes — e.g. a fire log citing the old value).
        s = re.sub(r"`[^`]*`", " ", line)                                               # `1068 entries` / `489/1068` backtick-literal (Last-fire examples)
        s = re.sub(r"\d+\s*(?:→|->)\s*\d+", " ", s)                                     # 1068→1069 / 1068->1069
        s = re.sub(rf"[{QUOTES}]\s*\d{{3,4}}\s+entries\s*[{QUOTES}]", " ", s)           # "1068 entries" quoted-historical (any quote style)
        for pat in pats:
            for m in pat.finditer(s):
                n = int(m.group(1))
                key = (os.path.basename(path), i, n)
                if n != ground and key not in seen:
                    seen.add(key)
                    bad.append(f"{os.path.basename(path)}:{i}: '{m.group(0).strip()}' (expected {ground})")
if bad:
    print("\n".join(bad))
PY
)"
if [ -z "$SCAN" ]; then
  pass "no stale present-tense catalog-total claims in the ledgers (all == $GROUND)"
else
  while IFS= read -r line; do fail "stale catalog-total claim → $line"; done <<< "$SCAN"
fi

say "catalog-count: $P passed, $F failed"
[ "$F" -eq 0 ]
