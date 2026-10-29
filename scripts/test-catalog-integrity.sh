#!/usr/bin/env bash
# D12/D02/D05 — catalog integrity (fire #133). (1) PROVE the validator catches real conflicts + does NOT
# false-flag legitimate platform splits (synthetic fixtures — the RED that proves the detector can fail),
# (2) run it on the COMMITTED catalog.json (must be conflict-free), (3) live-assert /api/catalog/:name
# returns the CANONICAL entry (bin===name) for a multi-bin package (e.g. xz → the `xz` bin, not `unxz`).
set -uo pipefail
u="${CONTROL_PLANE_URL:-https://app.install.doctor}"
dir="$(cd "$(dirname "$0")" && pwd)"
CAT="$dir/../packages/control-plane/src/catalog.json"
VAL="$dir/validate-catalog.py"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "catalog integrity (D12) @ $CAT"

# 1. The validator + the committed catalog both exist, and the REAL catalog has 0 true conflicts.
if [ -f "$VAL" ] && [ -f "$CAT" ]; then
  if out="$(python3 "$VAL" "$CAT" 2>&1)"; then
    pass "committed catalog is conflict-free — $(printf '%s' "$out" | grep -oE '[0-9]+ catalog entries' | head -1), unambiguous bins/providers/modes (D12)"
  else
    fail "committed catalog has conflicts: $(printf '%s' "$out" | head -4 | tr '\n' ' ')"
  fi
else
  fail "validator or catalog missing (VAL=$VAL CAT=$CAT)"
fi

# 2. FIXTURE — two entries sharing a bin on an OVERLAPPING platform → the validator MUST flag it (exit 1).
fx1="$(mktemp)"
cat >"$fx1" <<'JSON'
[{"name":"a","bin":"x","providers":["brew"],"pkgs":{"brew":"a"},"platforms":["macos","linux"],"installMode":"cli"},
 {"name":"b","bin":"x","providers":["brew"],"pkgs":{"brew":"b"},"platforms":["macos"],"installMode":"cli"}]
JSON
if python3 "$VAL" "$fx1" >/dev/null 2>&1; then fail "validator MISSED a same-bin overlapping-platform conflict (fixture)"; else pass "validator catches a same-bin overlapping-platform conflict (fixture RED → the detector can fail)"; fi
rm -f "$fx1"

# 3. FIXTURE — a DISJOINT-platform same-bin split (like devtoys/devtoys-windows) is legitimate → exit 0.
fx2="$(mktemp)"
cat >"$fx2" <<'JSON'
[{"name":"a","bin":"x","providers":["brew"],"pkgs":{"brew":"a"},"platforms":["macos"],"installMode":"app"},
 {"name":"a-win","bin":"x","providers":["choco"],"pkgs":{"choco":"a"},"platforms":["windows"],"installMode":"cli"}]
JSON
if python3 "$VAL" "$fx2" >/dev/null 2>&1; then pass "validator ALLOWS a disjoint-platform same-bin split (no false positive)"; else fail "validator false-flagged a legitimate disjoint-platform split"; fi
rm -f "$fx2"

# 4. FIXTURE — providers[] not matching pkgs keys → exit 1.
fx3="$(mktemp)"
cat >"$fx3" <<'JSON'
[{"name":"a","bin":"a","providers":["brew","apt"],"pkgs":{"brew":"a"},"platforms":["macos"],"installMode":"cli"}]
JSON
if python3 "$VAL" "$fx3" >/dev/null 2>&1; then fail "validator MISSED a providers<->pkgs mismatch (fixture)"; else pass "validator catches a providers<->pkgs mismatch (fixture)"; fi
rm -f "$fx3"

# 5. FIXTURE — a bad installMode → exit 1.
fx4="$(mktemp)"
cat >"$fx4" <<'JSON'
[{"name":"a","bin":"a","providers":["brew"],"pkgs":{"brew":"a"},"platforms":["macos"],"installMode":"wat"}]
JSON
if python3 "$VAL" "$fx4" >/dev/null 2>&1; then fail "validator MISSED a bad installMode (fixture)"; else pass "validator catches an invalid installMode (fixture)"; fi
rm -f "$fx4"

# 6-9. LIVE — /api/catalog/:name returns the CANONICAL entry (bin===name) for a multi-bin package (#133 fix).
#      Pre-fix the name-keyed Map kept the LAST sibling (xz→unxz, bzip2→bunzip2, kvm→qemu-img, rar→unrar).
for nm in xz bzip2 kvm rar; do
  gotbin="$(curl -s "$u/api/catalog/$nm" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('bin',''))" 2>/dev/null)"
  [ "$gotbin" = "$nm" ] && pass "GET /api/catalog/$nm -> canonical bin '$nm' (multi-bin package resolves to its namesake command; #133 D02/D12)" || fail "/api/catalog/$nm returned bin '$gotbin' (want canonical '$nm')"
done

say "catalog-integrity: $P passed, $F failed"
[ "$F" -eq 0 ]
