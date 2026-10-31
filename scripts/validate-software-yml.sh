#!/usr/bin/env bash
# scripts/validate-software-yml.sh — Validate software.yml structure.
# Checks for required fields, valid install methods, and malformed entries.
# Exits non-zero on violations.
set -euo pipefail

SW_YML="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/software.yml"
PASS=0
FAIL=0

echo "=== software.yml Validator ==="
echo "File: $SW_YML"
echo ""

# ---------------------------------------------------------------------------
# Check 1: File exists and is non-empty
# ---------------------------------------------------------------------------
if [ ! -f "$SW_YML" ]; then
  echo "FAIL: software.yml not found"
  exit 1
fi
LINES=$(wc -l < "$SW_YML" | tr -d ' ')
echo "PASS: software.yml exists ($LINES lines)"
PASS=$((PASS + 1))

# ---------------------------------------------------------------------------
# Check 2: Every top-level entry has _name
# ---------------------------------------------------------------------------
# Count entries in the softwarePackages section (indented 2 spaces under softwarePackages:)
ENTRIES_TOTAL=$(sed -n '/^softwarePackages:/,/^[^ ]/p' "$SW_YML" | /usr/bin/grep -c '^  [a-z]' 2>/dev/null || echo "0")
ENTRIES_WITH_NAME=$(sed -n '/^softwarePackages:/,/^[^ ]/p' "$SW_YML" | /usr/bin/grep -c '    _name:' 2>/dev/null || echo "0")

if [ "$ENTRIES_TOTAL" -eq "$ENTRIES_WITH_NAME" ] 2>/dev/null; then
  echo "PASS: All $ENTRIES_TOTAL entries have _name field"
  PASS=$((PASS + 1))
else
  MISSING=$((ENTRIES_TOTAL - ENTRIES_WITH_NAME))
  echo "WARN: $MISSING of $ENTRIES_TOTAL entries may be missing _name (some may be sub-entries)"
fi

# ---------------------------------------------------------------------------
# Check 3: No empty _deprecated (must have a reason)
# ---------------------------------------------------------------------------
EMPTY_DEPRECATED=$(/usr/bin/grep -c '_deprecated: ""$\|_deprecated: $''\|_deprecated: TODO$' "$SW_YML" 2>/dev/null | tr -d '[:space:]' || echo "0")
if [ "${EMPTY_DEPRECATED}" -le 0 ] 2>/dev/null; then
  echo "PASS: No empty _deprecated entries"
  PASS=$((PASS + 1))
else
  echo "FAIL: $EMPTY_DEPRECATED _deprecated entries have no reason"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Check 4: Count deprecated + install method conflicts
# (entries with _deprecated AND _todo are double-indicated)
# ---------------------------------------------------------------------------
DOUBLE_TAGGED=$(/usr/bin/grep -B50 '_todo:' "$SW_YML" | /usr/bin/grep -c '_deprecated:' 2>/dev/null || echo "0")
if [ "$DOUBLE_TAGGED" -eq 0 ]; then
  echo "PASS: No entries with both _deprecated and _todo"
  PASS=$((PASS + 1))
else
  echo "WARN: $DOUBLE_TAGGED entries have both _deprecated and _todo (non-blocking)"
fi

# ---------------------------------------------------------------------------
# Check 5: No malformed conditional install keys (_when with no target)
# ---------------------------------------------------------------------------
MALFORMED_WHEN=$(/usr/bin/grep -c '_when:$\|_when: ""\|_when:cask:$\|_when:apt:$' "$SW_YML" 2>/dev/null | tr -d '[:space:]' || echo "0")
if [ "${MALFORMED_WHEN}" -le 0 ] 2>/dev/null; then
  echo "PASS: No malformed _when conditional keys"
  PASS=$((PASS + 1))
else
  echo "FAIL: $MALFORMED_WHEN malformed _when conditional keys"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Check 6: Count entries by install method
# ---------------------------------------------------------------------------
echo ""
echo "=== Install Method Summary ==="
for method in brew cask apt npm pipx cargo go snap flatpak pacman dnf choco scoop yay; do
  count=$(/usr/bin/grep -c "    ${method}:" "$SW_YML" 2>/dev/null || echo "0")
  [ "$count" -gt 0 ] && echo "  $method: $count entries"
done

# ---------------------------------------------------------------------------
# Check 7 (#299): No DUPLICATE package keys. YAML parsers (yaml.safe_load) silently keep the LAST of a
# duplicated key and DROP the first — so a dup ships wrong install data or masks a catalog entry with NO
# parse error. Count the 2-space-indented keys in softwarePackages directly (the regex catches exact dups).
# software.yml is the most-edited file → a real "ensure there is no duplicate code" regression path.
# ---------------------------------------------------------------------------
echo ""
DUP_KEYS=$(sed -n '/^softwarePackages:/,/^[^ ]/p' "$SW_YML" | python3 -c 'import re,sys,collections; c=collections.Counter(m.group(1) for m in (re.match(r"^  ([A-Za-z0-9][\w.@/+-]*):\s*$", l) for l in sys.stdin) if m); d=sorted(k for k,v in c.items() if v>1); sys.stderr.write(("  duplicated: "+", ".join(d)+"\n") if d else ""); print(len(d))' 2>&2 || echo 0)
if [ "${DUP_KEYS:-0}" -eq 0 ] 2>/dev/null; then
  echo "PASS: No duplicate package keys in softwarePackages (YAML last-wins would silently drop the first)"
  PASS=$((PASS + 1))
else
  echo "FAIL: $DUP_KEYS duplicate package key(s) in softwarePackages — YAML silently keeps the LAST + drops the first (wrong install data / masked entry)"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
